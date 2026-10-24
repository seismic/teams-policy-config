# Teams Policy Config — Architecture & Code Flow

## High-Level Summary

A product feature called **Teams Meeting Ingest** that records Microsoft Teams meeting data (transcripts, insights, etc.) and pulls them into the platform for sales enablement.

Microsoft doesn't let any third-party app access Teams meeting data by default. An **IT administrator** of the customer's organization must explicitly authorize it by creating a **Teams Application Access Policy**.

Doing this manually requires the admin to open PowerShell and type ~10 different commands — install modules, log in to Azure, connect to Teams, create a policy, assign that policy. Most admins are not PowerShell experts.

**This Electron desktop app automates that entire process** into a **4-step wizard** where the admin just clicks buttons. Behind the scenes, the app runs every PowerShell and Azure CLI command for them.

### Example

Imagine a customer company "Acme Corp" with 500 employees using Teams for sales calls. Acme's IT admin downloads this app, clicks through 4 steps — entering the ingest app's Azure AD App ID in the Grant Policy step — and at the end, the ingest app is authorized to ingest meeting recordings for Acme's "Sales Team" group. The admin never types a single command.

---

## Architecture

The app has **two layers** that communicate via Electron IPC:

```
┌──────────────────────────────────────────────────────────────────┐
│  RENDERER (React UI)                                             │
│  App.tsx → StartSetupStep / AzureLoginStep / GrantPolicyStep /   │
│            CompleteStep                                            │
│  User clicks a button → calls window.electronAPI.<method>()      │
├──────────────────────── IPC Bridge ──────────────────────────────┤
│  MAIN PROCESS (Electron/Node.js)                                 │
│  main.ts → ipcMain.handle('<channel>') → orchestrators →         │
│            PowerShell / Azure CLI commands                        │
└──────────────────────────────────────────────────────────────────┘
```

The wizard steps are defined as an enum in `src/App.tsx`:

```ts
enum WizardStep {
  SetupEnvironment = 0,  // Step 1
  AzureLogin = 1,        // Step 2
  GrantPolicy = 2,       // Step 3
  Finish = 3             // Step 4
}
```

---

## Prerequisites: Two Tiers of Dependencies

Before the wizard can do its work, the admin's machine needs two tiers of tools. Package-manager flow is OS-aware: **winget / Chocolatey on Windows**, **Homebrew on macOS** (see [electron/install-cli.ts](../electron/install-cli.ts)).

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  TIER 1: System-level installs                                                 │
│  Windows: winget / choco        macOS: Homebrew (auto-installed if missing)   │
│                                                                                 │
│  ├── PowerShell ─────── the shell that runs everything below                   │
│  │   Check: powershell.exe / pwsh.exe / pwsh -NoProfile -Command "$PSVersion…"│
│  │   Install (Win): winget install --id Microsoft.PowerShell                   │
│  │   Install (mac): brew install --cask powershell  (with tap/formula fallbacks)│
│  │   Code: electron/util/os-util.ts (check) → electron/install-cli.ts (install)│
│  │                                                                              │
│  ├── Azure CLI ──────── login flow + Azure AD lookups (see Steps 2 and 3)      │
│  │   Check: az.cmd / az.exe / az version                                       │
│  │   Install (Win): winget install --id Microsoft.AzureCLI                     │
│  │   Install (mac): brew install azure-cli                                     │
│  │   Code: electron/util/os-util.ts (check) → electron/install-cli.ts (install)│
│  │   Used: electron/azure.ts (az login), electron/commands.ts (az ad user/group)│
│  │                                                                              │
│  └── Homebrew (macOS only) ── bootstrapped first if PowerShell/Azure CLI need it│
│      Install: NONINTERACTIVE=1 curl … | /bin/bash (falls back to interactive   │
│               Terminal via AppleScript when sudo is required)                  │
│      Code: electron/install-cli.ts                                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│  TIER 2: PowerShell module installs (Install-Module from PSGallery)            │
│  All run inside: electron/util/os-util.ts (installRequiredPowerShellModules)   │
│                                                                                 │
│  ├── NuGet (package provider) ── makes Install-Module work non-interactively   │
│  │   Install: Install-PackageProvider -Name NuGet ...                          │
│  │                                                                              │
│  ├── Az.Accounts / Az.Resources ── installed but no longer used by the active  │
│  │   code path. Earlier versions used Get-AzADUser / Get-AzADGroup for         │
│  │   user/group lookup; that flow has migrated to Azure CLI (`az ad user/group │
│  │   list`). The dead-code path in commands.ts (getAllGroups, getUserList,     │
│  │   getAllUserAndGroupList) still references them.                            │
│  │                                                                              │
│  └── MicrosoftTeams ── Teams policy management (the only Tier 2 module the     │
│      live code actually uses)                                                  │
│      Used: Import-Module, Connect-MicrosoftTeams,                              │
│            Get-/New-/Grant-CsApplicationAccessPolicy                           │
│      Code: electron/commands.ts                                                │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Azure CLI vs Az PowerShell Modules

