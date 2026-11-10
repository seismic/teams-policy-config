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

function defaultContext(): ResolveContext {
    return { platform: process.platform, env: process.env, exists: (p) => fs.existsSync(p) };
}

function pathApi(platform: NodeJS.Platform) {
    return platform === 'win32' ? nodePath.win32 : nodePath.posix;
}

function winRoots(env: NodeJS.ProcessEnv) {
    return {
        systemRoot: env['SystemRoot'] || 'C:\\Windows',
        programFiles: env['ProgramFiles'] || 'C:\\Program Files',
        programFilesX86: env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
        programData: env['ProgramData'] || 'C:\\ProgramData',
        localAppData: env['LOCALAPPDATA'],
    };
}

/**
 * Directories that executables may be loaded from. Anything outside is untrusted.
 */
export function getTrustedRoots(ctx: ResolveContext = defaultContext()): string[] {
    if (ctx.platform === 'win32') {
        const r = winRoots(ctx.env);
        const roots = [
            nodePath.win32.join(r.systemRoot, 'System32'),
            r.programFiles,
            r.programFilesX86,
            nodePath.win32.join(r.programData, 'chocolatey'),
        ];
        if (r.localAppData) {
            roots.push(nodePath.win32.join(r.localAppData, 'Microsoft', 'WindowsApps'));
        }
        return roots;
    }
    return ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin', '/home/linuxbrew/.linuxbrew/bin', '/snap/bin'];
}

/** True when `candidate` is an absolute path strictly inside one of the trusted roots. */
export function isTrustedPath(candidate: string, ctx: ResolveContext = defaultContext()): boolean {
    const p = pathApi(ctx.platform);
    if (!candidate || !p.isAbsolute(candidate)) return false;
    // Reject traversal before normalising so "C:\Program Files\..\evil" cannot sneak in.
    if (candidate.split(/[\\/]/).includes('..')) return false;
    const normalized = p.normalize(candidate);
    const fold = (s: string) => (ctx.platform === 'win32' ? s.toLowerCase() : s);
    return getTrustedRoots(ctx).some((root) => {
        const rel = p.relative(fold(p.normalize(root)), fold(normalized));
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
                return [w.join(r.programFiles, 'PowerShell', '7', 'pwsh.exe')];
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
