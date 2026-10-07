import { View } from 'react-native';
import type { WaiterCall } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { elapsed, elapsedMinutes } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { askBill, resolveCall } from '../../src/lib/actions';
import { ago } from '../../src/lib/fmt';
import { useTheme } from '../../src/lib/theme';
import { Badge, Button, Card, Divider, EmptyState, Header, Icon, OfflinePill, Row, Screen, SectionTitle, T, useToast } from '../../src/ui';

const KIND: Record<WaiterCall['kind'], { label: string; icon: string }> = {
  'call-waiter': { label: 'Calling waiter', icon: 'Bell' },
  water: { label: 'Water', icon: 'Water' },
  bill: { label: 'Bill please', icon: 'Receipt' },
};

export default function Calls() {
  const t = useTheme();
  const toast = useToast();
  const { device } = useApp();
  const s = useSession();
  const now = useNow(1000);
  const calls = useLive(device, ['waiterCalls'], () => device.where('waiterCalls', (c) => c.storeId === s.store.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.store.id]);
  const active = calls.filter((c) => c.status !== 'done').sort((a, b) => (a.status === b.status ? 0 : a.status === 'open' ? -1 : 1));
  const done = calls.filter((c) => c.status === 'done').reverse();
  const open = active.filter((c) => c.status === 'open').length;

  const act = async (c: WaiterCall, status: 'acknowledged' | 'done') => {
    await resolveCall(device, s, c.id, status);
    toast(status === 'done' ? `Table ${c.tableCode} · done` : `On my way to ${c.tableCode}`, { haptic: 'light', tone: status === 'done' ? 'success' : 'info' });
  };
  const bill = async (c: WaiterCall) => {
    const table = device.get('tables', c.tableId);
    if (table?.currentOrderId) await askBill(device, s, table.currentOrderId);
    await resolveCall(device, s, c.id, 'done');
    toast(`Bill requested · Table ${c.tableCode}`, { body: 'Cashier notified', haptic: 'success' });
  };

  return (
    <Screen header={<Header title="Calls" subtitle={open ? `${open} new · ${active.length - open} acknowledged` : 'No new calls'} right={<OfflinePill compact />} />}>
      {active.length ? (
        <View style={{ gap: 10 }}>
          {active.map((c) => {
            const k = KIND[c.kind];
            const isOpen = c.status === 'open';
            const urgent = isOpen && elapsedMinutes(c.createdAt, now) >= 3;
            return (
              <Card key={c.id} style={isOpen ? { borderColor: t.c.status.danger + '66' } : undefined}>
                <Row gap={12}>
                  <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isOpen ? t.c.status.dangerSoft : t.c.status.infoSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={k.icon} size={22} color={isOpen ? t.c.status.danger : t.c.status.info} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <T v="h3">{`Table ${c.tableCode}`}</T>
                    <T c="secondary">{k.label}</T>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge size="sm" tone={isOpen ? 'danger' : 'info'} icon={isOpen ? 'Bell' : 'Check'} label={isOpen ? 'New' : 'Acknowledged'} />
                    <T v="meta" num style={{ color: urgent ? t.c.status.danger : t.c.text.muted, fontWeight: urgent ? '700' : '400' }}>{`${elapsed(c.createdAt, now)} waiting`}</T>
                  </View>
                </Row>
                <Row gap={10} style={{ marginTop: 12 }}>
                  {isOpen ? <Button label="Acknowledge" variant="secondary" icon="Check" onPress={() => void act(c, 'acknowledged')} style={{ flex: 1 }} /> : null}
                  {c.kind === 'bill' ? (
                    <Button label="Request bill" icon="Receipt" onPress={() => void bill(c)} style={{ flex: 1 }} />
                  ) : (
                    <Button label="Done" icon="CircleCheck" variant={isOpen ? 'secondary' : 'primary'} onPress={() => void act(c, 'done')} style={{ flex: 1 }} />
                  )}
                </Row>
              </Card>
            );
          })}
        </View>
      ) : (
        <Card>
          <EmptyState icon="Bell" title="All caught up" body="Guest requests from table QR codes (call waiter, water, bill) appear here." />
        </Card>
      )}
      {done.length ? (
        <>
          <SectionTitle title="Completed" count={done.length} />
          <Card padded={false}>
            {done.slice(0, 10).map((c, i) => (
              <View key={c.id}>
                {i ? <Divider inset={16} /> : null}
                <Row style={{ paddingHorizontal: 16, minHeight: 48 }}>
                  <T style={{ flex: 1 }} c="secondary">{`Table ${c.tableCode} · ${KIND[c.kind].label}`}</T>
                  <T v="meta" c="muted">{ago(c.createdAt)}</T>
                </Row>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
