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

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in the required values. `VITE_APP_ID` is **mandatory** — the app will not work without it:
   ```env
   VITE_APP_ID=<your-azure-app-id>
   ```
3. Optionally update the other variables:
   | Variable | Description | Default |
   |---|---|---|
   | `VITE_DEFAULT_POLICY_NAME` | Teams meeting policy name | `Teams-Meeting-Policy` |
   | `VITE_ORG_NAME` | Your organisation name | _(empty)_ |
   | `VITE_TECHNICAL_DOCUMENTATION_LINK` | Link shown in the UI | Azure CLI docs URL |

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
