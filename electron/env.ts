import fs from 'node:fs';
import path from 'node:path';

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
    const candidatePaths = [
        // Dev / CLI execution from project root.
        path.resolve(process.cwd(), fileName),
        // Compiled main-process files in dist-electron/ (dev build output).
        path.resolve(__dirname, '..', fileName),
        // Packaged app resources (electron-builder extraResources).
        path.resolve(process.resourcesPath, fileName),
        // Sidecar env file next to installed executable.
        path.resolve(path.dirname(process.execPath), fileName),
    ];

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
            if (!key || process.env[key] !== undefined) {
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
