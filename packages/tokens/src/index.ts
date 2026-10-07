/**
 * Elixir POS semantic design tokens (Design System §5–7, §81).
 * Components consume semantic roles only — never raw palette values.
 */
export const palette = {
  navy950: '#0b1424',
  navy900: '#111c30',
  navy800: '#1a2742',
  navy700: '#263656',
  navy600: '#344770',
  gray25: '#fafbfc',
  gray50: '#f4f6f9',
  gray100: '#eceff4',
  gray200: '#dfe3ea',
  gray300: '#c9cfd9',
  gray400: '#9aa3b2',
  gray500: '#6b7485',
  gray600: '#525a6a',
  gray700: '#3a4150',
  gray900: '#141821',
  white: '#ffffff',
  green600: '#14804a',
  green50: '#e8f6ee',
  amber600: '#b25e09',
  amber50: '#fdf3e4',
  red600: '#c8322f',
  red50: '#fcebea',
  blue600: '#2563c9',
  blue50: '#e9f0fc',
} as const;

export const lightColors = {
  surface: {
    app: palette.gray50,
    primary: palette.white,
    secondary: palette.gray25,
    elevated: palette.white,
    selected: '#eef2f8',
    sunken: palette.gray100,
  },
  text: {
    primary: palette.gray900,
    secondary: palette.gray600,
    muted: palette.gray500,
    inverse: palette.white,
  },
  border: {
    default: palette.gray200,
    strong: palette.gray300,
    focus: palette.blue600,
  },
  action: {
    primary: palette.navy900,
    primaryHover: palette.navy700,
    secondary: palette.white,
    disabled: palette.gray300,
  },
  status: {
    success: palette.green600,
    successSoft: palette.green50,
    warning: palette.amber600,
    warningSoft: palette.amber50,
    danger: palette.red600,
    dangerSoft: palette.red50,
    info: palette.blue600,
    infoSoft: palette.blue50,
  },
  sync: {
    online: palette.green600,
    offline: palette.gray500,
    pending: palette.amber600,
    error: palette.red600,
  },
} as const;

export const darkColors = {
  surface: {
    app: '#0d121b',
    primary: '#151b26',
    secondary: '#111722',
    elevated: '#1b2230',
    selected: '#1f2a3d',
    sunken: '#0a0e15',
  },
  text: {
    primary: '#e9edf3',
    secondary: '#aab3c2',
    muted: '#808a9b',
    inverse: '#0d121b',
  },
  border: {
    default: '#262f3e',
    strong: '#344055',
    focus: '#6b9cf0',
  },
  action: {
    primary: '#e4eaf4',
    primaryHover: '#ffffff',
    secondary: '#151b26',
    disabled: '#344055',
  },
  status: {
    success: '#46c07f',
    successSoft: '#123222',
    warning: '#e6a147',
    warningSoft: '#352710',
    danger: '#f06b67',
    dangerSoft: '#3a1716',
    info: '#6b9cf0',
    infoSoft: '#15264a',
  },
  sync: {
    online: '#46c07f',
    offline: '#808a9b',
    pending: '#e6a147',
    error: '#f06b67',
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48 } as const;
export const radius = { sm: 6, md: 8, lg: 12, xl: 16, pill: 999 } as const;
export const fontSize = { xs: 12, sm: 13, md: 14, lg: 16, xl: 18, '2xl': 22, '3xl': 28, '4xl': 36 } as const;
export const lineHeight = { xs: 16, sm: 18, md: 20, lg: 22, xl: 24, '2xl': 28, '3xl': 34, '4xl': 42 } as const;
export const fontFamily =
  'Inter, "Noto Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const touchTarget = { min: 44, pos: 48 } as const;
export const motion = { fast: 120, base: 180, slow: 220 } as const;
export const breakpoints = { tablet: 640, compact: 1024, desktop: 1280, wide: 1600 } as const;

export const tokens = {
  color: lightColors,
  dark: darkColors,
  spacing,
  radius,
  fontSize,
  lineHeight,
  fontFamily,
  touchTarget,
  motion,
  breakpoints,
};
export type DesignTokens = typeof tokens;
