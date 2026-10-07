import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import type { FoodType } from '@elixir/contracts';
import type { StatusMeta, Tone } from '@elixir/domain';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import { T } from './Text';

// ───────────────────────── Button ─────────────────────────

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'success' | 'subtle';

export function Button({
  label, onPress, variant = 'primary', size = 'md', icon, iconRight, loading, disabled, block, style, accessibilityLabel, sublabel,
}: {
  label: string; onPress?: () => void; variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: string; iconRight?: string; loading?: boolean; disabled?: boolean;
  block?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; sublabel?: string;
}) {
  const t = useTheme();
  const height = size === 'lg' ? 56 : size === 'sm' ? 40 : 48;
  const pal: Record<ButtonVariant, { bg: string; fg: string; border: string; pressed: string }> = {
    primary: { bg: t.c.action.primary, fg: t.c.text.inverse, border: t.c.action.primary, pressed: t.c.action.primaryHover },
    secondary: { bg: t.c.surface.primary, fg: t.c.text.primary, border: t.c.border.strong, pressed: t.c.surface.sunken },
    ghost: { bg: 'transparent', fg: t.c.text.primary, border: 'transparent', pressed: t.c.surface.sunken },
    subtle: { bg: t.c.surface.sunken, fg: t.c.text.primary, border: t.c.surface.sunken, pressed: t.c.border.default },
    danger: { bg: t.c.status.danger, fg: '#ffffff', border: t.c.status.danger, pressed: t.c.status.danger },
    'danger-outline': { bg: t.c.surface.primary, fg: t.c.status.danger, border: t.c.status.danger, pressed: t.c.status.dangerSoft },
    success: { bg: t.c.status.success, fg: '#ffffff', border: t.c.status.success, pressed: t.c.status.success },
  };
  const p = pal[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: height, paddingHorizontal: size === 'sm' ? 12 : 16, borderRadius: t.radius.md, borderWidth: 1, borderColor: off && variant === 'primary' ? t.c.action.disabled : p.border,
          backgroundColor: off && variant === 'primary' ? t.c.action.disabled : pressed ? p.pressed : p.bg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          opacity: off && variant !== 'primary' ? 0.5 : pressed && (variant === 'danger' || variant === 'success') ? 0.88 : 1,
        },
        block && { alignSelf: 'stretch' },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={p.fg} /> : icon ? <Icon name={icon} size={size === 'lg' ? 20 : 18} color={p.fg} /> : null}
      <View style={{ alignItems: 'center', flexShrink: 1 }}>
        <T v={size === 'lg' ? 'h3' : 'bodyStrong'} style={{ color: p.fg }} lines={1}>{label}</T>
        {sublabel ? <T v="meta" style={{ color: p.fg, opacity: 0.85 }} num>{sublabel}</T> : null}
      </View>
      {iconRight ? <Icon name={iconRight} size={18} color={p.fg} /> : null}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, size = 44, color, badge, style }: { icon: string; label: string; onPress?: () => void; size?: number; color?: string; badge?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.c.surface.sunken : 'transparent' }, style]}
    >
      <Icon name={icon} size={20} color={color ?? t.c.text.primary} />
      {badge ? <CountBubble n={badge} style={{ position: 'absolute', top: 4, right: 4 }} /> : null}
    </Pressable>
  );
}

export function CountBubble({ n, style }: { n: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: t.c.status.danger, alignItems: 'center', justifyContent: 'center' }, style]}>
      <T v="meta" num style={{ color: '#fff', fontWeight: '700', fontSize: 11, lineHeight: 14 }}>{n > 99 ? '99+' : n}</T>
    </View>
  );
}

// ───────────────────────── Surfaces ─────────────────────────

export function Card({ children, style, onPress, padded = true, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; padded?: boolean; accessibilityLabel?: string }) {
  const t = useTheme();
  const base: ViewStyle = { backgroundColor: t.c.surface.primary, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border.default, padding: padded ? t.space.lg : 0 };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: t.c.surface.selected }, style]}>
      {children}
    </Pressable>
  );
}

export function Divider({ style, inset = 0 }: { style?: StyleProp<ViewStyle>; inset?: number }) {
  const t = useTheme();
  return <View style={[{ height: 1, backgroundColor: t.c.border.default, marginLeft: inset }, style]} />;
}

export function Row({ children, gap = 8, style, align = 'center', justify }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; align?: ViewStyle['alignItems']; justify?: ViewStyle['justifyContent'] }) {
  return <View style={[{ flexDirection: 'row', alignItems: align, gap, justifyContent: justify }, style]}>{children}</View>;
}

export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

