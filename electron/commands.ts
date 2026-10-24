/// <reference types="node" />
import './env';
import { PowerShellCommandResult, ProgressLogger, runPowerShell } from './util/os-util';
import { assertAppId, assertGroupId, assertPolicyName, psSingleQuote } from './util/validate';

type AccessPolicy = {
    Identity?: string;
    Description?: string;
    AppIds?: string[] | string;
};

export interface User {
    Id: string;
    DisplayName: string;
    UserPrincipalName: string;
}

export interface Group {
    Id: string;
    DisplayName: string;
}

export interface UserSearchResult {
    users: User[];
    total: number;
}

export interface GroupSearchResult {
    groups: Group[];
    total: number;
}

export interface UserAndGroupListResult {
    users: User[];
    groups: Group[];
    usersTotal: number;
    groupsTotal: number;
}

const AZ_LIST_LIMIT = 10;

function normalizeUsers(users: User[] | User | null): User[] {
    if (!users) {
        return [];
    }

    return Array.isArray(users) ? users : [users];
}

function normalizeGroups(groups: Group[] | Group | null): Group[] {
    if (!groups) {
        return [];
    }

    return Array.isArray(groups) ? groups : [groups];
}

function withTeamsLoginCheck(commands: string[]): string {
    return [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        'Import-Module MicrosoftTeams -ErrorAction Stop',
        "Connect-MicrosoftTeams -ErrorAction Stop | Out-Null",
        // 'try { Get-CsTenant -ErrorAction Stop | Out-Null } catch { Connect-MicrosoftTeams -ErrorAction Stop | Out-Null }',
        ...commands
    ].join('; ');
}

function withAzCliCheck(commands: string[]): string {
    return [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        "$azCli = (Get-Command 'az.exe' -ErrorAction SilentlyContinue).Source",
        "if (-not $azCli) { $azCli = (Get-Command 'az' -ErrorAction Stop).Source }",
        ...commands
    ].join('; ');
}

