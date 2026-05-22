# Building for macOS

This guide walks through generating a distributable macOS build (`.dmg` installer) for the **Teams Policy Config** Electron app.

The build is produced by [`electron-builder`](https://www.electron.build/) and is configured under the `"build"` key in [package.json](../package.json).

---

## 1. Prerequisites

### 1.1 Hardware / OS

- A Mac running **macOS 11 (Big Sur) or newer**.
- You must build the macOS artifact **on a Mac** — `electron-builder` cannot cross-compile a signed macOS `.dmg` from Windows or Linux.
- Both **Apple Silicon (arm64)** and **Intel (x64)** Macs are supported. By default the build targets the architecture of the host machine.

### 1.2 Tooling

| Tool          | Required Version           | Notes                                              |
|---------------|----------------------------|----------------------------------------------------|
| Node.js       | `24.15.0` (pinned by Volta) | See `"volta"` block in [package.json](../package.json). |
| npm           | Bundled with Node 24       | `npm -v` should report `10.x` or newer.            |
| Xcode CLT     | Latest                     | Required by native module rebuilds + code signing. |
| PowerShell    | `pwsh` 7+ (optional)       | Only needed if you plan to run the built app locally. |

Install Xcode Command Line Tools if you have not already:

```bash
xcode-select --install
```

Install Volta (recommended) so the pinned Node version is picked up automatically:

```bash
curl https://get.volta.sh | bash
```

Reopen your terminal and verify:

```bash
node -v   # v24.15.0
npm -v
```

### 1.3 Repository Checkout

```bash
git clone <repo-url>
cd teams-policy-config
```

---

## 2. Install Dependencies

From the project root:

```bash
npm install
```

This installs both runtime dependencies (`react`, `@mui/material`, etc.) and dev dependencies including `electron`, `electron-builder`, `vite`, and `typescript`.

> **Note:** If `npm install` fails with native-module compile errors, ensure Xcode CLT is installed (`xcode-select -p` should print a path) and re-run the install.

---

## 3. Verify Build Assets

The `build/` folder is referenced by `electron-builder` for app icons and other resources:

```json
"mac": {
  "icon": "build/icon.icns",
  "target": "dmg"
}
```

Before producing a release build, ensure `build/icon.icns` exists. If it does not, either:

1. Place a valid 1024×1024 `icon.icns` file at `build/icon.icns`, **or**
2. Temporarily remove the `"icon"` line from the `mac` block in [package.json](../package.json) to let `electron-builder` fall back to its default Electron icon (not recommended for releases).

To create an `.icns` from a PNG:

```bash
# Requires the iconutil utility (ships with macOS)
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
cp icon.png       icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build/icon.icns
```

---

## 4. (Optional) Set the App Version

`electron-builder` reads `version` from [package.json](../package.json). Bump it before releasing:

```bash
npm run version:patch    # 1.0.0 -> 1.0.1
npm run version:minor    # 1.0.0 -> 1.1.0
npm run version:major    # 1.0.0 -> 2.0.0
```

These scripts use `npm version` with `--no-git-tag-version`, so they update `package.json` only — commit and tag manually if you want a git tag for the release.

---

## 5. (Optional) Code Signing & Notarization

For releases distributed outside your machine, macOS requires the app to be signed (and ideally notarized) so end users do not see the *"app is damaged / cannot be opened"* warning.

### 5.1 Skip Signing (Development / Internal Builds)

If you just want a working `.dmg` for internal testing, disable signing:

```bash
export CSC_IDENTITY_AUTO_DISCOVERY=false
```

This tells `electron-builder` not to look for a Developer ID certificate. The produced `.dmg` will run on the Mac you built it on, but other Macs will need to right-click → **Open** the first time.

### 5.2 Sign With a Developer ID (Production)

You will need:

- An Apple Developer account.
- A **Developer ID Application** certificate installed in your Mac's login keychain.
- An **app-specific password** for your Apple ID (for notarization).

Set the following environment variables before running the build:

```bash
export CSC_LINK="/absolute/path/to/DeveloperID.p12"        # or use a keychain identity
export CSC_KEY_PASSWORD="<p12-password>"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
```

`electron-builder` automatically picks these up and signs + notarizes the resulting `.dmg`.

---

## 6. Produce the Build

Run the macOS build script:

```bash
npm run dist:mac
```

Under the hood this runs:

1. `npm run build:renderer` — `vite build`, which compiles the React app into `dist/`.
2. `npm run build:main` — `tsc -p tsconfig.electron.json`, which compiles the Electron main + preload sources into `dist-electron/`.
3. `electron-builder --mac` — packages the compiled output into a `.dmg` installer for macOS.

The build typically takes 1–3 minutes depending on machine speed.

### 6.1 Targeting a Specific Architecture

By default the build targets your host architecture. To build explicitly for one or both architectures:

```bash
# Apple Silicon only
npx electron-builder --mac --arm64

# Intel only
npx electron-builder --mac --x64

# Universal binary (both, larger size)
npx electron-builder --mac --universal
```

> Always run `npm run build` first (or use `npm run dist:mac`) so the compiled renderer/main are up to date before invoking `electron-builder` directly.

---

## 7. Locate the Output

After a successful build, the installer is written to the `dist/` folder at the project root:

```
dist/
├── Teams Policy Config-1.0.0.dmg          # The installer you distribute
├── Teams Policy Config-1.0.0-mac.zip      # Auto-update payload (if enabled)
├── mac/                                    # Unpacked .app bundle
│   └── Teams Policy Config.app
└── builder-effective-config.yaml           # Resolved electron-builder config
```

The file you share with end users is the **`.dmg`** file.

---

## 8. Install & Verify

1. Double-click the generated `.dmg` to mount it.
2. Drag **Teams Policy Config.app** into the **Applications** folder.
3. Launch the app from Applications.
   - If the build is unsigned, the first launch will be blocked by Gatekeeper. Right-click the app → **Open** → confirm the dialog.
4. Smoke-test the app:
   - Click **Create** with a sample folder/file name.
   - Confirm the folder + file are created and the file contains `Hello Electron`.

> The app spawns `pwsh` (PowerShell Core) for its file operations. If PowerShell Core is not installed on the test machine, install it via Homebrew: `brew install --cask powershell`.

---

## 9. Cleaning Build Artifacts

To start a fully clean build:

```bash
rm -rf dist dist-electron node_modules
npm install
npm run dist:mac
```

---

## 10. Troubleshooting

| Symptom                                                         | Cause / Fix                                                                                                            |
|-----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `Cannot find module 'dist-electron/main.js'` when running `start` | The main process did not compile — run `npm run build:main` and check for TypeScript errors.                            |
| `Error: ENOENT: no such file or directory ... build/icon.icns`  | Missing icon asset — see [Section 3](#3-verify-build-assets).                                                          |
| `Command failed: codesign ...`                                  | Either disable signing (`CSC_IDENTITY_AUTO_DISCOVERY=false`) or install a valid Developer ID certificate.              |
| Notarization step hangs / fails                                 | Verify `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are correct. Notarization can take several minutes. |
| `.dmg` is built but app crashes on launch on another Mac        | Likely unsigned; have the user right-click → **Open**, or sign + notarize for production releases.                     |
| `electron-builder` complains about `dist/` containing renderer files | Both Vite and electron-builder default to `dist/`. The current config works because Vite emits *into* `dist/` and electron-builder consumes it. Do not delete `dist/` mid-build. |

---

## 11. Related Documents

- [Windows build guide](windows-build.md)
- [Setup commands](setup-commands.md)
- [PowerShell commands reference](powershell-commands-reference.md)
- [Usage documentation](usage-doc.md)
