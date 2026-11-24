import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const ALLOWED_ENV_KEY_RE = /^VITE_[A-Z0-9_]+$/;

function stripWrappingQuotes(value: string): string {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function loadProjectEnvFile(fileName: string = '.env'): void {
    // Only trusted, non-user-writable locations are read. The current working directory and
    // the directory next to the executable are attacker-influenced, so they are never used
    // (MTGINGEST-5919).
    const candidatePaths = app.isPackaged
        // Packaged app resources (electron-builder extraResources).
        ? [path.resolve(process.resourcesPath, fileName)]
        // Dev build: the project root, relative to the compiled main-process files.
        : [path.resolve(__dirname, '..', fileName)];

    const envFilePath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!envFilePath) {
        return;
    }

    try {
        const content = fs.readFileSync(envFilePath, 'utf8');
        const lines = content.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const separatorIndex = trimmed.indexOf('=');
            if (separatorIndex <= 0) {
                continue;
            }

            const key = trimmed.slice(0, separatorIndex).trim();
            const rawValue = trimmed.slice(separatorIndex + 1);
            // Only app configuration keys may be set; never runtime/loader variables
            // such as PATH, NODE_OPTIONS or ELECTRON_*, and never overwrite existing values.
            if (!key || !ALLOWED_ENV_KEY_RE.test(key) || process.env[key] !== undefined) {
                continue;
            }

            process.env[key] = stripWrappingQuotes(rawValue);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Failed to load ${fileName}: ${message}`);
    }
}

loadProjectEnvFile();