These are **two completely different tools** that share the word "Azure":

| | **Azure CLI** (`az`) | **Az PowerShell Modules** (`Az.Accounts`, `Az.Resources`) |
|---|---|---|
| **What it is** | A standalone command-line tool installed as a system binary | PowerShell modules installed inside PowerShell via `Install-Module` |
| **Installed by** | `winget install Microsoft.AzureCLI` (Win) / `brew install azure-cli` (mac) | `Install-Module -Name Az.Accounts` |
| **Runs as** | `az login`, `az ad user list`, `az ad group list` (its own executable, invoked through PowerShell via `withAzCliCheck()`) | `Get-AzADUser`, `Get-AzADGroup` (inside PowerShell) |
| **Used for** | Device-code login (Step 2) **and** Azure AD user/group search (Step 3) | Currently unused by the active code path — see Tier 2 note above |

Think of it as: **Azure CLI** = a standalone program (like installing Chrome), **Az.Accounts / Az.Resources** = plugins inside PowerShell (like installing extensions inside VS Code).

---

## Step 1: Setup Environment

**UI:** `src/Steps/StartSetupStep.tsx` — shows a "Get Started" button  
**User clicks "Get Started"** → `src/App.tsx` `onGetStarted()` → calls `window.electronAPI.setupEnvironment()`  
**IPC Channel:** `setup-environment`  
**Handler:** `electron/main.ts` `ipcMain.handle('setup-environment', ...)`

### What this step does

Ensures the admin's machine has everything needed to run the subsequent steps.

#### System-level prerequisite checks

The handler calls `validateCliPrerequisites()` in [electron/main.ts](../electron/main.ts) before installing PowerShell modules. It probes both tools in parallel:

**Check PowerShell:**
- **Function:** `isPowerShellInstalled()` in [electron/util/os-util.ts](../electron/util/os-util.ts)
- **Command:** `<exe> -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"`. Probe order: `powershell.exe` → `pwsh.exe` → `pwsh` on Windows; `pwsh` → `powershell` on macOS/Linux.
- **If missing:** Returns `{ success: false, error: 'powershell-missing' | 'prerequisites-missing' }` → UI shows "Install PowerShell" button → renderer calls `system:install-powershell`.
- **Install:** `winget install --id Microsoft.PowerShell` or `choco install powershell-core -y` on Windows; `brew install --cask powershell` (with tap and formula fallbacks) on macOS — all in [electron/install-cli.ts](../electron/install-cli.ts).

**Check Azure CLI:**
- **Function:** `isAzCliInstalled()` in [electron/util/os-util.ts](../electron/util/os-util.ts)
- **Command:** `<exe> version`. Probe order: `az.cmd` → `az.exe` → `az` on Windows; `az` → `/opt/homebrew/bin/az` → `/usr/local/bin/az` on macOS/Linux.
- **If missing:** Returns `{ success: false, error: 'az-missing' | 'prerequisites-missing' }` → UI shows "Install Azure CLI" button → renderer calls `system:install-azure-cli`.
- **Install:** `winget install --id Microsoft.AzureCLI` or `choco install azure-cli -y` on Windows; `brew install azure-cli` on macOS.

