import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    getLookupTool,
    getTrustedCwd,
    getToolCandidates,
    resolveTrustedTool,
    validateLookupResult,
} from './trusted-exec';

const execFileAsync = promisify(execFile);

const isWindows = process.platform === 'win32';

export type ProgressLogger = (message: string) => void;

export type PowerShellCommandResult = {
    executable: string;
    stdout: string;
    stderr: string;
};

/**
 * Absolute, trusted PowerShell executables in preference order. Bare names are
 * never returned (MTGINGEST-5917): only files that exist in system-controlled
 * locations are launched.
 */
export function getPowerShellExecutables(): string[] {
    const tools = isWindows ? (['powershell', 'pwsh'] as const) : (['pwsh'] as const);
    const found: string[] = [];
    for (const tool of tools) {
        const resolved = resolveTrustedTool(tool);
        if (resolved) found.push(resolved);
    }
    return found;
}

export function getAzCliExecutables(): string[] {
    return getToolCandidates('az');
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
        PATH: combinedPath,
        // Defence in depth: stop Windows child tools from searching cwd for executables.
        ...(isWindows ? { NoDefaultCurrentDirectoryInExePath: '1' } : {})
    };
}

/**
 * Pinned, trusted working directory for every child process. Never process.cwd():
 * an attacker-writable launch directory must not influence executable lookup.
 */
export function getSafeCwd(): string {
    return getTrustedCwd();
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
        // Lookup tool is absolute and runs from a pinned cwd so the launch dir is never searched.
        const { stdout } = await execFileAsync(getLookupTool(), ['az'], {
            cwd: getSafeCwd(),
            env: withCommonCliPath()
        });
        // Accept only results inside trusted install locations; anything else
        // (planted az.exe/az.cmd/az.bat in cwd or user-writable dirs) is ignored.
        for (const line of stdout.split(/\r?\n/)) {
            const valid = validateLookupResult(line.trim());
            if (valid) return valid;
        }
        return null;
    } catch {
        return null;
    }
}

export async function resolveAzCliPath(): Promise<string | null> {
    // Re-validate the cache so only trusted, still-existing paths are ever reused.
    if (cachedAzCliPath && validateLookupResult(cachedAzCliPath)) {
        return cachedAzCliPath;
    }
    cachedAzCliPath = null;

    const known = resolveTrustedTool('az');
    if (known) {
        cachedAzCliPath = known;
        return known;
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
                cwd: getSafeCwd(),
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

    if (lastError) throw lastError;
    const notFound = new Error('PowerShell executable was not found in a trusted location.') as NodeJS.ErrnoException;
    notFound.code = 'ENOENT';
    throw notFound;
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
                cwd: getSafeCwd(),
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
        // .cmd files on Windows cannot be executed by execFile directly — they require
        // cmd.exe via shell:true. When using shell:true, quote the path so that spaces
        // in "C:\Program Files\..." are not split by cmd.exe (same pattern as powershell.ts).
        const isCmdScript = isWindows && azPath.toLowerCase().endsWith('.cmd');
        const probeExe = isCmdScript ? `"${azPath}"` : azPath;
        await execFileAsync(probeExe, ['--version'], {
            cwd: getSafeCwd(),
            env: withCommonCliPath(),
            shell: isCmdScript,
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
