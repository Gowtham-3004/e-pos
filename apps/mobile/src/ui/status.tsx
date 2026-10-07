import { Pressable, View } from 'react-native';
import { CONNECTIVITY } from '@elixir/domain';
import { relative } from '@elixir/format';
import { useNetwork, useSync } from '../lib/app';
import { useTheme } from '../lib/theme';
import { Icon } from './Icon';
import { InlineAlert } from './primitives';
import { T } from './Text';

/** Header pill: ● Online / ● Offline / ● Syncing N / ● Attention required — colour + icon + text (§26). */
export function OfflinePill({ onPress, compact }: { onPress?: () => void; compact?: boolean }) {
  const t = useTheme();
  const s = useSync();
  const meta = CONNECTIVITY[s.connectivity];
  const c = t.tone(meta.tone);
  const fg = s.connectivity === 'online' ? t.c.sync.online : s.connectivity === 'offline' ? t.c.sync.offline : c.fg;
  const label = s.connectivity === 'syncing' ? `Syncing ${s.pending}` : s.connectivity === 'offline' && s.pending ? `Offline · ${s.pending} queued` : compact && s.connectivity === 'attention' ? 'Attention' : meta.label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Connection: ${label}`}
      onPress={onPress}
      hitSlop={8}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: t.radius.pill, backgroundColor: c.bg, borderWidth: 1, borderColor: t.c.border.default }}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fg }} />
      <Icon name={meta.icon} size={13} color={fg} />
      <T v="meta" num style={{ color: s.connectivity === 'offline' ? t.c.text.secondary : fg, fontWeight: '600' }} lines={1}>{label}</T>
    </Pressable>
  );
}

/** Shown only where cloud data matters: consolidated / cross-device views. */
export function CloudOnlyNotice({ what = 'Consolidated multi-store view' }: { what?: string }) {
  const { online } = useNetwork();
  const s = useSync();
  if (online) return null;
  return (
    <InlineAlert tone="warning" icon="CloudOff" title={`${what} requires cloud connection`} style={{ marginBottom: 12 }}>
      {`Showing this device's last synced data from ${s.lastSuccessAt ? relative(s.lastSuccessAt) : 'the last sign-in'}. Local actions keep working.`}
    </InlineAlert>
  );
}
