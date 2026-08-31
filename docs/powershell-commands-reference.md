# PowerShell Commands Reference

> **Sources:** `electron/commands.ts` · `electron/azure.ts` · `electron/install-cli.ts` · `electron/util/os-util.ts`

All PowerShell scripts are executed via `runPowerShell(script, log?, successMessage?)` which calls:

```
pwsh -NoProfile -Command <script>            # macOS / Linux
powershell.exe -NoProfile -Command <script>  # Windows (fallback)
```

---

## 1. Session Bootstrap (Shared Header)

**Built by:** `withTeamsLoginCheck(commands[])` in `commands.ts`  
**Prepended to:** every Microsoft Teams policy command below.

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module MicrosoftTeams -ErrorAction Stop
Connect-MicrosoftTeams -ErrorAction Stop | Out-Null
```

| Piece | Why |
|---|---|
| `$ErrorActionPreference = 'Stop'` | Forces any non-terminating error to throw, so the Node.js caller can catch failures reliably. |
| `$ProgressPreference = 'SilentlyContinue'` | Suppresses noisy progress bars that corrupt JSON output. |
| `Import-Module MicrosoftTeams` | Loads the Teams cmdlets (`Get/New/Set/Grant-CsApplicationAccessPolicy`, `Get-CsOnlineUser`, etc.). |
| `Connect-MicrosoftTeams` | Opens an authenticated Teams session (interactive browser login on first run). |

**Inputs:** none (credentials come from the interactive sign-in browser popup).

---

## 2. Check Azure CLI Is Available (Shared Header)

**Built by:** `withAzCliCheck(commands[])` in `commands.ts`  
**Prepended to:** every Azure AD data command below.

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$azCli = (Get-Command 'az.exe' -ErrorAction SilentlyContinue).Source
if (-not $azCli) { $azCli = (Get-Command 'az' -ErrorAction Stop).Source }
```

**Why:** Resolves the `az` CLI binary path into `$azCli` so subsequent commands call it with `& $azCli ...`. This avoids `az` not being found in Electron's restricted `PATH`.

---

## 3. Verify Teams Connection

**Function:** `connectToMicrosoftTeams()`  
**Used in:** pre-login validation step.

```powershell
# (session bootstrap prepended)
Write-Output "TEAMS_SESSION_READY"
```

**Why:** Runs the full bootstrap and emits a sentinel string. The caller checks for `TEAMS_SESSION_READY` in stdout to confirm a live Teams session before proceeding.

**Inputs:** none.

---

## 4. List All CS Application Access Policies

**Function:** `getAllAccessPolicies()`  
**Used in:** showing existing policies to the user.

```powershell
# (session bootstrap prepended)
$policies = Get-CsApplicationAccessPolicy -ErrorAction Stop |
    Select-Object Identity, Description, AppIds
if ($null -eq $policies -or @($policies).Count -eq 0) {
    Write-Output "NO_POLICIES_FOUND"
} else {
    $policies | ConvertTo-Json -Depth 5 -Compress
}
```

**Why:** Retrieves all tenant-level application access policies so the UI can display them and allow the user to pick or detect duplicates.

**Inputs:** none (tenant-scoped cmdlet, no parameters needed).

**Output:** JSON array of `{ Identity, Description, AppIds }` objects, or the literal string `NO_POLICIES_FOUND`.

---

## 5. Get Policy by Name

**Function:** `getPolicyByName(policyName)`  
**Used in:** checking whether a policy already exists before creating one.

```powershell
# (session bootstrap prepended)
Get-CsApplicationAccessPolicy -Identity "<policyName>" -ErrorAction Stop |
    Select-Object Identity, Description, AppIds |
    ConvertTo-Json -Depth 5 -Compress
```

**Why:** Targeted lookup so the app can avoid re-creating an already-present policy.

**Inputs:**

| Parameter | Type | Description |
|---|---|---|
| `-Identity` | `string` | Policy name chosen by the user, e.g. `"Meeting-Policy"`. |

---

## 6. Create a New CS Application Access Policy

**Function:** `setupPolicy(policyName)`  
**Used in:** the "Setup Policy" step.

```powershell
# (session bootstrap prepended)
$policy = New-CsApplicationAccessPolicy `
    -Identity "<policyName>" `
    -AppIds "<appId>" `
    -Description "MS teams access policy for Teams Meeting Ingest"
