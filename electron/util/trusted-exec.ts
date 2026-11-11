import fs from 'node:fs';
import nodePath from 'node:path';
import os from 'node:os';

/**
 * Safe executable resolution for every external tool the app launches
 * (MTGINGEST-5916 / MTGINGEST-5917, CWE-426 / CWE-427).
 *
 * Rules:
 *  - Tools are NEVER launched by bare name and NEVER searched for in the current
 *    working directory. Windows resolves bare names from the cwd first, so a
 *    planted powershell.exe / winget.exe / az.cmd in the launch dir would run.
 *  - Every launch uses an absolute path located under a trusted, system-controlled
 *    install root (System32, Program Files, ProgramData, /usr/bin, ...).
 *  - Child processes get a pinned trusted cwd, never process.cwd().
 */

export type ToolName = 'powershell' | 'pwsh' | 'winget' | 'choco' | 'az' | 'brew' | 'bash';

export type ResolveContext = {
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    exists: (p: string) => boolean;
    /** User profile directory; defaults to the OS account's profile (os.userInfo().homedir). */
    homedir?: string;
};

/**
 * existsSync can report false for Windows App Execution Aliases (winget.exe is a
 * zero-byte reparse point that stat() cannot follow), so fall back to lstat,
 * which inspects the link itself.
 */
