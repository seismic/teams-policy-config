/**
 * Regression tests for MTGINGEST-5916 (untrusted Azure CLI resolution via cwd)
 * and MTGINGEST-5917 (binary hijacking of PowerShell / winget / choco).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', async (orig) => {
  const actual = await orig<typeof import('node:child_process')>();
  const fn: any = (...a: unknown[]) => execFileMock(...a);
  fn[Symbol.for('nodejs.util.promisify.custom')] = (...a: unknown[]) => execFileMock(...a);
  return { ...actual, execFile: fn };
});

import {
  getToolCandidates,
  getTrustedShell,
  getLookupTool,
  getTrustedCwd,
  isTrustedPath,
  notFoundMessage,
  resolveTrustedTool,
  validateLookupResult,
  type ResolveContext,
} from '../util/trusted-exec';

const WIN_ENV = {
  SystemRoot: 'C:\\Windows',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ProgramData: 'C:\\ProgramData',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
} as NodeJS.ProcessEnv;

const winCtx = (existing: string[]): ResolveContext => ({
  platform: 'win32',
  env: WIN_ENV,
  exists: (p) => existing.includes(p),
  homedir: 'C:\\Users\\u',
});

const LAUNCH_DIR = 'C:\\Users\\u\\Downloads\\evil';

describe('isTrustedPath (Windows)', () => {
  const ctx = winCtx([]);
  it.each(['az.exe', 'az.cmd', 'az.bat', 'powershell.exe', 'winget.exe', 'choco.exe'])(
    'rejects bare name %s',
    (n) => expect(isTrustedPath(n, ctx)).toBe(false),
  );
  it.each(['az.exe', 'az.cmd', 'az.bat', 'powershell.exe', 'pwsh.exe', 'winget.exe', 'choco.exe'])(
    'rejects %s planted in the launch directory',
    (n) => expect(isTrustedPath(`${LAUNCH_DIR}\\${n}`, ctx)).toBe(false),
  );
  it('rejects traversal and sibling-prefix tricks', () => {
    expect(isTrustedPath('C:\\Program Files\\..\\evil\\az.cmd', ctx)).toBe(false);
    expect(isTrustedPath('C:\\Program Files Evil\\az.cmd', ctx)).toBe(false);
  });
  it('accepts Program Files / System32 paths case-insensitively', () => {
    expect(isTrustedPath('c:\\program files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd', ctx)).toBe(true);
    expect(isTrustedPath('C:\\Windows\\System32\\where.exe', ctx)).toBe(true);
  });
});

describe('resolveTrustedTool (Windows)', () => {
  it('returns absolute system paths for genuine binaries', () => {
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const winget = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe';
    const choco = 'C:\\ProgramData\\chocolatey\\bin\\choco.exe';
    const ctx = winCtx([ps, winget, choco]);
    expect(resolveTrustedTool('powershell', ctx)).toBe(ps);
    expect(resolveTrustedTool('winget', ctx)).toBe(winget);
    expect(resolveTrustedTool('choco', ctx)).toBe(choco);
  });
  it('ignores binaries planted in cwd (they are never candidates)', () => {
    const ctx = winCtx(['powershell.exe', 'winget.exe', 'choco.exe', 'az.cmd'].map((n) => `${LAUNCH_DIR}\\${n}`));
    for (const t of ['powershell', 'pwsh', 'winget', 'choco', 'az'] as const) {
      expect(resolveTrustedTool(t, ctx)).toBeNull();
    }
  });
});

describe('validateLookupResult (where.exe output)', () => {
  const ctx = winCtx([`${LAUNCH_DIR}\\az.exe`, `${LAUNCH_DIR}\\az.bat`, 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd']);
  it('rejects planted az.exe / az.cmd / az.bat in the launch dir', () => {
    for (const n of ['az.exe', 'az.cmd', 'az.bat']) {
      expect(validateLookupResult(`${LAUNCH_DIR}\\${n}`, ctx)).toBeNull();
    }
  });
  it('rejects az.bat even in a trusted location, and non-existent files', () => {
    expect(validateLookupResult('C:\\Program Files\\x\\az.bat', winCtx(['C:\\Program Files\\x\\az.bat']))).toBeNull();
    expect(validateLookupResult('C:\\Program Files\\x\\az.cmd', winCtx([]))).toBeNull();
  });
  it('accepts the genuine install', () => {
    const p = 'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd';
    expect(validateLookupResult(p, ctx)).toBe(p);
  });
});

describe('getTrustedCwd', () => {
  it('is System32 on Windows and never process.cwd()', () => {
    expect(getTrustedCwd(winCtx([]))).toBe('C:\\Windows\\System32');
  });
  it('is the filesystem root elsewhere', () => {
    expect(getTrustedCwd({ platform: 'darwin', env: {}, exists: () => false })).toBe('/');
  });
});

// ---- Integration through os-util with where.exe returning attacker-controlled output ----
describe('resolveAzCliPath / isAzCliInstalled with planted binary', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
  });

  const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  afterEach(() => {
    Object.defineProperty(process, 'platform', origPlatform);
    vi.restoreAllMocks();
  });

  async function loadAsWindows() {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    Object.assign(process.env, { SystemRoot: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' });
    return import('../util/os-util');
  }

  it('does not accept or execute a planted az in cwd; reports missing', async () => {
    const planted = `${LAUNCH_DIR}\\az.exe`;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === planted);
    vi.spyOn(fs, 'lstatSync').mockImplementation(((p: any) => { if (String(p) === planted) return {} as any; throw new Error('ENOENT'); }) as any);
    execFileMock.mockImplementation(async (file: string) => {
      if (/where\.exe$/i.test(file)) return { stdout: `${planted}\r\n`, stderr: '' };
      throw new Error(`unexpected exec of ${file}`);
    });
    const os = await loadAsWindows();
    expect(await os.resolveAzCliPath()).toBeNull();
    expect(await os.isAzCliInstalled()).toBe(false);
    // Only where.exe (absolute, pinned cwd) was ever launched; the planted az never was.
    for (const call of execFileMock.mock.calls) {
      expect(call[0]).not.toBe(planted);
      expect(path.win32.isAbsolute(call[0])).toBe(true);
      expect(call[2].cwd).toBe('C:\\Windows\\System32');
    }
  });

  it('never uses process.cwd() as child cwd', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'lstatSync').mockImplementation((() => { throw new Error('ENOENT'); }) as any);
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    const os = await loadAsWindows();
    await os.isPowerShellInstalled();
    await os.isAzCliInstalled();
    for (const call of execFileMock.mock.calls) {
      expect(call[2].cwd).not.toBe(process.cwd());
    }
  });
});

const HOME = 'C:\\Users\\u';
const mk = (env: NodeJS.ProcessEnv, homedir = HOME): ResolveContext => ({ platform: 'win32', env, exists: () => true, homedir });

describe('environment-derived roots are ignored (re-review N1/N2)', () => {
  it('ignores UNC ProgramFiles', () => {
    const ctx = mk({ ...WIN_ENV, ProgramFiles: '\\\\evil\\s' });
    expect(isTrustedPath('\\\\evil\\s\\x.exe', ctx)).toBe(false);
    expect(isTrustedPath('C:\\Program Files\\x.exe', ctx)).toBe(true);
  });
  it.each(['Z:\\Program Files', 'D:\\Program Files', 'C:\\Users\\u\\evil'])('ignores ProgramFiles=%s', (pf) => {
    const ctx = mk({ ...WIN_ENV, ProgramFiles: pf });
    expect(isTrustedPath(`${pf}\\az.cmd`, ctx)).toBe(false);
  });
  it('SystemRoot=Z:\\Windows does not move the pinned cwd or where.exe', () => {
    const ctx = mk({ ...WIN_ENV, SystemRoot: 'Z:\\Windows' });
    expect(getTrustedCwd(ctx)).toBe('C:\\Windows\\System32');
    expect(getLookupTool(ctx)).toBe('C:\\Windows\\System32\\where.exe');
    expect(getTrustedShell(ctx)).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(isTrustedPath('Z:\\Windows\\System32\\where.exe', ctx)).toBe(false);
  });
  it.each([
    'C:\\Users\\..\\AppData\\Local',
    'C:\\Users\\.\\AppData\\Local',
    'C:\\Users\\Public\\AppData\\Local',
    'D:\\Users\\u\\AppData\\Local',
    'C:\\evil',
    '\\\\evil\\s\\AppData\\Local',
  ])('rejects LOCALAPPDATA=%s', (lad) => {
    expect(getToolCandidates('winget', mk({ ...WIN_ENV, LOCALAPPDATA: lad }))).toEqual([]);
    expect(isTrustedPath(`${lad}\\Microsoft\\WindowsApps\\winget.exe`, mk({ ...WIN_ENV, LOCALAPPDATA: lad }))).toBe(false);
  });
  it('rejects a LOCALAPPDATA that differs from the profile directory', () => {
    expect(getToolCandidates('winget', mk({ ...WIN_ENV, LOCALAPPDATA: 'C:\\Users\\other\\AppData\\Local' }))).toEqual([]);
  });
  it('rejects a reserved or non-C: profile directory', () => {
    expect(getToolCandidates('winget', mk(WIN_ENV, 'C:\\Users\\Public'))).toEqual([]);
    expect(getToolCandidates('winget', mk({ ...WIN_ENV, LOCALAPPDATA: 'Z:\\Users\\u\\AppData\\Local' }, 'Z:\\Users\\u'))).toEqual([]);
  });
  it('accepts the genuine profile-derived winget alias', () => {
    expect(getToolCandidates('winget', mk(WIN_ENV))).toEqual(['C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe']);
  });
});

describe('user-writable locations only trusted as exact candidates', () => {
  const ctx = winCtx([]);
  it('accepts exact winget alias / choco candidates but not other files in those folders', () => {
    expect(isTrustedPath('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe', ctx)).toBe(true);
    expect(isTrustedPath('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\az.exe', ctx)).toBe(false);
    expect(isTrustedPath('C:\\ProgramData\\chocolatey\\bin\\az.cmd', ctx)).toBe(false);
  });
  it('posix: /usr/local/bin only for exact candidates; linuxbrew az/pwsh accepted', () => {
    const p: ResolveContext = { platform: 'linux', env: {}, exists: () => true };
    expect(isTrustedPath('/usr/local/bin/az', p)).toBe(true);
    expect(isTrustedPath('/usr/local/bin/evil', p)).toBe(false);
    expect(isTrustedPath('/usr/bin/anything', p)).toBe(true);
    expect(isTrustedPath('/home/linuxbrew/.linuxbrew/bin/az', p)).toBe(true);
    expect(isTrustedPath('/home/linuxbrew/.linuxbrew/bin/pwsh', p)).toBe(true);
  });
  it('finds PowerShell 7-preview and reports actionable not-found text', () => {
    const prev = 'C:\\Program Files\\PowerShell\\7-preview\\pwsh.exe';
    expect(resolveTrustedTool('pwsh', winCtx([prev]))).toBe(prev);
    expect(notFoundMessage('az')).toMatch(/Install it for all users/);
  });
});

describe('winget App Execution Alias detection', () => {
  it('resolves via lstat when existsSync reports false', async () => {
    vi.resetModules();
    const alias = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe';
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'lstatSync').mockImplementation(((p: any) => { if (String(p) === alias) return {} as any; throw new Error('ENOENT'); }) as any);
    vi.spyOn(os, 'homedir').mockReturnValue(HOME);
    const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const saved = { ...process.env };
    Object.assign(process.env, WIN_ENV);
    try {
      const mod = await import('../util/trusted-exec');
      expect(mod.resolveTrustedTool('winget')).toBe(alias);
    } finally {
      Object.defineProperty(process, 'platform', origPlatform);
      process.env = saved;
      vi.restoreAllMocks();
    }
  });
});

describe('runPowerShell environment (re-review N3)', () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    execFileMock.mockImplementation(async (file: string) => ({ stdout: file === '/usr/bin/which' ? '' : 'ok', stderr: '' }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TPC_AZ_CLI;
  });

  const psCall = () => execFileMock.mock.calls.find((c) => c[0] === '/usr/bin/pwsh')!;

  it('sets TPC_AZ_CLI to the validated path and the caller cannot override it', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => ['/usr/bin/pwsh', '/usr/bin/az'].includes(String(p)));
    process.env.TPC_AZ_CLI = '/tmp/evil-inherited';
    const os2 = await import('../util/os-util');
    await os2.runPowerShell('x', undefined, undefined, { env: { TPC_AZ_CLI: '/tmp/evil-caller', OTHER: 'data' } });
    const env = psCall()[2].env;
    expect(env.TPC_AZ_CLI).toBe('/usr/bin/az');
    expect(env.OTHER).toBe('data');
    expect(psCall()[2].cwd).toBe('/');
  });

  it('sets TPC_AZ_CLI to empty (never inherited/caller value) when az is not resolved', async () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p) === '/usr/bin/pwsh');
    vi.spyOn(fs, 'lstatSync').mockImplementation((() => { throw new Error('ENOENT'); }) as any);
    process.env.TPC_AZ_CLI = '/tmp/evil-inherited';
    const os2 = await import('../util/os-util');
    await os2.runPowerShell('x', undefined, undefined, { env: { TPC_AZ_CLI: '/tmp/evil-caller' } });
    expect(psCall()[2].env.TPC_AZ_CLI).toBe('');
  });
});

describe('az lookup in scripts (behavioural)', () => {
  it('generated scripts read $env:TPC_AZ_CLI and never search PATH for az', async () => {
    vi.resetModules();
    const runPowerShell = vi.fn(async () => ({ executable: 'x', stdout: '[]', stderr: '' }));
    vi.doMock('../env', () => ({}));
    vi.doMock('../util/os-util', async (orig) => ({ ...(await orig<any>()), runPowerShell }));
    const commands = await import('../commands');
    await commands.searchUsers(() => {}, 'alice').catch(() => undefined);
    vi.doUnmock('../util/os-util');
    vi.doUnmock('../env');
    expect(runPowerShell).toHaveBeenCalled();
    const script = String((runPowerShell.mock.calls[0] as unknown[])[0]);
    expect(script).toContain('$env:TPC_AZ_CLI');
    expect(script).not.toMatch(/Get-Command/);
    expect(script).toMatch(/throw/);
  });
});

describe('runCommandWithLiveLogs (powershell.ts)', () => {
  it.each(['az', './az.cmd', 'C:\\evil\\az.cmd', '\\\\evil\\s\\az.cmd', '/tmp/az', '/usr/local/bin/evil'])('refuses %s', async (exe) => {
    const { runCommandWithLiveLogs } = await import('../util/powershell');
    await expect(runCommandWithLiveLogs(exe, ['--version'], { cwd: '/' })).rejects.toMatchObject({ code: 'EINVAL' });
  });
  it('Windows: UNC .cmd is refused (isAbsolute would accept it)', () => {
    expect(path.win32.isAbsolute('\\\\evil\\s\\az.cmd')).toBe(true);
    expect(isTrustedPath('\\\\evil\\s\\az.cmd', winCtx([]))).toBe(false);
  });
  it('Windows shell is the fixed System32 cmd.exe regardless of ComSpec', () => {
    expect(getTrustedShell(mk({ ...WIN_ENV, ComSpec: 'C:\\evil\\cmd.exe' }))).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(getTrustedShell({ platform: 'linux', env: {}, exists: () => true })).toBe(false);
  });
});

describe('source-level guard: no unchecked launches remain', () => {
  const root = path.resolve(__dirname, '..');
  const sources: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') walk(full); }
      else if (/\.(ts|tsx|js|cjs|mjs)$/.test(e.name)) sources.push(full);
    }
  };
  walk(root);
  const rel = (f: string) => path.relative(root, f).replace(/\\/g, '/');
  const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = (f: string) => stripComments(fs.readFileSync(f, 'utf8'));
  const launchers = ['install-cli.ts', 'util/os-util.ts', 'util/powershell.ts'];

  it('only the vetted modules reference child_process (any import form)', () => {
    const users = sources.filter((f) => /child_process/.test(read(f))).map(rel).sort();
    expect(users).toEqual(launchers.slice().sort());
  });

  it('no electron source uses process.cwd() as a working directory for launches', () => {
    for (const f of sources) {
      const src = read(f);
      if (!/child_process|runCommandWithLiveLogs|runPowerShell/.test(src)) continue;
      expect(src, rel(f)).not.toMatch(/process\.cwd\(\)/);
    }
  });

  it('every cwd (property, shorthand, variable) is pinned', () => {
    for (const f of sources) {
      const src = read(f);
      if (!/child_process|runCommandWithLiveLogs|runPowerShell/.test(src)) continue;
      for (const m of src.matchAll(/\bcwd:\s*([^,}\r\n;]+)/g)) {
        const v = m[1].trim();
        expect(['getSafeCwd()', 'getTrustedCwd()', 'cwd', 'string'], `${rel(f)}: cwd: ${v}`).toContain(v);
      }
      if (/[{,]\s*cwd\s*[,}]/.test(src) || /\bconst\s+cwd\b/.test(src)) {
        expect(src, `${rel(f)} shorthand cwd must be the pinned dir`).toMatch(/\bconst\s+cwd\s*=\s*getSafeCwd\(\)/);
      }
    }
  });

  it('shell is never true; only false or the fixed trusted cmd.exe', () => {
    for (const f of sources) {
      const src = read(f);
      if (!/child_process/.test(src)) continue;
      for (const m of src.matchAll(/\bshell:\s*([^\r\n]+)/g)) {
        const v = m[1].trim().replace(/,$/, '');
        expect(v, `${rel(f)}: shell: ${v}`).toMatch(/^(false|(isCmdScript|useWindowsShell) \? getTrustedShell\(\) : false)$/);
      }
    }
  });

  it('every launch first argument is an absolute literal or a resolver-produced identifier', () => {
    const allowedIdentifiers = new Set(['executable', 'probeExe', 'spawnExecutable', 'getLookupTool(']);
    for (const f of launchers.map((x) => path.join(root, x))) {
      const src = read(f);
      for (const m of src.matchAll(/\b(execFileAsync|execFile|spawn|exec|execSync|spawnSync)\(\s*([^,)]+)/g)) {
        const arg = m[2].trim();
        if (m[1] === 'execFile' && arg === 'execFile') continue;
        if (/^['"`]/.test(arg)) expect(arg, `${rel(f)}: ${m[1]}(${arg}`).toMatch(/^['"`]\//);
        else expect(allowedIdentifiers.has(arg), `${rel(f)}: ${m[1]}(${arg}) is not a resolver-produced value`).toBe(true);
      }
      expect(src, rel(f)).not.toMatch(/\bexecSync\(|\bspawnSync\(|\bexec\(/);
    }
  });

  it('Homebrew install snippets call curl by absolute path', () => {
    const src = read(path.join(root, 'install-cli.ts'));
    expect(src).not.toMatch(/\$\(curl /);
    expect(src).toMatch(/\/usr\/bin\/curl/);
  });
});