$policy | Select-Object Identity, Description, AppIds | ConvertTo-Json -Depth 5 -Compress
```

**Why:** Creates a new policy that whitelists the configured Teams app ID, enabling the app to access meeting recordings via the Graph API.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `-Identity` | User-entered policy name | Unique name for the policy in the tenant. |
| `-AppIds` | UI-entered `appId` (validated GUID) | The Azure AD application (client) ID of the Teams app. |
| `-Description` | Hardcoded | Human-readable label stored with the policy. |

---

## 7. Update an Existing Policy (Add App ID)

**Function:** `grantPolicy()` — "policy already exists" branch  
**Used in:** ensuring an existing policy contains the current app ID.

```powershell
Set-CsApplicationAccessPolicy `
    -Identity "<policyName>" `
    -AppIds "<appId>" `
    -Description "MS teams access policy for Teams Meeting Ingest"
```

**Why:** If the policy was created before this app ID was added, this updates it in place rather than creating a duplicate policy.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `-Identity` | Policy name | Identifies the existing policy to modify. |
| `-AppIds` | UI-entered `appId` (validated GUID) | App ID to add to the policy's allowed list. |

---

## 8. Grant Policy to a Group (Legacy)

**Function:** `grantPolicy(policyName, groupId)` — legacy helper

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Connect-MicrosoftTeams -ErrorAction Stop
Grant-CsApplicationAccessPolicy -Group "<groupId>" -PolicyName "<policyName>" -Rank 1
```

**Why:** Assigns the policy to a specific Azure AD group. Members of this group inherit the policy.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `-Group` | `groupId` argument | Object ID of the Azure AD group. |
| `-PolicyName` | `policyName` argument | Name of the policy to grant. |
| `-Rank` | Hardcoded `1` | Priority rank for group-based policy assignment. |

---

## 9. Grant Policy to Specific Users

**Function:** `grantPolicyToUser(policyName, users[])`  
**Used in:** assigning the policy to individually selected or CSV-imported users.

The script loops over each user UPN and performs smart assignment logic:

```powershell
# (session bootstrap prepended)
$TargetPolicyName = "<policyName>"
$TargetAppId      = "<appId>"
$targetUsers      = @('<upn1>', '<upn2>', ...)
$results          = @()

function Get-AssignedUserPolicyName {
    param([string]$UserPrincipalName)
    $user = Get-CsOnlineUser -Identity $UserPrincipalName -ErrorAction SilentlyContinue
    # Checks ApplicationAccessPolicy and EffectivePolicyAssignments properties
    if ($user.PSObject.Properties.Name -contains "ApplicationAccessPolicy" -and $user.ApplicationAccessPolicy) {
        return [string]$user.ApplicationAccessPolicy
    }
    if ($user.PSObject.Properties.Name -contains "EffectivePolicyAssignments" -and $user.EffectivePolicyAssignments) {
        $assignment = @($user.EffectivePolicyAssignments) |
            Where-Object { $_.PolicyType -eq "ApplicationAccessPolicy" -and $_.PolicyName } |
            Select-Object -First 1
        if ($assignment) { return [string]$assignment.PolicyName }
    }
    return $null
}

foreach ($userTarget in $targetUsers) {
    $userPolicyName = Get-AssignedUserPolicyName -UserPrincipalName $userTarget

    if ($userPolicyName) {
        $existingPolicy = Get-CsApplicationAccessPolicy -Identity $userPolicyName -ErrorAction SilentlyContinue

        if ($existingPolicy.AppIds -contains $TargetAppId) {
            # Skip — user's assigned policy already includes the app ID
        } elseif ($existingPolicy.AppIds -notcontains $TargetAppId) {
            # Patch the existing policy with the missing app ID
            Set-CsApplicationAccessPolicy -Identity $userPolicyName -AppIds @{ Add = $TargetAppId } -ErrorAction Stop
        }
        $policyToGrant = $userPolicyName
    }

    Grant-CsApplicationAccessPolicy -Identity $userTarget -PolicyName $policyToGrant -ErrorAction Stop
}

