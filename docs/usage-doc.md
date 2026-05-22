# Apply Microsoft Teams Access Policy — User Guide

This app is a setup wizard that applies a Microsoft Teams Application Access Policy to your Azure AD tenant. It walks you through four steps in order: environment check, Azure login, policy configuration, and confirmation.

---

## Overview

| Step | Label | What happens |
|---|---|---|
| 1 | Setup Environment | Checks that PowerShell and Azure CLI are installed and ready |
| 2 | Azure Login | Authenticates you to Azure AD via device-code sign-in |
| 3 | Grant Policy | Creates the Teams policy and assigns it to users, groups, or the whole tenant |
| 4 | Complete | Shows a summary of what was applied |

Progress is shown by a dot indicator at the top of the panel. You move forward with the **Next** / **Finish** button at the bottom. The button is disabled until the current step is satisfied.

A live **Operation Logs** panel on the right side of the window streams every background action in real time — useful for troubleshooting.

---

## Step 1 — Setup Environment

**What it does:** Automatically runs a prerequisite check the moment this step loads. It verifies that both PowerShell and Azure CLI (`az`) are installed and reachable.

### Possible outcomes

#### All prerequisites met
The check passes silently. You can now click Next to proceed to Step 2.

#### PowerShell is missing

A message is shown and the **Install PowerShell** button appears.

| Action | Details |
|---|---|
| **Install PowerShell** | Runs the OS-appropriate install command. On macOS, uses Homebrew (`brew install --cask powershell`). On Windows, uses `winget install Microsoft.PowerShell` with Chocolatey as fallback. A confirmation dialog appears before anything is run. You may be prompted for your system password or a UAC approval on Windows. |

After installation the environment check re-runs automatically. A green success indicator replaces the button when complete.

> **Linux:** Automatic install is not supported. Follow the link shown in the message to install PowerShell manually, then restart the app.

#### Azure CLI is missing

A message is shown and the **Install Azure CLI** button appears.

| Action | Details |
|---|---|
| **Install Azure CLI** | Runs `brew install azure-cli` on macOS or `winget install Microsoft.AzureCLI` on Windows. A confirmation dialog appears first. On macOS, if Homebrew itself is not installed, a second dialog asks whether to install Homebrew first. |

**Homebrew install flow (macOS only):**

1. The app first attempts a non-interactive install inside the app process.
2. If that fails (common in sandboxed Electron contexts), it opens a real Terminal window via AppleScript and starts the Homebrew installer interactively there.
3. Once you see `"If installation completed successfully, return to the app and retry."` in Terminal, complete the install, then click **Install Azure CLI** again in the app.

> **Linux:** Follow the link shown in the message to install Azure CLI manually, then restart the app.

#### Both prerequisites are missing

Both **Install PowerShell** and **Install Azure CLI** buttons appear simultaneously. Install them in either order; the environment check re-runs after each.

#### PowerShell module installation fails

After the binary checks pass, the app installs required PowerShell modules (`Az.Accounts`, `Az.Resources`, `MicrosoftTeams`) from the PowerShell Gallery. If this step fails, an error is displayed with details. Common causes:

- No internet access to `https://www.powershellgallery.com`
- Corporate proxy blocking outbound HTTPS
- PowerShell execution policy restricting `Install-Module`

Resolve the issue and click **Next** to retry (the environment check will run again).

---

## Step 2 — Azure Login

**What it does:** Signs you in to Azure AD using the device-code authentication flow so the app can query Azure AD users and groups, and later apply Teams policies.

### Actions

| Action | Details |
|---|---|
| **Login to Azure** | Starts the `az login --use-device-code` flow. The app opens `https://microsoft.com/devicelogin` in your default browser automatically. |

### Device code flow

1. Click **Login to Azure**.
2. A device code (e.g. `ABCD1234`) appears in the panel.
3. Your browser opens `https://microsoft.com/devicelogin` automatically.
4. Enter the device code in the browser and sign in with your Azure AD credentials.
5. If MFA is required, complete the MFA challenge in the browser.
6. Once sign-in is confirmed, the app shows a green **Login successful** indicator with your account name and tenant ID.

> **Copy button:** A copy icon next to the device code lets you copy it to the clipboard in one click if you need to paste it manually.

### After login

Upon success the app fetches a sample list of users and groups from your Azure AD tenant in the background. These populate the pickers in Step 3.

### Error states

| Error | What to do |
|---|---|
| **MFA required** | Complete the device-code sign-in in the browser window that opened, including MFA. Then click **Login to Azure** again. |
| **Login timed out** | The device-code sign-in window has a time limit (~10 min). Click **Login to Azure** to start a fresh code. |
| **Login failed** | Details are shown in the message bar and Operation Logs. Check your credentials and network, then retry. |
| **Tenant-only login** | If your account has no Azure subscriptions, the app falls back to tenant-level context. Login still succeeds and all policy operations remain available. |

---

## Step 3 — Grant Policy

**What it does:** Creates (or reuses) a Teams Application Access Policy and assigns it to the targets you choose.

> **Note:** The policy only applies to users or groups that do not already have an existing policy. Users with a policy that is missing the app ID will have the app ID added automatically.

### Field: Policy Name

| Detail | Description |
|---|---|
| **Type** | Free text, required |
| **Default value** | Pre-filled from the `VITE_DEFAULT_POLICY_NAME` environment variable (default: `Teams-Meeting-Policy`) |
| **Persistence** | The value you type is saved locally and pre-filled on the next app launch |

