import fs from 'node:fs';
import nodePath from 'node:path';

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

function defaultContext(): ResolveContext {
    return { platform: process.platform, env: process.env, exists: fileExists };
}

function pathApi(platform: NodeJS.Platform) {
    return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

/**
 * Environment variables are attacker-influenceable (e.g. ProgramFiles=\\evil\\share),
 * so they are only honoured when they name the SAME well-known path on a local
 * drive letter (handles a non-C: system drive). UNC and any other value fall back
 * to the fixed default.
 */
function sameOnLocalDrive(value: string | undefined, fallback: string): string {
    if (value && /^[A-Za-z]:\\/.test(value) && value.slice(2).replace(/\\+$/, '').toLowerCase() === fallback.slice(2).toLowerCase()) {
        return value.replace(/\\+$/, '');
    }
    return fallback;
}

function winRoots(env: NodeJS.ProcessEnv) {
    return {
        systemRoot: sameOnLocalDrive(env['SystemRoot'], 'C:\\Windows'),
        programFiles: sameOnLocalDrive(env['ProgramFiles'], 'C:\\Program Files'),
        programFilesX86: sameOnLocalDrive(env['ProgramFiles(x86)'], 'C:\\Program Files (x86)'),
        programData: sameOnLocalDrive(env['ProgramData'], 'C:\\ProgramData'),
        // Per-user path: only the standard shape C:\Users\<name>\AppData\Local is accepted.
        localAppData: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local$/.test(env['LOCALAPPDATA'] ?? '') ? env['LOCALAPPDATA'] : undefined,
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
        const r = winRoots(ctx.env);
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
        const r = winRoots(ctx.env);
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
            return ['/usr/local/bin/pwsh', '/opt/homebrew/bin/pwsh', '/usr/bin/pwsh', '/snap/bin/pwsh'];
        case 'az':
            return ['/opt/homebrew/bin/az', '/usr/local/bin/az', '/usr/bin/az'];
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
        return nodePath.win32.join(winRoots(ctx.env).systemRoot, 'System32');
    }
    return '/';
}

/** Absolute path to where.exe / which, used for the PATH-lookup fallback. */
export function getLookupTool(ctx: ResolveContext = defaultContext()): string {
    return ctx.platform === 'win32'
        ? nodePath.win32.join(winRoots(ctx.env).systemRoot, 'System32', 'where.exe')
        : '/usr/bin/which';
}

/**
 * Actionable message for when a tool is not available in a trusted location.
 * Per-user installs (e.g. under %LOCALAPPDATA% or ~/.local/bin) are deliberately
 * not accepted because those folders are writable by the launching user.
 */
export function notFoundMessage(tool: ToolName): string {
    return `${tool} was not found in a trusted system location. Install it for all users (for example under C:\\Program Files on Windows, or via Homebrew / the system package manager elsewhere) and restart the app.`;
}
