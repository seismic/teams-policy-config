import { useEffect } from 'react';
import Button from '../components/Button';
import SuccessIndicator from '../components/SuccessIndicator';

type StartSetupStepProps = {
    onGetStarted: () => void;
    showInstallPowerShellButton: boolean;
    showInstallAzureButton: boolean;
    handleInstallPowerShell: () => void;
    handleInstallAzureCli: () => void;
    installing: boolean;
    installingAzure: boolean;
    isPowerShellInstalled?: boolean;
    isAzureCLIInstalled?: boolean;
};

const TECHNICAL_DOCUMENTATION_LINK =
    import.meta.env.VITE_TECHNICAL_DOCUMENTATION_LINK?.trim() || 'https://docs.microsoft.com/en-us/azure/azure-cli-install';

/**
 * This component represents the first step of the setup wizard, where we check if the user's environment meets the necessary requirements to connect Microsoft Teams. It provides buttons to install PowerShell and Azure CLI if they are not already installed, and it automatically triggers an environment check when the component mounts.
 * @returns 
 */
export default function StartSetupStep({
    onGetStarted,
    showInstallPowerShellButton,
    showInstallAzureButton,
    handleInstallPowerShell,
    handleInstallAzureCli,
    installing,
    installingAzure,
    isPowerShellInstalled,
    isAzureCLIInstalled,
}: StartSetupStepProps) {
    const showPowerShellInstalled = isPowerShellInstalled === true;
    const showAzureInstalled = isAzureCLIInstalled === true;
    const showActions =
        showInstallPowerShellButton ||
        showInstallAzureButton ||
        showPowerShellInstalled === true ||
        showAzureInstalled === true;

    /**
     * Automatically trigger the environment check when the component mounts. This will determine if the "Get Started" button should be enabled or if installation buttons should be shown.
     */
    useEffect(() => {
        onGetStarted();
    }, []);

    return (
        <div className="step-content">
            <div>
                To use this app and connect to Microsoft Teams, ensure Azure CLI is installed. If you are not permitted to use Azure CLI, you can follow these manual steps within the <a href={TECHNICAL_DOCUMENTATION_LINK} target="_blank" rel="noopener noreferrer">technical documentation</a>.
            </div>

            {/* Install PowerShell and Azure CLI buttons */}
            {
                showActions &&
                <div className="step-action-buttons">
                    {showInstallPowerShellButton && (
                        <Button
                            onClick={handleInstallPowerShell}
                            disabled={installing || installingAzure}
                            variant="outlined"
                            size="small"
                        >
                            {installing ? 'Installing PowerShell...' : 'Install PowerShell'}
                        </Button>
                    )}
                    {showInstallAzureButton && (
                        <Button
                            onClick={handleInstallAzureCli}
                            disabled={installing || installingAzure}
                            variant="outlined"
                            size="small"
                        >
                            {installingAzure ? 'Installing Azure CLI...' : 'Install Azure CLI'}
                        </Button>
                    )}
                    {showPowerShellInstalled === true && (
                        <SuccessIndicator text="PowerShell successfully installed" />
                    )}
                    {showAzureInstalled === true && (
                        <SuccessIndicator text="Azure CLI successfully installed" />
                    )}
                </div>
            }
        </div>
    );
}