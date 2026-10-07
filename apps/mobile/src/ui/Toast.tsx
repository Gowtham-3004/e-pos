import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Animated, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { Tone } from '@elixir/domain';
import { darkColors } from '@elixir/tokens';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import { T } from './Text';

interface ToastMsg { id: number; title: string; body?: string; tone: Tone; opacity: Animated.Value }
const Ctx = createContext<(title: string, opts?: { body?: string; tone?: Tone; haptic?: 'success' | 'warning' | 'error' | 'light' }) => void>(() => {});

export function haptic(kind: 'success' | 'warning' | 'error' | 'light') {
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'light') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else void Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : kind === 'warning' ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error);
  } catch {
    /* haptics unavailable */
  }
}

/** Non-blocking confirmation (item added, KOT sent, synced). Sits above the tab bar / bottom action. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);
  const seq = useRef(0);
  const show = useCallback(
    (title: string, opts: { body?: string; tone?: Tone; haptic?: 'success' | 'warning' | 'error' | 'light' } = {}) => {
      const id = ++seq.current;
      if (opts.haptic) haptic(opts.haptic);
      const opacity = new Animated.Value(0);
      setMsgs([{ id, title, body: opts.body, tone: opts.tone ?? 'success', opacity }]);
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
      setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 2600);
    },
    [],
  );
  return (
    <Ctx.Provider value={show}>
      {children}
      <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 132, alignItems: 'center' }}>
        {msgs.map((m) => {
          return (
            <Animated.View
              key={m.id}
              accessibilityLiveRegion="polite"
              style={{ opacity: m.opacity, flexDirection: 'row', gap: 10, alignItems: 'center', maxWidth: 480, width: '100%', backgroundColor: t.dark ? t.c.surface.elevated : '#141821', borderRadius: t.radius.lg, paddingVertical: 12, paddingHorizontal: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
            >
              <Icon name={m.tone === 'success' ? 'CircleCheck' : m.tone === 'danger' ? 'AlertCircle' : m.tone === 'warning' ? 'TriangleAlert' : 'Info'} size={20} color={m.tone === 'neutral' ? '#fff' : darkColors.status[m.tone]} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong" style={{ color: '#fff' }}>{m.title}</T>
                {m.body ? <T v="meta" style={{ color: '#c9cfd9' }}>{m.body}</T> : null}
              </View>
            </Animated.View>
          );
        })}
      </View>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