$results | ConvertTo-Json -Depth 5 -Compress
```

**Why:** Handles three cases — user has no policy (assign new), user's existing policy already has the app ID (skip), user's existing policy is missing the app ID (patch it then re-grant).

**Inputs:**

| Variable | Source | Description |
|---|---|---|
| `$targetUsers` | `users[]` argument (array of UPNs) | User principal names of the target users. Single-quotes escaped. |
| `$TargetPolicyName` | `policyName` argument | Policy to grant to each user. |
| `$TargetAppId` | UI-entered `appId` (validated GUID) | App ID to verify/add to any patched policies. |

---

## 10. Grant Policy to Azure AD Groups

**Function:** `grantPolicyToGroup(policyName, groups[])`  
**Used in:** assigning the policy at the group level.

```powershell
# (session bootstrap prepended)
# Repeated once per group in the input array:
Grant-CsApplicationAccessPolicy -Group "<groupId>" -PolicyName "<policyName>" -ErrorAction Stop
```

**Why:** Grants the policy at the group level so all group members get access without individual assignments.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `-Group` | Each entry in `groups[]` | Azure AD group Object ID. |
| `-PolicyName` | `policyName` argument | Policy to assign. |

---

## 11. Grant Policy Globally (Tenant-Wide)

**Function:** `grantPolicyToGlobal(policyName)`  
**Used in:** "grant to all users" option.

```powershell
# (session bootstrap prepended)
Grant-CsApplicationAccessPolicy -Global -PolicyName "<policyName>" -ErrorAction Stop
```

**Why:** Applies the policy tenant-wide, granting every user access without needing individual or group assignments.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `-Global` | Switch flag | Targets the entire tenant rather than a specific identity. |
| `-PolicyName` | `policyName` argument | Policy to apply globally. |

---

## 12. List Azure AD Users (Sample + Search via Azure CLI)

**Functions:** `getUserList(searchText?)` · `searchUsers(searchText, page)` · `getAllUserAndGroupList()`

These `az` commands are called via `& $azCli ...` inside the `withAzCliCheck` PowerShell wrapper.

### No search text — first page

```powershell
& $azCli ad user list `
    --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:10]" `
    --output json
```

### With search prefix (server-side OData filter)

```powershell
& $azCli ad user list `
    --filter "startswith(displayName,'<searchText>')" `
    --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:10]" `
    --output json
```

### Full-text contains search with paging (in-memory PowerShell filter)

```powershell
$searchText = '<escaped>'.ToLower()
$usersJson  = & $azCli ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json
$allUsers   = $usersJson | ConvertFrom-Json
$filtered   = @($allUsers | Where-Object {
    ($_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText)) -or
    ($_.UserPrincipalName -and $_.UserPrincipalName.ToLower().Contains($searchText))
})
$paged      = @($filtered | Select-Object -Skip <startIndex> -First 10)
if (@($paged).Count -eq 0) { Write-Output "[]" } else { @($paged) | ConvertTo-Json -Depth 5 -Compress }
```

**Why:** The Azure Graph OData `filter` only supports `startswith`; for contains-style search the full list is fetched and filtered in PowerShell.

**Inputs:**

| Parameter | Source | Description |
|---|---|---|
| `--filter` | `searchText` argument | Optional OData filter for server-side prefix match. |
| `[startIndex:endIndex]` | `page` × `AZ_LIST_LIMIT` (= 10) | JMESPath slice for pagination. |

---

## 13. Resolve Users by Email (CSV Import)

**Function:** `searchUsersByEmails(emails[])`  
**Used in:** importing target users from a CSV file.

```powershell
# (withAzCliCheck header prepended)
$targetEmails = @('user1@domain.com', 'user2@domain.com', ...)
$users = @()
foreach ($email in $targetEmails) {
    $userJson = & $azCli ad user show `
        --id $email `
        --query "{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" `
        --output json 2>$null
    if ($LASTEXITCODE -eq 0 -and $userJson) {
        try {
            $userObj = $userJson | ConvertFrom-Json
            if ($userObj) { $users += $userObj }
        } catch { }
    }
}
if (@($users).Count -eq 0) { Write-Output "[]" } else { @($users) | ConvertTo-Json -Depth 5 -Compress }
```

**Why:** Resolves each CSV-supplied email to a full Azure AD user object (including Object ID) required for policy grant operations.

**Inputs:**

| Variable | Source | Description |
|---|---|---|
| `$targetEmails` | `emails[]` argument | Array of email/UPN strings from CSV. Single-quotes escaped to prevent injection. |
| `--id` | Each email value | The UPN or email used to look up the user in Azure AD. |

---

## 14. List / Search Azure AD Groups

**Functions:** `searchGroups(searchText, page)` · `getAllGroups()`

```powershell
# No search — paginated slice:
& $azCli ad group list --query "[].{Id:id, DisplayName:displayName} | [<start>:<end>]" --output json

# With in-memory contains search:
$searchText  = '<escaped>'.ToLower()
$groupsJson  = & $azCli ad group list --query "[].{Id:id, DisplayName:displayName}" --output json
$allGroups   = $groupsJson | ConvertFrom-Json
$filtered    = @($allGroups | Where-Object { $_.DisplayName -and $_.DisplayName.ToLower().Contains($searchText) })
$paged       = @($filtered | Select-Object -Skip <start> -First 10)
if (@($paged).Count -eq 0) { Write-Output "[]" } else { @($paged) | ConvertTo-Json -Depth 5 -Compress }
```

**Why:** Provides the group picker in the UI. Uses the same in-memory contains-search pattern as users because `az ad group list` OData filter support is limited.

**Inputs:** same pagination and search pattern as the user search commands above.

---

## 15. Get Users + Groups with Total Counts (Combined Payload)

**Function:** `getAllUserAndGroupList(searchText?)`  
**Used in:** initial load of the user/group selector.

```powershell
# (withAzCliCheck header prepended)

# 1. Fetch sample data
$groupsJson  = & $azCli ad group list --query "[0:10].{Id:id, DisplayName:displayName}" --output json
$usersJson   = & $azCli ad user list [--filter "startswith(displayName,'<text>')"] `
                   --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:10]" `
                   --output json

