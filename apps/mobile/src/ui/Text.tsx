import type { ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../lib/theme';

export type TextVariant = 'display' | 'title' | 'h2' | 'h3' | 'body' | 'bodyStrong' | 'meta' | 'label' | 'kpi' | 'overline';
type Color = 'primary' | 'secondary' | 'muted' | 'inverse' | 'success' | 'warning' | 'danger' | 'info' | 'action';

/** Typography from Design System §4: 12 meta · 14 body · 16 card titles · 18 panels · 22–28 titles · 28–36 KPIs. */
export function T({ children, v = 'body', c = 'primary', num, center, lines, style, selectable }: { children?: ReactNode; v?: TextVariant; c?: Color; num?: boolean; center?: boolean; lines?: number; style?: StyleProp<TextStyle>; selectable?: boolean }) {
  const t = useTheme();
  const color = {
    primary: t.c.text.primary, secondary: t.c.text.secondary, muted: t.c.text.muted, inverse: t.c.text.inverse,
    success: t.c.status.success, warning: t.c.status.warning, danger: t.c.status.danger, info: t.c.status.info, action: t.c.action.primary,
  }[c];
  const styles: Record<TextVariant, TextStyle> = {
    display: { fontSize: t.fs['4xl'], lineHeight: t.lh['4xl'], fontWeight: '700', letterSpacing: -0.8 },
    kpi: { fontSize: t.fs['3xl'], lineHeight: t.lh['3xl'], fontWeight: '700', letterSpacing: -0.5 },
    title: { fontSize: t.fs['2xl'], lineHeight: t.lh['2xl'], fontWeight: '700', letterSpacing: -0.3 },
    h2: { fontSize: t.fs.xl, lineHeight: t.lh.xl, fontWeight: '700' },
    h3: { fontSize: t.fs.lg, lineHeight: t.lh.lg, fontWeight: '600' },
    body: { fontSize: t.fs.md, lineHeight: t.lh.md },
    bodyStrong: { fontSize: t.fs.md, lineHeight: t.lh.md, fontWeight: '600' },
    label: { fontSize: t.fs.sm, lineHeight: t.lh.sm, fontWeight: '600' },
    meta: { fontSize: t.fs.xs, lineHeight: t.lh.xs },
    overline: { fontSize: t.fs.xs, lineHeight: t.lh.xs, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  };
  const base = styles[v];
  return (
    <RNText
      selectable={selectable}
      numberOfLines={lines}
      style={[base, { color }, num && { fontVariant: ['tabular-nums'] }, center && { textAlign: 'center' }, style]}
    >
      {children}
    </RNText>
  );
}
