import './stepper.scss';

type StepperProps = {
    currentStep: number;
    totalSteps: number;
};

export default function Stepper({ currentStep, totalSteps }: StepperProps) {
    const activeIndex = Math.min(Math.max(currentStep, 0), totalSteps - 1);
    const stepLabel = activeIndex + 1;

    return (
        <div className="stepper-wrap">
            <span className="step-chip">Step {stepLabel} of {totalSteps}</span>
            <div className="dot-stepper" role="img" aria-label={`Step ${stepLabel} of ${totalSteps}`}>
                {Array.from({ length: totalSteps }).map((_, index) => (
                    <span
                        key={index}
                        className={`dot ${index === activeIndex ? 'active' : ''}`}
                        aria-hidden="true"
                    />
                ))}
            </div>
        </div>
    );
}
