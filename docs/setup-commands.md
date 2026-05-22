# Setup Commands Reference

This document lists the commands used by the Electron backend setup flow, with details about purpose, where each command is used, and platform notes.

## Scope

- Main source: `electron/commands.ts`
- Extra command sources:
	- `electron/azure.ts`
	- `electron/install-cli.ts`
	- `electron/util/os-util.ts`

## Common Runtime Wrappers

### `runPowerShell(script, log, successMessage)`

- Used to execute PowerShell script blocks.
- Runtime selection:
	- Windows: `powershell.exe`, `pwsh.exe`, `pwsh`
	- macOS/Linux: `pwsh`, `powershell`
- Important behavior:
	- Uses `-NoProfile -Command <script>`.
	- PATH is extended through `withCommonCliPath()`.

### `runCommandWithLiveLogs(executable, args, options)`

- Used for long-running CLI commands with streamed output (for UI logs).
- Used by Azure login flow and install routines.

## PowerShell + Teams Commands (`electron/commands.ts`)

### Session bootstrap (reused by many operations)

Constructed by `withTeamsLoginCheck()`:

```powershell
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module MicrosoftTeams -ErrorAction Stop
Connect-MicrosoftTeams -ErrorAction Stop | Out-Null
```

Used before Teams policy commands.

### Connect to Teams

```powershell
Write-Output "TEAMS_SESSION_READY"
```

Used in `connectToMicrosoftTeams()` after session bootstrap.

### Read policy list

```powershell
$policies = Get-CsApplicationAccessPolicy -ErrorAction Stop | Select-Object Identity, Description, AppIds
if ($null -eq $policies -or @($policies).Count -eq 0) { Write-Output "NO_POLICIES_FOUND" } else { $policies | ConvertTo-Json -Depth 5 -Compress }
```

Used in `getAllAccessPolicies()`.

### Read policy by name

```powershell
Get-CsApplicationAccessPolicy -Identity "<policyName>" -ErrorAction Stop | Select-Object Identity, Description, AppIds | ConvertTo-Json -Depth 5 -Compress
```

Used in `getPolicyByName()`.

### Create policy

```powershell
$policy = New-CsApplicationAccessPolicy -Identity "<policyName>" -AppIds "8628b04c-a0f9-458c-b88c-ebc68652cf57" -Description "MS teams access policy for Teams Meeting Ingest"
$policy | Select-Object Identity, Description, AppIds | ConvertTo-Json -Depth 5 -Compress
```

Used in `setupPolicy()`.

### Grant policy (legacy group function)

```powershell
Grant-CsApplicationAccessPolicy -Group "<groupId>" -PolicyName "<policyName>" -Rank 1
```

Used in `grantPolicy()`.

### Grant policy to users

One command is generated per user:

```powershell
Grant-CsApplicationAccessPolicy -Identity "<userUPN>" -PolicyName "<policyName>" -ErrorAction Stop
```

Used in `grantPolicyToUser()`.

### Grant policy to groups

One command is generated per group:

```powershell
Grant-CsApplicationAccessPolicy -Group "<groupId>" -PolicyName "<policyName>" -ErrorAction Stop
```

Used in `grantPolicyToGroup()`.

### Grant global policy

```powershell
Grant-CsApplicationAccessPolicy -Global -PolicyName "<policyName>" -ErrorAction Stop
```

Used in `grantPolicyToGlobal()`.

## Azure AD Data Commands (`electron/commands.ts`)

`AZ_LIST_LIMIT` is currently `2` and controls first-page sample size.

### Get user sample list

No search:

```bash
az ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:2]" --output json
```

With search prefix:

```bash
az ad user list --filter "startswith(displayName,'<text>')" --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:2]" --output json
```

Used in `getUserList()`.

### Search users with paging

```bash
az ad user list --filter "startswith(displayName,'<text>') or startswith(userPrincipalName,'<text>')" --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [<start>:<end>]" --output json
```

Total count query:

```bash
az ad user list --filter "startswith(displayName,'<text>') or startswith(userPrincipalName,'<text>')" --query "length(@)" --output tsv
```

Used in `searchUsers(searchText, page)`.

### Search groups with paging

```bash
az ad group list --filter "startswith(displayName,'<text>')" --query "[].{Id:id, DisplayName:displayName} | [<start>:<end>]" --output json
```

Total count query:

```bash
az ad group list --filter "startswith(displayName,'<text>')" --query "length(@)" --output tsv
```

Used in `searchGroups(searchText, page)`.

### Initial combined users + groups payload

Current script in `getAllUserAndGroupList()` uses:

```bash
az ad group list --query "[0:2].{Id:id, DisplayName:displayName}" --output json
az ad user list [optional --filter ...] --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName} | [0:2]" --output json
az rest --method get --uri "https://graph.microsoft.com/v1.0/groups?$top=1&$count=true" --headers ConsistencyLevel=eventual --output json
az rest --method get --uri "https://graph.microsoft.com/v1.0/users?$top=1&$count=true" --headers ConsistencyLevel=eventual --output json
```

Notes:

- In PowerShell script, `az --% rest ...` is used to avoid PowerShell parsing issues with URI query symbols.
- Counts are read from `@odata.count`.

## Azure Login Commands (`electron/azure.ts`)

### Device code login

```bash
az login --use-device-code --allow-no-subscriptions
```

### Resolve account context

Primary:

```bash
az account show --output json
```

Fallback for tenant-only accounts:

```bash
az account tenant list --output json
```

Used in `runAzLogin()`.

## Module Installation Commands (`electron/util/os-util.ts`)

Executed in `installRequiredPowerShellModules()`:

```powershell
Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue
Install-Module -Name Az.Accounts -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
Install-Module -Name Az.Resources -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
Install-Module -Name MicrosoftTeams -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
```

Only missing modules are installed.

## CLI Installation Commands (`electron/install-cli.ts`)

### Windows

PowerShell:

```bash
winget install --id Microsoft.PowerShell --source winget --accept-source-agreements --accept-package-agreements
```

Fallback:

```bash
choco install powershell-core -y
```

Azure CLI:

```bash
winget install --id Microsoft.AzureCLI --source winget --accept-source-agreements --accept-package-agreements
```

Fallback:

```bash
choco install azure-cli -y
```

### macOS

PowerShell attempts:

```bash
brew install --cask powershell
brew install powershell/tap/powershell
brew install powershell
```

Azure CLI:

```bash
brew install azure-cli
```

## Usage and Troubleshooting Notes

- Ensure both `az` and PowerShell (`pwsh`/`powershell`) are in PATH for Electron process (the app extends PATH but still depends on installed binaries).
- Search/pagination behavior uses:
	- page index starting at `0`
	- page size from `AZ_LIST_LIMIT`
- If counts fail but list succeeds, UI still works with fallback total based on returned array length.
- Windows-specific parser behavior can break complex command strings embedded in PowerShell; using argument-based CLI execution is generally more reliable.

