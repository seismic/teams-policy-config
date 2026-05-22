import MuiTextField, { TextFieldProps } from '@mui/material/TextField';

const rectangularSx = {
    '& .MuiOutlinedInput-root': {
        borderRadius: 0,
    },
};

export default function TextField({ sx, ...rest }: TextFieldProps) {
    const mergedSx = Array.isArray(sx) ? [rectangularSx, ...sx] : [rectangularSx, sx];

    return <MuiTextField {...rest} sx={mergedSx} />;
}
