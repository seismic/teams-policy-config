import path from 'node:path';
import { app } from 'electron';
import { loadTrustedEnv } from './util/env-config';

// Packaged: only the .env bundled inside app.asar (electron-builder "files").
// Dev: only the project-root .env (one level above dist-electron/).
// Never process.cwd(), process.resourcesPath, or the executable's directory.
loadTrustedEnv({
    isPackaged: app.isPackaged,
    trustedEnvPath: app.isPackaged
        ? path.join(app.getAppPath(), '.env')
        : path.resolve(__dirname, '..', '.env'),
});