If Homebrew itself is missing on macOS, the UI offers `system:install-homebrew`, which runs the official Homebrew installer non-interactively and falls back to opening Terminal via AppleScript when sudo is required.

#### Install PowerShell modules (active code path)

The handler calls `runPreLoginPowerShellTasks()` in `electron/teams-setup.ts`, which calls `installRequiredPowerShellModules()` in `electron/util/os-util.ts`.

A single PowerShell script is built and executed via `runPowerShell()`, which runs:

```
powershell.exe -NoProfile -Command "<script>"
```

The script contents:

| Command | What it does |
|---|---|
| `$ErrorActionPreference = 'Stop'` | Makes any error terminate the script immediately |
| `$ProgressPreference = 'SilentlyContinue'` | Suppresses download progress bars (they slow down non-interactive scripts) |
| `Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue` | Ensures NuGet provider exists so `Install-Module` can download from PSGallery without interactive prompts |
| `$requiredModules = @('Az.Accounts', 'Az.Resources', 'MicrosoftTeams')` | Declares the 3 modules needed |
| `Get-Module -ListAvailable -Name $module` (for each) | Checks if each module is already installed |
| `Install-Module -Name $module -Repository PSGallery -Scope CurrentUser -Force -AllowClobber` (for each missing) | Downloads and installs missing modules from PowerShell Gallery |

**Why each module:**

| Module | Commands it provides | Used in |
|---|---|---|
| **Az.Accounts** | Authentication context for all `Az.*` commands | Installed for backward compatibility — no live code path consumes it (see Tier 2 note above) |
| **Az.Resources** | `Get-AzADUser`, `Get-AzADGroup` | Only referenced by dead code (`getAllGroups`, `getUserList`, `getAllUserAndGroupList` in [electron/commands.ts](../electron/commands.ts)); live user/group lookup now uses Azure CLI |
| **MicrosoftTeams** | `Connect-MicrosoftTeams`, `New-CsApplicationAccessPolicy`, `Grant-CsApplicationAccessPolicy`, `Get-CsApplicationAccessPolicy` | [electron/commands.ts](../electron/commands.ts) — Teams session and policy management (Step 3) |

**Why NuGet:** On a fresh machine, the NuGet package provider may not be present. Without it, `Install-Module` prompts interactively ("Install NuGet provider? [Y/N]"), which freezes a non-interactive app.

**Why Az.Accounts + Az.Resources instead of Az:** The full `Az` meta-module contains 70+ sub-modules (~300+ MB). The original design needed only `Get-AzADUser` and `Get-AzADGroup` from `Az.Resources` (which depends on `Az.Accounts`); installing just those two is significantly faster. Now that user/group lookup has moved to Azure CLI, the `Az.*` install is effectively vestigial — it remains in `installRequiredPowerShellModules()` to avoid breaking the dead-code paths that still reference it.

**After success:** Returns `{ success: true }` → UI sets `isEnvironmentSetupComplete = true` → wizard advances to Step 2.

---

## Step 2: Azure Login

**UI:** `src/Steps/AzureLoginStep.tsx` — shows a "Login to Azure" button  
**User clicks "Login to Azure"** → `src/App.tsx` `onAzureLogin()` → calls `window.electronAPI.startAzLogin()`  
**IPC Channel:** `start-az-login`  
**Handler:** `electron/main.ts` `ipcMain.handle('start-az-login', ...)`

### What this step does

Performs Azure device-code login via Azure CLI. It does **not** pre-fetch users or groups — those are loaded lazily in Step 3 as the admin types in the search boxes (see "User/group search" below).

Calls `runAzLogin()` in [electron/azure.ts](../electron/azure.ts).

**Command 1 — Login:**
```
az login --use-device-code --allow-no-subscriptions
```