export function SectionTitle({ title, action, onAction, count }: { title: string; action?: string; onAction?: () => void; count?: number }) {
  const t = useTheme();
  return (
    <Row style={{ marginTop: t.space.xl, marginBottom: t.space.sm, paddingHorizontal: 2 }}>
      <T v="overline" c="muted">{title}</T>
      {count !== undefined ? <T v="meta" c="muted" num>· {count}</T> : null}
      <Spacer />
      {action ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          <T v="label" c="info">{action}</T>
        </Pressable>
      ) : null}
    </Row>
  );
}

// ───────────────────────── Status ─────────────────────────

export function Badge({ label, tone = 'neutral', icon, size = 'md', style }: { label: string; tone?: Tone; icon?: string; size?: 'sm' | 'md'; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View
      accessibilityLabel={label}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: c.bg, borderRadius: t.radius.pill, paddingHorizontal: size === 'sm' ? 6 : 8, paddingVertical: size === 'sm' ? 1 : 3 }, style]}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 11 : 13} color={c.fg} /> : null}
      <T v="meta" style={{ color: c.fg, fontWeight: '600', fontSize: size === 'sm' ? 11 : 12 }} lines={1}>{label}</T>
    </View>
  );
}

/** Colour + icon + text from a domain StatusMeta (UX-07). */
export function StatusBadge({ meta, size, suffix }: { meta: StatusMeta; size?: 'sm' | 'md'; suffix?: string }) {
  return <Badge label={suffix ? `${meta.label} · ${suffix}` : meta.label} tone={meta.tone} icon={meta.icon} size={size} />;
}

export function InlineAlert({ tone = 'info', title, children, icon, action, onAction, style }: { tone?: Tone; title: string; children?: ReactNode; icon?: string; action?: string; onAction?: () => void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const c = t.tone(tone);
  const ic = icon ?? { success: 'CircleCheck', warning: 'TriangleAlert', danger: 'AlertCircle', info: 'Info', neutral: 'Info' }[tone];
  return (
    <View accessibilityRole="alert" style={[{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: t.radius.md, backgroundColor: c.bg, borderWidth: 1, borderColor: t.dark ? c.bg : `${c.fg}33` }, style]}>
      <View style={{ paddingTop: 1 }}>
        <Icon name={ic} size={18} color={c.fg} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="label" style={{ color: t.dark ? t.c.text.primary : c.fg }}>{title}</T>
        {children ? (typeof children === 'string' ? <T v="meta" c="secondary">{children}</T> : children) : null}
        {action ? (
          <Pressable onPress={onAction} hitSlop={8} style={{ marginTop: 4 }} accessibilityRole="button">
            <T v="label" style={{ color: c.fg, textDecorationLine: 'underline' }}>{action}</T>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function EmptyState({ icon = 'Inbox', title, body, action, onAction, quiet }: { icon?: string; title: string; body?: string; action?: string; onAction?: () => void; quiet?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: quiet ? 24 : 40, paddingHorizontal: 24, gap: 8 }}>
      {!quiet ? (
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: t.c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
          <Icon name={icon} size={24} color={t.c.text.muted} />
        </View>
      ) : null}
      <T v={quiet ? 'body' : 'h3'} c={quiet ? 'muted' : 'primary'} center>{title}</T>
      {body ? <T c="secondary" center>{body}</T> : null}
      {action ? <Button label={action} variant="secondary" onPress={onAction} style={{ marginTop: 8 }} /> : null}
    </View>
  );
}

// ───────────────────────── Selection ─────────────────────────

export function Chip({ label, selected, onPress, count, icon }: { label: string; selected?: boolean; onPress?: () => void; count?: number; icon?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40, paddingHorizontal: 14, borderRadius: t.radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
        borderColor: selected ? t.c.action.primary : t.c.border.default,
        backgroundColor: selected ? t.c.action.primary : pressed ? t.c.surface.sunken : t.c.surface.primary,
      })}
    >
      {icon ? <Icon name={icon} size={14} color={selected ? t.c.text.inverse : t.c.text.secondary} /> : null}
      <T v="label" style={{ color: selected ? t.c.text.inverse : t.c.text.primary }} lines={1}>{label}</T>
      {count !== undefined ? <T v="meta" num style={{ color: selected ? t.c.text.inverse : t.c.text.muted, opacity: 0.85 }}>{count}</T> : null}
    </Pressable>
  );
}

export function ChipRow({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }, style]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

