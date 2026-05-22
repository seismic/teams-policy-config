import CheckCircleIcon from '@mui/icons-material/CheckCircle';

type SuccessIndicatorProps = {
    text: string;
};

export default function SuccessIndicator({ text }: SuccessIndicatorProps) {
    return (
        <span className="success-indicator">
            <CheckCircleIcon fontSize="small" />
            {text}
        </span>
    );
}