- `--use-device-code`: Azure CLI outputs a code (e.g., `ABC123XYZ`) and a URL (`https://microsoft.com/devicelogin`). The admin opens that URL and types the code.
- `--allow-no-subscriptions`: Allows login even if the account has no Azure subscriptions (some Teams-only admins don't).
- **Timeout:** 10 minutes — if the admin doesn't complete the browser flow in time, the handler returns `{ success: false, error: 'az-login-timeout' }`.

While this runs, `maybeHandleDeviceCodeLine()` parses the live output looking for the device code and URL. When detected, the app auto-opens `https://microsoft.com/devicelogin` in the browser and logs the code to the UI.

**Command 2 — Get account info:**
```
az account show --output json
```
Returns the logged-in account's name, username, and tenant ID.

**Fallback** (if no subscription):
```
az account tenant list --output json
```
Returns the tenant ID even without subscription access.

**Specific error mappings** (handled in [electron/main.ts](../electron/main.ts)):
- `ENOENT` → `{ error: 'az-missing' }` (Azure CLI not on PATH).
- `ETIMEDOUT` → `{ error: 'az-login-timeout' }`.
- stderr/stdout contains `AADSTS50076` → `{ error: 'az-mfa-required' }` (tenant requires MFA).
- anything else → `{ error: 'az-login-failed', message }`.

**After success:** Returns `{ success: true, azure: { accountName, userName, tenantId } }` → UI sets `isAzureLoginComplete = true` → wizard advances to Step 3.

---

## Step 3: Grant Policy

**UI:** `src/Steps/GrantPolicyStep.tsx` — form with policy name, grant type (User/Group/Global), and user/group dropdowns  
**User fills the form and clicks "Submit"** → `src/App.tsx` `onGrantPolicy(values)` → calls `window.electronAPI.grantPolicy(data)`  
**IPC Channel:** `grant-policy`  
**Handler:** `electron/main.ts` `ipcMain.handle('grant-policy', ...)`

### What this step does

The admin picks a policy name and a target type (User / Group / Global), then either types into a search box (which streams matches from Azure AD via Azure CLI) or pastes a CSV of email addresses. On submit the app creates the Teams access policy and grants it to the chosen targets.

#### User/group search (lazy, while the admin types)

The Grant Policy form in [src/Steps/GrantPolicyStep.tsx](../src/Steps/GrantPolicyStep.tsx) (with the modal in [src/Steps/EntitySelectionDialog.tsx](../src/Steps/EntitySelectionDialog.tsx)) does not load the entire directory up front. As the admin types, the renderer calls one of three IPC channels:

| IPC channel | Backend function | Command (via PowerShell wrapper `withAzCliCheck()`) | Page size |
|---|---|---|---|
| `search-users` | `searchUsers()` in [electron/commands.ts](../electron/commands.ts) | `az ad user list --query "[].{Id:id, DisplayName:displayName, UserPrincipalName:userPrincipalName}" --output json` (filtered client-side, paged) | 10 |
| `search-users-by-emails` | `searchUsersByEmails()` | `az ad user show --id <email>` per email (CSV import flow) | n/a |
| `search-groups` | `searchGroups()` | `az ad group list --query "[].{Id:id, DisplayName:displayName}" --output json` (filtered client-side, paged) | 10 |

`withAzCliCheck()` resolves the `az` executable inside the PowerShell session before each script (`Get-Command az.exe` / `Get-Command az`), so no system PATH changes are required.

Each call returns `{ users | groups, total }`. `total` powers the pagination UI; the page slice is computed in PowerShell with `Select-Object -Skip … -First …`.

#### Submit: create + grant the policy

When the admin clicks Submit, the renderer calls `electronAPI.grantPolicy({ policyName, type, users, groups })` → IPC channel `grant-policy`. The handler in [electron/main.ts](../electron/main.ts) validates the payload (policy name is required; `user`-type requires at least one user; `group`-type requires at least one group) and calls `grantAccessPolicy()` in [electron/teams-setup.ts](../electron/teams-setup.ts).

##### Part A: Create the policy

Calls `setupPolicy()` in [electron/commands.ts](../electron/commands.ts).

**Check if policy exists** (`getPolicyByName()`):
```powershell
Get-CsApplicationAccessPolicy -Identity "<policyName>"
```
If found → skips creation.

**Create (if not found):**
```powershell
New-CsApplicationAccessPolicy -Identity "<policyName>" -AppIds "<teamsAppId>" -Description "MS teams access policy for Teams Meeting Ingest"
```

- `-Identity`: The policy name the admin entered.
- `-AppIds`: The App ID entered by the admin in the Grant Policy step of the UI, validated as a GUID both at the IPC boundary (`electron/main.ts`) and again via `assertAppId()` in [electron/util/validate.ts](../electron/util/validate.ts) before it reaches this script.
- `-Description`: Hardcoded human-readable description.

This tells Microsoft Teams: *"There is now a policy authorizing this specific app to access meeting data."*

##### Part B: Assign the policy

Depending on the admin's selection in the UI:

**User-level** — `grantPolicyToUser()` in [electron/commands.ts](../electron/commands.ts):
```powershell
Grant-CsApplicationAccessPolicy -Identity "<userPrincipalName>" -PolicyName "<policyName>"
```
(Runs once per selected user.)

**Group-level** — `grantPolicyToGroup()`:
```powershell
Grant-CsApplicationAccessPolicy -Group "<groupId>" -PolicyName "<policyName>"
```

**Global (everyone)** — `grantPolicyToGlobal()`:
```powershell
Grant-CsApplicationAccessPolicy -Global -PolicyName "<policyName>"
```

All three are wrapped with `withTeamsLoginCheck()`, which prepends `Import-Module MicrosoftTeams` + `Connect-MicrosoftTeams` so the session is authenticated before the grant command runs.

**After success:** Returns `{ success: true, policyName, users, groups, message, data: <per-user grant details> }` → UI sets `isGrantPolicyComplete = true` → wizard advances to Step 4.

---

## Step 4: Finish

**UI:** `src/Steps/CompleteStep.tsx`

**No commands. No IPC calls.** Simply displays:

> *"Policy applied successfully."*

The wizard is complete. The admin can close the app.

---

## Complete Flow Diagram

```
STEP 1: Setup Environment
─────────────────────────
UI: "Get Started" button
IPC: setup-environment
Code: main.ts → teams-setup.ts → os-util.ts

  ┌─ PowerShell command ────────────────────────────────────────────────┐
  │ Install-PackageProvider -Name NuGet ...                             │
  │ Get-Module -ListAvailable -Name Az.Accounts                        │
  │ Get-Module -ListAvailable -Name Az.Resources                       │
  │ Get-Module -ListAvailable -Name MicrosoftTeams                     │
  │ Install-Module -Name <missing> -Repository PSGallery                │
  └─────────────────────────────────────────────────────────────────────┘
                              ↓ success

STEP 2: Azure Login
─────────────────────────
UI: "Login to Azure" button
IPC: start-az-login
Code: main.ts → azure.ts

  ┌─ Shell command ─────────────────────────────────────────────────────┐
  │ az login --use-device-code --allow-no-subscriptions                 │
  │ az account show --output json                                       │
  └─────────────────────────────────────────────────────────────────────┘
                              ↓ success (no user/group data fetched here)

STEP 3: Grant Policy
─────────────────────────
UI: Form with policy name, type, paged user/group search
IPC: search-users / search-users-by-emails / search-groups (as admin types)
     grant-policy                                          (on submit)
Code: main.ts → commands.ts (search) → teams-setup.ts → commands.ts (grant)

  Search (lazy) — Azure CLI via PowerShell
  ┌─ PowerShell command ────────────────────────────────────────────────┐
  │ az ad user list --query "[].{Id,DisplayName,UserPrincipalName}"     │
  │ az ad group list --query "[].{Id,DisplayName}"                      │
  │ az ad user show --id <email>            (CSV import flow)           │
  └─────────────────────────────────────────────────────────────────────┘

  Part A — Create policy (PowerShell, MicrosoftTeams module)
  ┌─ PowerShell command ────────────────────────────────────────────────┐
  │ Get-CsApplicationAccessPolicy -Identity "<name>"                    │
  │ New-CsApplicationAccessPolicy -Identity "<name>"                    │
  │   -AppIds "<appId>" -Description "..."                              │
  └─────────────────────────────────────────────────────────────────────┘

  Part B — Assign policy (one of three)
  ┌─ PowerShell command ────────────────────────────────────────────────┐
  │ Grant-CsApplicationAccessPolicy -Identity "<user>"      (user)      │
  │ Grant-CsApplicationAccessPolicy -Group "<groupId>"      (group)     │
  │ Grant-CsApplicationAccessPolicy -Global                 (global)    │
  └─────────────────────────────────────────────────────────────────────┘
                              ↓ success

STEP 4: Finish
─────────────────────────
UI: "Policy applied successfully."
No commands. Done.
```

---

## Cross-Cutting Concerns

### Security — renderer loads only local content

#### Assumption

The BrowserWindow renderer loads **only local content**:

- **Production** — `file://` from the bundled `dist/index.html`
- **Development** — `http://localhost:5173` (Vite dev server)

This assumption is treated as a **machine-enforced control**, not a convention. If it silently breaks, the renderer could be navigated to an external origin and used as an attack surface against the privileged main process.

#### Enforced controls

The six controls below together enforce the assumption. They are defined as named, testable constants in [electron/util/security-constants.ts](../electron/util/security-constants.ts) and wired into [electron/window.ts](../electron/window.ts).

| # | Control | Where set | What it prevents |
|---|---|---|---|
| 1 | `sandbox: true` | `BrowserWindow` `webPreferences` | Renderer process runs in the OS sandbox — Node.js built-ins are unreachable even if the preload bridge is bypassed |
| 2 | `contextIsolation: true` | `BrowserWindow` `webPreferences` | Renderer JS context is isolated from the preload context — `window` cannot reach `ipcRenderer` directly |
| 3 | `nodeIntegration: false` | `BrowserWindow` `webPreferences` | Belt-and-suspenders: Node APIs are not injected into the renderer even without `contextIsolation` |
| 4 | `will-navigate` handler | `webContents.on('will-navigate', …)` | Any renderer-initiated navigation to a non-local URL is cancelled before the request leaves the process; uses `isLocalUrl()` from [electron/util/url.ts](../electron/util/url.ts) |
| 5 | `setWindowOpenHandler` | `webContents.setWindowOpenHandler(…)` | `window.open()` and `target="_blank"` links are denied in-process; `https://` links are forwarded to the system browser via `shell.openExternal` |
| 6 | Content-Security-Policy | `session.webRequest.onHeadersReceived` (dev) and `<meta http-equiv="Content-Security-Policy">` in `index.html` (prod) | Prevents inline script injection and restricts `script-src` to `'self'`; `object-src 'none'` blocks plugins; `form-action 'none'` blocks cross-origin form posts |

#### IPC boundary hardening

Controls 1–6 protect the browser process. At the IPC boundary, the main process additionally validates every payload before acting on it — it never trusts renderer-supplied data:

| IPC channel | Validation applied |
|---|---|
| `grant-policy` | Payload must be a plain object; `type` must be exactly `"user"` or `"group"`; `policyName` must match the `POLICY_NAME_RE` allowlist; group IDs must be valid GUIDs |
| `settings:set-policy-name` | `policyName` validated against `POLICY_NAME_RE` before write |
| `settings:get-policy-name` | Stored value re-validated on read — defends against a tampered `settings.json` |
| `search-users` / `search-groups` | `searchText` capped at 200 characters |
| `search-users-by-emails` | Each address validated against an email-shape pattern; batch capped at 500 |

Validation logic lives in [electron/util/validate.ts](../electron/util/validate.ts). The same functions used at runtime are imported directly by the test suite — there is no separate test double that can drift.

#### Test coverage

[electron/test/security-controls.test.ts](../electron/test/security-controls.test.ts) — run with `npm test`.

| Test group | What is asserted |
|---|---|
| Controls 1–3 (`SECURE_WEB_PREFERENCES`) | `sandbox`, `contextIsolation`, `nodeIntegration` have the exact required values |
| Control 4 (`isLocalUrl`) | Allowed: `file://`, `http/https://localhost`. Blocked: all external origins, `data:`, `javascript:`, `blob:`, malformed URLs |
| Control 5 (`setWindowOpenHandler`) | No unit test possible without a live `BrowserWindow`; enforced by the code-review contract in `window.ts` |
| Control 6 (`DEV_CSP` / `PROD_CSP`) | Required directives present (`object-src 'none'`, `script-src 'self'`, `base-uri 'self'`, `form-action 'none'`, no `unsafe-eval`); `PROD_CSP` constant verified to match the `index.html` meta tag byte-for-byte |
| IPC validators | `isValidPolicyName`, `isValidGuid`, `isValidSearchText`, `isValidEmail`, `EMAIL_BATCH_LIMIT` — boundary and injection cases |

---

### Logging

Every IPC handler in [electron/main.ts](../electron/main.ts) attaches two loggers:

1. **Progress logger** (`createProgressLogger()`) — sends `{ timestamp, message }` over the `op:progress` channel to the renderer. The UI appends each message to the live log panel.
2. **Enterprise logger** (`createEnterpriseLogger()` in [electron/util/logger/enterprise-logger.ts](../electron/util/logger/enterprise-logger.ts)) — writes to disk for audit trails. A **single session logger** is created on first use and reused for the rest of the process lifetime; subsequent IPC calls append to the same files.

   - Base directory: `app.getPath('userData')/logs/<YYYY-MM-DD>/<HH-MM-SS>/`
   - `log.txt` — full append-only operation log with ISO timestamps (every `elog.log(...)` and `elog.error(...)` call).
   - `result.txt` — concise summary written when `elog.finish(success)` runs at the end of a grant operation (start/end time, status, accumulated `addSummary()` entries).

The `shell:open-logs-folder` IPC channel opens this directory in Finder/Explorer (used by the folder icon in the wizard header).

### Settings persistence

The wizard remembers the last policy name the admin entered, so the next session pre-fills it. Storage: `app.getPath('userData')/settings.json`, schema `{ grantPolicyName?: string }`. IPC: `settings:get-policy-name` / `settings:set-policy-name`. All wiring lives in [electron/main.ts](../electron/main.ts).

### Install-on-demand IPC

If the prerequisite check in Step 1 reports a missing tool, the UI shows an "Install …" button that calls one of these install handlers. All three live in [electron/install-cli.ts](../electron/install-cli.ts):

| IPC channel | Backend function | Platforms |
|---|---|---|
| `system:install-powershell` | `installPowerShell()` | Windows (winget/choco), macOS (brew cask → tap → formula) |
| `system:install-azure-cli`  | `installAzureCli()`   | Windows (winget/choco), macOS (brew) |
| `system:install-homebrew`   | `installHomebrew()`   | macOS only — bootstraps Homebrew non-interactively; falls back to opening Terminal when sudo is needed |

### IPC channel reference

| Channel | Direction | Handler | Used by |
|---|---|---|---|
| `setup-environment` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 1 — "Get Started" |
| `start-az-login` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 2 — "Login to Azure" |
| `grant-policy` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — Submit |
| `search-users` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — user search box |
| `search-users-by-emails` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — CSV import |
| `search-groups` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — group search box |
| `settings:get-policy-name` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — prefill |
| `settings:set-policy-name` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 3 — persist on submit |
| `system:install-powershell` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 1 — install fallback |
| `system:install-azure-cli` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 1 — install fallback |
| `system:install-homebrew` | renderer → main | [electron/main.ts](../electron/main.ts) | Step 1 — install fallback (macOS) |
| `shell:open-logs-folder` | renderer → main | [electron/main.ts](../electron/main.ts) | header — open logs in file explorer |
| `op:progress` | main → renderer | [electron/preload.ts](../electron/preload.ts) | live log panel |

The renderer-facing names (`setupEnvironment`, `searchUsers`, `openLogsFolder`, …) are bound to these channels in [electron/preload.ts](../electron/preload.ts) via `contextBridge.exposeInMainWorld('electronAPI', …)`.

---

## Key Files Reference

### Renderer (React)

| File | Purpose |
|---|---|
| [src/App.tsx](../src/App.tsx) | Main React component — wizard state machine, IPC calls to main process |
| [src/Steps/index.tsx](../src/Steps/index.tsx) | Barrel re-exporting step components |
| [src/Steps/StartSetupStep.tsx](../src/Steps/StartSetupStep.tsx) | Step 1 UI — "Get Started" + install buttons |
| [src/Steps/AzureLoginStep.tsx](../src/Steps/AzureLoginStep.tsx) | Step 2 UI — "Login to Azure" button |
| [src/Steps/GrantPolicyStep.tsx](../src/Steps/GrantPolicyStep.tsx) | Step 3 UI — policy form with target-type selector and searchable user/group inputs |
| [src/Steps/EntitySelectionDialog.tsx](../src/Steps/EntitySelectionDialog.tsx) | Modal used by Step 3 — paged search results with selection |
| [src/Steps/CompleteStep.tsx](../src/Steps/CompleteStep.tsx) | Step 4 UI — success message |
| [src/Steps/PolicyTypeStep.tsx](../src/Steps/PolicyTypeStep.tsx) | Exported but not currently wired into the wizard flow |
| [src/components/](../src/components/) | Reusable UI primitives — Button, MultiSelect, SearchableTargetMultiSelect, Stepper, SuccessIndicator, TextField |
| [src/ThemeModeProvider.tsx](../src/ThemeModeProvider.tsx) | Material-UI theme/dark-mode provider |
| [src/theme.ts](../src/theme.ts) | MUI theme configuration |

### Main process (Electron / Node)

| File | Purpose |
|---|---|
| [electron/main.ts](../electron/main.ts) | All IPC handlers — routes UI actions to backend functions; owns session logger and settings store |
| [electron/preload.ts](../electron/preload.ts) | Exposes `window.electronAPI` to the renderer via `contextBridge` |
| [electron/window.ts](../electron/window.ts) | Electron BrowserWindow creation |
| [electron/env.ts](../electron/env.ts) | Loads `.env` into `process.env` — checks dev, build-output, packaged, and execPath locations |
| [electron/teams-setup.ts](../electron/teams-setup.ts) | Orchestrator — `runPreLoginPowerShellTasks()` and `grantAccessPolicy()` |
| [electron/azure.ts](../electron/azure.ts) | Azure device-code login via Azure CLI (`runAzLogin()`) |
| [electron/commands.ts](../electron/commands.ts) | PowerShell + Azure CLI commands — policy CRUD via MicrosoftTeams module, user/group search via `az ad user/group list` |
| [electron/install-cli.ts](../electron/install-cli.ts) | System-level install logic for PowerShell, Azure CLI, and Homebrew (winget / choco / brew) |
| [electron/util/os-util.ts](../electron/util/os-util.ts) | Core utilities — `runPowerShell()`, `installRequiredPowerShellModules()`, CLI detection, PATH extension |
| [electron/util/powershell.ts](../electron/util/powershell.ts) | Live-output PowerShell runner (used by Azure CLI login for streaming device-code output) |
| [electron/util/logger/enterprise-logger.ts](../electron/util/logger/enterprise-logger.ts) | Session-based file logger — writes `log.txt` and `result.txt` under `userData/logs/<date>/<time>/` |
