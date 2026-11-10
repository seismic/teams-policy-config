/**
 * Pure builders for the PowerShell used by user / group / email search.
 *
 * Kept free of Electron imports so the exact generated script can be unit-tested.
 *
 * Security model (MTGINGEST-5914/5915/5918, CWE-78):
 *  - Free-text search input is NEVER placed in script source. It is passed to
 *    PowerShell as DATA through an environment variable (`$env:TPC_SEARCH_TEXT`), so no
 *    quote character (ASCII or Unicode) or metacharacter can change script structure.
 *  - Emails are allowlist-validated (assertEmail) and then embedded with the single
 *    shared quoting helper psSingleQuote(). They are also re-checked inside the script
 *    before reaching `az`, which on Windows is `az.cmd` and is re-parsed by cmd.exe.
 *  - Numbers (paging) are coerced to bounded integers.
 */
import { EMAIL_PATTERN_SOURCE, assertEmail, assertSearchText, psSingleQuote } from './validate';

export const AZ_LIST_LIMIT = 10;

/** Environment variable that carries the raw search text to PowerShell as data. */
export const SEARCH_TEXT_ENV_VAR = 'TPC_SEARCH_TEXT';

const MAX_PAGE = 100000;

export type ScriptSpec = {
    /** Script lines, to be wrapped (e.g. withAzCliCheck) and joined by the caller. */
    commands: string[];
    /** Extra environment for the PowerShell process (data, never code). */
    env: Record<string, string>;
};

export type SearchScripts = { page: ScriptSpec; total: ScriptSpec };

const USER_PROJECTION = '[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}';
const GROUP_PROJECTION = '[].{Id:id, DisplayName:displayName}';

export function toSafePage(page: unknown): number {
    const n = typeof page === 'number' && Number.isFinite(page) ? Math.floor(page) : 0;
    return Math.min(Math.max(n, 0), MAX_PAGE);
}

const SEARCH_TEXT_LINE = `$searchText = $env:${SEARCH_TEXT_ENV_VAR}.ToLower()`;

export function buildUserSearchScripts(searchText: unknown, page: unknown): SearchScripts {
    const text = assertSearchText(searchText);
    const safePage = toSafePage(page);
    const startIndex = safePage * AZ_LIST_LIMIT;
    const endIndex = startIndex + AZ_LIST_LIMIT;

    if (!text) {
        return {
            page: {
                commands: [`& $azCli ad user list --query "${USER_PROJECTION} | [${startIndex}:${endIndex}]" --output json`],
                env: {},
            },
            total: {
                commands: [
                    `$usersJson = & $azCli ad user list --query "${USER_PROJECTION}" --output json`,
                    '$users = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
                    'Write-Output @($users).Count',
                ],
                env: {},
            },
        };
    }

    const env = { [SEARCH_TEXT_ENV_VAR]: text };
    const filter = [
        SEARCH_TEXT_LINE,
        `$usersJson = & $azCli ad user list --query "${USER_PROJECTION}" --output json`,
        '$allUsers = if ($usersJson) { $usersJson | ConvertFrom-Json } else { @() }',
        '$filteredUsers = @($allUsers | Where-Object {',
        '    ($_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText)) -or ($_.UserPrincipalName -and $_.UserPrincipalName.ToLower().Contains($searchText))',
        '})',
    ];
    return {
        page: {
            commands: [
                ...filter,
                `$pagedUsers = @($filteredUsers | Select-Object -Skip ${startIndex} -First ${AZ_LIST_LIMIT})`,
                'if (@($pagedUsers).Count -eq 0) { Write-Output "[]" } else { @($pagedUsers) | ConvertTo-Json -Depth 5 -Compress }',
            ],
            env,
        },
        total: { commands: [...filter, 'Write-Output @($filteredUsers).Count'], env },
    };
}

export function buildGroupSearchScripts(searchText: unknown, page: unknown): SearchScripts {
    const text = assertSearchText(searchText);
    const safePage = toSafePage(page);
    const startIndex = safePage * AZ_LIST_LIMIT;
    const endIndex = startIndex + AZ_LIST_LIMIT;

    if (!text) {
        return {
            page: {
                commands: [`& $azCli ad group list --query "${GROUP_PROJECTION} | [${startIndex}:${endIndex}]" --output json`],
                env: {},
            },
            total: {
                commands: [
                    `$groupsJson = & $azCli ad group list --query "${GROUP_PROJECTION}" --output json`,
                    '$groups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
                    'Write-Output @($groups).Count',
                ],
                env: {},
            },
        };
    }

    const env = { [SEARCH_TEXT_ENV_VAR]: text };
    const filter = [
        SEARCH_TEXT_LINE,
        `$groupsJson = & $azCli ad group list --query "${GROUP_PROJECTION}" --output json`,
        '$allGroups = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }',
        '$filteredGroups = @($allGroups | Where-Object { $_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText) })',
    ];
    return {
        page: {
            commands: [
                ...filter,
                `$pagedGroups = @($filteredGroups | Select-Object -Skip ${startIndex} -First ${AZ_LIST_LIMIT})`,
                'if (@($pagedGroups).Count -eq 0) { Write-Output "[]" } else { @($pagedGroups) | ConvertTo-Json -Depth 5 -Compress }',
            ],
            env,
        },
        total: { commands: [...filter, 'Write-Output @($filteredGroups).Count'], env },
    };
}

/**
 * Builds the by-email lookup. Every email is validated here (point of use) and an
 * invalid one throws BEFORE any script text is produced, so it can never appear in a script.
 * Returns null when there is nothing to resolve.
 */
export function buildEmailLookupScript(emails: unknown): { commands: string[]; emails: string[] } | null {
    const normalized = (Array.isArray(emails) ? emails : [])
        .map((email) => (typeof email === 'string' ? email.trim() : String(email ?? '').trim()))
        .filter((email) => email.length > 0)
        .map((email) => assertEmail(email).toLowerCase());

    if (normalized.length === 0) {
        return null;
    }

    const unique = Array.from(new Set(normalized));
    const emailList = unique.map((email) => psSingleQuote(email)).join(', ');
    // .NET regex: \A..\z (unlike `$`, `\z` does not match before a trailing newline).
    const guard = psSingleQuote(`\\A(?:${EMAIL_PATTERN_SOURCE})\\z`);

    return {
        emails: unique,
        commands: [
            `$targetEmails = @(${emailList})`,
            `$emailGuard = ${guard}`,
            '$users = @()',
            'foreach ($email in $targetEmails) {',
            // Defence in depth: `az` is az.cmd on Windows and cmd.exe re-parses its args.
            '  if ($email -notmatch $emailGuard) { continue }',
            '  $userJson = & $azCli ad user show --id $email --query "{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json 2>$null',
            '  if ($LASTEXITCODE -eq 0 -and $userJson) {',
            '    try {',
            '      $userObj = $userJson | ConvertFrom-Json',
            '      if ($userObj) { $users += $userObj }',
            '    } catch { }',
            '  }',
            '}',
            'if (@($users).Count -eq 0) { Write-Output "[]" } else { @($users) | ConvertTo-Json -Depth 5 -Compress }',
        ],
    };
}
