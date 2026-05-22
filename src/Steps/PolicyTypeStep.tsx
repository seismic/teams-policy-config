import Radio from '@mui/material/Radio';

type PolicyTypeStepProps = {
    policyType: string;
    isValid: boolean;
    onPolicyTypeChange: (value: string) => void;
};

export default function PolicyTypeStep({ policyType, isValid, onPolicyTypeChange }: PolicyTypeStepProps) {
    return (
        <div className="step-content">
            <p className="label">Choose policy type</p>
            <label className="radio-row">
                <Radio
                    checked={policyType === 'monthly'}
                    onChange={() => onPolicyTypeChange('monthly')}
                />
                <span>Monthly</span>
            </label>
            <label className="radio-row">
                <Radio
                    checked={policyType === 'yearly'}
                    onChange={() => onPolicyTypeChange('yearly')}
                />
                <span>Yearly</span>
            </label>
            {!isValid && (
                <p className="error-text" role="alert">Please choose a policy type.</p>
            )}
        </div>
    );
}