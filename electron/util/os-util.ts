import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';

export type ProgressLogger = (message: string) => void;

export type PowerShellCommandResult = {
    executable: string;
    stdout: string;
    stderr: string;
};

export function getPowerShellExecutables(): string[] {
    return isWindows
        ? ['powershell.exe', 'pwsh.exe', 'pwsh']
        : ['pwsh', 'powershell'];
}

export function getAzCliExecutables(): string[] {
    return isWindows
        ? ['az.cmd', 'az.exe', 'az']
        : ['az', '/opt/homebrew/bin/az', '/usr/local/bin/az'];
}

/**
 * Extends PATH with common CLI install locations so Electron-launched processes
 * can find tools installed via Homebrew or system paths.
 * This is necessary because Electron apps may not inherit the full user shell
 * environment, especially on macOS where GUI apps launched from Finder don't get the same PATH as terminal sessions.
 * By including typical locations for Homebrew and system binaries, we increase the chances that subprocesses can find PowerShell, Azure CLI, and other tools without requiring users to modify their system PATH or launch the app from a terminal.
 * @param env Optional base environment to extend. Defaults to process.env.
 * @returns A new environment object with an extended PATH variable.
 */
export function withCommonCliPath(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
    const existingPath = env.PATH ?? '';
    const extraPaths = isWindows
        ? ['C:\\Windows\\System32', 'C:\\Program Files\\PowerShell\\7', 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin', 'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin']
        : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
    const combinedPath = [existingPath, ...extraPaths.filter((p) => !existingPath.includes(p))]
        .filter(Boolean)
        .join(path.delimiter);

    return {
        ...env,
        PATH: combinedPath
    };
}

/**
 * Returns a controlled, non-attacker-writable working directory for child
 * processes (the app directory) instead of process.cwd().
 *
 * For a packaged Electron app, process.cwd() can be an arbitrary directory the
 * OS happened to launch the app from. On Windows, spawning through a shell with
 * an unqualified command name resolves it from the cwd first, so a cwd an
 * attacker can write to enables a binary hijack (scan finding 1352217). Pinning
 * the cwd to the read-only app directory removes that vector.
 *
 * In packaged builds, app.getAppPath() returns a path ending in `.asar`
 * (e.g. /Applications/MyApp.app/Contents/Resources/app.asar). Electron's
 * virtual FS treats it as a directory, but Node's spawn hits the real OS
 * filesystem and gets ENOTDIR. Use the parent (Resources/) directory instead.
 */
export function getSafeCwd(): string {
    try {
        const appPath = app.getAppPath();
        return appPath.endsWith('.asar') ? path.dirname(appPath) : appPath;
    } catch {
        return process.cwd();
    }
}

function azCandidatePaths(): string[] {
    if (isWindows) {
        const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
        const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
        return [
            path.join(programFiles, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd'),
            path.join(programFilesX86, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd'),
        ];
    }

    return ['/opt/homebrew/bin/az', '/usr/local/bin/az', '/usr/bin/az'];
}

/**
 * Resolves the Azure CLI to a verified, absolute path before it is ever spawned.
 *
 * This is the core mitigation for the untrusted-search-path finding (1352217):
 * callers must invoke az by absolute path, never by a bare name, so that neither
 * the shell nor cmd.exe performs a PATH/cwd search that could be hijacked.
 *
 * Resolution order: well-known install locations first, then a PATH lookup via
 * an absolute `where.exe`/`which` (themselves invoked safely, no shell). Only a
 * successful resolution is cached, so the in-app "Install Azure CLI" flow can
 * still be picked up later in the same session.
 */
let cachedAzCliPath: string | null = null;

async function resolveAzCliViaSystemLookup(): Promise<string | null> {
    try {
        if (isWindows) {
            const systemRoot = process.env['SystemRoot'] || 'C:\\Windows';
            const whereExe = path.join(systemRoot, 'System32', 'where.exe');
            const { stdout } = await execFileAsync(whereExe, ['az'], { env: withCommonCliPath() });
            const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
            return first && path.isAbsolute(first) && fs.existsSync(first) ? first : null;
        }

        const { stdout } = await execFileAsync('/usr/bin/which', ['az'], { env: withCommonCliPath() });
        const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
        return first && path.isAbsolute(first) && fs.existsSync(first) ? first : null;
    } catch {
        return null;
    }
}

export async function resolveAzCliPath(): Promise<string | null> {
    if (cachedAzCliPath && fs.existsSync(cachedAzCliPath)) {
        return cachedAzCliPath;
    }

    for (const candidate of azCandidatePaths()) {
        if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
            cachedAzCliPath = candidate;
            return candidate;
        }
    }

    const resolved = await resolveAzCliViaSystemLookup();
    if (resolved) {
        cachedAzCliPath = resolved;
    }
    return resolved;
}

/**
 * Executes a PowerShell script using the first available shell executable.
 * Logs progress and errors through the provided logger callback.
 * @param script The PowerShell script to execute as a string.
 * @param log Optional callback to receive progress messages for UI updates.
 * @param completeMessage Optional message to log upon successful completion of the script.
 * @returns Command output details including executable, stdout, and stderr.
 * @throws An error if no PowerShell executable is found or if execution fails for reasons other than missing executable.
 */
export async function runPowerShell(script: string, log?: ProgressLogger, completeMessage?: string): Promise<PowerShellCommandResult> {
    const executables = getPowerShellExecutables();

    let lastError: unknown;
    for (const executable of executables) {
        try {
            // log?.(`Running PowerShell via ${executable}...`);
            const { stdout, stderr } = await execFileAsync(executable, ['-NoProfile', '-Command', script], {
                cwd: process.cwd(),
                env: withCommonCliPath()
            });

            if (completeMessage) {
                log?.(completeMessage);
            }

            return {
                executable,
                stdout,
                stderr
            };
        } catch (error: any) {
            const errorObject = error as NodeJS.ErrnoException;
            if (errorObject.code === 'ENOENT') {
                log?.(`PowerShell executable not found: ${executable}`);
                lastError = error;
                continue;
            }
            log?.(`PowerShell failed: ${errorObject.message}`);
            throw error;
        }
    }

    throw lastError ?? new Error('PowerShell executable was not found.');
}

/**
 * Installs required modules before setup proceeds to Azure login.
 * Any failure should bubble up so the caller can stop execution.
 * @param log Optional callback to receive progress messages for UI updates.
 * @throws An error if module installation fails, which should be handled by the caller to stop the login flow and inform the user.
 */
export async function installRequiredPowerShellModules(log?: ProgressLogger): Promise<void> {
    log?.('Installing required PowerShell modules (Az, MicrosoftTeams)...');

    // const script = [
    //     "$ErrorActionPreference = 'Stop'",
    //     "$ProgressPreference = 'SilentlyContinue'",        
    //     "$requiredModules = @('Az', 'MicrosoftTeams')",
    //     "$missingModules = @()",
    //     "foreach ($module in $requiredModules) { if (-not (Get-Module -ListAvailable -Name $module)) { $missingModules += $module } }",
    //     "if ($missingModules.Count -eq 0) { Write-Output 'All required PowerShell modules are already installed.' } else { foreach ($module in $missingModules) { Write-Output \"Installing PowerShell module: $module\"; Install-Module -Name $module -Repository PSGallery -Scope CurrentUser -Force -AllowClobber } }"
    // ].join('; ');

    const script = `
        $ErrorActionPreference = 'Stop'
        $ProgressPreference = 'SilentlyContinue'
        Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser -ErrorAction SilentlyContinue
        $requiredModules = @('Az.Accounts', 'Az.Resources','MicrosoftTeams')
        $missingModules = @()
        foreach ($module in $requiredModules) {
            if (-not (Get-Module -ListAvailable -Name $module)) {
                $missingModules += $module
            }
        }
        if ($missingModules.Count -eq 0) {
            Write-Output 'All required PowerShell modules are already installed.'
        } else {
            foreach ($module in $missingModules) {
                Write-Output "Installing PowerShell module: $module"
                Install-Module -Name $module -Repository PSGallery -Scope CurrentUser -Force -AllowClobber
            }
        }
    `;

    await runPowerShell(script, log, 'Required PowerShell modules are ready.');
}

/**
 * Checks whether any PowerShell executable is reachable from this process.
 */
export async function isPowerShellInstalled(log?: ProgressLogger): Promise<boolean> {
    const executables = getPowerShellExecutables();

    for (const executable of executables) {
        try {
            await execFileAsync(executable, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
                cwd: process.cwd(),
                env: withCommonCliPath()
            });
            log?.(`Detected PowerShell executable: ${executable}`);
            return true;
        } catch (error: any) {
            const errorObject = error as NodeJS.ErrnoException;
            if (errorObject.code === 'ENOENT' || errorObject.code === 'EINVAL') {
                continue;
            }

            // The executable exists but could not run this probe command.
            log?.(`PowerShell probe failed for ${executable}: ${errorObject.message}`);
            return true;
        }
    }

    return false;
}

/**
 * Checks whether Azure CLI is reachable from this process.
 */
export async function isAzCliInstalled(log?: ProgressLogger): Promise<boolean> {
    // Resolve to a verified absolute path (well-known locations + safe PATH lookup)
    // rather than probing bare executable names through a shell, which would be
    // vulnerable to a working-directory binary hijack (scan finding 1352217).
    const azPath = await resolveAzCliPath();
    if (!azPath) {
        log?.('Azure CLI was not found in the expected locations or on PATH.');
        return false;
    }

    try {
        await execFileAsync(azPath, ['--version'], {
            cwd: getSafeCwd(),
            env: withCommonCliPath()
        });
        log?.(`Detected Azure CLI executable: ${azPath}`);
        return true;
    } catch (error: any) {
        // The path resolved but the binary is not runnable (broken install, missing
        // shared libraries, lost execute permission, etc.).  Do not cache this
        // outcome so a subsequent install in the same session can be picked up.
        cachedAzCliPath = null;
        log?.(`Azure CLI probe failed for ${azPath}: ${(error as NodeJS.ErrnoException).message}`);
        return false;
    }
}
