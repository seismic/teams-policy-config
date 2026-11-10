/**
 * MTGINGEST-5919: electron/env.ts must hand loadTrustedEnv the app.asar path
 * (packaged) or the project-root path (dev) — never cwd/resources/execPath.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadEnvModule(isPackaged: boolean) {
    vi.resetModules();
    const loadTrustedEnv = vi.fn();
    vi.doMock('electron', () => ({
        app: { isPackaged, getAppPath: () => '/Apps/X/resources/app.asar' },
    }));
    vi.doMock('../util/env-config', () => ({ loadTrustedEnv }));
    await import('../env');
    return loadTrustedEnv;
}

afterEach(() => {
    vi.doUnmock('electron');
    vi.doUnmock('../util/env-config');
});

describe('electron/env.ts', () => {
    it('packaged: uses the .env inside app.getAppPath()', async () => {
        const fn = await loadEnvModule(true);
        expect(fn).toHaveBeenCalledWith({
            isPackaged: true,
            trustedEnvPath: path.join('/Apps/X/resources/app.asar', '.env'),
        });
    });

    it('dev: uses only the project-root .env', async () => {
        const fn = await loadEnvModule(false);
        const arg = fn.mock.calls[0][0];
        expect(arg.isPackaged).toBe(false);
        expect(arg.trustedEnvPath).toBe(path.resolve(__dirname, '..', '..', '.env'));
    });
});
