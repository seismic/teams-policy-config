import { contextBridge, ipcRenderer } from 'electron';

interface GrantPolicyPayload {
  policyName: string;
  type: 'user' | 'group';
  users?: string[];
  groups?: string[];
}

contextBridge.exposeInMainWorld('electronAPI', {
  setupEnvironment: () => ipcRenderer.invoke('setup-environment'),
  startAzLogin: () => ipcRenderer.invoke('start-az-login'),
  grantPolicy: (data: GrantPolicyPayload) => ipcRenderer.invoke('grant-policy', data),
  searchUsers: (searchText: string, page: number = 0) => ipcRenderer.invoke('search-users', { searchText, page }),
  resolveUsersByEmails: (emails: string[]) => ipcRenderer.invoke('search-users-by-emails', { emails }),
  searchGroups: (searchText: string, page: number = 0) => ipcRenderer.invoke('search-groups', { searchText, page }),
  getSavedPolicyName: () => ipcRenderer.invoke('settings:get-policy-name'),
  setSavedPolicyName: (policyName: string) => ipcRenderer.invoke('settings:set-policy-name', { policyName }),
  installPowerShell: () => ipcRenderer.invoke('system:install-powershell'),
  installAzureCli: () => ipcRenderer.invoke('system:install-azure-cli'),
  installHomebrew: () => ipcRenderer.invoke('system:install-homebrew'),
  onOperationProgress: (callback: (payload: { timestamp: string; message: string }) => void) =>
    ipcRenderer.on('op:progress', (_event, payload) => callback(payload)),
  clearOperationProgressListeners: () => ipcRenderer.removeAllListeners('op:progress'),
  openLogsFolder: () => ipcRenderer.invoke('shell:open-logs-folder'),
});
