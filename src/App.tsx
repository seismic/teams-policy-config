import { useEffect, useMemo, useRef, useState } from 'react';
import Button from './components/Button';
import Stepper from './components/Stepper';
import { IconButton, Tooltip } from '@mui/material';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { AzureLoginStep, CompleteStep, StartSetupStep, GrantPolicyStep, ReviewStep } from './Steps';
import { POLICY_TARGET_TYPE } from './policyTypes';

enum WizardStep {
  SetupEnvironment = 0,
  AzureLogin = 1,
  GrantPolicy = 2,
  Review = 3,
  Finish = 4
}

const LAST_WIZARD_STEP = WizardStep.Review;
const WIZARD_STEP_LABELS = ['Setup Environment', 'Azure Login', 'Grant Policy', 'Review', 'Complete'];
const DOT_STEPS_TOTAL = 4;

type UserGrantDetail = {
  user: string;
  policyName: string;
  status: 'applied-target-policy' | 'added-app-id-existing-policy' | 'skipped-already-has-app-id';
  message: string;
};

type GrantPolicyResultData = {
  targetType?: string;
  policyName?: string;
  details?: UserGrantDetail[];
  targets?: string[];
};

export default function App() {
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [installingPowerShell, setInstallingPowerShell] = useState(false);
  const [installingAzure, setInstallingAzure] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [usersTotal, setUsersTotal] = useState<number>(0);
  const [groupsTotal, setGroupsTotal] = useState<number>(0);
  const [showInstallAzureButton, setShowInstallAzureButton] = useState(false);
  const [showInstallPowerShellButton, setShowInstallPowerShellButton] = useState(false);

  const [currentStep, setCurrentStep] = useState<WizardStep>(WizardStep.SetupEnvironment);
  const [isStepLoading, setIsStepLoading] = useState(false);
  const [azureDeviceCode, setAzureDeviceCode] = useState<string | null>(null);
  const [isPowerShellInstalled, setIsPowerShellInstalled] = useState(false);
  const [isAzureCLIInstalled, setIsAzureCLIInstalled] = useState(false);

  const [isEnvironmentSetupComplete, setIsEnvironmentSetupComplete] = useState(false);
  const [isAzureLoginComplete, setIsAzureLoginComplete] = useState(false);
  const [isGrantPolicyComplete, setIsGrantPolicyComplete] = useState(false);
  const [isGrantSubmitting, setIsGrantSubmitting] = useState<boolean>(false);
  const [grantPolicyResult, setGrantPolicyResult] = useState<GrantPolicyResultData | null>(null);
  const [grantPolicyValues, setGrantPolicyValues] = useState<any>({
    policyName: '',
    appId: '',
    type: POLICY_TARGET_TYPE.USER,
    users: [],
    groups: [],
  });

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (stepHeadingRef.current) {
      stepHeadingRef.current.focus();
    }
  }, [currentStep]);

  useEffect(() => {
    if (logsContainerRef.current) {
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      });
    }
  }, [logs]);

  const stepValidation = useMemo(() => {
    const step1Valid = isEnvironmentSetupComplete;
    const step2Valid = isAzureLoginComplete;
    const hasPolicyName = typeof grantPolicyValues?.policyName === 'string' && grantPolicyValues.policyName.trim().length > 0;
    const selectedType = grantPolicyValues?.type;
    const hasUserSelection = Array.isArray(grantPolicyValues?.users) && grantPolicyValues.users.length > 0;
    const hasGroupSelection = Array.isArray(grantPolicyValues?.groups) && grantPolicyValues.groups.length > 0;
    const isGrantPolicyReady =
      hasPolicyName &&
      (
        selectedType === POLICY_TARGET_TYPE.GLOBAL ||
        (selectedType === POLICY_TARGET_TYPE.USER && hasUserSelection) ||
        (selectedType === POLICY_TARGET_TYPE.GROUP && hasGroupSelection)
      );
    const step3Valid = isGrantPolicyComplete || isGrantPolicyReady;
    const step4Valid = true; // Review is always valid — it's read-only
    return [step1Valid, step2Valid, step3Valid, step4Valid];
  }, [isEnvironmentSetupComplete, isAzureLoginComplete, isGrantPolicyComplete, grantPolicyValues]);

  const isCurrentStepValid = stepValidation[currentStep];
  const isLastStep = currentStep === LAST_WIZARD_STEP;

  const goNext = async (skipValidation?: boolean | undefined) => {
    console.log('Go next clicked. Current step:', currentStep, 'Is current step valid?', isCurrentStepValid);
    console.log('Step validation states:', stepValidation);
    if (!isCurrentStepValid && !skipValidation) return;

    console.log('Proceeding to next step... isLastStep?', isLastStep);
    if (isLastStep) {
      await onGrantPolicy(grantPolicyValues);
      return;
    }

    console.log('Moving to next step:', Math.min(currentStep + 1, LAST_WIZARD_STEP));
    setCurrentStep((prev) => Math.min(prev + 1, LAST_WIZARD_STEP) as WizardStep);
  };

  const goBack = () => {
    if (isStepLoading) return;
    setCurrentStep((prev) => {
      if (prev === WizardStep.SetupEnvironment) return prev;
      return Math.max(WizardStep.SetupEnvironment, prev - 1) as WizardStep;
    });
  };

  const goToFirstStep = () => {
    if (isStepLoading) return;

    // Reset all state to initial values
    setCurrentStep(WizardStep.SetupEnvironment);
    setMessage('');
    setIsEnvironmentSetupComplete(false);
    setIsAzureLoginComplete(false);
    setIsGrantPolicyComplete(false);
    setGrantPolicyValues({
      policyName: '',
      appId: '',
      type: POLICY_TARGET_TYPE.USER,
      users: [],
      groups: [],
    });
  };

  const onGetStarted = async (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    setMessage('');
    setIsStepLoading(true);
    setIsLoading(true);
    setLogs((prev) => [...prev, 'Starting operation...']);

    try {
      const result = await window.electronAPI.setupEnvironment();
      if (result.success) {
        setMessage(result.message || 'Environment setup completed successfully.');
        setShowInstallPowerShellButton(false);
        setShowInstallAzureButton(false);
        setIsEnvironmentSetupComplete(true);
      } else if (result.error === 'prerequisites-missing') {
        const missingPowerShell = !!result.missingPowerShell;
        const missingAzCli = !!result.missingAzCli;

        setShowInstallPowerShellButton(missingPowerShell);
        setShowInstallAzureButton(missingAzCli);

        if (missingPowerShell) {
          setIsPowerShellInstalled(false);
        }
        if (missingAzCli) {
          setIsAzureCLIInstalled(false);
        }

        if (result.platform === 'darwin' || result.platform === 'win32') {
          setMessage('PowerShell and Azure CLI are not installed. Please install both to continue.');
        } else {
          setMessage('PowerShell and Azure CLI are not installed. Install both and try again.');
        }
      } else if (result.error === 'powershell-missing') {
        setShowInstallPowerShellButton(true);
        setShowInstallAzureButton(false);
        setIsPowerShellInstalled(false);
        let installMsg = '';
        if (result.platform === 'darwin') {
          installMsg = 'PowerShell is not installed.';
        } else if (result.platform === 'win32') {
          installMsg = 'PowerShell is not installed. Click below to install PowerShell.';
        } else if (result.platform === 'linux') {
          installMsg = 'PowerShell is not installed. See https://docs.microsoft.com/powershell/scripting/install/installing-powershell for instructions.';
        } else {
          installMsg = 'PowerShell is not installed on your system.';
        }
        setMessage(installMsg);
      } else if (result.error === 'az-missing') {
        setShowInstallPowerShellButton(false);
        setShowInstallAzureButton(true);
        setIsAzureCLIInstalled(false);
        if (result.platform === 'darwin') {
          setMessage('Azure CLI (az) is not installed or not available in PATH. Click below to install Azure CLI with Homebrew.');
        } else if (result.platform === 'win32') {
          setMessage('Azure CLI (az) is not installed or not available in PATH. Click below to install Azure CLI.');
        } else if (result.platform === 'linux') {
          setMessage('Azure CLI (az) is not installed or not available in PATH. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli-linux and try again.');
        } else {
          setMessage('Azure CLI (az) is not installed or not available in PATH. Install it from https://learn.microsoft.com/cli/azure/install-azure-cli and try again.');
        }
      } else if (result.error === 'az-mfa-required') {
        setMessage('Azure login requires MFA by tenant policy. Please complete the device-code sign-in in the terminal/browser and retry.');
      } else if (result.error === 'az-login-timeout') {
        setMessage(result.message || 'Azure login timed out. Retry and complete device-code sign-in promptly.');
      } else if (result.error === 'az-login-failed') {
        const details = result.message ? ` Details: ${result.message}` : '';
        setMessage(`Azure login failed.${details}`);
        if (result.message) {
          setLogs((prev) => [...prev.slice(-79), `Error details: ${result.message}`]);
        }
      } else if (result.error === 'ps-module-install-failed') {
        const details = result.message ? ` Details: ${result.message}` : '';
        setMessage(`Required PowerShell module installation failed.${details}`);
        if (result.message) {
          setLogs((prev) => [...prev.slice(-79), `Module install error: ${result.message}`]);
        }
      } else {
        setMessage('Failed: Unknown error.');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred';
      setLogs((prev) => [...prev.slice(-79), `Error: ${errorMessage}`]);
      setMessage(`Failed: ${errorMessage}`);
    } finally {
      setIsStepLoading(false);
      setIsLoading(false);
    }
  };

  const onAzureLogin = async () => {
    setMessage('');
    setAzureDeviceCode(null);
    setIsStepLoading(true);
    setIsLoading(true);
    setLogs((prev) => [...prev, 'Starting Azure login...']);

    try {
      const result = await window.electronAPI.startAzLogin();
      console.log('Setup result:', result);

      if (result.success) {
        // Store data
        setUsers([]);
        setGroups([]);
        setUsersTotal(0);
        setGroupsTotal(0);

        if (result?.data?.users) {
          const mappedUsers = result?.data?.users.map((user: any) => ({
            label: user.DisplayName,
            value: user.UserPrincipalName,
          }));
          setUsers(mappedUsers);
          setUsersTotal(typeof result?.data?.usersTotal === 'number' ? result.data.usersTotal : mappedUsers.length);
        }

        if (result?.data?.groups) {
          const mappedGroups = result?.data?.groups.map((group: any) => ({
            value: group.Id,
            label: group.DisplayName,
          }));
          setGroups(mappedGroups);
          setGroupsTotal(typeof result?.data?.groupsTotal === 'number' ? result.data.groupsTotal : mappedGroups.length);
        }

        const azureParts = [
          result.accountName ? `Account: ${result.accountName}` : '',
          result.userName ? `User: ${result.userName}` : '',
          result.tenantId ? `Tenant: ${result.tenantId}` : ''
        ].filter(Boolean);

        const azureSummary = azureParts.length > 0
          ? `Azure login successful (${azureParts.join(' | ')}).`
          : 'Azure login successful.';
        const tenantOnlySummary = result.tenantOnly
          ? ' No subscription is currently accessible for this account, but tenant-level login succeeded.'
          : '';
        setMessage(`${azureSummary}${tenantOnlySummary}`);
        setIsAzureLoginComplete(true);
        // goNext();
        return;
      }

      if (result.error === 'az-mfa-required') {
        setMessage('Azure login requires MFA by tenant policy. Please complete the device-code sign-in in the terminal/browser and retry.');
      } else if (result.error === 'az-login-timeout') {
        setMessage(result.message || 'Azure login timed out. Retry and complete device-code sign-in promptly.');
      } else if (result.error === 'az-login-failed') {
        const details = result.message ? ` Details: ${result.message}` : '';
        setMessage(`Azure login failed.${details}`);
        if (result.message) {
          setLogs((prev) => [...prev.slice(-79), `Error details: ${result.message}`]);
        }
      } else {
        setMessage(result.message || 'Azure login failed.');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      setMessage(`Azure login failed: ${errorMessage}`);
    } finally {
      setIsStepLoading(false);
      setIsLoading(false);
    }
  };

  /**
  * Handles the installation of Azure CLI on macOS using Homebrew. Prompts the user for confirmation before proceeding, and provides feedback on the installation progress and outcome.
  * @returns {Promise<void>}
  */
  const handleInstallAzureCli = async () => {
    if (!window.confirm('This will run the platform-specific Azure CLI installation command on your system. You may be prompted for your password or approval. Continue?')) {
      return;
    }

    setIsStepLoading(true);
    setInstallingAzure(true);
    setIsAzureCLIInstalled(false);
    setMessage('Installing Azure CLI...');

    try {
      // Install Azure CLI using the exposed API from the preload script
      const result = await (window.electronAPI.installAzureCli?.() ?? Promise.resolve({ success: false, error: 'missing-api' }));
      if (result.success) {
        setMessage('Azure CLI installed successfully!');
        setShowInstallAzureButton(false);
        setIsAzureCLIInstalled(true);

        // Start again to cross the Azure CLI requirement and proceed with login if this was the blocking issue
        onGetStarted();
      } else if (result.error === 'unsupported-platform') {
        setMessage('Automatic install is supported on macOS and Windows only.');
      } else if (result.error === 'brew-missing') {
        const shouldInstallHomebrew = window.confirm(
          'Homebrew is required to install Azure CLI on macOS. Install Homebrew now? This may require your password.'
        );
        if (!shouldInstallHomebrew) {
          setMessage(result.stderr || 'Homebrew is not installed. Install it from https://brew.sh and try again.');
          return;
        }

        setMessage('Installing Homebrew...');
        const brewInstallResult = await (window.electronAPI.installHomebrew?.() ?? Promise.resolve({ success: false, error: 'missing-api' }));
        if (!brewInstallResult.success) {
          setMessage('Homebrew install failed: ' + (brewInstallResult.stderr || brewInstallResult.error || 'Unknown error'));
          return;
        }

        if (brewInstallResult.pending) {
          setMessage(
            brewInstallResult.message ||
            'Homebrew installer started in Terminal. Complete it there, then click Install Azure CLI again.'
          );
          return;
        }

        setMessage('Homebrew installed. Retrying Azure CLI installation...');
        const retryResult = await (window.electronAPI.installAzureCli?.() ?? Promise.resolve({ success: false, error: 'missing-api' }));
        if (retryResult.success) {
          setMessage('Azure CLI installed successfully!');
          setShowInstallAzureButton(false);
          setIsAzureCLIInstalled(true);
          onGetStarted();
          return;
        }

        setMessage('Azure CLI install failed: ' + (retryResult.stderr || retryResult.error || 'Unknown error'));
      } else if (result.error === 'package-manager-missing') {
        setMessage(result.stderr || 'No supported package manager found. Install winget or Chocolatey and try again.');
      } else {
        setMessage('Azure CLI install failed: ' + (result.stderr || result.error || 'Unknown error'));
      }
    } catch (err) {
      setMessage('Azure CLI install failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsStepLoading(false);
      setInstallingAzure(false);
    }
  };

  /**
   * Handles the installation of PowerShell on the user's system using OS-specific package managers. Provides user feedback and error handling for various scenarios.
   * @returns {Promise<void>}
   */
  const handleInstallPowerShell = async () => {
    if (!window.confirm('This will run the platform-specific PowerShell installation command on your system. You may be prompted for your password or approval. Continue?')) {
      return;
    }

    setIsStepLoading(true);
    setInstallingPowerShell(true);
    setIsPowerShellInstalled(false);

    setMessage('Installing PowerShell...');

    try {
      // @ts-ignore
      const result = await (window.electronAPI.installPowerShell?.() ?? window.electronAPI['system:install-powershell']?.());
      if (result.success) {
        setMessage('PowerShell installed successfully!');
        setShowInstallPowerShellButton(false);
        setIsPowerShellInstalled(true);

        // Start again to cross the PowerShell requirement and proceed with login if this was the blocking issue
        onGetStarted();
      } else if (result.error === 'unsupported-platform') {
        setMessage('Automatic install is supported on macOS and Windows only.');
      } else if (result.error === 'brew-missing') {
        const shouldInstallHomebrew = window.confirm(
          'Homebrew is required to install PowerShell on macOS. Install Homebrew now? This may require your password.'
        );
        if (!shouldInstallHomebrew) {
          setMessage(result.stderr || 'Homebrew is not installed. Install it from https://brew.sh and try again.');
          return;
        }

        setMessage('Installing Homebrew...');
        const brewInstallResult = await (window.electronAPI.installHomebrew?.() ?? Promise.resolve({ success: false, error: 'missing-api' }));
        if (!brewInstallResult.success) {
          setMessage('Homebrew install failed: ' + (brewInstallResult.stderr || brewInstallResult.error || 'Unknown error'));
          return;
        }

        if (brewInstallResult.pending) {
          setMessage(
            brewInstallResult.message ||
            'Homebrew installer started in Terminal. Complete it there, then click Install PowerShell again.'
          );
          return;
        }

        setMessage('Homebrew installed. Retrying PowerShell installation...');
        const retryResult = await (window.electronAPI.installPowerShell?.() ?? Promise.resolve({ success: false, error: 'missing-api' }));
        if (retryResult.success) {
          setMessage('PowerShell installed successfully!');
          setShowInstallPowerShellButton(false);
          setIsPowerShellInstalled(true);
          onGetStarted();
          return;
        }

        setMessage('Install failed: ' + (retryResult.stderr || retryResult.error || 'Unknown error'));
      } else if (result.error === 'package-manager-missing') {
        setMessage(result.stderr || 'No supported package manager found. Install winget or Chocolatey and try again.');
      } else {
        setMessage('Install failed: ' + (result.stderr || result.error || 'Unknown error'));
      }
    } catch (err) {
      setMessage('Install failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsStepLoading(false);
      setInstallingPowerShell(false);
    }
  };

  /**
   * Handles the granting of a policy based on the provided values. It constructs the necessary data object and invokes the corresponding API to perform the operation, while managing UI state for loading and completion feedback.
   * @param values 
   */
  const onGrantPolicy = async (values: any) => {
    console.log('Granting policy with values:', values);
    const data = {
      policyName: values.policyName,
      type: values.type,
      users: values.users ? values.users.map((u: any) => u.value) : [],
      groups: values.groups ? values.groups.map((g: any) => g.value) : [],
    };
    // setGrantValues(data);

    setIsGrantSubmitting(true);
    setGrantPolicyResult(null);
    try {
      const result = await window.electronAPI.grantPolicy(data);
      if (result.success) {
        setMessage(result.message || 'Policy granted successfully.');
        const resultData = (result.data as GrantPolicyResultData) || null;
        const groupNames = Array.isArray(values?.groups)
          ? values.groups
            .map((group: any) => typeof group?.label === 'string' ? group.label.trim() : '')
            .filter((label: string) => label.length > 0)
          : [];
        const userNameMap: Record<string, string> = Array.isArray(values?.users)
          ? values.users.reduce((acc: Record<string, string>, u: any) => {
            if (typeof u?.value === 'string' && typeof u?.label === 'string' && u.label.trim()) {
              acc[u.value.toLowerCase()] = u.label.trim();
            }
            return acc;
          }, {})
          : {};
        const mappedResult = resultData?.targetType === POLICY_TARGET_TYPE.GROUP
          ? {
            ...resultData,
            targets: groupNames.length > 0 ? groupNames : resultData.targets,
          }
          : resultData?.targetType === POLICY_TARGET_TYPE.USER
            ? {
              ...resultData,
              details: Array.isArray(resultData.details)
                ? resultData.details.map((d) => ({
                  ...d,
                  user: userNameMap[d.user?.toLowerCase()] ?? d.user,
                }))
                : resultData.details,
              targets: Array.isArray(resultData.targets)
                ? resultData.targets.map((t) => userNameMap[t?.toLowerCase()] ?? t)
                : resultData.targets,
            }
            : resultData;

        setGrantPolicyResult(mappedResult);
        setIsGrantPolicyComplete(true);
        setCurrentStep(WizardStep.Finish);
      } else {
        setMessage(result.message || 'Failed to grant policy.');
      }
    } catch (err) {
      setMessage('Failed to grant policy: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsGrantSubmitting(false);
    }
  }

  useEffect(() => {
    window.electronAPI.clearOperationProgressListeners?.();
    window.electronAPI.onOperationProgress?.(({ timestamp, message }) => {
      const deviceCodeMatch = message.match(/Device code detected:\s*([A-Z0-9-]+)/i)
        || message.match(/Enter this device code in browser:\s*([A-Z0-9-]+)/i);
      if (deviceCodeMatch?.[1]) {
        setAzureDeviceCode(deviceCodeMatch[1]);
      }

      const time = new Date(timestamp).toLocaleTimeString();
      setLogs((prev) => [...prev.slice(-79), `[${time}] ${message}`]);
    });

    return () => {
      window.electronAPI.clearOperationProgressListeners?.();
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="app-container">
        <h1>Apply Microsoft Teams Access Policy</h1>

        <Stepper currentStep={currentStep} totalSteps={DOT_STEPS_TOTAL} />

        <section className="panel" aria-live="polite">
          <h2 ref={stepHeadingRef} className="panel-title">
            {WIZARD_STEP_LABELS[currentStep]}
          </h2>

          {currentStep === WizardStep.SetupEnvironment && (
            <StartSetupStep
              showInstallPowerShellButton={showInstallPowerShellButton}
              showInstallAzureButton={showInstallAzureButton}
              handleInstallPowerShell={handleInstallPowerShell}
              handleInstallAzureCli={handleInstallAzureCli}
              installing={installingPowerShell}
              installingAzure={installingAzure}
              onGetStarted={onGetStarted}
              isPowerShellInstalled={isPowerShellInstalled}
              isAzureCLIInstalled={isAzureCLIInstalled}
            />
          )}

          {currentStep === WizardStep.AzureLogin && (
            <AzureLoginStep
              isValid={stepValidation[WizardStep.AzureLogin]}
              isLoading={isLoading}
              deviceCode={azureDeviceCode}
              onAzureLogin={onAzureLogin}
            />
          )}

          {currentStep === WizardStep.GrantPolicy && (
            <GrantPolicyStep
              isValid={stepValidation[WizardStep.GrantPolicy]}
              users={users}
              groups={groups}
              usersTotal={usersTotal}
              groupsTotal={groupsTotal}
              onValuesChange={setGrantPolicyValues}
              isSubmitting={isGrantSubmitting}
              initialType={grantPolicyValues.type}
              initialUsers={grantPolicyValues.users}
              initialGroups={grantPolicyValues.groups}
            />
          )}

          {currentStep === WizardStep.Review && (
            <ReviewStep
              policyName={grantPolicyValues.policyName}
              type={grantPolicyValues.type}
              users={grantPolicyValues.users ?? []}
              groups={grantPolicyValues.groups ?? []}
            />
          )}

          {currentStep === WizardStep.Finish && (
            <CompleteStep
              onCompleted={() => { }}
              isValid={stepValidation[WizardStep.Finish]}
              grantResult={grantPolicyResult}
            />
          )}
        </section>

        <hr />

        <div className="actions" aria-label="Wizard navigation">
          {currentStep === WizardStep.Finish ? (
            <Button variant="contained" onClick={goToFirstStep}>
              Restart
            </Button>
          ) : (
            <>
              <Button
                variant="outlined"
                onClick={goBack}
                disabled={currentStep === WizardStep.SetupEnvironment || isStepLoading}
              >
                Back
              </Button>
              <Button
                variant="contained"
                onClick={() => goNext(false)}
                disabled={!isCurrentStepValid || isStepLoading || isGrantSubmitting}
              >
                {(isStepLoading || isGrantSubmitting)
                  ? 'Processing...'
                  : isLastStep
                    ? 'Finish'
                    : 'Next'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Operation Logs */}
      <div className="logs" role="status" aria-live="polite">
        <div className="logs-header">
          <h3>Operation Logs</h3>
          <Tooltip title="Open the logs folder to view saved operation logs" arrow>
            <IconButton
              size="small"
              title="Open logs folder"
              aria-label="Open logs folder"
              onClick={() => window.electronAPI.openLogsFolder?.()}
            >
              <FolderOpenIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
        <div ref={logsContainerRef} className="logs-body">
          <pre>{logs.join('\n')}</pre>
        </div>
      </div>
    </div>
  );
};