function fileExists(p: string): boolean {
    try {
        if (fs.existsSync(p)) return true;
        fs.lstatSync(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Profile directory from the OS account database (GetUserProfileDirectory on Windows),
 * NOT os.homedir(), which reads the attacker-influenceable USERPROFILE variable.
 */
function accountHomedir(): string {
    try {
        return os.userInfo().homedir || '';
    } catch {
        return '';
    }
}

function defaultContext(): ResolveContext {
    return { platform: process.platform, env: process.env, exists: fileExists, homedir: accountHomedir() };
}

function pathApi(platform: NodeJS.Platform) {
    return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/**
 * Windows roots are FIXED. Environment variables (SystemRoot, ProgramFiles, ...) are
 * attacker-influenceable and cannot prove a drive is a local, OS-controlled one
 * (mapped network, subst and user-created drives all look the same), so they are
 * ignored. Machines with a non-C: system drive are not supported by the automatic
 * lookup; they get an explicit "unsupported" message instead (see notFoundMessage).
 *
 * The only per-user location is %LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe. It is
 * derived from the account's profile directory (os.userInfo().homedir, not USERPROFILE),
 * and only when LOCALAPPDATA equals it and the profile is C:\Users\<one safe segment>.
 */
const RESERVED_PROFILES = new Set(['public', 'default', 'default user', 'all users']);

/**
 * Profile folder name allow-list. The Win32 API ignores trailing dots/spaces and accepts
 * 8.3 short names, so "Public.", "Public " and "PUBLIC~1" all alias the world-writable
 * C:\Users\Public. Reject those, then compare reserved names after stripping.
 */
function isSafeProfileSegment(seg: string): boolean {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_. -]*$/.test(seg)) return false; // also rejects ~ : \ / and leading . or space
    if (/[. ]$/.test(seg)) return false;
    return !RESERVED_PROFILES.has(seg.replace(/[. ]+$/, '').toLowerCase());
}

function winRoots(env: NodeJS.ProcessEnv, homedir: string = accountHomedir()) {
    const w = nodePath.win32;
    const home = homedir.replace(/[\\/]+$/, '');
    const m = /^C:\\Users\\([^\\/]+)$/i.exec(home);
    let localAppData: string | undefined;
    if (m && isSafeProfileSegment(m[1])) {
        const derived = w.join(home, 'AppData', 'Local');
        const fromEnv = env['LOCALAPPDATA'];
        if (fromEnv && !/(^|[\\/])\.{1,2}([\\/]|$)/.test(fromEnv) && w.normalize(fromEnv).toLowerCase() === derived.toLowerCase()) {
            localAppData = derived;
        }
    }
    return {
        systemRoot: 'C:\\Windows',
        programFiles: 'C:\\Program Files',
        programFilesX86: 'C:\\Program Files (x86)',
        programData: 'C:\\ProgramData',
        localAppData,
    };
}

/**
 * Directories whose contents are writable only by administrators/OS, so ANY file
 * inside is acceptable. User-writable or ACL-dependent locations (WindowsApps,
 * ProgramData\\chocolatey, /usr/local/bin, /opt/homebrew/bin, ...) are NOT roots:
 * they are trusted only through the exact candidate files in getToolCandidates.
 */
export function getTrustedRoots(ctx: ResolveContext = defaultContext()): string[] {
    if (ctx.platform === 'win32') {
        const r = winRoots(ctx.env, ctx.homedir);
        return [nodePath.win32.join(r.systemRoot, 'System32'), r.programFiles, r.programFilesX86];
    }
    return ['/usr/bin', '/bin'];
}

const ALL_TOOLS: ToolName[] = ['powershell', 'pwsh', 'winget', 'choco', 'az', 'brew', 'bash'];

/**
 * True when `candidate` is an absolute path that is either inside an admin-only
 * trusted root, or exactly one of the fixed per-tool candidate files.
 */
export function isTrustedPath(candidate: string, ctx: ResolveContext = defaultContext()): boolean {
    const p = pathApi(ctx.platform);
    if (!candidate || !p.isAbsolute(candidate)) return false;
    if (/^[\\/]{2}/.test(candidate)) return false; // UNC / device paths
    // Reject traversal before normalising so "C:\Program Files\..\evil" cannot sneak in.
    if (candidate.split(/[\\/]/).includes('..')) return false;
    const fold = (x: string) => (ctx.platform === 'win32' ? x.toLowerCase() : x);
    const normalized = fold(p.normalize(candidate));
    if (ALL_TOOLS.some((t) => getToolCandidates(t, ctx).some((c) => fold(p.normalize(c)) === normalized))) {
        return true;
    }
    return getTrustedRoots(ctx).some((root) => {
        const rel = p.relative(fold(p.normalize(root)), normalized);
        return !!rel && !rel.startsWith('..') && !p.isAbsolute(rel);
    });
}

/** Fixed candidate locations per tool (all absolute, all under trusted roots). */
export function getToolCandidates(tool: ToolName, ctx: ResolveContext = defaultContext()): string[] {
    if (ctx.platform === 'win32') {
        const r = winRoots(ctx.env, ctx.homedir);
        const w = nodePath.win32;
        switch (tool) {
            case 'powershell':
                return [w.join(r.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')];
            case 'pwsh':
                return [
                    w.join(r.programFiles, 'PowerShell', '7', 'pwsh.exe'),
                    w.join(r.programFiles, 'PowerShell', '7-preview', 'pwsh.exe'),
                ];
            case 'winget':
                return r.localAppData ? [w.join(r.localAppData, 'Microsoft', 'WindowsApps', 'winget.exe')] : [];
            case 'choco':
                return [w.join(r.programData, 'chocolatey', 'bin', 'choco.exe')];
            case 'az':
                return [
                    w.join(r.programFiles, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd'),
                    w.join(r.programFilesX86, 'Microsoft SDKs', 'Azure', 'CLI2', 'wbin', 'az.cmd'),
                ];
            default:
                return [];
        }
    }
    switch (tool) {
        case 'powershell':
            return [];
        case 'pwsh':
            return ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/home/linuxbrew/.linuxbrew/bin/pwsh', '/usr/bin/pwsh', '/snap/bin/pwsh'];
        case 'az':
            return ['/opt/homebrew/bin/az', '/usr/local/bin/az', '/home/linuxbrew/.linuxbrew/bin/az', '/usr/bin/az'];
        case 'brew':
            return ['/opt/homebrew/bin/brew', '/usr/local/bin/brew', '/home/linuxbrew/.linuxbrew/bin/brew'];
        case 'bash':
            return ['/bin/bash'];
        default:
            return [];
    }
}

/**
 * Resolves a tool to a verified absolute path in a trusted location, or null.
 * Never consults cwd or PATH.
 */
export function resolveTrustedTool(tool: ToolName, ctx: ResolveContext = defaultContext()): string | null {
    for (const candidate of getToolCandidates(tool, ctx)) {
        if (isTrustedPath(candidate, ctx) && ctx.exists(candidate)) {
            return candidate;
        }
    }
    return null;
}

/** Accepts a path found by a PATH lookup only if it is trusted, exists, and is an expected file type. */
export function validateLookupResult(found: string | undefined, ctx: ResolveContext = defaultContext()): string | null {
    if (!found) return null;
    if (ctx.platform === 'win32' && !/\.(exe|cmd)$/i.test(found)) return null;
    return isTrustedPath(found, ctx) && ctx.exists(found) ? found : null;
}

/**
 * Pinned working directory for child processes. Windows: System32 (not writable
 * by standard users). Elsewhere: filesystem root. Never process.cwd().
 */
export function getTrustedCwd(ctx: ResolveContext = defaultContext()): string {
    if (ctx.platform === 'win32') {
        return nodePath.win32.join(winRoots(ctx.env, ctx.homedir).systemRoot, 'System32');
    }
    return '/';
}

/** Absolute path to where.exe / which, used for the PATH-lookup fallback. */
export function getLookupTool(ctx: ResolveContext = defaultContext()): string {
    return ctx.platform === 'win32'
        ? nodePath.win32.join(winRoots(ctx.env, ctx.homedir).systemRoot, 'System32', 'where.exe')
        : '/usr/bin/which';
}

const TOOL_LABEL: Record<ToolName, string> = {
    powershell: 'Windows PowerShell (powershell.exe)',
    pwsh: 'PowerShell 7 (pwsh)',
    winget: 'winget',
    choco: 'Chocolatey',
    az: 'Azure CLI',
    brew: 'Homebrew',
    bash: 'bash',
};

/** True when Windows is not on C: (or C:\Windows\System32 is missing): auto-detection is unsupported. */
export function isUnsupportedWindowsLayout(ctx: ResolveContext = defaultContext()): boolean {
    if (ctx.platform !== 'win32') return false;
    const drive = (ctx.env['SystemDrive'] || ctx.env['SystemRoot'] || 'C:').slice(0, 2).toUpperCase(); // message only, never trust
    return drive !== 'C:' || !ctx.exists('C:\\Windows\\System32');
}

/**
 * Actionable, platform-appropriate message for when a tool is not available in a trusted
 * location. Per-user installs are deliberately not accepted because those folders are
 * writable by the launching user. Never includes caller-supplied paths.
 */
export function notFoundMessage(tool: ToolName, ctx: ResolveContext = defaultContext()): string {
    const label = TOOL_LABEL[tool];
    if (ctx.platform === 'win32') {
        if (isUnsupportedWindowsLayout(ctx)) {
            return `${label} could not be located: automatic detection is not supported when Windows is not installed on C: (expected C:\\Windows\\System32). Run the app on a standard Windows layout or contact your administrator.`;
        }
        return `${label} was not found in a trusted system location. Install it for all users (for example under C:\\Program Files) and restart the app.`;
    }
    return `${label} was not found in a trusted system location. Install it with Homebrew or your system package manager (into /usr/bin, /usr/local/bin or /opt/homebrew/bin) and restart the app.`;
}

/**
 * cmd.exe metacharacters that must not appear in a path launched through a shell.
 */
export function isCmdSafePath(p: string): boolean {
    return !/[%&^!"<>|\r\n]/.test(p);
}

/**
 * Absolute path to cmd.exe for shell:true launches (needed to run az.cmd). Passing it
 * explicitly stops Node from consulting the attacker-influenceable ComSpec variable.
 * Returns false (no shell) on non-Windows.
 */
export function getTrustedShell(ctx: ResolveContext = defaultContext()): string | false {
    return ctx.platform === 'win32' ? nodePath.win32.join(winRoots(ctx.env, ctx.homedir).systemRoot, 'System32', 'cmd.exe') : false;
}
