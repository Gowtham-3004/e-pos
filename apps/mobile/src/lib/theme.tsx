import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, fontSize, lightColors, lineHeight, radius, spacing, touchTarget } from '@elixir/tokens';
import type { Tone } from '@elixir/domain';

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Palette = Widen<typeof lightColors>;
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Theme {
  dark: boolean;
  c: Palette;
  space: typeof spacing;
  radius: typeof radius;
  fs: typeof fontSize;
  lh: typeof lineHeight;
  touch: typeof touchTarget;
  tone: (t: Tone) => { fg: string; bg: string };
}

function makeTheme(dark: boolean): Theme {
  const c: Palette = dark ? darkColors : lightColors;
  return {
    dark,
    c,
    space: spacing,
    radius,
    fs: fontSize,
    lh: lineHeight,
    touch: touchTarget,
    tone: (t) => {
      switch (t) {
        case 'success':
          return { fg: c.status.success, bg: c.status.successSoft };
        case 'warning':
          return { fg: c.status.warning, bg: c.status.warningSoft };
        case 'danger':
          return { fg: c.status.danger, bg: c.status.dangerSoft };
        case 'info':
          return { fg: c.status.info, bg: c.status.infoSoft };
        default:
          return { fg: c.text.secondary, bg: c.surface.sunken };
      }
    },
  };
}

const LIGHT = makeTheme(false);
const DARK = makeTheme(true);

const Ctx = createContext<{ theme: Theme; mode: ThemeMode; setMode: (m: ThemeMode) => void }>({ theme: LIGHT, mode: 'light', setMode: () => {} });
const KEY = 'elixir-mobile:theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('light');
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => v && setModeState(v as ThemeMode))
      .catch(() => undefined);
  }, []);
  const value = useMemo(() => {
    const dark = mode === 'dark' || (mode === 'system' && system === 'dark');
    return {
      theme: dark ? DARK : LIGHT,
      mode,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        AsyncStorage.setItem(KEY, m).catch(() => undefined);
      },
    };
  }, [mode, system]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx).theme;
export const useThemeMode = () => useContext(Ctx);
