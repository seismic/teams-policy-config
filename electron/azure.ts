import { shell, clipboard } from 'electron';
import {
  getSafeCwd,
  ProgressLogger,
  resolveAzCliPath,
  withCommonCliPath,
} from './util/os-util';
import { runCommandWithLiveLogs } from './util/powershell';

/**
 * Performs Azure device-code login and then resolves either subscription context
 * or tenant-only context (for accounts without subscription access).
 * The function also handles parsing CLI output in real time to detect device-code prompts and guide the user through the login process.
 * @param log Optional logger to stream CLI output and guidance messages to the UI.
 * @returns An object containing account and tenant information upon successful login.
 * @throws An error if the login process fails or times out. The error may include stdout and stderr properties with CLI output for debugging.
 */
export async function runAzLogin(log?: ProgressLogger): Promise<{
  accountName?: string;
  userName?: string;
  tenantId?: string;
  tenantOnly?: boolean;
}> {
  // Resolve the Azure CLI to a verified absolute path up front (finding 1352217),
  // so every spawn uses a fully-qualified path with no PATH/cwd search.
  const azPath = await resolveAzCliPath();
  if (!azPath) {
    const notFound = new Error('Azure CLI was not found.') as NodeJS.ErrnoException;
    notFound.code = 'ENOENT';
    throw notFound;
  }
  const env = withCommonCliPath();
  const cwd = getSafeCwd();
  const canonicalDeviceLoginUrl = 'https://microsoft.com/devicelogin';
  let deviceUrlOpened = false;
  let lastDeviceCode: string | undefined;

  // Parse device-code prompts from CLI output and guide the user in real time.
  const maybeHandleDeviceCodeLine = (line: string) => {
    const urlMatch = line.match(/https?:\/\/[^\s)]+/i);
    const codeMatch = line.match(/enter the code\s+([A-Z0-9]+)/i);

    if (codeMatch?.[1]) {
      lastDeviceCode = codeMatch[1];
      log?.(`Device code detected: ${lastDeviceCode}`);
      if (!deviceUrlOpened) {
        deviceUrlOpened = true;
        void shell.openExternal(canonicalDeviceLoginUrl)
          .then(() => {
            log?.(`Opened browser automatically: ${canonicalDeviceLoginUrl}`);
            log?.(`Enter this device code in browser: ${lastDeviceCode}`);
          })
          .catch((openErr) => {
            log?.(`Could not auto-open browser: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
          });
      }
    }

    const url = urlMatch?.[0];
    if (!deviceUrlOpened && url && /login\.microsoft\.com\/device|microsoft\.com\/devicelogin/i.test(url)) {
      deviceUrlOpened = true;
      void shell.openExternal(canonicalDeviceLoginUrl)
        .then(() => {
          log?.(`Opened browser automatically: ${canonicalDeviceLoginUrl}`);
          if (lastDeviceCode) {
            try {
              clipboard.writeText(lastDeviceCode);
              log?.(`Device code copied to clipboard: ${lastDeviceCode}`);
            } catch (clipboardErr) {
              log?.(`Could not copy device code to clipboard: ${clipboardErr instanceof Error ? clipboardErr.message : String(clipboardErr)}`);
            }
            log?.(`Enter this device code in browser: ${lastDeviceCode}`);
          }
        })
        .catch((openErr) => {
          log?.(`Could not auto-open browser: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
        });
    }
  };

  let stdout = '';

  log?.(`Starting Azure login using ${azPath}...`);
  log?.('Complete the device-code flow in browser/terminal when prompted.');
  if (!deviceUrlOpened) {
    void shell.openExternal(canonicalDeviceLoginUrl)
      .then(() => {
        deviceUrlOpened = true;
        log?.(`Opened browser automatically: ${canonicalDeviceLoginUrl}`);
      })
      .catch((openErr) => {
        log?.(`Could not auto-open browser: ${openErr instanceof Error ? openErr.message : String(openErr)}`);
      });
  }

  try {
    await runCommandWithLiveLogs(azPath, ['login', '--use-device-code', '--allow-no-subscriptions'], {
      cwd,
      env,
      log: (line) => {
        log?.(line);
        maybeHandleDeviceCodeLine(line);
      },
      timeoutMs: 10 * 60 * 1000
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stderr?: string };
    const stderr = err.stderr;
    if (stderr) {
      log?.(`Azure login failed: ${stderr.slice(0, 400)}`);
    } else {
      log?.(`Azure login failed: ${err.message}`);
    }
    throw error;
  }
  log?.('Azure login command completed. Fetching account context...');

  try {
    // Preferred path: account has subscription context.
    const accountResult = await runCommandWithLiveLogs(azPath, ['account', 'show', '--output', 'json'], {
      cwd,
      env,
      timeoutMs: 30 * 1000
    });
    stdout = accountResult.stdout;
    log?.('Subscription context found via az account show.');
  } catch (accountError) {
    // Fallback path: tenant-only sign-in (no subscription access available).
    log?.('No subscription context detected. Falling back to tenant-level context...');
    const tenantListResult = await runCommandWithLiveLogs(azPath, ['account', 'tenant', 'list', '--output', 'json'], {
      cwd,
      env,
      timeoutMs: 30 * 1000
    });
    const tenantList = JSON.parse(tenantListResult.stdout || '[]');
    const firstTenant = Array.isArray(tenantList) ? tenantList[0] : undefined;
    log?.('Tenant-level login succeeded.');
    return {
      accountName: firstTenant?.displayName,
      userName: undefined,
      tenantId: firstTenant?.tenantId,
      tenantOnly: true
    };
  }

  let account: any = {};
  try {
    account = JSON.parse(stdout);
  } catch {
    account = {};
  }

  return {
    accountName: account?.name,
    userName: account?.user?.name,
    tenantId: account?.tenantId
  };
}