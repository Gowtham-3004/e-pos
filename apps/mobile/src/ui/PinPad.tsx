import { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import { T } from './Text';

/** Four-dot PIN display with a shake on error. */
export function PinDots({ length, value, error }: { length: number; value: string; error?: boolean }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!error) return;
    Animated.sequence([10, -10, 6, -6, 0].map((v) => Animated.timing(x, { toValue: v, duration: 50, useNativeDriver: Platform.OS !== 'web' }))).start();
  }, [error, x]);
  return (
    <Animated.View accessibilityLabel={`${value.length} of ${length} digits entered`} style={{ flexDirection: 'row', gap: 16, justifyContent: 'center', transform: [{ translateX: x }] }}>
      {Array.from({ length }, (_, i) => {
        const on = i < value.length;
        const c = error ? t.c.status.danger : t.c.action.primary;
        return <View key={i} style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: on ? c : t.c.border.strong, backgroundColor: on ? c : 'transparent' }} />;
      })}
    </Animated.View>
  );
}

/** Big 56px+ keys (touch §51). */
export function PinPad({ onDigit, onBackspace, disabled }: { onDigit: (d: string) => void; onBackspace: () => void; disabled?: boolean }) {
  const t = useTheme();
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: 320, alignSelf: 'center' }}>
      {keys.map((k, i) =>
        k === '' ? (
          <View key={i} style={{ width: 88, height: 60 }} />
        ) : (
          <Pressable
            key={i}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={k === 'del' ? 'Delete digit' : k}
            onPress={() => (k === 'del' ? onBackspace() : onDigit(k))}
            style={({ pressed }) => ({
              width: 88, height: 60, borderRadius: t.radius.lg, alignItems: 'center', justifyContent: 'center',
              backgroundColor: k === 'del' ? 'transparent' : pressed ? t.c.surface.sunken : t.c.surface.primary,
              borderWidth: k === 'del' ? 0 : 1, borderColor: t.c.border.default,
            })}
          >
            {k === 'del' ? <Icon name="Backspace" size={24} color={t.c.text.primary} /> : <T v="title" num>{k}</T>}
          </Pressable>
        ),
      )}
    </View>
  );
}

/** Hardware keyboard entry for PIN pads (web / tablets with keyboards). */
export function usePinKeyboard(active: boolean, onDigit: (d: string) => void, onBackspace: () => void) {
  useEffect(() => {
    if (!active || Platform.OS !== 'web' || typeof window === 'undefined') return;
    const h = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) onDigit(e.key);
      else if (e.key === 'Backspace') onBackspace();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [active, onDigit, onBackspace]);
}