# 2. Get exact total counts from MS Graph (requires ConsistencyLevel: eventual)
$accessToken  = & $azCli account get-access-token --resource-type ms-graph --query accessToken --output tsv
$graphHeaders = @{ Authorization = "Bearer $accessToken"; ConsistencyLevel = "eventual" }
$groupsTotal  = [int]((Invoke-RestMethod -Method Get `
    -Uri 'https://graph.microsoft.com/v1.0/groups?$top=1&$count=true' `
    -Headers $graphHeaders).'@odata.count')
$usersTotal   = [int]((Invoke-RestMethod -Method Get `
    -Uri 'https://graph.microsoft.com/v1.0/users?$top=1&$count=true' `
    -Headers $graphHeaders).'@odata.count')

# 3. Build and return payload
$groups  = if ($groupsJson) { $groupsJson | ConvertFrom-Json } else { @() }
$users   = if ($usersJson)  { $usersJson  | ConvertFrom-Json } else { @() }
$payload = [PSCustomObject]@{
    groups      = @($groups)
    users       = @($users)
    groupsTotal = [int]$groupsTotal
    usersTotal  = [int]$usersTotal
}
$payload | ConvertTo-Json -Depth 5 -Compress
```

**Why:** A single round-trip to get sample data AND exact total counts. Counts come from `@odata.count` via the Microsoft Graph REST API (requires `ConsistencyLevel: eventual` header) rather than fetching the entire list.

**Inputs:**

| Variable | Source | Description |
|---|---|---|
| `--filter` | `searchText` argument | Optional prefix filter for users. |
| `get-access-token` | Active `az` login session | Retrieves a bearer token for Graph API calls without a separate sign-in. |

---

## 16. Install Required PowerShell Modules

**Function:** `installRequiredPowerShellModules()` in `os-util.ts`  
**Used in:** `runPreLoginPowerShellTasks()` — runs before any login step.

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Bootstrap NuGet package provider (required by Install-Module)
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue

$requiredModules = @('Az.Accounts', 'Az.Resources', 'MicrosoftTeams')
$missingModules  = @()
foreach ($module in $requiredModules) {
    if (-not (Get-Module -ListAvailable -Name $module)) {
        $missingModules += $module
    }
}
if ($missingModules.Count -eq 0) {
    Write-Output 'All required PowerShell modules are already installed.'
} else {
    foreach ($module in $missingModules) {
        Write-Output "Installing PowerShell module: $module"
        Install-Module -Name $module -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
    }
}
```

**Why:** Ensures `Az.Accounts`, `Az.Resources`, and `MicrosoftTeams` modules are present before any cmdlets are called. Only missing modules are installed to save time.

**Inputs:**

| Parameter | Value | Description |
|---|---|---|
| `-Name NuGet` | Hardcoded | Bootstraps the NuGet package provider needed by `Install-Module`. |
| `-Scope CurrentUser` | Hardcoded | No admin / elevated privileges required. |
| `-Repository PSGallery` | Hardcoded | Uses the official PowerShell Gallery. |
| `-AllowClobber` | Hardcoded | Allows overwriting conflicting commands from other modules. |

---

## 17. Probe PowerShell Version

**Function:** `isPowerShellInstalled()` in `os-util.ts`  
**Used in:** pre-flight check before any script execution.

```powershell
$PSVersionTable.PSVersion.ToString()
```

Called as: `pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'`

**Why:** Lightweight existence check — if this succeeds, PowerShell is available and functional. No modules needed.

