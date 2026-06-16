# Teams Policy Config

Simple desktop app with two fields:
- Folder name
- File name

When you click **Create**, the app calls Electron IPC and executes a **PowerShell** command to:
- create the folder
- create the text file
- write `Hello Electron`

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
