/// <reference types="vite/client" />

interface GrantPolicyPayload {
	policyName: string;
	appId: string;
	type: 'user' | 'group';
	users?: string[];
	groups?: string[];
}

interface ElectronApiResult {
	success: boolean;
	error?: string;
	message?: string;
	platform?: string;
	missingPowerShell?: boolean;
	missingAzCli?: boolean;
	accountName?: string;
	userName?: string;
	tenantId?: string;
	tenantOnly?: boolean;
	data?: any;
}

interface Window {
	electronAPI: {
		setupEnvironment: () => Promise<ElectronApiResult>;
		startAzLogin: () => Promise<ElectronApiResult>;
		grantPolicy: (data: GrantPolicyPayload) => Promise<ElectronApiResult>;
		searchUsers: (searchText: string, page?: number) => Promise<ElectronApiResult>;
		resolveUsersByEmails: (emails: string[]) => Promise<ElectronApiResult>;
		searchGroups: (searchText: string, page?: number) => Promise<ElectronApiResult>;
		getSavedPolicyName?: () => Promise<ElectronApiResult>;
		setSavedPolicyName?: (policyName: string) => Promise<ElectronApiResult>;
		getSavedAppId?: () => Promise<ElectronApiResult>;
		setSavedAppId?: (appId: string) => Promise<ElectronApiResult>;
		installPowerShell?: () => Promise<any>;
		installAzureCli?: () => Promise<any>;
		installHomebrew?: () => Promise<any>;
		onOperationProgress?: (callback: (payload: { timestamp: string; message: string }) => void) => void;
		clearOperationProgressListeners?: () => void;
		openLogsFolder?: () => Promise<any>;
	};
}
