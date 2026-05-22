import {
    experimental_extendTheme as extendTheme,
} from '@mui/material/styles';
import type { PaletteMode } from '@mui/material';

const commonTypography = {
    fontFamily: '"Segoe UI Variable", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: 16,
    h1: {
        fontSize: '45px',
        fontWeight: 600,
        lineHeight: '52px',
    },
    h2: {
        fontSize: '32px',
        fontWeight: 600,
        lineHeight: '40px',
    },
    h3: {
        fontSize: '22px',
        fontWeight: 600,
        lineHeight: '28px',
    },
    body1: {
        fontSize: '16px',
        lineHeight: '24px',
    },
    body2: {
        fontSize: '14px',
        lineHeight: '21px',
    },
    button: {
        fontSize: '14px',
        fontWeight: 600,
        textTransform: 'none' as const,
        letterSpacing: '0.01em',
    },
};

const getModePalette = (mode: PaletteMode) => {
    if (mode === 'dark') {
        return {
            primary: {
                main: '#90caf9',
                dark: '#42a5f5',
                light: '#e3f2fd',
                contrastText: '#242424',
            },
            secondary: {
                main: '#4fd1c5',
                dark: '#2c7a7b',
                light: '#b2f5ea',
                contrastText: '#071a1a',
            },
            success: {
                main: '#34d399',
            },
            warning: {
                main: '#fbbf24',
            },
            error: {
                main: '#f87171',
            },
            background: {
                default: '#0f172a',
                paper: '#111827',
            },
            text: {
                primary: '#f8fafc',
                secondary: '#cbd5e1',
            },
            divider: '#334155',
        };
    }

    return {
        primary: {
            main: '#005a9e',
            dark: '#004578',
            light: '#cfe8ff',
            contrastText: '#ffffff',
        },
        secondary: {
            main: '#0d9488',
            dark: '#0f766e',
            light: '#ccfbf1',
            contrastText: '#ffffff',
        },
        success: {
            main: '#15803d',
        },
        warning: {
            main: '#b45309',
        },
        error: {
            main: '#b42318',
        },
        background: {
            default: '#F4F6F8',
            paper: '#ffffff',
        },
        text: {
            primary: '#000000',
            secondary: '#334155',
        },
        divider: '#cbd5e1',
    };
};

export const appTheme = extendTheme({
    colorSchemes: {
        light: {
            palette: getModePalette('light'),
        },
        dark: {
            palette: getModePalette('dark'),
        },
    },
    shape: {
        borderRadius: 10,
    },
    typography: commonTypography,
    components: {
        MuiCssBaseline: {
            styleOverrides: {
                ':focus-visible': {
                    outline: '3px solid var(--mui-palette-primary-main)',
                    outlineOffset: '2px',
                    borderRadius: '4px',
                },
                '::selection': {
                    backgroundColor: 'var(--mui-palette-primary-light)',
                    color: 'var(--mui-palette-primary-contrastText)',
                },
            },
        },
        MuiButton: {
            styleOverrides: {
                root: {
                    minHeight: 40,
                },
            },
        },
    },
});
