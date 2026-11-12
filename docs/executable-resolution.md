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
  trusted. The profile directory comes from the OS account database (`os.userInfo().homedir`, not `os.homedir()`, which reads the `USERPROFILE` variable) and must be `C:\Users\<one name>`. The name is allow-listed (`A-Z a-z 0-9 _ . - space`), may not start with a dot or space, may not end in a dot or space, may not contain `~`, and may not be `Public`, `Default`, `Default User` or `All Users` (compared after stripping trailing dots/spaces, since Windows treats `Public.` as `Public`).
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

## macOS / Linux behaviour changes
- The `which az` fallback ignores anything outside the exact candidate files, so `~/.local/bin`,
  pipx, nix and asdf installs of `az` are no longer detected.
- Tarball installs of PowerShell (for example `/opt/microsoft/powershell`) are not detected;
  use Homebrew or the distro package.
- Child processes now start in `/` instead of the app directory.
- Intel Homebrew (`/usr/local/bin`) is normally writable by the logged-in user but is accepted as an
  exact candidate file. This is a documented trade-off: those files are not accepted from any other
  name or folder.

## Windows notes
- Launches through `cmd.exe` (`az.cmd`) are refused if the path contains `% & ^ ! " < > |` or a CR/LF.
- A refused executable path is logged JSON-escaped (so control characters cannot forge log lines) and is not included in the error message.
- Windows on a drive other than `C:` (or without `C:\Windows\System32`) gets an explicit
  "automatic detection is not supported" message.

## Guard limitation
The repo has no ESLint config, so the "only these modules may import `child_process`" rule is a test
(`electron/test/trusted-exec.test.ts`). It cannot see string-built module names such as
`require('child' + '_process')`; add an ESLint `no-restricted-imports` / `no-restricted-modules`
rule if ESLint is adopted.