**Inputs:** none.

---

## 18. Azure Login (Device Code Flow)

**Function:** `runAzLogin()` in `azure.ts`  
**Executed via:** `runCommandWithLiveLogs` (streams stdout in real time, not `runPowerShell`).

```bash
az login --use-device-code --allow-no-subscriptions
```

**Why:** Opens a device-code browser flow so the user can authenticate with Azure AD interactively. `--allow-no-subscriptions` handles tenant-only accounts that have no Azure subscriptions.

### Post-login context resolution

Primary — subscription account:

```bash
az account show --output json
```

Fallback — tenant-only account (no subscription access):

```bash
az account tenant list --output json
```

**Why:** After login, the app needs the tenant ID and account name for the UI. `account show` works for subscription accounts; `account tenant list` is the fallback for tenant-only sign-ins.

**Inputs:** none (all interaction happens in the browser popup).

---

## 19. CLI Installation Commands

These commands are invoked by `installPowerShell()` and `installAzureCli()` in `install-cli.ts`. They are **only triggered when the user explicitly clicks the Install button** in the UI after a prerequisite check fails.

### Windows — PowerShell

```bash
# Primary (winget)
winget install --id Microsoft.PowerShell --source winget --accept-source-agreements --accept-package-agreements

# Fallback (Chocolatey)
choco install powershell-core -y
```

### Windows — Azure CLI

```bash
# Primary (winget)
winget install --id Microsoft.AzureCLI --source winget --accept-source-agreements --accept-package-agreements

# Fallback (Chocolatey)
choco install azure-cli -y
```

### macOS — PowerShell (via Homebrew, tried in order)

```bash
brew install --cask powershell
brew install powershell/tap/powershell
brew install powershell
```

### macOS — Azure CLI

```bash
brew install azure-cli
```

### macOS — Homebrew itself

```bash
# Non-interactive (app context)
NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Interactive fallback — opens a real Terminal window via AppleScript
osascript \
  -e 'tell application "Terminal" to activate' \
  -e 'tell application "Terminal" to do script "<homebrew-install-command>"'
```

**Why:** Homebrew doesn't always succeed non-interactively inside an Electron app sandbox. The `osascript` fallback opens a real Terminal window where the user can complete the installation and then return to the app.

---

## Summary Table

| # | Command / Cmdlet | Module / Tool | Purpose |
|---|---|---|---|
| 1 | `Import-Module MicrosoftTeams` | PowerShell | Load Teams cmdlets |
| 2 | `Connect-MicrosoftTeams` | MicrosoftTeams | Authenticate Teams session |
| 3 | `Get-CsApplicationAccessPolicy` | MicrosoftTeams | List / read policies |
| 4 | `New-CsApplicationAccessPolicy` | MicrosoftTeams | Create new policy |
| 5 | `Set-CsApplicationAccessPolicy` | MicrosoftTeams | Update existing policy app IDs |
| 6 | `Grant-CsApplicationAccessPolicy` | MicrosoftTeams | Grant policy to user / group / global |
| 7 | `Get-CsOnlineUser` | MicrosoftTeams | Check user's current policy assignment |
| 8 | `Install-PackageProvider` | PowerShell | Bootstrap NuGet for module installs |
| 9 | `Install-Module` | PowerShell | Install Az.Accounts, Az.Resources, MicrosoftTeams |
| 10 | `Get-Module -ListAvailable` | PowerShell | Check if modules are already installed |
| 11 | `$PSVersionTable` | PowerShell | Probe PowerShell availability |
| 12 | `Invoke-RestMethod` | PowerShell | Call MS Graph API to get user/group total counts |
| 13 | `az login --use-device-code` | Azure CLI | Interactive Azure AD login |
| 14 | `az account show` | Azure CLI | Get current subscription / tenant context |
| 15 | `az account tenant list` | Azure CLI | Tenant-only fallback context |
| 16 | `az account get-access-token` | Azure CLI | Get MS Graph bearer token |
| 17 | `az ad user list` | Azure CLI | List / search Azure AD users |
| 18 | `az ad user show --id` | Azure CLI | Resolve a single user by email / UPN |
| 19 | `az ad group list` | Azure CLI | List / search Azure AD groups |
| 20 | `winget install` | Windows | Install PowerShell / Azure CLI on Windows |
| 21 | `choco install` | Windows | Fallback install on Windows (Chocolatey) |
| 22 | `brew install` | macOS | Install PowerShell / Azure CLI on macOS |
| 23 | `osascript` | macOS | Open Terminal for interactive Homebrew install |
