import './env';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { grantAccessPolicy, runPreLoginPowerShellTasks, SetupResult } from './teams-setup';
import { createEnterpriseLogger } from './util/logger/enterprise-logger';
import { installAzureCli, installHomebrew, installPowerShell } from './install-cli';
import { searchGroups, searchUsers, searchUsersByEmails } from './commands';
import { EMAIL_BATCH_LIMIT, isValidEmail, isValidGuid, isValidPolicyName, isValidSearchText } from './util/validate';

const APP_ID_VALIDATION_MESSAGE = 'Invalid app id. Expected an Azure AD application (client) ID (GUID).';
import { GrantType, GRANT_TYPE_VALUES } from './util/grant-types';
import {
  isAzCliInstalled,
  isPowerShellInstalled,
  ProgressLogger,
} from './util/os-util';
import { runAzLogin } from './azure';
import { createWindow } from './window';

// Set a custom app name and process title for better identification in system tools and logs.
const APP_DISPLAY_NAME = 'Teams Policy Config';
app.setName(APP_DISPLAY_NAME);
process.title = APP_DISPLAY_NAME;

/**
 * Validates that required CLI tools (PowerShell and Azure CLI) are installed and reachable.
 * If any prerequisites are missing, returns a SetupFailure object with details to guide the user.
 * If all prerequisites are met, returns null.
 * @param log Logger to stream progress messages to the UI.
 * @returns A promise that resolves to a SetupResult object if any prerequisite is missing, or null if all are present.
 */
async function validateCliPrerequisites(log: ProgressLogger): Promise<SetupResult | null> {
  log('Checking prerequisites (PowerShell and Azure CLI)...');

  const [hasPowerShell, hasAzCli] = await Promise.all([
    isPowerShellInstalled(log),
    isAzCliInstalled(log)
  ]);

  if (!hasPowerShell || !hasAzCli) {
    if (!hasPowerShell) {
      log('PowerShell is not installed. Blocking login.');
    }

    if (!hasAzCli) {
      log('Azure CLI is not installed. Blocking login.');
    }

    return {
      success: false,
      error: !hasPowerShell && !hasAzCli
        ? 'prerequisites-missing'
        : !hasPowerShell
          ? 'powershell-missing'
          : 'az-missing',
      platform: process.platform,
      missingPowerShell: !hasPowerShell,
      missingAzCli: !hasAzCli
    };
  }

  return null;
}

function createProgressLogger(sender: Electron.WebContents): ProgressLogger {
  return (message) => {
    sender.send('op:progress', {
      timestamp: new Date().toISOString(),
      message
    });
  };
}

let sessionLogger: ReturnType<typeof createEnterpriseLogger> | null = null;

function createAppLogger() {
  if (!sessionLogger) {
    const logsBaseDir = path.join(app.getPath('userData'), 'logs');
    sessionLogger = createEnterpriseLogger({ baseDir: logsBaseDir });
  }

  return sessionLogger;
}

