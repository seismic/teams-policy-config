import { installRequiredPowerShellModules, ProgressLogger } from './util/os-util';
import { getPolicyByName, getUserList, grantPolicyToGlobal, grantPolicyToGroup, grantPolicyToUser, setupPolicy, User } from './commands';

export type SetupResult = {
	success: boolean;
	error?: string;
	platform?: NodeJS.Platform;
	message?: string;
	missingPowerShell?: boolean;
	missingAzCli?: boolean;
};

/**
 * Retrieves all CS Application Access Policies.
 */
export async function grantAccessPolicy(log: ProgressLogger, policyName: string, type: string, users: any[], groups: any[]): Promise<any> {
	log('Granting policy started...');

	// Setup the policy first to ensure it exists before attempting to grant it, and to avoid potential issues with granting a non-existent policy.
	await setupPolicy(log, policyName);

	// For user policy, grant to first user in the list (for testing/demo purposes)
	let result;
	switch (type) {
		case 'user':
			result = await grantPolicyToUser(log, policyName, users);
			break;
		case 'group':
			result = await grantPolicyToGroup(log, policyName, groups);
			break;
		case 'global':
			log('Granting global policy');
			// Grant global policy logic here
			result = await grantPolicyToGlobal(log, policyName);
			break;
		default:
			log(`Unknown policy grant type: ${type}`);
			return;
	}

	log(`Grant policy output: ${JSON.stringify(result)}`);
	log('Granting policy completed.');
	return result;
}

/**
 * Retrieves a specific CS Application Access Policy by name.
 */
async function getPolicy(log: ProgressLogger, policyName: string): Promise<void> {
	log?.(`Retrieving CS Application Access Policy "${policyName}" for Microsoft Teams...`);

	const result = await getPolicyByName(log, policyName);
	if (!result) {
		log?.(`CS Application Access Policy "${policyName}" was not found.`);
		return;
	}

	log(`Get-CsApplicationAccessPolicy output: ${JSON.stringify(result, null, 2)}`);
}

async function getAllUsers(log: ProgressLogger): Promise<User[]> {
	log('Retrieving Azure user list...');

	const result = await getUserList(log);
	if (!result) {
		log('No Azure users found.');
		return [];
	}

	log?.(`Retrieved ${result.length} Azure users.`);
	log?.('Azure User list:');
	result.forEach(user => log?.(` - ${user.DisplayName} (${user.UserPrincipalName})`));

	return result;
}

/**
 * Runs the necessary PowerShell tasks before attempting to log in, including installing required modules and connecting to Azure.
 * @param log Optional callback to receive progress messages for UI updates during the pre-login tasks.
 * @returns A promise that resolves to a SetupResult object if any task fails, or null if all tasks succeed.
 */
export async function runPreLoginPowerShellTasks(
	log: ProgressLogger
): Promise<SetupResult | null> {
	// Install required PowerShell modules first so setup fails early if prerequisites are missing.
	try {
		await installRequiredPowerShellModules(log);
		return {
			success: true,
			message: 'Required PowerShell modules are installed.'
		};
	} catch (moduleInstallError: any) {
		log('PowerShell module installation failed. Blocking login.');
		return {
			success: false,
			error: 'ps-module-install-failed',
			message: moduleInstallError?.message || 'Failed to install required PowerShell modules (Az, MicrosoftTeams).'
		};
	}
}