export function Segmented<V extends string>({ value, options, onChange, style }: { value: V; options: Array<{ value: V; label: string; count?: number; icon?: string }>; onChange: (v: V) => void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View accessibilityRole="tablist" style={[{ flexDirection: 'row', backgroundColor: t.c.surface.sunken, borderRadius: t.radius.md, padding: 3, gap: 3 }, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 40, borderRadius: t.radius.sm, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, backgroundColor: on ? t.c.surface.primary : 'transparent', borderWidth: on ? 1 : 0, borderColor: t.c.border.default }}
          >
            {o.icon ? <Icon name={o.icon} size={14} color={on ? t.c.text.primary : t.c.text.secondary} /> : null}
            <T v="label" c={on ? 'primary' : 'secondary'} lines={1}>{o.label}</T>
            {o.count !== undefined && o.count > 0 ? <T v="meta" num c={on ? 'primary' : 'muted'}>{o.count}</T> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({ value, onChange, min = 0, max = 99, size = 48, label = 'Quantity' }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: number; label?: string }) {
  const t = useTheme();
  const btn = (icon: string, delta: number, disabled: boolean, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      disabled={disabled}
      onPress={() => onChange(Math.max(min, Math.min(max, value + delta)))}
      style={({ pressed }) => ({ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.c.surface.sunken : 'transparent', opacity: disabled ? 0.35 : 1 })}
    >
      <Icon name={icon} size={20} color={t.c.text.primary} />
    </Pressable>
  );
  return (
    <View accessibilityLabel={`${label} ${value}`} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.c.border.strong, borderRadius: t.radius.md, backgroundColor: t.c.surface.primary, overflow: 'hidden' }}>
      {btn('Minus', -1, value <= min, `Decrease ${label.toLowerCase()}`)}
      <T v="h3" num style={{ minWidth: 36, textAlign: 'center' }}>{value}</T>
      {btn('Plus', 1, value >= max, `Increase ${label.toLowerCase()}`)}
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder, autoFocus }: { value: string; onChangeText: (s: string) => void; placeholder: string; autoFocus?: boolean }) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: t.radius.md, borderWidth: 1, borderColor: focus ? t.c.border.focus : t.c.border.default, backgroundColor: t.c.surface.primary }}>
      <Icon name="Search" size={18} color={t.c.text.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.c.text.muted}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        accessibilityLabel={placeholder}
        style={{ flex: 1, fontSize: 16, color: t.c.text.primary, paddingVertical: 10, outlineStyle: 'none' } as never}
      />
      {value ? <IconButton icon="X" label="Clear search" size={36} onPress={() => onChangeText('')} /> : null}
    </View>
  );
}

export function TextArea({ value, onChangeText, placeholder, label }: { value: string; onChangeText: (s: string) => void; placeholder?: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T v="label" c="secondary">{label}</T>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.c.text.muted}
        multiline
        accessibilityLabel={label}
        style={{ minHeight: 64, borderWidth: 1, borderColor: t.c.border.default, borderRadius: t.radius.md, padding: 12, fontSize: 15, color: t.c.text.primary, backgroundColor: t.c.surface.primary, textAlignVertical: 'top' }}
      />
    </View>
  );
}

// ───────────────────────── Lists ─────────────────────────

export function ListRow({
  title, subtitle, left, right, onPress, chevron, icon, iconTone, meta, style, disabled,
}: {
  title: string; subtitle?: string; left?: ReactNode; right?: ReactNode; onPress?: () => void; chevron?: boolean; icon?: string; iconTone?: Tone; meta?: ReactNode; style?: StyleProp<ViewStyle>; disabled?: boolean;
}) {
  const t = useTheme();
  const tone = iconTone ? t.tone(iconTone) : { fg: t.c.text.secondary, bg: t.c.surface.sunken };
  const body = (
    <>
      {left ?? (icon ? (
        <View style={{ width: 36, height: 36, borderRadius: t.radius.md, backgroundColor: tone.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={tone.fg} />
        </View>
      ) : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong" lines={2}>{title}</T>
        {subtitle ? <T v="meta" c="secondary" lines={2}>{subtitle}</T> : null}
        {meta}
      </View>
      {right}
      {chevron ? <Icon name="ChevronRight" size={18} color={t.c.text.muted} /> : null}
    </>
  );
  const base: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 };
  if (!onPress) return <View style={[base, style]}>{body}</View>;
  return (
    <Pressable disabled={disabled} accessibilityRole="button" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: t.c.surface.selected }, style]}>
      {body}
    </Pressable>
  );
}

// ───────────────────────── Data ─────────────────────────

export function Kpi({ label, value, sub, tone, icon, style }: { label: string; value: string; sub?: string; tone?: Tone; icon?: string; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ flex: 1, gap: 2, padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.surface.secondary, borderWidth: 1, borderColor: t.c.border.default }, style]}>
      <Row gap={6}>
        {icon ? <Icon name={icon} size={14} color={tone ? t.tone(tone).fg : t.c.text.muted} /> : null}
        <T v="meta" c="secondary" lines={1}>{label}</T>
      </Row>
      <T v="h2" num lines={1}>{value}</T>
      {sub ? <T v="meta" c="muted" lines={1}>{sub}</T> : null}
    </View>
  );
}

