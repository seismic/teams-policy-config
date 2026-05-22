import { Button } from '@mui/material';

type ButtonProps = {
    onClick: () => void;
    disabled?: boolean;
    variant?: 'text' | 'outlined' | 'contained';
    children: React.ReactNode;
    style?: React.CSSProperties;
    size?: 'small' | 'medium' | 'large';
};

const defaultStyle: React.CSSProperties = {
    minWidth: 0,
    width: 'fit-content',
    alignSelf: 'flex-start',
};

export default function CustomButton({ onClick, disabled = false, variant = 'contained', children, style, ...rest }: ButtonProps) {
    return (
        <Button onClick={onClick} disabled={disabled} variant={variant} style={{ ...defaultStyle, ...style }} {...rest}>
            {children}
        </Button>
    );
}