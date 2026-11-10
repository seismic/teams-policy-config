/**
 * MTGINGEST-5919 regression tests: a planted .env must not override bundled config.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTrustedEnv, parseEnvContent, resolveTeamsAppId } from '../util/env-config';

const GOOD = '11111111-2222-3333-4444-555555555555';
const EVIL = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let tmp: string;
let bundled: string;
let planted: string;
let originalCwd: string;

beforeEach(() => {
    originalCwd = process.cwd();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envcfg-'));
    fs.mkdirSync(path.join(tmp, 'asar'));
    fs.mkdirSync(path.join(tmp, 'launch'));
    bundled = path.join(tmp, 'asar', '.env');
    planted = path.join(tmp, 'launch', '.env');
    fs.writeFileSync(bundled, `VITE_APP_ID=${GOOD}\nEVIL_VAR=1\n`);
    fs.writeFileSync(
        planted,
        `VITE_APP_ID=${EVIL}\nVITE_DEV_SERVER_URL=http://evil.example\nNODE_OPTIONS=--require /tmp/x.js\nPATH=/tmp/evil\n`
    );
    process.chdir(path.join(tmp, 'launch'));
});

afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadTrustedEnv (packaged)', () => {
    it('ignores a malicious .env in the launch directory', () => {
        const env: NodeJS.ProcessEnv = {};
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: bundled, targetEnv: env });
        expect(env.VITE_APP_ID).toBe(GOOD);
        expect(env.VITE_DEV_SERVER_URL).toBeUndefined();
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(env.PATH).toBeUndefined();
    });

    it('drops unlisted keys even from the bundled file', () => {
        const env: NodeJS.ProcessEnv = {};
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: bundled, targetEnv: env });
        expect(env.EVIL_VAR).toBeUndefined();
    });

    it('bundled app ID overrides an inherited process env value', () => {
        const env: NodeJS.ProcessEnv = { VITE_APP_ID: EVIL };
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: bundled, targetEnv: env });
        expect(env.VITE_APP_ID).toBe(GOOD);
    });

    it('removes an inherited VITE_DEV_SERVER_URL', () => {
        const env: NodeJS.ProcessEnv = { VITE_DEV_SERVER_URL: 'http://evil.example' };
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: bundled, targetEnv: env });
        expect(env.VITE_DEV_SERVER_URL).toBeUndefined();
    });

    it('does not accept the dev server URL from the bundled file', () => {
        fs.writeFileSync(bundled, `VITE_APP_ID=${GOOD}\nVITE_DEV_SERVER_URL=http://localhost:1\n`);
        const env: NodeJS.ProcessEnv = {};
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: bundled, targetEnv: env });
        expect(env.VITE_DEV_SERVER_URL).toBeUndefined();
    });

    it('leaves app ID unset when the bundled file is missing (fails closed)', () => {
        const env: NodeJS.ProcessEnv = { VITE_APP_ID: EVIL };
        loadTrustedEnv({ isPackaged: true, trustedEnvPath: path.join(tmp, 'nope', '.env'), targetEnv: env });
        expect(env.VITE_APP_ID).toBeUndefined();
        expect(() => resolveTeamsAppId(env.VITE_APP_ID)).toThrow();
    });
});

describe('loadTrustedEnv (development)', () => {
    it('allows the dev server URL but still drops unlisted keys', () => {
        const env: NodeJS.ProcessEnv = {};
        loadTrustedEnv({ isPackaged: false, trustedEnvPath: planted, targetEnv: env });
        expect(env.VITE_DEV_SERVER_URL).toBe('http://evil.example');
        expect(env.NODE_OPTIONS).toBeUndefined();
        expect(env.PATH).toBeUndefined();
    });

    it('explicit process env takes precedence over the file', () => {
        const env: NodeJS.ProcessEnv = { VITE_APP_ID: GOOD };
        loadTrustedEnv({ isPackaged: false, trustedEnvPath: planted, targetEnv: env });
        expect(env.VITE_APP_ID).toBe(GOOD);
    });
});

describe('parseEnvContent', () => {
    it('strips quotes and comments', () => {
        expect(parseEnvContent(`# c\nVITE_APP_ID="${GOOD}"\n`, true)).toEqual({ VITE_APP_ID: GOOD });
    });
});

describe('resolveTeamsAppId', () => {
    it('accepts and trims a GUID', () => {
        expect(resolveTeamsAppId(`  ${GOOD} `)).toBe(GOOD);
    });
    it.each([undefined, '', '   ', 'not-a-guid', `${GOOD}; calc`, `${GOOD}"`, '{' + GOOD + '}'])(
        'rejects %j',
        (v) => {
            expect(() => resolveTeamsAppId(v as string | undefined)).toThrow();
        }
    );
});