/** Delta always pairs icon + signed text (never colour alone). */
export function Delta({ pct, label = 'vs yesterday' }: { pct: number | null; label?: string }) {
  const t = useTheme();
  if (pct === null) return <T v="meta" c="muted">No comparison for yesterday</T>;
  const up = pct >= 0;
  const c = up ? t.c.status.success : t.c.status.danger;
  return (
    <Row gap={4}>
      <Icon name={up ? 'TrendingUp' : 'TrendingDown'} size={14} color={c} />
      <T v="label" num style={{ color: c }}>{`${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`}</T>
      <T v="meta" c="muted">{label}</T>
    </Row>
  );
}

/** Single-hue mini bar chart from plain Views (decorative charts are an anti-pattern; this one answers "how is the week?"). */
export function MiniBars({ data, height = 88, highlightLast = true }: { data: Array<{ label: string; value: number; display: string }>; height?: number; highlightLast?: boolean }) {
  const t = useTheme();
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <View accessibilityLabel={data.map((d) => `${d.label} ${d.display}`).join(', ')}>
      <Row align="flex-end" gap={6} style={{ height }}>
        {data.map((d, i) => {
          const last = highlightLast && i === data.length - 1;
          return (
            <View key={d.label + i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height }}>
              <View style={{ width: '100%', maxWidth: 30, height: Math.max(3, (d.value / max) * (height - 4)), borderRadius: 4, backgroundColor: last ? t.c.status.info : t.dark ? '#2b3d5e' : '#b9cbec' }} />
            </View>
          );
        })}
      </Row>
      <Row gap={6} style={{ marginTop: 6 }}>
        {data.map((d, i) => (
          <T key={d.label + i} v="meta" c={i === data.length - 1 ? 'primary' : 'muted'} center style={{ flex: 1, fontSize: 11 }} lines={1}>{d.label}</T>
        ))}
      </Row>
    </View>
  );
}

/** Horizontal share bars (BarList) — preferred over pies. */
export function ShareBars({ items }: { items: Array<{ label: string; value: number; display: string; icon?: string }> }) {
  const t = useTheme();
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <View style={{ gap: 10 }}>
      {items.map((i) => (
        <View key={i.label} style={{ gap: 4 }}>
          <Row>
            {i.icon ? <Icon name={i.icon} size={14} color={t.c.text.secondary} /> : null}
            <T v="label" style={{ flex: 1 }}>{i.label}</T>
            <T v="label" num>{i.display}</T>
            <T v="meta" c="muted" num style={{ width: 40, textAlign: 'right' }}>{`${Math.round((i.value / total) * 100)}%`}</T>
          </Row>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: t.c.surface.sunken, overflow: 'hidden' }}>
            <View style={{ width: `${(i.value / total) * 100}%`, height: 8, borderRadius: 4, backgroundColor: t.c.status.info }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Veg / non-veg / egg marker: shape + colour (square + dot, square + triangle). */
export function FoodMark({ type, size = 14 }: { type: FoodType; size?: number }) {
  const color = type === 'veg' ? '#14804a' : type === 'non-veg' ? '#a5342a' : '#b25e09';
  const label = type === 'veg' ? 'Veg' : type === 'non-veg' ? 'Non-veg' : 'Contains egg';
  const inner = size * 0.5;
  return (
    <View accessibilityLabel={label} style={{ width: size, height: size, borderWidth: 1.5, borderColor: color, borderRadius: 2, alignItems: 'center', justifyContent: 'center' }}>
      {type === 'non-veg' ? (
        <View style={{ width: 0, height: 0, borderLeftWidth: inner / 2, borderRightWidth: inner / 2, borderBottomWidth: inner * 0.9, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
      ) : (
        <View style={{ width: inner, height: inner, borderRadius: inner / 2, backgroundColor: color }} />
      )}
    </View>
  );
}

export function KeyValue({ label, value, strong, num = true }: { label: string; value: string; strong?: boolean; num?: boolean }) {
  return (
    <Row style={{ minHeight: 28 }}>
      <T v={strong ? 'bodyStrong' : 'body'} c={strong ? 'primary' : 'secondary'} style={{ flex: 1 }}>{label}</T>
      <T v={strong ? 'h3' : 'body'} num={num}>{value}</T>
    </Row>
  );
}

export function Avatar({ name, color, size = 40 }: { name: string; color?: string; size?: number }) {
  const t = useTheme();
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color ?? t.c.action.primary, alignItems: 'center', justifyContent: 'center' }}>
      <T v={size > 48 ? 'h2' : 'label'} style={{ color: '#fff' }}>{ini}</T>
    </View>
  );
}