type AppSettings = {
  grantPolicyName?: string;
  grantAppId?: string;
};

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readAppSettings(): AppSettings {
  const settingsPath = getSettingsFilePath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as AppSettings;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAppSettings(nextSettings: AppSettings): void {
  const settingsPath = getSettingsFilePath();
  const settingsDir = path.dirname(settingsPath);
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf8');
}

ipcMain.handle('settings:get-policy-name', async () => {
  const elog = createAppLogger();
  elog.log('Reading policy name setting...');
  elog.addSummary('Get policy name setting');
  const settings = readAppSettings();
  // Re-validate on read: never propagate a policy name from settings.json that
  // would not pass input validation (defends the settings reload path, 1352156).
  const policyName = isValidPolicyName(settings.grantPolicyName) ? settings.grantPolicyName!.trim() : '';
  elog.log(`Policy name retrieved: "${policyName}"`);
  elog.addSummary(`Policy name: "${policyName}"`);
  return {
    success: true,
    data: { policyName }
  };
});

ipcMain.handle('settings:set-policy-name', async (_event, payload: { policyName?: string } | string) => {
  const elog = createAppLogger();
  elog.log('Setting policy name...');
  elog.addSummary('Set policy name operation started');

  const value = typeof payload === 'string' ? payload : payload?.policyName;
  if (!isValidPolicyName(value)) {
    elog.error('Invalid policy name provided.');
    elog.addSummary('Failed: invalid policy name.');
    return {
      success: false,
      error: 'invalid-policy-name',
      message: 'Invalid policy name. Use only letters, numbers, space, dot, hyphen or underscore (max 64).'
    };
  }

  const settings = readAppSettings();
  settings.grantPolicyName = value.trim();
  writeAppSettings(settings);
  elog.log(`Policy name saved: "${settings.grantPolicyName}"`);
  elog.addSummary(`Policy name set to: "${settings.grantPolicyName}"`);

  return {
    success: true,
    data: {
      policyName: settings.grantPolicyName
    }
  };
});

ipcMain.handle('settings:get-app-id', async () => {
  const elog = createAppLogger();
  elog.log('Reading app id setting...');
  elog.addSummary('Get app id setting');
  const settings = readAppSettings();
  // Re-validate on read: never propagate an app id from settings.json that
  // would not pass input validation (defends the settings reload path, 1352156).
  const appId = isValidGuid(settings.grantAppId) ? settings.grantAppId!.trim() : '';
  elog.log(`App id retrieved: "${appId}"`);
  elog.addSummary(`App id retrieved.`);
  return {
    success: true,
    data: { appId }
  };
});

ipcMain.handle('settings:set-app-id', async (_event, payload: { appId?: string } | string) => {
  const elog = createAppLogger();
  elog.log('Setting app id...');
  elog.addSummary('Set app id operation started');

  const value = typeof payload === 'string' ? payload : payload?.appId;
  if (!isValidGuid(value)) {
    elog.error('Invalid app id provided.');
    elog.addSummary('Failed: invalid app id.');
    return {
      success: false,
      error: 'invalid-app-id',
      message: APP_ID_VALIDATION_MESSAGE
    };
  }

  const settings = readAppSettings();
  settings.grantAppId = value.trim();
  writeAppSettings(settings);
  elog.log(`App id saved.`);
  elog.addSummary(`App id set.`);

  return {
    success: true,
    data: {
      appId: settings.grantAppId
    }
  };
});

/**
 * IPC entry point for renderer "Get Started" flow.
 * Handles the "setup-environment" IPC call from the renderer process.
 * This includes checking prerequisites and installing required PowerShell modules.
 */
ipcMain.handle('setup-environment', async (_event) => {
  const log = createProgressLogger(_event.sender);
  // Enterprise logger for file logging
  const elog = createAppLogger();
  elog.log('Starting setup environment operation...');
  log('Starting setup environment operation...');
  elog.addSummary('Setup environment operation started');

  const prerequisiteFailure = await validateCliPrerequisites((msg) => { log(msg); elog.log(msg); });
  if (prerequisiteFailure) {
    elog.error('Prerequisite failure', new Error(prerequisiteFailure.error || '')); elog.addSummary('Prerequisite failure: ' + (prerequisiteFailure.error || ''));
    return prerequisiteFailure;
  }

  const preLoginTaskFailure = await runPreLoginPowerShellTasks((msg) => { log(msg); elog.log(msg); });
  if (preLoginTaskFailure) {
    elog.error('Pre-login PowerShell task failure', new Error(preLoginTaskFailure.error || ''));
    elog.addSummary('Pre-login PowerShell task failure: ' + (preLoginTaskFailure.error || ''));
    return preLoginTaskFailure;
  }

  elog.addSummary('Environment setup completed successfully.');
  log('Environment setup completed successfully.');

  return {
    success: true,
    message: 'Environment setup completed successfully.'
  };
});

/**
 * IPC entry point for renderer "Get Started" flow.
 * Handles the "start-setup" IPC call from the renderer process.
 * This includes checking prerequisites, installing required PowerShell modules,
 * and performing Azure login.
 */
ipcMain.handle('start-az-login', async (_event) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  elog.log('Starting Azure Login operation.');
  log('Starting Azure Login operation.');
  elog.addSummary('Azure Login operation started');

  try {
    const azure = await runAzLogin((msg) => { log(msg); elog.log(msg); });
    elog.log('Azure Login completed successfully.');
    log('Azure Login completed successfully.');
    elog.addSummary('Azure login succeeded.');

    return {
      success: true,
      azure,
    };
  } catch (err: any) {
    elog.error('Azure login failed', err);
    if (err && err.code === 'ETIMEDOUT') {
      log('Azure login timed out. Please retry and complete device-code sign-in promptly.');
      elog.addSummary('Azure login timed out.');
      return {
        success: false,
        error: 'az-login-timeout',
        message: 'Azure login timed out while waiting for device-code completion. Please retry and finish sign-in in browser.'
      };
    }

    if (err && err.code === 'ENOENT') {
      log('Azure CLI is missing.');
      elog.addSummary('Azure CLI is missing.');
      return {
        success: false,
        error: 'az-missing',
        platform: process.platform
      };
    }

    const stderr = typeof err?.stderr === 'string' ? err.stderr : '';
    const stdout = typeof err?.stdout === 'string' ? err.stdout : '';
    const details = [stderr, stdout, typeof err?.message === 'string' ? err.message : '']
      .filter(Boolean)
      .join('\n');

    if (details.includes('AADSTS50076')) {
      log('Azure login blocked by MFA policy (AADSTS50076).');
      elog.addSummary('Azure login blocked by MFA policy (AADSTS50076).');
      return {
        success: false,
        error: 'az-mfa-required',
        message: 'MFA is required by your tenant policy. Complete sign-in using the device code flow and try again.'
      };
    }

    log('Azure login failed with an unexpected error.');
    elog.addSummary('Azure login failed with an unexpected error.');

    return {
      success: false,
      error: 'az-login-failed',
      message: details || 'Unknown Azure login error'
    };
  }
});

