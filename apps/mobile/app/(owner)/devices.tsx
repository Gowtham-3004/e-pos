import { View } from 'react-native';
import { DEVICE_STATUS } from '@elixir/domain';
import { useLive, useNow } from '@elixir/local-store/react';
import { number } from '@elixir/format';
import { useApp, useSession, useSync } from '../../src/lib/app';
import { DEVICE_KIND, ago } from '../../src/lib/fmt';
import { useTheme } from '../../src/lib/theme';
import { Badge, Card, CloudOnlyNotice, Divider, Header, Icon, Kpi, OfflinePill, Row, Screen, SectionTitle, StatusBadge, T } from '../../src/ui';

export default function Devices() {
  const t = useTheme();
  const { device } = useApp();
  const s = useSession();
  const sync = useSync();
  useNow(30000);
  const data = useLive(
    device,
    ['devices', 'edgeNodes'],
    () => ({
      devices: device.where('devices', (d) => d.tenantId === s.tenant.id && s.user.storeIds.includes(d.storeId)),
      edges: device.where('edgeNodes', (e) => e.tenantId === s.tenant.id),
    }),
    [s.tenant.id, s.user.id],
  );
  const counts = {
    active: data.devices.filter((d) => d.status === 'active').length,
    offline: data.devices.filter((d) => d.status === 'offline').length,
    attention: data.devices.filter((d) => d.status === 'attention').length,
  };

  return (
    <Screen header={<Header title="Devices" subtitle={`${data.devices.length} registered · ${s.stores.length} store${s.stores.length > 1 ? 's' : ''}`} right={<OfflinePill compact />} />}>
      <CloudOnlyNotice what="Live device status" />
      <Row gap={10}>
        <Kpi label="Active" value={number(counts.active)} icon="CircleCheck" tone="success" />
        <Kpi label="Offline" value={number(counts.offline)} icon="WifiOff" tone="neutral" />
        <Kpi label="Attention" value={number(counts.attention)} icon="TriangleAlert" tone="warning" />
      </Row>

      {s.stores.map((st) => {
        const list = data.devices.filter((d) => d.storeId === st.id && d.kind !== 'store-edge').sort((a, b) => a.code.localeCompare(b.code));
        const edge = data.edges.find((e) => e.storeId === st.id);
        return (
          <View key={st.id}>
            <SectionTitle title={`${st.name} · ${st.code}`} count={list.length} />
            {edge ? (
              <Card style={{ marginBottom: 10 }}>
                <Row>
                  <View style={{ width: 36, height: 36, borderRadius: t.radius.md, backgroundColor: t.c.surface.sunken, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="Server" size={18} color={t.c.text.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">Store Edge</T>
                    <T v="meta" c="secondary">{`v${edge.version} · ${edge.connectedDevices} devices on LAN · up ${edge.uptimeHours}h`}</T>
                  </View>
                  <Badge
                    tone={edge.status === 'healthy' ? 'success' : edge.status === 'degraded' ? 'warning' : 'danger'}
                    icon={edge.status === 'healthy' ? 'CircleCheck' : 'TriangleAlert'}
                    label={edge.status === 'healthy' ? 'Healthy' : edge.status === 'degraded' ? 'Degraded' : 'Down'}
                  />
                </Row>
                <Row gap={8} style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <Badge size="sm" tone={edge.wanState === 'up' ? 'success' : 'danger'} icon={edge.wanState === 'up' ? 'Wifi' : 'WifiOff'} label={`WAN ${edge.wanState === 'up' ? 'up' : 'down'}`} />
                  <Badge size="sm" tone={edge.queueCount > 20 ? 'warning' : 'neutral'} icon="CloudUpload" label={`${edge.queueCount} queued · oldest ${Math.round(edge.queueAgeSec / 60)}m`} />
                  <Badge size="sm" tone="neutral" icon="Cloud" label={`Checkpoint ${ago(edge.cloudCheckpointAt)}`} />
                </Row>
              </Card>
            ) : null}
            <Card padded={false}>
              {list.map((d, i) => {
                const me = d.id === s.deviceId;
                const kind = DEVICE_KIND[d.kind];
                return (
                  <View key={d.id}>
                    {i ? <Divider inset={64} /> : null}
                    <Row gap={12} style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 }} align="flex-start">
                      <View style={{ width: 36, height: 36, borderRadius: t.radius.md, backgroundColor: t.c.surface.sunken, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={kind.icon} size={18} color={t.c.text.primary} />
                      </View>
                      <View style={{ flex: 1, gap: 3 }}>
                        <T v="bodyStrong" lines={2}>{`${d.code} · ${d.name}`}</T>
                        {me ? <Badge size="sm" tone="info" icon="Smartphone" label="This phone" /> : null}
                        <T v="meta" c="secondary" lines={1}>{`${kind.label} · v${d.appVersion} · ${d.os}`}</T>
                        <Row gap={6} style={{ flexWrap: 'wrap' }}>
                          <T v="meta" c="muted">{`Last seen ${me ? ago(sync.lastSuccessAt ?? d.lastSeenAt) : ago(d.lastSeenAt)}`}</T>
                          {(me ? sync.pending : d.pendingSync) > 0 ? <Badge size="sm" tone="warning" icon="CloudUpload" label={`${me ? sync.pending : d.pendingSync} pending sync`} /> : null}
                          {d.failedSync > 0 ? <Badge size="sm" tone="danger" icon="TriangleAlert" label={`${d.failedSync} failed`} /> : null}
                          {d.peripherals?.some((p) => p.state !== 'ready' && p.state !== 'connected') ? <Badge size="sm" tone="warning" icon="Printer" label="Printer unavailable" /> : null}
                        </Row>
                      </View>
                      <StatusBadge meta={DEVICE_STATUS[me ? (sync.connectivity === 'offline' ? 'offline' : 'active') : d.status]} size="sm" />
                    </Row>
                  </View>
                );
              })}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
