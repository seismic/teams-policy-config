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
  getTrustedCwd,
  isTrustedPath,
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
    execFileMock.mockResolvedValue({ stdout: '', stderr: '' });
    const os = await loadAsWindows();
    await os.isPowerShellInstalled();
    await os.isAzCliInstalled();
    for (const call of execFileMock.mock.calls) {
      expect(call[2].cwd).not.toBe(process.cwd());
    }
  });
});

describe('source-level guard: no unchecked launches remain', () => {
  const root = path.resolve(__dirname, '..');
  const files = ['install-cli.ts', 'azure.ts', 'main.ts', 'commands.ts', path.join('util', 'os-util.ts')];
  it.each(files)('%s has no process.cwd() or bare-name tool launch', (f) => {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    expect(src).not.toMatch(/cwd:\s*process\.cwd\(\)/);
    expect(src).not.toMatch(/execFileAsync\(\s*'(winget|choco|brew|powershell|pwsh|az)(\.exe)?'/);
  });
});