/**
 * IPC entry point for renderer "Grant Policy" flow.
 * Handles the "grant-policy" IPC call from the renderer process.
 * This includes connecting to Microsoft Teams, verifying/setting up the access policy, and granting it to the specified group.
 * For demonstration, the policy name and group ID are currently hardcoded, but in a real implementation these would be passed from the renderer process based on user input.
 */
ipcMain.handle('grant-policy', async (_event, data) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  elog.log('Starting grant policy operation...');
  log('Starting grant policy operation...');
  elog.addSummary('Grant policy operation started');

  try {
    // Validate payload shape before destructuring — never trust renderer-supplied data
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      elog.error('Invalid payload: expected a plain object.');
      elog.addSummary('Failed: malformed payload.');
      elog.finish(false);
      return { success: false, error: 'invalid-payload', message: 'Malformed request payload.' };
    }

    const { policyName, appId, type, users, groups } = data;

    // Allowlist the type field — never allow arbitrary strings to reach the grant logic
    if (!GRANT_TYPE_VALUES.includes(type as GrantType)) {
      elog.error('Invalid type field in payload.');
      elog.addSummary('Failed: invalid type field.');
      elog.finish(false);
      return { success: false, error: 'invalid-type', message: `type must be one of: ${GRANT_TYPE_VALUES.join(', ')}.` };
    }

    if (!isValidPolicyName(policyName)) {
      log('Invalid policy name provided.');
      elog.error('Invalid policy name provided.');
      elog.addSummary('Invalid policy name provided.');
      elog.finish(false);
      return {
        success: false,
        error: 'invalid-policy-name',
        message: 'Invalid policy name. Use only letters, numbers, space, dot, hyphen or underscore (max 64).'
      };
    }

    if (!isValidGuid(appId)) {
      log('Invalid app id provided.');
      elog.error('Invalid app id provided.');
      elog.addSummary('Invalid app id provided.');
      elog.finish(false);
      return {
        success: false,
        error: 'invalid-app-id',
        message: APP_ID_VALIDATION_MESSAGE
      };
    }

    if (type === GrantType.User && (!users || !Array.isArray(users) || users.length === 0)) {
      log('No users specified for user-type policy grant.');
      elog.error('No users specified for user-type policy grant.');
      elog.addSummary('No users specified for user-type policy grant.');
      elog.finish(false);
      return {
        success: false,
        error: 'no-users-specified',
        message: 'At least one user must be specified for a user-type policy grant.'
      };
    }

    if (type === GrantType.Group && (!groups || !Array.isArray(groups) || groups.length === 0)) {
      log('No groups specified for group-type policy grant.');
      elog.error('No groups specified for group-type policy grant.');
      elog.addSummary('No groups specified for group-type policy grant.');
      elog.finish(false);
      return {
        success: false,
        error: 'no-groups-specified',
        message: 'At least one group must be specified for a group-type policy grant.'
      };
    }

    if (type === GrantType.Group && !groups.every((group: unknown) => isValidGuid(group))) {
      log('One or more group ids are not valid GUIDs.');
      elog.error('One or more group ids are not valid GUIDs.');
      elog.addSummary('Invalid group id provided.');
      elog.finish(false);
      return {
        success: false,
        error: 'invalid-group-id',
        message: 'Each selected group must be a valid Azure AD object id (GUID).'
      };
    }

    const grantOperationResult = await grantAccessPolicy((msg) => { log(msg); elog.log(msg); }, policyName, appId, type, users, groups);
    log('Granting policy completed successfully.');
    elog.addSummary('Granting policy completed successfully.');
    elog.finish(true);

    return {
      success: true,
      policyName,
      users,
      groups,
      message: `Policy "${policyName}" granted to ${type === GrantType.User ? `users ${users.join(', ')}` : `groups ${groups.join(', ')}`} successfully.`,
      data: grantOperationResult || null
    };
  } catch (err: any) {
    log('Granting policy failed with an unexpected error.');
    elog.error('Granting policy failed with an unexpected error.', err);
    elog.addSummary('Granting policy failed with an unexpected error.');
    elog.finish(false);

    const details = typeof err?.message === 'string' ? err.message : 'Unknown error';

    return {
      success: false,
      error: 'grant-policy-failed',
      message: details
    };
  }
});

