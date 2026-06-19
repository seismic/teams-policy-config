# Teams Policy Config

A desktop setup wizard (Electron) that creates a **Microsoft Teams Application Access Policy** in your Azure AD tenant and grants it to the users, groups, or the whole tenant you choose. It drives the Microsoft Teams and Azure CLI tooling for you via **PowerShell**, so admins don't have to run the cmdlets by hand.

The wizard walks through four steps:

1. **Setup Environment** — checks that PowerShell and Azure CLI are installed.
2. **Azure Login** — signs in to Azure AD via device-code authentication.
3. **Grant Policy** — creates the policy and grants it at User, Group, or Global (tenant-wide) level.
4. **Complete** — shows a summary of what was applied.

See the [User Guide](docs/usage-doc.md) for a full walkthrough and the [architecture overview](docs/architecture.md) for how it works under the hood.

> **Least-privilege guidance:** Start with a small **pilot group** (User or Group level), validate, then **expand deliberately**. Avoid granting at Global (tenant-wide) level until the policy is validated and every user genuinely needs it. See [Least-privilege rollout](docs/usage-doc.md#least-privilege-rollout).

## Run

```bash
npm install
npm start
```

## Set environment

1. Create a `.env` file in the project root and add the following variables:
   ```env
   VITE_APP_ID=<your-azure-app-id>
   VITE_DEFAULT_POLICY_NAME=Teams-Meeting-Policy
   VITE_ORG_NAME=
   VITE_TECHNICAL_DOCUMENTATION_LINK=https://docs.microsoft.com/en-us/azure/azure-cli-install

   ```
   `VITE_APP_ID` is **mandatory** — the app will not work without it.

   | Variable | Description | Default |
   |---|---|---|
   | `VITE_APP_ID` | Azure App ID **(mandatory)** | _(none)_ |
   | `VITE_DEFAULT_POLICY_NAME` | Teams meeting policy name | `Teams-Meeting-Policy` |
   | `VITE_ORG_NAME` | Your organisation name | _(empty)_ |
   | `VITE_TECHNICAL_DOCUMENTATION_LINK` | Link shown in the UI | `https://docs.microsoft.com/en-us/azure/azure-cli-install` |

## Build

### For Mac

```bash
npm run dist:mac
```

See the [Mac build guide](docs/mac-build.md) for detailed step-by-step instructions, prerequisites, code signing, and troubleshooting.

### For Windows

```bash
npm run dist:win
```

See the [Windows build guide](docs/windows-build.md) for detailed step-by-step instructions, prerequisites, code signing, and troubleshooting.

## PowerShell Requirement

This project executes PowerShell from Electron main process (`electron/main.ts`).
Install PowerShell Core (`pwsh`) on macOS/Linux, or use Windows PowerShell on Windows.
