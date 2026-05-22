import { useEffect, useState } from 'react';
import Button from '../components/Button';
import IconButton from '@mui/material/IconButton';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SuccessIndicator from '../components/SuccessIndicator';

type AzureLoginStepProps = {
    isValid: boolean;
    isLoading: boolean;
    deviceCode?: string | null;
    onAzureLogin: () => void;
};

export default function AzureLoginStep({ isValid, isLoading, deviceCode, onAzureLogin }: AzureLoginStepProps) {
    const [copyStatus, setCopyStatus] = useState('');

    /**
     * Resets the copy status message whenever the device code changes.
     * This ensures that the user receives accurate feedback related to the current device code,
     * especially if a new code is generated during the login process.
     */
    useEffect(() => {
        setCopyStatus('');
    }, [deviceCode]);

    /**
     * Handles copying the device code to the clipboard.
     * Provides user feedback on whether the copy action was successful or if it failed.
     * This is important for improving the user experience, especially since the device code is needed for the Azure login process.
     */
    const onCopyDeviceCode = async () => {
        if (!deviceCode) return;

        try {
            await navigator.clipboard.writeText(deviceCode);
            setCopyStatus('Copied');
        } catch {
            setCopyStatus('Copy failed');
        }
    };

    return (
        <div className="step-content">
            <div>
                Login to Azure to continue with Microsoft Teams policy configuration. Copy the device code and use it to complete the login process.
            </div>
            {deviceCode && !isValid && (
                <div className="device-code-box" role="status" aria-live="polite">
                    <span>Device code: <span className="device-code-value">{deviceCode}</span></span>
                    <IconButton
                        onClick={onCopyDeviceCode}
                        disabled={!deviceCode}
                        size="small"
                        aria-label="Copy device code"
                        sx={{ p: 0.35 }}
                    >
                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                    {copyStatus && <span className="copy-status">{copyStatus}</span>}
                </div>
            )}
            {isValid && (
                <SuccessIndicator text="Login successful" />
            )}
            {!isValid && (
                <Button
                    onClick={onAzureLogin}
                    disabled={isLoading}
                    variant="outlined"
                >
                    {isLoading ? 'Signing in...' : 'Login to Azure'}
                </Button>
            )}
        </div>
    );
}