/**
 * Handles PowerShell installation using OS-specific package manager flows.
 * Supports Homebrew on macOS and winget/Chocolatey on Windows.
 */
ipcMain.handle('system:install-powershell', async (_event) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  elog.log('Starting PowerShell installation...');
  elog.addSummary('PowerShell installation started');
  try {
    const result = await installPowerShell((msg) => { log(msg); elog.log(msg); });
    const success = !!(result as any)?.success;
    elog.addSummary(`PowerShell installation ${success ? 'succeeded' : 'failed'}.`);
    return result;
  } catch (err: any) {
    elog.error('PowerShell installation threw an unexpected error.', err);
    elog.addSummary('PowerShell installation failed with an unexpected error.');
    throw err;
  }
});

/**
 * Handles Azure CLI installation using OS-specific package manager flows.
 * Supports Homebrew on macOS and winget/Chocolatey on Windows.
 */
ipcMain.handle('system:install-azure-cli', async (_event) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  elog.log('Starting Azure CLI installation...');
  elog.addSummary('Azure CLI installation started');
  try {
    const result = await installAzureCli((msg) => { log(msg); elog.log(msg); });
    const success = !!(result as any)?.success;
    elog.addSummary(`Azure CLI installation ${success ? 'succeeded' : 'failed'}.`);
    return result;
  } catch (err: any) {
    elog.error('Azure CLI installation threw an unexpected error.', err);
    elog.addSummary('Azure CLI installation failed with an unexpected error.');
    throw err;
  }
});

ipcMain.handle('system:install-homebrew', async (_event) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  elog.log('Starting Homebrew installation...');
  elog.addSummary('Homebrew installation started');
  try {
    const result = await installHomebrew((msg) => { log(msg); elog.log(msg); });
    const success = !!(result as any)?.success;
    elog.addSummary(`Homebrew installation ${success ? 'succeeded' : 'failed'}.`);
    return result;
  } catch (err: any) {
    elog.error('Homebrew installation threw an unexpected error.', err);
    elog.addSummary('Homebrew installation failed with an unexpected error.');
    throw err;
  }
});

/**
 * IPC endpoint to open the logs folder in the system file explorer.
 * This allows users to easily access log files for troubleshooting.
 */
ipcMain.handle('shell:open-logs-folder', async () => {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  await shell.openPath(logsDir);
  return { success: true };
});

/**
 * IPC endpoint to search users by text typed in the Grant Policy step.
 */
