/**
 * Trusted configuration loading (MTGINGEST-5919, CWE-426).
 *
 * Pure helpers with no Electron dependency so they are unit-testable.
 *
 * Rules:
 *  - Packaged builds read config ONLY from the bundled .env inside app.asar.
 *    process.cwd(), process.resourcesPath, and the executable's directory are
 *    attacker-writable and are never consulted.
 *  - Only allowlisted keys are accepted; everything else is dropped.
 *  - Dev-only keys (VITE_DEV_SERVER_URL) are ignored in packaged builds.
 *  - In packaged builds the bundled value always wins over inherited process.env.
 */
import fs from 'node:fs';
import { isValidGuid } from './validate';

/** Keys accepted from a .env file in any build. */
export const ALLOWED_ENV_KEYS: readonly string[] = ['VITE_APP_ID'];

/** Keys accepted only from unpackaged (development) runs. */
export const DEV_ONLY_ENV_KEYS: readonly string[] = ['VITE_DEV_SERVER_URL'];

export function stripWrappingQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        trimmed.length >= 2 &&
        ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'")))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

/** Parses .env content, returning only keys permitted for the given build type. */
export function parseEnvContent(content: string, isPackaged: boolean): Record<string, string> {
    const allowed = new Set<string>(isPackaged ? ALLOWED_ENV_KEYS : [...ALLOWED_ENV_KEYS, ...DEV_ONLY_ENV_KEYS]);
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const sep = trimmed.indexOf('=');
        if (sep <= 0) continue;
        const key = trimmed.slice(0, sep).trim();
        if (!allowed.has(key)) continue;
        result[key] = stripWrappingQuotes(trimmed.slice(sep + 1));
    }
    return result;
}

export interface LoadConfigOptions {
    isPackaged: boolean;
    /** Single trusted .env path: bundled in app.asar when packaged; project root in dev. */
    trustedEnvPath: string;
    /** Environment object to populate (defaults to process.env). */
    targetEnv?: NodeJS.ProcessEnv;
}

export function loadTrustedEnv(options: LoadConfigOptions): void {
    const { isPackaged, trustedEnvPath, targetEnv = process.env } = options;

    if (isPackaged) {
        // Dev-only settings must never take effect in a packaged build, even if
        // inherited from the launching process environment.
        for (const key of DEV_ONLY_ENV_KEYS) delete targetEnv[key];
        // The bundled config is authoritative: drop any inherited override.
        for (const key of ALLOWED_ENV_KEYS) delete targetEnv[key];
    }

    let content: string;
    try {
        content = fs.readFileSync(trustedEnvPath, 'utf8');
    } catch {
        return;
    }

    const parsed = parseEnvContent(content, isPackaged);
    for (const [key, value] of Object.entries(parsed)) {
        // Dev: explicit process env (e.g. cross-env) takes precedence over the file.
        if (!isPackaged && targetEnv[key] !== undefined) continue;
        targetEnv[key] = value;
    }
}

/** Returns the normalized Teams app ID, or throws if missing/not a strict GUID. */
export function resolveTeamsAppId(raw: string | undefined): string {
    const appId = raw?.trim();
    if (!appId) {
        throw new Error('VITE_APP_ID is not configured in the bundled application config.');
    }
    if (!isValidGuid(appId)) {
        throw new Error('VITE_APP_ID is not a valid GUID.');
    }
    return appId;
}
