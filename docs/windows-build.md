# Building for Windows

This guide walks through generating a distributable Windows build (`.exe` NSIS installer) for the **Teams Policy Config** Electron app.

The build is produced by [`electron-builder`](https://www.electron.build/) and is configured under the `"build"` key in [package.json](../package.json).

---

## 1. Prerequisites

### 1.1 Hardware / OS

- A machine running **Windows 10 (1809+) or Windows 11**, 64-bit.
- It is **strongly recommended** to build the Windows artifact **on Windows**. While `electron-builder` can cross-compile a Windows `.exe` from macOS/Linux (via Wine + Mono), the experience is fragile — native modules, code signing, and NSIS plugins all behave best on the native OS.
- Both **x64** and **arm64** targets are supported; default is `x64`.

### 1.2 Tooling

| Tool                            | Required Version           | Notes                                                                          |
|---------------------------------|----------------------------|--------------------------------------------------------------------------------|
| Node.js                         | `24.15.0` (pinned by Volta) | See `"volta"` block in [package.json](../package.json).                        |
| npm                             | Bundled with Node 24       | `npm -v` should report `10.x` or newer.                                        |
| Git for Windows                 | Latest                     | Includes `bash` which is useful for some npm scripts.                          |
| Visual Studio Build Tools 2022  | Latest                     | Required for compiling native modules. Install the *Desktop development with C++* workload. |
| Python                          | 3.10+                      | Required by `node-gyp` when rebuilding native modules.                         |
| PowerShell                      | 5.1 (built-in) or `pwsh` 7+ | Built-in Windows PowerShell works for running the app.                          |

Install Volta (recommended) so the pinned Node version is picked up automatically:

```powershell
# In PowerShell, run as your normal user
winget install Volta.Volta
```

Restart your terminal and verify:

```powershell
node -v   # v24.15.0
npm -v
```

Install Visual Studio Build Tools 2022 with the **C++ build tools** workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### 1.3 Repository Checkout

Open **PowerShell** (preferred) or **Git Bash** and run:

```powershell
git clone <repo-url>
cd teams-policy-config
```

> **Tip:** Avoid building from a deeply nested folder. Windows still has a 260-character path limit by default, and `node_modules` can blow through it. Keep the checkout near a drive root (e.g. `C:\dev\teams-policy-config`).

---

## 2. Install Dependencies

From the project root:

```powershell
npm install
```

This installs both runtime dependencies (`react`, `@mui/material`, etc.) and dev dependencies including `electron`, `electron-builder`, `vite`, and `typescript`.

> **Note:** If `npm install` fails with native-module compile errors, ensure the **Visual Studio C++ Build Tools** workload is installed and that `python` resolves on `PATH`. Then re-run the install.

---

## 3. Verify Build Assets

The `build/` folder is referenced by `electron-builder` for app icons and other resources:

```json
"win": {
  "icon": "build/icon.ico",
  "target": "nsis"
},
"nsis": {
  "deleteAppDataOnUninstall": false
}
```

Before producing a release build, ensure `build/icon.ico` exists. If it does not, either:

1. Place a valid multi-resolution `icon.ico` file at `build/icon.ico` (containing 16×16, 32×32, 48×48, 64×64, 128×128, and 256×256 entries), **or**
2. Temporarily remove the `"icon"` line from the `win` block in [package.json](../package.json) to let `electron-builder` fall back to its default Electron icon (not recommended for releases).

To create an `.ico` from a PNG you can use any of:

- The free **GIMP** image editor — *File → Export As → `.ico`*, including multiple resolutions.
- The online tool [icoconvert.com](https://icoconvert.com/).
- Node-based converter:

  ```powershell
  npm install -g png-to-ico
  png-to-ico icon.png > build\icon.ico
  ```

---

## 4. (Optional) Set the App Version

`electron-builder` reads `version` from [package.json](../package.json). Bump it before releasing:

```powershell
npm run version:patch    # 1.0.0 -> 1.0.1
npm run version:minor    # 1.0.0 -> 1.1.0
npm run version:major    # 1.0.0 -> 2.0.0
```

These scripts use `npm version` with `--no-git-tag-version`, so they update `package.json` only — commit and tag manually if you want a git tag for the release.

---

## 5. (Optional) Code Signing

For releases distributed outside your machine, signing the installer avoids the *"Windows protected your PC"* SmartScreen warning and the *"Unknown Publisher"* UAC prompt.

### 5.1 Skip Signing (Development / Internal Builds)

If you just want a working `.exe` for internal testing, simply do not provide any signing env vars. The produced installer will run, but end users will see SmartScreen / UAC warnings the first time they launch it.

### 5.2 Sign With a Code Signing Certificate (Production)

You will need one of:

- A **Standard Code Signing Certificate** (`.pfx` file) — installer is signed but still triggers SmartScreen until it builds reputation.
- An **EV Code Signing Certificate** (hardware token / cloud HSM) — passes SmartScreen immediately.

Set the following environment variables before running the build:

```powershell
$env:CSC_LINK = "C:\path\to\certificate.pfx"
$env:CSC_KEY_PASSWORD = "<pfx-password>"
```

For an EV certificate stored on a hardware token, configure `signtool` separately and set:

```powershell
$env:WIN_CSC_LINK = ""           # leave empty when using a hardware token
$env:SIGNTOOL_PATH = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\signtool.exe"
```

`electron-builder` automatically picks these up and signs the resulting `.exe` installer.

---

## 6. Produce the Build

Run the Windows build script:

```powershell
npm run dist:win
```

Under the hood this runs:

1. `npm run build:renderer` — `vite build`, which compiles the React app into `dist/`.
2. `npm run build:main` — `tsc -p tsconfig.electron.json`, which compiles the Electron main + preload sources into `dist-electron/`.
3. `electron-builder --win` — packages the compiled output into an NSIS `.exe` installer for Windows.

The build typically takes 1–3 minutes depending on machine speed. The first run will download the Electron binary distribution and NSIS tooling, which can take longer.

### 6.1 Targeting a Specific Architecture

By default the build targets `x64`. To build for other architectures:

```powershell
# x64 only (default)
npx electron-builder --win --x64

# arm64 only
npx electron-builder --win --arm64

# Both x64 + arm64 in one run
npx electron-builder --win --x64 --arm64
```

> Always run `npm run build` first (or use `npm run dist:win`) so the compiled renderer/main are up to date before invoking `electron-builder` directly.

### 6.2 Building From macOS / Linux (Optional)

If you must build the Windows installer from a Mac:

```bash
# macOS prerequisites
brew install --cask wine-stable
brew install mono
npm run dist:win
```

This works for unsigned builds but is not officially supported for production releases. Sign + ship from Windows whenever possible.

---

## 7. Locate the Output

After a successful build, the installer is written to the `dist/` folder at the project root:

```
dist\
├── Teams Policy Config Setup 1.0.0.exe    # The NSIS installer you distribute
├── Teams Policy Config Setup 1.0.0.exe.blockmap
├── win-unpacked\                           # Unpacked app (useful for debugging)
│   └── Teams Policy Config.exe
├── latest.yml                              # Auto-update manifest (if enabled)
└── builder-effective-config.yaml           # Resolved electron-builder config
```

The file you share with end users is the **`Teams Policy Config Setup <version>.exe`** file.

---

## 8. Install & Verify

1. Double-click the generated `.exe` installer.
2. If SmartScreen warns about an unknown publisher, click **More info → Run anyway** (only for unsigned/internal builds).
3. Choose an install location and complete the installer.
4. Launch **Teams Policy Config** from the Start Menu or desktop shortcut.
5. Smoke-test the app by walking through the setup wizard:
   - **Step 1 – Setup Environment:** The app checks for PowerShell and Azure CLI. If either is missing, install them using the buttons provided, then verify both show as installed before proceeding.
   - **Step 2 – Azure Login:** Click **Login** and follow the device-code prompt. A browser tab will open — sign in with your Azure account. Return to the app and confirm the step shows as complete.
   - **Step 3 – Grant Policy:** Select target type (user, group, or global), enter the policy name (default: `Teams-Meeting-Policy`). For user/group targeting, add at least one user or group. Click **Apply** and confirm the results summary shows the expected policy assignment.
   - **Step 4 – Complete:** Verify the wizard reaches the completion screen without errors.

> The app spawns PowerShell for its file operations. Windows ships with **Windows PowerShell 5.1**, which is sufficient. For the modern cross-platform shell, install PowerShell 7+ via:
>
> ```powershell
> winget install Microsoft.PowerShell
> ```

### 8.1 NSIS Installer Behavior

The current configuration sets:

```json
"nsis": {
  "deleteAppDataOnUninstall": false
}
```

This means uninstalling the app will **not** remove user data under `%APPDATA%\Teams Policy Config\`. Re-installing or upgrading will preserve user preferences and logs.

---

## 9. Cleaning Build Artifacts

To start a fully clean build:

```powershell
Remove-Item -Recurse -Force dist, dist-electron, node_modules
npm install
npm run dist:win
```

---

## 10. Troubleshooting

| Symptom                                                         | Cause / Fix                                                                                                            |
|-----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `Cannot find module 'dist-electron/main.js'` when running `start` | The main process did not compile — run `npm run build:main` and check for TypeScript errors.                            |
| `Error: ENOENT: no such file or directory ... build\icon.ico`   | Missing icon asset — see [Section 3](#3-verify-build-assets).                                                          |
| `node-gyp` / native module build errors                         | Install **Visual Studio 2022 Build Tools** with the C++ workload, plus Python 3.10+. Re-run `npm install`.              |
| `gyp ERR! find Python` / `Python not found`                     | Install Python 3 (`winget install Python.Python.3.12`) and ensure `python --version` works in a new terminal.           |
| SmartScreen blocks the installer with "Unknown Publisher"       | The build is unsigned. Either sign with a code-signing certificate (see Section 5) or click **More info → Run anyway**. |
| Build fails with `ENAMETOOLONG` / path too long                 | Move the checkout closer to the drive root (e.g. `C:\dev\...`), or enable long paths via `git config --system core.longpaths true` and the Windows registry policy. |
| `electron-builder` complains about a locked file in `dist\`     | Close any running instance of the app and any Explorer windows showing `dist\`, then retry.                            |
| Installer runs but app crashes immediately on launch            | Run from `dist\win-unpacked\Teams Policy Config.exe` directly to see the console output, then check `%APPDATA%\Teams Policy Config\logs\`. |
| Cross-compiling from macOS fails with Wine / Mono errors        | Build on Windows instead — Wine-based cross-compilation is unsupported for signed releases.                            |

---

## 11. Related Documents

- [Mac build guide](mac-build.md)
- [Setup commands](setup-commands.md)
- [PowerShell commands reference](powershell-commands-reference.md)
- [Usage documentation](usage-doc.md)