function parseJsonFromPowerShellOutput<T>(rawOutput: string, log?: ProgressLogger): T | null {
    const output = rawOutput.trim();
    if (!output || output === 'NO_POLICIES_FOUND') {
        return null;
    }

    const ansiCleaned = output.replace(/\u001b\[[0-9;]*m/g, '');
    const firstJsonStart = ansiCleaned.search(/[\[{\"]/);
    const jsonCandidate = firstJsonStart >= 0 ? ansiCleaned.slice(firstJsonStart).trim() : ansiCleaned;

    try {
        return JSON.parse(jsonCandidate) as T;
    } catch (parseError: any) {
        log?.(`Failed to parse PowerShell JSON output. ${parseError?.message || 'Unknown parse error.'}`);
        log?.(`Raw output: ${ansiCleaned}`);
        return null;
    }
}

/**
 * Connects to Microsoft Teams to validate authentication and module readiness.
 * @param log Optional logger to track the progress of the command execution.
 * @returns A promise that resolves with the result of the PowerShell command execution.
 */
export async function connectToMicrosoftTeams(log?: ProgressLogger, successMessage?: string): Promise<PowerShellCommandResult> {
    const script = withTeamsLoginCheck(['Write-Output "TEAMS_SESSION_READY"']);

    return runPowerShell(script, log, successMessage || 'Successfully connected to Microsoft Teams.');
}

/**
 * Retrieves all CS Application Access Policies.
 * @param log Optional logger to track the progress of the command execution.
 * @returns A promise that resolves with the result of the PowerShell command execution.
 */
export async function getAllAccessPolicies(log: ProgressLogger, successMessage?: string): Promise<AccessPolicy[] | AccessPolicy | null> {
    const script = withTeamsLoginCheck([
        '$policies = Get-CsApplicationAccessPolicy -ErrorAction Stop | Select-Object Identity, Description, AppIds; if ($null -eq $policies -or @($policies).Count -eq 0) { Write-Output "NO_POLICIES_FOUND" } else { $policies | ConvertTo-Json -Depth 5 -Compress }'
    ]);

    try {
        const result = await runPowerShell(script, log, successMessage || 'CS Application Access Policies retrieved successfully.');
        const parsed = parseJsonFromPowerShellOutput<AccessPolicy[] | AccessPolicy>(result.stdout, log);
        if (!parsed) {
            log?.('No CS Application Access Policies found.');
            return null;
        }

        log?.(`Get-CsApplicationAccessPolicy output: ${JSON.stringify(parsed, null, AZ_LIST_LIMIT)}`);
        return parsed;
    } catch (error: any) {
        log?.(`Failed to retrieve CS Application Access Policies. ${error?.message || 'Unknown error.'}`);
        return null;
    }
}

export async function getPolicyByName(log: ProgressLogger, policyName: string): Promise<AccessPolicy | null> {
    const safePolicyName = assertPolicyName(policyName);
    const script = withTeamsLoginCheck([
        `Get-CsApplicationAccessPolicy -Identity ${psSingleQuote(safePolicyName)} -ErrorAction Stop | Select-Object Identity, Description, AppIds | ConvertTo-Json -Depth 5 -Compress`
    ]);
    log(`Executing PowerShell script to retrieve CS Application Access Policy "${policyName}"...`);
    log(`PowerShell script: ${script}`);

    try {
        const result = await runPowerShell(script, log, `Checked for existence of CS Application Access Policy "${policyName}".`);
        const parsed = parseJsonFromPowerShellOutput<AccessPolicy>(result.stdout, log);
        if (!parsed) {
            log?.(`CS Application Access Policy "${policyName}" was not found.`);
            return null;
        }

        return parsed;
    } catch (error: any) {
        // log?.(`Failed to retrieve CS Application Access Policy "${policyName}". ${error?.message || 'Unknown error.'}`);
        log?.(`CS Application Access Policy "${policyName}" was not found.`);
        return null;
    }
}

async function isPolicyExist(policyName: string, log: ProgressLogger): Promise<boolean> {
    const policy = await getPolicyByName(log, policyName);
    if (policy) {
        log(`CS Application Access Policy "${policyName}" exists.`);
        return true;
    }

    return false;
}

export async function setupPolicy(log: ProgressLogger, policyName: string, appId: string): Promise<any> {
    const safePolicyName = assertPolicyName(policyName);
    const teamsAppId = assertAppId(appId);
    // Check if the policy already exists to avoid redundant setup attempts.
    const quotedPolicyName = psSingleQuote(safePolicyName);
    const quotedAppId = psSingleQuote(teamsAppId);
    const alreadyExists = await isPolicyExist(safePolicyName, log);
    if (alreadyExists) {
        log(`CS Application Access Policy "${safePolicyName}" already exists. Skipping setup.`);

        // Here even if policy exists, we want to add AppId to the policy to make sure the policy is correctly configured, so we won't return here and will proceed to add AppId to the policy if it's not already there.
        const script = withTeamsLoginCheck([
            `$existingPolicy = Get-CsApplicationAccessPolicy -Identity ${quotedPolicyName} -ErrorAction Stop`,
            `if ($existingPolicy.AppIds -notcontains ${quotedAppId}) {`,
            `  Set-CsApplicationAccessPolicy -Identity ${quotedPolicyName} -AppIds @{ Add = ${quotedAppId} } -ErrorAction Stop`,
            `  Write-Host "Updated existing policy '${safePolicyName}' with app ID." -ForegroundColor Green`,
            `} else {`,
            `  Write-Host "Existing policy '${safePolicyName}' already includes app ID. No update needed." -ForegroundColor DarkGray`,
            `}`
        ]);
        const result = await runPowerShell(script, log, `Ensured existing CS Application Access Policy "${safePolicyName}" is configured with the correct app ID.`);
        log(`Set-CsApplicationAccessPolicy output: ${result.stdout.trim()}`);

        return;
    }

    // New-CsApplicationAccessPolicy -Identity "Teams-Meeting-Policy" -AppIds "TEAMS_APP_ID"  -Description "MS teams access policy for Teams Meeting Ingest"
    log(`Setting up CS Application Access Policy for ${safePolicyName}...`);
    const script = withTeamsLoginCheck([
        `$policy = New-CsApplicationAccessPolicy -Identity ${quotedPolicyName} -AppIds ${quotedAppId} -Description "MS teams access policy for Teams Meeting Ingest"`,
        '$policy | Select-Object Identity, Description, AppIds | ConvertTo-Json -Depth 5 -Compress',
    ]);
    log(`Executing PowerShell script to set up CS Application Access Policy "${safePolicyName}"...`);
    log(`PowerShell script: ${script}`);

    const result = await runPowerShell(script, log, 'CS Application Access Policy setup is complete.');
    log(`CS Application Access Policy setup output: ${result.stdout.trim()}`);

    const parsed = parseJsonFromPowerShellOutput<AccessPolicy>(result.stdout, log);
    return parsed || null;
}

export async function grantPolicy(log: ProgressLogger, policyName: string, groupId: string, appId: string): Promise<void> {
    const safePolicyName = assertPolicyName(policyName);
    const safeGroupId = assertGroupId(groupId);
    const teamsAppId = assertAppId(appId);

    // Check if the policy already exists to avoid redundant setup attempts.
    const alreadyExists = await isPolicyExist(safePolicyName, log);
    if (alreadyExists) {
        log(`CS Application Access Policy "${safePolicyName}" already exists. Skipping setup.`);

        // Even if the policy exists, we still want to ensure it's granted to the specified group. So we won't return here and will proceed to grant the policy.
        const script = [
            `Set-CsApplicationAccessPolicy -Identity ${psSingleQuote(safePolicyName)} -AppIds ${psSingleQuote(teamsAppId)} -Description "MS teams access policy for Teams Meeting Ingest"`,
        ].join('; ');
        const result = await runPowerShell(script, log, 'Policy already exists. added appId to the policy.');
        log(`Set-CsApplicationAccessPolicy output: ${result.stdout.trim()}`);
        return;
    }

    // New-CsApplicationAccessPolicy -Identity "Teams-Meeting-Policy" -AppIds "TEAMS_APP_ID"  -Description "MS teams access policy for Teams Meeting Ingest"
    log(`Setting up CS Application Access Policy for ${safePolicyName}...`);
    const script = [
        "$ErrorActionPreference = 'Stop'",
        "$ProgressPreference = 'SilentlyContinue'",
        'Connect-MicrosoftTeams -ErrorAction Stop',
        `Grant-CsApplicationAccessPolicy -Group ${psSingleQuote(safeGroupId)} -PolicyName ${psSingleQuote(safePolicyName)} -Rank 1`
    ].join('; ');

    const result = await runPowerShell(script, log, 'Grant: CS Application Access Policy grant is complete.');
    log(`Grant-CSApplicationAccessPolicy output: ${result.stdout.trim()}`);
}

/**
 * Retrieves a list of Azure AD users using PowerShell.
 * @param log Logger to track the progress of the command execution.
 * @returns A promise that resolves with an array of user objects containing Id, DisplayName, and UserPrincipalName.
 */
export async function getUserList(log: ProgressLogger, searchText?: string): Promise<User[] | null> {
    log('Retrieving list of Azure users...');

    const trimmedSearchText = searchText?.trim();
    const escapedSearchText = trimmedSearchText ? trimmedSearchText.replace(/'/g, "''") : '';
    const usersCommand = trimmedSearchText
        ? `& $azCli ad user list --filter "startswith(displayName,'${escapedSearchText}')" --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:${AZ_LIST_LIMIT}]" --output json`
        : `& $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:${AZ_LIST_LIMIT}]" --output json`;
    const script = withAzCliCheck([
        `$groupsJson = & $azCli ad group list --query "[].{Id:id, DisplayName:displayName} | [0:${AZ_LIST_LIMIT}]" --output json`,
        `$usersJson = ${usersCommand}`,
        '$users = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
        '$payload = [PSCustomObject]@{ groups = @($groups); users = @($users) }',
        '$payload | ConvertTo-Json -Depth 5 -Compress',
    ]);
    // const script = withTeamsLoginCheck([
    //     `$users = Get-AzADUser -First 9999 | Select-Object Id, DisplayName, UserPrincipalName; if ($null -eq $users) { "[]" } else { @($users) | ConvertTo-Json -Depth 3 -Compress }`
    // ]);
    const result = await runPowerShell(script, log);
    const output = result.stdout.trim();
    if (!output) {
        return [];
    }

    // PowerShell output may occasionally include ANSI escapes or extra lines.
    const ansiCleaned = output.replace(/\u001b\[[0-9;]*m/g, '');
    const firstJsonStart = ansiCleaned.search(/[\[{\"]/);
    const jsonCandidate = firstJsonStart >= 0 ? ansiCleaned.slice(firstJsonStart).trim() : ansiCleaned;

    try {
        log?.(`Get-AzADUser output: ${jsonCandidate}`);
        return JSON.parse(jsonCandidate) as User[];
    } catch (parseError: any) {
        log(`Failed to parse Azure users JSON output. ${parseError?.message || 'Unknown parse error.'}`);
        // Fallback to line parsing so the flow can continue even with mixed output.
        return null;
    }
}

/**
 * Searches Azure AD users by display name or user principal name using Azure CLI.
 * @param log Logger to track command execution progress.
 * @param searchText Search text entered by the user.
 * @returns A promise that resolves with matching users.
 */
export async function searchUsers(log: ProgressLogger, searchText: string, page: number = 0): Promise<UserSearchResult> {
    const trimmedSearchText = searchText?.trim() || '';
    const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
    const startIndex = safePage * AZ_LIST_LIMIT;
    const endIndex = startIndex + AZ_LIST_LIMIT;

    log(`Searching Azure users for: "${trimmedSearchText || '<all>'}" (page ${safePage + 1})`);

    const escapedSearchText = trimmedSearchText.replace(/'/g, "''");
    const usersScript = trimmedSearchText
        ? withAzCliCheck([
            `$searchText = '${escapedSearchText}'.ToLower()`,
            `$usersJson = & $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json`,
            '$allUsers = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
            '$filteredUsers = @($allUsers | Where-Object {',
            '    ($_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText)) -or ($_.UserPrincipalName -and $_.UserPrincipalName.ToLower().Contains($searchText))',
            '})',
            `$pagedUsers = @($filteredUsers | Select-Object -Skip ${startIndex} -First ${AZ_LIST_LIMIT})`,
            'if (@($pagedUsers).Count -eq 0) { Write-Output "[]" } else { @($pagedUsers) | ConvertTo-Json -Depth 5 -Compress }'
        ])
        : withAzCliCheck([
            `& $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [${startIndex}:${endIndex}]" --output json`
        ]);
    const totalCountScript = trimmedSearchText
        ? withAzCliCheck([
            `$searchText = '${escapedSearchText}'.ToLower()`,
            `$usersJson = & $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json`,
            '$allUsers = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
            '$filteredUsers = @($allUsers | Where-Object {',
            '    ($_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText)) -or ($_.UserPrincipalName -and $_.UserPrincipalName.ToLower().Contains($searchText))',
            '})',
            'Write-Output @($filteredUsers).Count'
        ])
        : withAzCliCheck([
            `$usersJson = & $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json`,
            '$users = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
            'Write-Output @($users).Count'
        ]);

    const usersResult = await runPowerShell(usersScript, log, 'Azure user search completed successfully.');
    const parsed = parseJsonFromPowerShellOutput<User[] | User>(usersResult.stdout, log);
    const users = normalizeUsers(parsed);

    const totalCountResult = await runPowerShell(totalCountScript, log, 'Azure user search total count retrieved successfully.');
    const parsedTotalCount = Number.parseInt(totalCountResult.stdout.trim(), 10);
    const total = Number.isNaN(parsedTotalCount) ? users.length : parsedTotalCount;

    return { users, total };
}

/**
 * Resolves Azure AD users for a list of email/user principal names.
 * @param log Logger to track command execution progress.
 * @param emails Email or UPN list from CSV.
 * @returns A promise that resolves with matched users.
 */
export async function searchUsersByEmails(log: ProgressLogger, emails: string[]): Promise<User[]> {
    const normalizedEmails = (Array.isArray(emails) ? emails : [])
        .map((email) => String(email || '').trim())
        .filter((email) => email.length > 0);

    if (normalizedEmails.length === 0) {
        return [];
    }

    const uniqueEmails = Array.from(new Set(normalizedEmails.map((email) => email.toLowerCase())));
    const emailList = uniqueEmails
        .map((email) => `'${email.replace(/'/g, "''")}'`)
        .join(', ');

    log(`Resolving Azure users by email from CSV. Count: ${uniqueEmails.length}`);
    log(`Emails to resolve: ${uniqueEmails.join(', ')}`);

    const script = withAzCliCheck([
        `$targetEmails = @(${emailList})`,
        '$users = @()',
        'foreach ($email in $targetEmails) {',
        '  $userJson = & $azCli ad user show --id $email --query "{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json 2>$null',
        '  if ($LASTEXITCODE -eq 0 -and $userJson) {',
        '    try {',
        '      $userObj = $userJson | ConvertFrom-Json',
        '      if ($userObj) { $users += $userObj }',
        '    } catch { }',
        '  }',
        '}',
        'if (@($users).Count -eq 0) { Write-Output "[]" } else { @($users) | ConvertTo-Json -Depth 5 -Compress }'
    ]);

    const result = await runPowerShell(script, log, 'Azure users resolved by email successfully.');
    log(`Search users by emails output: ${result.stdout.trim()}`);
    const parsed = parseJsonFromPowerShellOutput<User[] | User>(result.stdout, log);

    return normalizeUsers(parsed);
}

/**
 * Searches Azure AD groups by display name using Azure CLI.
 * @param log Logger to track command execution progress.
 * @param searchText Search text entered by the user.
 * @returns A promise that resolves with matching groups and total count.
 */
export async function searchGroups(log: ProgressLogger, searchText: string, page: number = 0): Promise<GroupSearchResult> {
    const trimmedSearchText = searchText?.trim() || '';
    const safePage = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
    const startIndex = safePage * AZ_LIST_LIMIT;
    const endIndex = startIndex + AZ_LIST_LIMIT;

    log(`Searching Azure groups for: "${trimmedSearchText || '<all>'}" (page ${safePage + 1})`);

    const escapedSearchText = trimmedSearchText.replace(/'/g, "''");
    const groupsScript = trimmedSearchText
        ? withAzCliCheck([
            `$searchText = '${escapedSearchText}'.ToLower()`,
            `$groupsJson = & $azCli ad group list --query "[].{Id:id, DisplayName:displayName}" --output json`,
            '$allGroups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
            '$filteredGroups = @($allGroups | Where-Object { $_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText) })',
            `$pagedGroups = @($filteredGroups | Select-Object -Skip ${startIndex} -First ${AZ_LIST_LIMIT})`,
            'if (@($pagedGroups).Count -eq 0) { Write-Output "[]" } else { @($pagedGroups) | ConvertTo-Json -Depth 5 -Compress }'
        ])
        : withAzCliCheck([
            `& $azCli ad group list --query "[].{Id:id, DisplayName:displayName} | [${startIndex}:${endIndex}]" --output json`
        ]);
    const totalCountScript = trimmedSearchText
        ? withAzCliCheck([
            `$searchText = '${escapedSearchText}'.ToLower()`,
            `$groupsJson = & $azCli ad group list --query "[].{Id:id, DisplayName:displayName}" --output json`,
            '$allGroups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
            '$filteredGroups = @($allGroups | Where-Object { $_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText) })',
            'Write-Output @($filteredGroups).Count'
        ])
        : withAzCliCheck([
            `$groupsJson = & $azCli ad group list --query "[].{Id:id, DisplayName:displayName}" --output json`,
            '$groups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
            'Write-Output @($groups).Count'
        ]);

    const groupsResult = await runPowerShell(groupsScript, log, 'Azure group search completed successfully.');
    const parsed = parseJsonFromPowerShellOutput<Group[] | Group>(groupsResult.stdout, log);
    const groups = normalizeGroups(parsed);

    const totalCountResult = await runPowerShell(totalCountScript, log, 'Azure group search total count retrieved successfully.');
    const parsedTotalCount = Number.parseInt(totalCountResult.stdout.trim(), 10);
    const total = Number.isNaN(parsedTotalCount) ? groups.length : parsedTotalCount;

    return { groups, total };
}

/**
 * Retrieves a list of Azure AD groups using PowerShell.
 * @param log Logger to track the progress of the command execution.
 * @returns A promise that resolves with an array of group objects containing Id and DisplayName.
 */
export async function getAllGroups(log: ProgressLogger): Promise<any[] | null> {
    log('Retrieving list of Azure groups...');
    const script = withTeamsLoginCheck([
        '$groups = Get-AzADGroup -First 9999 | Select-Object Id, DisplayName; if ($null -eq $groups) { "[]" } else { @($groups) | ConvertTo-Json -Depth 3 -Compress }'
    ]);

    const result = await runPowerShell(script, log);
    const output = result.stdout.trim();
    if (!output) {
        return [];
    }

    // PowerShell output may occasionally include ANSI escapes or extra lines.
    const ansiCleaned = output.replace(/\u001b\[[0-9;]*m/g, '');
    const firstJsonStart = ansiCleaned.search(/[\[{\"]/);
    const jsonCandidate = firstJsonStart >= 0 ? ansiCleaned.slice(firstJsonStart).trim() : ansiCleaned;

    try {
        return JSON.parse(jsonCandidate) as any[];
    } catch (parseError: any) {
        log(`Failed to parse Azure groups JSON output. ${parseError?.message || 'Unknown parse error.'}`);
        // Fallback to line parsing so the flow can continue even with mixed output.
        return null;
    }
}

export async function getAllUserAndGroupList(log: ProgressLogger, searchText?: string): Promise<UserAndGroupListResult> {
    log('Retrieving list of Azure groups...');

    const trimmedSearchText = searchText?.trim();
    const escapedSearchText = trimmedSearchText ? trimmedSearchText.replace(/'/g, "''") : '';
    const usersCommand = trimmedSearchText
        ? `& $azCli ad user list --filter "startswith(displayName,'${escapedSearchText}')" --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:${AZ_LIST_LIMIT}]" --output json`
        : `& $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:${AZ_LIST_LIMIT}]" --output json`;


    const script = withAzCliCheck([
        // 1. Fetch Samples (Limited by your constant)
        `$groupsJson = & $azCli ad group list --query "[0:${AZ_LIST_LIMIT}].{Id:id, DisplayName:displayName}" --output json`,
        `$usersJson = ${usersCommand}`,

        `$accessToken = & $azCli account get-access-token --resource-type ms-graph --query accessToken --output tsv`,
        '$graphHeaders = @{ Authorization = "Bearer $accessToken"; ConsistencyLevel = "eventual" }',
        `$groupsTotal = [int]((Invoke-RestMethod -Method Get -Uri 'https://graph.microsoft.com/v1.0/groups?$top=1&$count=true' -Headers $graphHeaders).'@odata.count')`,
        `$usersTotal = [int]((Invoke-RestMethod -Method Get -Uri 'https://graph.microsoft.com/v1.0/users?$top=1&$count=true' -Headers $graphHeaders).'@odata.count')`,

        // 3. Logic to handle empty results and build payload
        '$groups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
        '$users = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
        '$payload = [PSCustomObject]@{ groups = @($groups); users = @($users); groupsTotal = [int]$groupsTotal; usersTotal = [int]$usersTotal }',
        '$payload | ConvertTo-Json -Depth 5 -Compress',
    ]);

    const result = await runPowerShell(script, log);
    const output = result.stdout.trim();
    if (!output) {
        return { users: [], groups: [], usersTotal: 0, groupsTotal: 0 };
    }

    // PowerShell output may occasionally include ANSI escapes or extra lines.
    const ansiCleaned = output.replace(/\u001b\[[0-9;]*m/g, '');
    const firstJsonStart = ansiCleaned.search(/[\[{\"]/);
    const jsonCandidate = firstJsonStart >= 0 ? ansiCleaned.slice(firstJsonStart).trim() : ansiCleaned;

    try {
        const parsed = JSON.parse(jsonCandidate) as {
            users?: User[] | User;
            groups?: Group[] | Group;
            usersTotal?: number;
            groupsTotal?: number;
        };
        const users = Array.isArray(parsed?.users)
            ? parsed.users
            : parsed?.users
                ? [parsed.users]
                : [];
        const groups = Array.isArray(parsed?.groups)
            ? parsed.groups
            : parsed?.groups
                ? [parsed.groups]
                : [];
        const usersTotal = typeof parsed?.usersTotal === 'number' ? parsed.usersTotal : users.length;
        const groupsTotal = typeof parsed?.groupsTotal === 'number' ? parsed.groupsTotal : groups.length;

        return { users, groups, usersTotal, groupsTotal };
    } catch (parseError: any) {
        log(`Failed to parse Azure groups JSON output. ${parseError?.message || 'Unknown parse error.'}`);
        // Fallback to line parsing so the flow can continue even with mixed output.
        return { users: [], groups: [], usersTotal: 0, groupsTotal: 0 };
    }
}

export async function grantPolicyToUser(log: ProgressLogger, policyName: string, appId: string, users: string[]): Promise<any> {
    if (users.length === 0) {
        log('No users available to grant the policy to.');
        return {
            success: false,
            targetType: 'user',
            policyName,
            targets: users,
            message: 'No users available to grant the policy to.'
        };
    }

    const safePolicyName = assertPolicyName(policyName);
    log(`Start granting policy "${safePolicyName}" to user(s): ${users.join(', ')}...`);
    const teamsAppId = assertAppId(appId);
    const targetUsers = users.map((user) => `'${user.replace(/'/g, "''")}'`).join(', ');
    const script = withTeamsLoginCheck([
        `$TargetPolicyName = ${psSingleQuote(safePolicyName)}`,
        `$TargetAppId = ${psSingleQuote(teamsAppId)}`,
        `$targetUsers = @(${targetUsers})`,
        '$results = @()',
        `function Get-AssignedUserPolicyName {
    param([string]$UserPrincipalName)

    $user = Get-CsOnlineUser -Identity $UserPrincipalName -ErrorAction SilentlyContinue
    if (-not $user) { return $null }

    if ($user.PSObject.Properties.Name -contains "ApplicationAccessPolicy" -and $user.ApplicationAccessPolicy) {
        return [string]$user.ApplicationAccessPolicy
    }

    if ($user.PSObject.Properties.Name -contains "EffectivePolicyAssignments" -and $user.EffectivePolicyAssignments) {
        $assignment = @($user.EffectivePolicyAssignments) | Where-Object { $_.PolicyType -eq "ApplicationAccessPolicy" -and $_.PolicyName } | Select-Object -First 1
        if ($assignment) {
            return [string]$assignment.PolicyName
        }
    }

    return $null
}`,
        `foreach ($userTarget in $targetUsers) {
    $userPolicyName = Get-AssignedUserPolicyName -UserPrincipalName $userTarget
    $policyToGrant = $TargetPolicyName
    $resultStatus = 'applied-target-policy'
    $resultMessage = "Policy assigned to user: $userTarget (Policy: $policyToGrant)"

    if ($userPolicyName) {
        $existingUserPolicy = Get-CsApplicationAccessPolicy -Identity $userPolicyName -ErrorAction SilentlyContinue

        if ($existingUserPolicy -and $existingUserPolicy.AppIds -contains $TargetAppId) {
            Write-Host "Skipping user grant for $userTarget. Assigned policy '$userPolicyName' already includes app ID." -ForegroundColor DarkGray
            $results += [PSCustomObject]@{
                user = $userTarget
                policyName = $userPolicyName
                status = 'skipped-already-has-app-id'
                message = "Skipped user grant for $userTarget because assigned policy '$userPolicyName' already includes app ID."
            }
            continue
        }

        if ($existingUserPolicy -and $existingUserPolicy.AppIds -notcontains $TargetAppId) {
            Set-CsApplicationAccessPolicy -Identity $userPolicyName -AppIds @{ Add = $TargetAppId } -ErrorAction Stop
            Write-Host "Updated assigned user policy '$userPolicyName' with app ID for $userTarget. Re-granting policy." -ForegroundColor Green
            $resultStatus = 'added-app-id-existing-policy'
            $resultMessage = "Updated assigned policy '$userPolicyName' with app ID, then granted it to $userTarget."
        }

        $policyToGrant = $userPolicyName
    }

    Grant-CsApplicationAccessPolicy -Identity $userTarget -PolicyName $policyToGrant -ErrorAction Stop
    Write-Host "Policy assigned to user: $userTarget (Policy: $policyToGrant)" -ForegroundColor Green

    $results += [PSCustomObject]@{
        user = $userTarget
        policyName = $policyToGrant
        status = $resultStatus
        message = $resultMessage
    }
}`,
        '$results | ConvertTo-Json -Depth 5 -Compress'
    ]);

    const result = await runPowerShell(script, log, `Policy "${policyName}" granted to user(s): ${users.join(', ')}.`);
    const parsedDetails = parseJsonFromPowerShellOutput<Array<{
        user: string;
        policyName: string;
        status: 'applied-target-policy' | 'added-app-id-existing-policy' | 'skipped-already-has-app-id';
        message: string;
    }> | {
        user: string;
        policyName: string;
        status: 'applied-target-policy' | 'added-app-id-existing-policy' | 'skipped-already-has-app-id';
        message: string;
    }>(result.stdout, log);
    const details = parsedDetails
        ? (Array.isArray(parsedDetails) ? parsedDetails : [parsedDetails])
        : [];

    return {
        success: true,
        targetType: 'user',
        policyName,
        targets: users,
        details,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
    };
}

export async function grantPolicyToGroup(log: ProgressLogger, policyName: string, groups: string[]): Promise<any> {
    if (groups.length === 0) {
        log('No groups available to grant the policy to.');
        return {
            success: false,
            targetType: 'group',
            policyName,
            targets: groups,
            message: 'No groups available to grant the policy to.'
        };
    }

    const safePolicyName = assertPolicyName(policyName);
    const safeGroups = groups.map(assertGroupId);
    log(`Start granting policy "${safePolicyName}" to group(s): ${safeGroups.join(', ')}...`);
    const script = withTeamsLoginCheck(safeGroups.map(group => `Grant-CsApplicationAccessPolicy -Group ${psSingleQuote(group)} -PolicyName ${psSingleQuote(safePolicyName)} -ErrorAction Stop`));
    const result = await runPowerShell(script, log, `Policy "${safePolicyName}" granted to group(s): ${safeGroups.join(', ')}.`);

    return {
        success: true,
        targetType: 'group',
        policyName,
        targets: groups,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
    };
}

export async function grantPolicyToGlobal(log: ProgressLogger, policyName: string): Promise<any> {
    const safePolicyName = assertPolicyName(policyName);
    log(`Start granting global policy "${safePolicyName}"...`);
    const script = withTeamsLoginCheck([`Grant-CsApplicationAccessPolicy -Global -PolicyName ${psSingleQuote(safePolicyName)} -ErrorAction Stop`]);
    const result = await runPowerShell(script, log, `Global policy "${safePolicyName}" granted successfully.`);

    return {
        success: true,
        targetType: 'global',
        policyName,
        targets: ['global'],
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
    };
}