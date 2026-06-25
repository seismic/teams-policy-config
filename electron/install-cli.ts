import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProgressLogger, withCommonCliPath, getSafeCwd } from './util/os-util';

const execFileAsync = promisify(execFile);

const HOMEBREW_INSTALL_COMMAND = 'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';
const HOMEBREW_INSTALL_COMMAND_INTERACTIVE = '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"';

function escapeForAppleScript(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function isCommandAvailable(command: string, args: string[] = ['--version']): Promise<boolean> {
	try {
		await execFileAsync(command, args, { cwd: getSafeCwd(), env: withCommonCliPath() });
		return true;
	} catch {
		return false;
	}
}

async function installPowerShellOnWindows(log: ProgressLogger): Promise<Record<string, unknown>> {
	log('Detected Windows OS. Redirecting to Windows-specific PowerShell installation flow.');
	const wingetAvailable = await isCommandAvailable('winget', ['--version']);
	if (wingetAvailable) {
		try {
			// Resolve the full path to winget in the current (non-elevated) context so
			// that the elevated Start-Process can find it. winget is a per-user AppX app
			// and the elevated user's PATH typically lacks the WindowsApps folder.
			const psScript = [
				`$winget = (Get-Command winget -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)`,
				`if (-not $winget) { Write-Error 'winget not found'; exit 1 }`,
				`$p = Start-Process -FilePath $winget -ArgumentList @('install','--id','Microsoft.PowerShell','--source','winget','--accept-source-agreements','--accept-package-agreements','--silent') -Verb RunAs -Wait -PassThru`,
				`exit $p.ExitCode`,
			].join('; ');
			const { stdout } = await execFileAsync(
				'powershell.exe',
				['-NoProfile', '-Command', psScript],
				{ cwd: getSafeCwd(), env: withCommonCliPath(), maxBuffer: 50 * 1024 * 1024 }
			);
			log('PowerShell installation completed successfully.');

			return {
				success: true,
				stdout,
				method: 'winget'
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			const details = (err.stderr ?? '').trim() || (err.stdout ?? '').trim() || err.message || 'winget install failed';
			log(`PowerShell installation failed: ${details}`);
			return {
				success: false,
				error: 'install-failed',
				stderr: details
			};
		}
	}

	const chocoAvailable = await isCommandAvailable('choco', ['--version']);
	if (chocoAvailable) {
		try {
			const { stdout } = await execFileAsync('choco', ['install', 'powershell-core', '-y'], {
				cwd: getSafeCwd(),
				env: withCommonCliPath()
			});
			log('PowerShell installation completed successfully.');
			return {
				success: true,
				stdout,
				method: 'choco'
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			return {
				success: false,
				error: 'install-failed',
				stderr: (err.stderr ?? '').trim() || (err.stdout ?? '').trim() || err.message || 'Chocolatey install failed'
			};
		}
	}

	return {
		success: false,
		error: 'package-manager-missing',
		stderr:
			'No supported package manager found. Install App Installer (winget) from Microsoft Store or install Chocolatey, then retry.'
	};
}

async function installAzureCliOnWindows(log: ProgressLogger): Promise<Record<string, unknown>> {
	log('Detected Windows OS. Redirecting to Windows-specific Azure CLI installation flow.');
	const wingetAvailable = await isCommandAvailable('winget', ['--version']);
	if (wingetAvailable) {
		try {
			log('Installing Azure CLI via winget. This may take a minute — a Windows permission prompt (UAC) may appear...');
			// Azure CLI requires a machine-scope MSI install which needs admin rights.
			// Resolve the full path to winget in the current (non-elevated) context so
			// that the elevated Start-Process can find it — winget is a per-user AppX app
			// and the elevated user's PATH typically lacks the WindowsApps folder.
			const psScript = [
				`$winget = (Get-Command winget -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)`,
				`if (-not $winget) { Write-Error 'winget not found'; exit 1 }`,
				`$p = Start-Process -FilePath $winget -ArgumentList @('install','--id','Microsoft.AzureCLI','--source','winget','--accept-source-agreements','--accept-package-agreements','--silent') -Verb RunAs -Wait -PassThru`,
				`exit $p.ExitCode`,
			].join('; ');
			const { stdout } = await execFileAsync(
				'powershell.exe',
				['-NoProfile', '-Command', psScript],
				{ cwd: getSafeCwd(), env: withCommonCliPath(), maxBuffer: 50 * 1024 * 1024 }
			);
			log('Azure CLI installation completed successfully.');
			return {
				success: true,
				stdout,
				method: 'winget'
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			const details = (err.stderr ?? '').trim() || (err.stdout ?? '').trim() || err.message || 'winget install failed';
			log(`Azure CLI installation failed: ${details}`);
			return {
				success: false,
				error: 'install-failed',
				stderr: details
			};
		}
	}

	const chocoAvailable = await isCommandAvailable('choco', ['--version']);
	if (chocoAvailable) {
		try {
			const { stdout } = await execFileAsync('choco', ['install', 'azure-cli', '-y'], {
				cwd: getSafeCwd(),
				env: withCommonCliPath()
			});
			return {
				success: true,
				stdout,
				method: 'choco'
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			return {
				success: false,
				error: 'install-failed',
				stderr: (err.stderr ?? '').trim() || (err.stdout ?? '').trim() || err.message || 'Chocolatey install failed'
			};
		}
	}

	return {
		success: false,
		error: 'package-manager-missing',
		stderr:
			'No supported package manager found. Install App Installer (winget) from Microsoft Store or install Chocolatey, then retry.'
	};
}

/**
 * Installs PowerShell on macOS using Homebrew with multiple fallback formulas.
 * Checks for Homebrew availability, then attempts installation using the most common cask method first, followed by alternative formulas if the initial attempt fails.
 * Provides detailed error information if installation fails, including which methods were attempted and their respective error outputs.
 * Note: This installation path is only triggered if the user clicks the "Install PowerShell" button in the UI after a failed login due to missing PowerShell.
 * The main setup flow does not automatically attempt to install PowerShell, but this IPC handler allows the renderer to request installation when the user opts in.
 * This design keeps the installation action user-initiated and separate from the main login flow, while still providing a clear path to resolve the missing PowerShell prerequisite.
 * @returns An object indicating success or failure, along with any relevant output or error details.
 * @throws An error if the installation process encounters an unexpected failure, which should be handled by the caller to inform the user.
 */
export async function installPowerShell(log: ProgressLogger): Promise<Record<string, unknown>> {
	if (process.platform === 'win32') {
		return installPowerShellOnWindows(log);
	}

	if (process.platform !== 'darwin') {
		log('Unsupported OS for automatic PowerShell installation. This feature is only available on Windows and macOS.');
		return { success: false, error: 'unsupported-platform' };
	}

	try {
		log('Checking Homebrew availability...');
		await execFileAsync('brew', ['--version'], { cwd: getSafeCwd(), env: withCommonCliPath() });
		log('Homebrew is available. Proceeding with PowerShell installation...');
	} catch {
		log('Homebrew is not installed. Install Homebrew from https://brew.sh and try again.');
		return {
			success: false,
			error: 'brew-missing',
			stderr: 'Homebrew is not installed. Install Homebrew from https://brew.sh and try again.'
		};
	}

	const brewEnv = {
		...withCommonCliPath(),
		HOMEBREW_NO_AUTO_UPDATE: '1',
		HOMEBREW_NO_ENV_HINTS: '1'
	};

	const attempts: Array<{ label: string; args: string[] }> = [
		{ label: 'brew cask', args: ['install', '--cask', 'powershell'] },
		{ label: 'tap formula', args: ['install', 'powershell/tap/powershell'] },
		{ label: 'formula', args: ['install', 'powershell'] }
	];

	const errors: string[] = [];
	for (const attempt of attempts) {
		try {
			log(`Attempting PowerShell installation using ${attempt.label} method...`);
			const { stdout } = await execFileAsync('brew', attempt.args, {
				cwd: getSafeCwd(),
				env: brewEnv
			});
			log(`PowerShell installation succeeded using ${attempt.label} method.`);
			return {
				success: true,
				stdout,
				method: attempt.label
			};
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			const stderr = (err.stderr ?? '').trim();
			const stdout = (err.stdout ?? '').trim();
			const details = stderr || stdout || err.message || 'Unknown Homebrew error';
			errors.push(`${attempt.label}: ${details}`);
		}
	}

	log('All Homebrew installation attempts failed. See error details for more information.');

	return {
		success: false,
		error: 'install-failed',
		stderr: errors.join('\n\n')
	};
}

export async function installHomebrew(log: ProgressLogger): Promise<Record<string, unknown>> {
	if (process.platform !== 'darwin') {
		return {
			success: false,
			error: 'unsupported-platform',
			stderr: 'Automatic Homebrew install is supported on macOS only.'
		};
	}

	try {
		await execFileAsync('brew', ['--version'], { cwd: getSafeCwd(), env: withCommonCliPath() });
		log('Homebrew is already installed.');
		return {
			success: true,
			message: 'Homebrew is already installed.'
		};
	} catch {
		log('Homebrew was not found. Starting Homebrew installation...');
	}

	try {
		const { stdout, stderr } = await execFileAsync('/bin/bash', ['-c', HOMEBREW_INSTALL_COMMAND], {
			cwd: getSafeCwd(),
			env: withCommonCliPath()
		});

		await execFileAsync('brew', ['--version'], { cwd: getSafeCwd(), env: withCommonCliPath() });
		log('Homebrew installation completed successfully.');
		return {
			success: true,
			stdout: [stdout, stderr].filter(Boolean).join('\n').trim(),
			method: 'official-install-script'
		};
	} catch (error) {
		const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
		const details = (err.stderr ?? '').trim() || (err.stdout ?? '').trim() || err.message || 'Homebrew install failed';
		log(`Homebrew installation failed in app context. Falling back to interactive Terminal flow. Details: ${details}`);

		try {
			const terminalScript = `${HOMEBREW_INSTALL_COMMAND_INTERACTIVE}; echo; echo \"If installation completed successfully, return to the app and retry.\"`;
			const escapedTerminalScript = escapeForAppleScript(terminalScript);

			await execFileAsync(
				'osascript',
				[
					'-e',
					'tell application "Terminal" to activate',
					'-e',
					`tell application "Terminal" to do script "${escapedTerminalScript}"`
				],
				{ cwd: getSafeCwd(), env: withCommonCliPath() }
			);

			log('Started Homebrew installation in Terminal. Complete it there, then retry app installation.');
			return {
				success: true,
				pending: true,
				method: 'terminal-interactive',
				message: 'Opened Terminal and started Homebrew installer. Complete it there, then return to the app and retry.'
			};
		} catch (terminalError) {
			const terminalErr = terminalError as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
			const terminalDetails = (terminalErr.stderr ?? '').trim() || (terminalErr.stdout ?? '').trim() || terminalErr.message || 'Failed to open Terminal for interactive Homebrew install';
			log('Homebrew installation failed. Unable to start Terminal fallback.');
			return {
				success: false,
				error: 'homebrew-install-failed',
				stderr: `${details}\n\nTerminal fallback error: ${terminalDetails}\n\nInstall manually from https://brew.sh and retry.`
			};
		}
	}
}

/**
 * Handles the installation of Azure CLI on macOS using Homebrew. Verifies Homebrew availability and attempts installation.
 * Provides detailed error information if installation fails.
 * Note: This installation path is only triggered if the user clicks the "Install Azure CLI" button in the UI after a failed login due to missing Azure CLI.
 * The main setup flow does not automatically attempt to install Azure CLI, but this IPC handler allows the renderer to request installation when the user opts in.
 * This design keeps the installation action user-initiated and separate from the main login flow, while still providing a clear path to resolve the missing Azure CLI prerequisite.
 * @returns An object indicating success or failure, along with any relevant output or error details.
 * @throws An error if the installation process encounters an unexpected failure, which should be handled by the caller to inform the user.
 */
export async function installAzureCli(log: ProgressLogger): Promise<Record<string, unknown>> {
	if (process.platform === 'win32') {
		return installAzureCliOnWindows(log);
	}

	if (process.platform !== 'darwin') {
		log('Unsupported OS for automatic Azure CLI installation. This feature is only available on Windows and macOS.');
		return { success: false, error: 'unsupported-platform' };
	}

	try {
		await execFileAsync('brew', ['--version'], { cwd: getSafeCwd(), env: withCommonCliPath() });
	} catch {
		log('Homebrew is not installed. Install Homebrew from https://brew.sh and try again.');
		return {
			success: false,
			error: 'brew-missing',
			stderr: 'Homebrew is not installed. Install Homebrew from https://brew.sh and try again.'
		};
	}

	const brewEnv = {
		...withCommonCliPath(),
		HOMEBREW_NO_AUTO_UPDATE: '1',
		HOMEBREW_NO_ENV_HINTS: '1'
	};

	try {
		log('Homebrew is available. Proceeding with Azure CLI installation...');
		const { stdout } = await execFileAsync('brew', ['install', 'azure-cli'], {
			cwd: getSafeCwd(),
			env: brewEnv
		});
		log('Azure CLI installation completed successfully.');
		return {
			success: true,
			stdout,
			method: 'brew formula'
		};
	} catch (error: any) {
		// Capture detailed error information to provide better feedback to the user about why the installation failed.
		const err = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
		const stderr = (err.stderr ?? '').trim();
		const stdout = (err.stdout ?? '').trim();
		const details = stderr || stdout || err.message || 'Unknown Homebrew error';

		log('Azure CLI installation failed. See error details for more information.');

		return {
			success: false,
			error: 'install-failed',
			stderr: details
		};
	}
}

// Backward-compatible exports for existing imports.
export const installPowerShellOnMac = installPowerShell;
export const installAzureCliOnMac = installAzureCli;
