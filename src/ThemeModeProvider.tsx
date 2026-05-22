import { createContext, useContext, useMemo } from 'react';
import CssBaseline from '@mui/material/CssBaseline';
import {
    Experimental_CssVarsProvider as CssVarsProvider,
    useColorScheme,
} from '@mui/material/styles';
import type { PropsWithChildren } from 'react';
import { appTheme } from './theme';

type AppColorMode = 'light' | 'dark';

type ThemeModeContextValue = {
    mode: AppColorMode;
    toggleMode: () => void;
};

const ThemeModeContext = createContext<ThemeModeContextValue | undefined>(undefined);

function ThemeModeBridge({ children }: PropsWithChildren): JSX.Element {
    const { mode, systemMode, setMode } = useColorScheme();

    const resolvedMode = useMemo<AppColorMode>(() => {
        if (mode === 'dark' || mode === 'light') {
            return mode;
        }

        return systemMode === 'dark' ? 'dark' : 'light';
    }, [mode, systemMode]);

    const value = useMemo<ThemeModeContextValue>(() => {
        return {
            mode: resolvedMode,
            toggleMode: () => setMode(resolvedMode === 'dark' ? 'light' : 'dark'),
        };
    }, [resolvedMode, setMode]);

    return <ThemeModeContext.Provider value={value}>{children}</ThemeModeContext.Provider>;
}

export function AppThemeProvider({ children }: PropsWithChildren): JSX.Element {
    return (
        <CssVarsProvider
            defaultMode="light" // "light" | "dark" | "system"
            modeStorageKey="teams-setup-theme"
            theme={appTheme}
        >
            <CssBaseline enableColorScheme />
            <ThemeModeBridge>{children}</ThemeModeBridge>
        </CssVarsProvider>
    );
}

export function useAppThemeMode(): ThemeModeContextValue {
    const context = useContext(ThemeModeContext);
    if (!context) {
        throw new Error('useAppThemeMode must be used within AppThemeProvider.');
    }

    return context;
}