Enter the name for the Teams Application Access Policy. If a policy with this name already exists in the tenant, the app reuses it (updating it with the app ID if needed) instead of creating a duplicate.

---

### Field: Grant level (policy type)

Choose one of three radio options:

#### User level
Assigns the policy to individual users. Best for targeted rollouts or exceptions.

- Requires at least one user to be selected before **Finish** is enabled.
- Users can be added manually via the **Add users** dialog or imported from a CSV file.

#### Group level
Assigns the policy to Azure AD groups. All members of the selected groups inherit the policy. Best for department- or team-scale rollouts.

- Requires at least one group to be selected before **Finish** is enabled.
- Groups are added via the **Add groups** dialog.

#### Global level
Assigns the policy tenant-wide to every user in the organization.

- No user or group selection is needed.
- **Finish** becomes available immediately after entering a policy name.
- Use with caution — this affects all users in the tenant.

---

### User selection (User level only)

#### Add users button

Opens the **User Picker** dialog.

| Dialog element | Description |
|---|---|
| **Search box** | Type any part of a display name or email (UPN). Results update with a short debounce (~400 ms). |
| **Results list** | Shows up to 10 users per page from Azure AD. Check the box next to each user you want to include. |
| **Pagination** | Use the page controls at the bottom to browse when there are more results than fit on one page. |
| **Selected count** | A counter in the dialog header shows how many users are currently checked. |
| **Save / Cancel** | **Save** adds checked users to the selection. **Cancel** discards changes. Previously selected users are pre-checked when the dialog reopens. |

Selected users appear as removable chips in the field above the buttons. Click the × on a chip to deselect a user.

#### Upload CSV button

Imports users from a CSV file.

**Supported CSV formats:**

| Format | Description |
|---|---|
| Column named `Email` | The app reads the `Email` column for user principal names |
| Column named `UserPrincipalName` | The app reads this column if `Email` is not present |
| No header row | The app treats the first column of every row as the UPN |

After you select a file, the app reads it in the browser, extracts the email/UPN values, and resolves each one against Azure AD to fetch the full display name. A **Loading users...** indicator is shown while this runs. Resolved users are merged with any already-selected users — duplicates are deduplicated automatically.

The name of the uploaded file is shown next to the button as confirmation.

---

### Group selection (Group level only)

#### Add groups button

Opens the **Group Picker** dialog.

| Dialog element | Description |
|---|---|
| **Search box** | Type any part of the group display name. Results update with a short debounce. |
| **Results list** | Shows up to 10 groups per page. Check groups to include them. |
| **Pagination** | Browse multiple pages when the tenant has many groups. |
| **Save / Cancel** | Works the same as the user picker. |

Selected groups appear as removable chips. Click × to remove a group.

---

### Finish button

Becomes active when:
- A policy name is entered, **and**
- At least one user is selected (User level), or at least one group is selected (Group level), or Global level is chosen.

Clicking **Finish** runs the full policy operation:

1. Checks whether the policy already exists.
2. Creates the policy with `New-CsApplicationAccessPolicy` if it does not exist.
3. If it exists, updates it with the app ID via `Set-CsApplicationAccessPolicy`.
4. Grants the policy via `Grant-CsApplicationAccessPolicy` to each target.

The button label changes to **Processing...** and is disabled while the operation runs. Progress is streamed to the Operation Logs panel.

---

## Step 4 — Complete

Shown automatically after a successful policy grant.

### What is displayed

| Section | Description |
|---|---|
| **Success indicator** | Green checkmark confirming the policy was applied. |
| **Assigned policy** | Lists users or groups where the policy was freshly assigned. |
| **Already had policy** | Lists users whose existing policy already contained the app ID — no change was made. |
| **Assigned targets** | For group or global grants, lists the group names or confirms tenant-wide application. |

No further action is required. You can close the app.

---

## Operation Logs panel

Located on the right side of the window. Streams timestamped messages from every background operation:

- PowerShell / Azure CLI command output
- Device code detection
- Module installation progress
- Policy operation results
- Error details

The panel scrolls automatically to the latest entry. It retains the last 80 lines. Use this panel to diagnose errors — the full error message is shown here even when the UI message bar shows only a summary.

---

## Prerequisites summary

| Requirement | Minimum version | Notes |
|---|---|---|
| PowerShell | 5.1+ (Windows) or 7+ (macOS/Linux) | `pwsh` or `powershell.exe` must be in PATH |
| Azure CLI | Any recent version | `az` must be in PATH |
| Az.Accounts module | Latest from PSGallery | Installed automatically |
| Az.Resources module | Latest from PSGallery | Installed automatically |
| MicrosoftTeams module | Latest from PSGallery | Installed automatically |
| Azure AD account | Must have Teams admin or equivalent role | Required to create and grant CS policies |

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
|---|---|---|
| Environment check loops without advancing | PowerShell module install blocked by proxy or execution policy | Check internet access; run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` in PowerShell and retry |
| Device code not appearing | Browser popup blocked | Manually open `https://microsoft.com/devicelogin` and watch Operation Logs for the code |
| "No subscription context" message after login | Account has no Azure subscriptions | Not an error — tenant-level login is sufficient for policy operations |
| `Get-CsApplicationAccessPolicy` fails | MicrosoftTeams module not connected | Ensure Teams admin credentials were used at login; retry from Step 2 |
| CSV import shows no users | File format mismatch | Ensure the CSV has a column named `Email` or `UserPrincipalName`, or put emails in the first column with no header |
| Finish button stays disabled | No users/groups selected, or policy name is empty | Fill in the policy name and add at least one target for user/group grants |
