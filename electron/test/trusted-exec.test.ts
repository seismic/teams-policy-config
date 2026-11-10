/**
 * Regression tests for MTGINGEST-5916 (untrusted Azure CLI resolution via cwd)
 * and MTGINGEST-5917 (binary hijacking of PowerShell / winget / choco).
 */
import fs from 'node:fs';
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

describe('environment-derived roots (review fix)', () => {
  it('ignores UNC ProgramFiles and falls back to the fixed default', () => {
    const ctx: ResolveContext = { platform: 'win32', env: { ...WIN_ENV, ProgramFiles: '\\\\evil\\s' }, exists: () => true };
    expect(isTrustedPath('\\\\evil\\s\\x.exe', ctx)).toBe(false);
    expect(isTrustedPath('C:\\Program Files\\x.exe', ctx)).toBe(true);
  });
  it('ignores env pointing at a different directory (ProgramFiles=C:\\Users\\u\\evil)', () => {
    const ctx: ResolveContext = { platform: 'win32', env: { ...WIN_ENV, ProgramFiles: 'C:\\Users\\u\\evil' }, exists: () => true };
    expect(isTrustedPath('C:\\Users\\u\\evil\\az.cmd', ctx)).toBe(false);
  });
  it('honours the same path on another drive letter', () => {
    const ctx: ResolveContext = { platform: 'win32', env: { ...WIN_ENV, ProgramFiles: 'D:\\Program Files' }, exists: () => true };
    expect(isTrustedPath('D:\\Program Files\\x.exe', ctx)).toBe(true);
  });
  it('rejects a non-standard LOCALAPPDATA', () => {
    const ctx: ResolveContext = { platform: 'win32', env: { ...WIN_ENV, LOCALAPPDATA: 'C:\\evil' }, exists: () => true };
    expect(getToolCandidates('winget', ctx)).toEqual([]);
  });
});

describe('user-writable locations only trusted as exact candidates (review fix)', () => {
  const ctx = winCtx([]);
  it('accepts exact winget alias / choco candidates but not other files in those folders', () => {
    expect(isTrustedPath('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe', ctx)).toBe(true);
    expect(isTrustedPath('C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\az.exe', ctx)).toBe(false);
    expect(isTrustedPath('C:\\ProgramData\\chocolatey\\bin\\az.cmd', ctx)).toBe(false);
  });
  it('posix: /usr/local/bin only for exact candidates', () => {
    const p: ResolveContext = { platform: 'darwin', env: {}, exists: () => true };
    expect(isTrustedPath('/usr/local/bin/az', p)).toBe(true);
    expect(isTrustedPath('/usr/local/bin/evil', p)).toBe(false);
    expect(isTrustedPath('/usr/bin/anything', p)).toBe(true);
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

describe('az resolved path is passed to PowerShell as data', () => {
  it('commands.ts no longer searches PATH for az', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'commands.ts'), 'utf8');
    expect(src).not.toMatch(/Get-Command\s+'az/);
    expect(src).toMatch(/\$env:TPC_AZ_CLI/);
  });
});

describe('runCommandWithLiveLogs (powershell.ts)', () => {
  it('refuses bare-name executables', async () => {
    const { runCommandWithLiveLogs } = await import('../util/powershell');
    await expect(runCommandWithLiveLogs('az', ['--version'], { cwd: '/' })).rejects.toMatchObject({ code: 'EINVAL' });
    await expect(runCommandWithLiveLogs('./az.cmd', [], { cwd: '/' })).rejects.toMatchObject({ code: 'EINVAL' });
  });
});

describe('source-level guard: no unchecked launches remain', () => {
  const root = path.resolve(__dirname, '..');
  const sources: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') walk(full); }
      else if (/\.ts$/.test(e.name)) sources.push(full);
    }
  };
  walk(root);
  const rel = (f: string) => path.relative(root, f).replace(/\\/g, '/');
  const read = (f: string) => fs.readFileSync(f, 'utf8');

  it('only the vetted modules import child_process', () => {
    const users = sources.filter((f) => /from\s+'(node:)?child_process'/.test(read(f))).map(rel).sort();
    expect(users).toEqual(['install-cli.ts', 'util/os-util.ts', 'util/powershell.ts']);
  });

  it('no child-process file uses process.cwd() or a non-pinned cwd', () => {
    for (const f of ['install-cli.ts', 'util/os-util.ts', 'util/powershell.ts', 'azure.ts', 'commands.ts'].map((x) => path.join(root, x))) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(/process\.cwd\(\)/);
      for (const m of src.matchAll(/\bcwd:\s*([^,}\r\n]+)/g)) {
        const v = m[1].trim();
        expect(['getSafeCwd()', 'cwd', 'string;'], `${rel(f)}: cwd: ${v}`).toContain(v);
      }
    }
  });

  it('every launch uses a resolved/absolute executable, never a bare literal', () => {
    for (const f of ['install-cli.ts', 'util/os-util.ts', 'util/powershell.ts', 'azure.ts'].map((x) => path.join(root, x))) {
      const src = read(f);
      for (const m of src.matchAll(/\b(execFileAsync|execFile|spawn|exec|execSync|spawnSync)\(\s*([^,\s)]+)/g)) {
        const arg = m[2];
        if (/^['"`]/.test(arg)) {
          expect(arg, `${rel(f)}: ${m[1]}(${arg}`).toMatch(/^['"`]\//); // absolute literal only
        }
      }
      expect(src, rel(f)).not.toMatch(/\bexecSync\(|\bspawnSync\(/);
    }
  });

  it('Homebrew install snippets call curl by absolute path', () => {
    const src = read(path.join(root, 'install-cli.ts'));
    expect(src).not.toMatch(/\$\(curl /);
    expect(src).toMatch(/\/usr\/bin\/curl/);
  });
});