ipcMain.handle('search-users', async (_event, payload: { searchText?: string; page?: number } | string) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  const searchText = typeof payload === 'string' ? payload : payload?.searchText || '';
  const page = typeof payload === 'string' ? 0 : payload?.page ?? 0;

  if (!isValidSearchText(searchText)) {
    return { success: false, error: 'invalid-search-text', message: 'Search text exceeds maximum allowed length.', data: { users: [], total: 0 } };
  }

  elog.log(`Searching users — query: "${searchText}", page: ${page}`);
  elog.addSummary(`Search users: query="${searchText}" page=${page}`);

  try {
    const { users, total } = await searchUsers((msg) => { log(msg); elog.log(msg); }, searchText, page);
    elog.log(`Search returned ${total} total user(s), ${users.length} on this page.`);
    elog.addSummary(`Search users succeeded: ${total} total result(s).`);
    return {
      success: true,
      data: { users, total }
    };
  } catch (err: any) {
    const details = typeof err?.message === 'string' ? err.message : 'Unknown error';
    elog.error('Search users failed.', err);
    elog.addSummary(`Search users failed: ${details}`);
    return {
      success: false,
      error: 'search-users-failed',
      message: details,
      data: { users: [], total: 0 }
    };
  }
});

/**
 * IPC endpoint to resolve users by email list (CSV import flow).
 */
ipcMain.handle('search-users-by-emails', async (_event, payload: { emails?: string[] } | string[]) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  const emails = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.emails)
      ? payload.emails
      : [];

  if (emails.length > EMAIL_BATCH_LIMIT) {
    return { success: false, error: 'too-many-emails', message: `Maximum ${EMAIL_BATCH_LIMIT} email addresses per request.`, data: { users: [] } };
  }

  const invalidEmail = emails.find((e: unknown) => !isValidEmail(e));
  if (invalidEmail !== undefined) {
    return { success: false, error: 'invalid-email', message: 'One or more email addresses are not valid.', data: { users: [] } };
  }

  elog.log(`Resolving users by emails — ${emails.length} address(es) provided.`);
  elog.addSummary(`Search users by emails: ${emails.length} address(es)`);

  try {
    const users = await searchUsersByEmails((msg) => { log(msg); elog.log(msg); }, emails);
    elog.log(`Resolved ${users.length} user(s) from provided emails.`);
    elog.addSummary(`Search users by emails succeeded: ${users.length} user(s) resolved.`);
    return {
      success: true,
      data: { users }
    };
  } catch (err: any) {
    const details = typeof err?.message === 'string' ? err.message : 'Unknown error';
    elog.error('Search users by emails failed.', err);
    elog.addSummary(`Search users by emails failed: ${details}`);
    return {
      success: false,
      error: 'search-users-by-emails-failed',
      message: details,
      data: { users: [] }
    };
  }
});

/**
 * IPC endpoint to search groups by text typed in the Grant Policy step.
 */
ipcMain.handle('search-groups', async (_event, payload: { searchText?: string; page?: number } | string) => {
  const log = createProgressLogger(_event.sender);
  const elog = createAppLogger();
  const searchText = typeof payload === 'string' ? payload : payload?.searchText || '';
  const page = typeof payload === 'string' ? 0 : payload?.page ?? 0;

  if (!isValidSearchText(searchText)) {
    return { success: false, error: 'invalid-search-text', message: 'Search text exceeds maximum allowed length.', data: { groups: [], total: 0 } };
  }

  elog.log(`Searching groups — query: "${searchText}", page: ${page}`);
  elog.addSummary(`Search groups: query="${searchText}" page=${page}`);

  try {
    const { groups, total } = await searchGroups((msg) => { log(msg); elog.log(msg); }, searchText, page);
    elog.log(`Search returned ${total} total group(s), ${groups.length} on this page.`);
    elog.addSummary(`Search groups succeeded: ${total} total result(s).`);
    return {
      success: true,
      data: { groups, total }
    };
  } catch (err: any) {
    const details = typeof err?.message === 'string' ? err.message : 'Unknown error';
    elog.error('Search groups failed.', err);
    elog.addSummary(`Search groups failed: ${details}`);
    return {
      success: false,
      error: 'search-groups-failed',
      message: details,
      data: { groups: [], total: 0 }
    };
  }
});

app.whenReady()
  .then(() => {
    app.setName(APP_DISPLAY_NAME);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  })
  .catch((error) => {
    console.error('App failed to initialize:', error);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
