# External tool resolution (security)

All external tools (PowerShell, pwsh, winget, choco, Azure CLI, brew, bash) are launched
through `electron/util/trusted-exec.ts`. See MTGINGEST-5916 / MTGINGEST-5917.

## Rules
- Never launched by bare name; never searched for in the current directory or PATH.
- Only absolute paths in admin-only roots are accepted (Windows: `C:\Windows\System32`,
  `C:\Program Files`, `C:\Program Files (x86)`; elsewhere `/usr/bin`, `/bin`), plus a short list
  of exact files in locations that are not admin-only (winget alias under
  `%LOCALAPPDATA%\Microsoft\WindowsApps`, `C:\ProgramData\chocolatey\bin\choco.exe` (only as safe
  as that folder's ACL), `/usr/local/bin`, `/opt/homebrew/bin`, Linuxbrew).
- Roots are fixed. Environment variables such as `ProgramFiles`, `SystemRoot` and `ComSpec` are not
  trusted. The profile directory comes from `os.homedir()` and must be `C:\Users\<name>`.
- Child processes run with a pinned cwd (`System32` / `/`), and `cmd.exe` is `C:\Windows\System32\cmd.exe`.
- PowerShell scripts receive the validated Azure CLI path as `$env:TPC_AZ_CLI` (empty when
  unresolved). Scripts never search PATH for `az`.

## Installs that are intentionally not detected
Per-user and non-standard installs are not accepted, because those folders are writable by the
launching user (or unreadable to the app), so a planted binary could not be told apart:
- Azure CLI under `%LOCALAPPDATA%`, `~/.local/bin`, pipx / virtualenv installs.
- Microsoft Store / MSIX PowerShell (`WindowsApps\Microsoft.PowerShell_*`).
- Windows machines whose system drive is not `C:`.

Fix: install the tool for all users (for example the MSI installers under `C:\Program Files`) and
restart the app. The app's not-found message says the same.
