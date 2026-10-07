import { ActivityIndicator, View } from 'react-native';
import type { BootStep } from '@elixir/local-store';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import { InlineAlert } from './primitives';
import { T } from './Text';

export function ElixirMark({ size = 40 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.26, backgroundColor: t.dark ? '#e4eaf4' : '#111c30', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.42, gap: size * 0.08 }}>
        {[1, 0.7, 1].map((w, i) => (
          <View key={i} style={{ height: size * 0.09, width: `${w * 100}%`, borderRadius: 2, backgroundColor: t.dark ? '#111c30' : '#ffffff' }} />
        ))}
      </View>
    </View>
  );
}

/** "Restoring local workspace…" (§48) — shown only on cold start, never for background sync. */
export function BootScreen({ steps, error }: { steps: BootStep[]; error?: string }) {
  const t = useTheme();
  const list = steps.length ? steps : [{ key: 'db', label: 'Local database', done: false }];
  return (
    <View style={{ flex: 1, backgroundColor: t.c.surface.app, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <View style={{ width: '100%', maxWidth: 380, backgroundColor: t.c.surface.primary, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border.default, padding: 24, gap: 16 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <ElixirMark size={40} />
          <View>
            <T v="h2">Elixir POS</T>
            <T v="meta" c="secondary">Restoring local workspace…</T>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          {list.map((s) => (
            <View key={s.key} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {s.done ? <Icon name="CircleCheck" size={16} color={t.c.status.success} /> : <ActivityIndicator size="small" color={t.c.text.muted} />}
              <T c={s.done ? 'primary' : 'muted'}>{s.label}</T>
            </View>
          ))}
        </View>
        {error ? (
          <InlineAlert tone="danger" title="Local data could not be opened">
            {`${error}. Committed transactions are not affected. Restart the app or contact support.`}
          </InlineAlert>
        ) : null}
      </View>
    </View>
  );
}
