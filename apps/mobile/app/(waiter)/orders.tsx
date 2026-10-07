import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ORDER_STATUS, TABLE_STATUS, orderTotals, tableStatusFromOrder } from '@elixir/domain';
import { useLive, useNow } from '@elixir/local-store/react';
import { elapsed, elapsedMinutes, money } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { useTheme } from '../../src/lib/theme';
import { Badge, Card, EmptyState, Header, Icon, OfflinePill, Row, Screen, Segmented, StatusBadge, T } from '../../src/ui';

export default function Orders() {
  const t = useTheme();
  const router = useRouter();
  const { device } = useApp();
  const s = useSession();
  const now = useNow(1000);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const orders = useLive(
    device,
    ['orders'],
    () => device.where('orders', (o) => o.storeId === s.store.id && !o.closedAt && o.status !== 'cancelled' && o.status !== 'collected').sort((a, b) => a.openedAt.localeCompare(b.openedAt)),
    [s.store.id],
  );
  const mine = orders.filter((o) => o.waiterId === s.user.id);
  const shown = scope === 'mine' ? mine : orders;

  return (
    <Screen header={<Header title="Orders" subtitle={`${mine.length} running for you · ${orders.length} in restaurant`} right={<OfflinePill compact />} />}>
      <Segmented
        value={scope}
        onChange={setScope}
        options={[
          { value: 'mine', label: 'My orders', count: mine.length },
          { value: 'all', label: 'All running', count: orders.length },
        ]}
        style={{ marginBottom: 12 }}
      />
      {shown.length ? (
        <View style={{ gap: 10 }}>
          {shown.map((o) => {
            const tot = orderTotals(o.lines, o.billDiscountPct);
            const unsent = o.lines.filter((l) => l.state === 'unsent').reduce((x, l) => x + l.qty, 0);
            const ready = o.lines.filter((l) => l.state === 'ready').length;
            const meta = o.type === 'dine-in' ? TABLE_STATUS[tableStatusFromOrder(o)] : ORDER_STATUS[o.status];
            const late = elapsedMinutes(o.openedAt, now) >= 45;
            const waiter = o.waiterId !== s.user.id ? device.get('users', o.waiterId) : undefined;
            return (
              <Card key={o.id} onPress={() => router.push(`/order/${o.id}`)} accessibilityLabel={`${o.tableCode ? `Table ${o.tableCode}` : `Token ${o.token}`}, ${meta.label}`}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <T v="h3">{o.tableCode ? `Table ${o.tableCode}` : `Token ${o.token} · ${o.type === 'takeaway' ? 'Takeaway' : 'Delivery'}`}</T>
                    <T v="meta" c="secondary">{`${o.orderNo} · ${tot.itemCount} items · ${o.kotCount} KOT${o.kotCount === 1 ? '' : 's'}${o.guests ? ` · ${o.guests} guests` : ''}${waiter ? ` · ${waiter.name.split(' ')[0]}` : ''}`}</T>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <T v="h3" num>{money(tot.totalPaise)}</T>
                    <Row gap={4}>
                      <Icon name="Clock" size={12} color={late ? t.c.status.warning : t.c.text.muted} />
                      <T v="meta" num style={{ color: late ? t.c.status.warning : t.c.text.secondary }}>{elapsed(o.openedAt, now)}</T>
                    </Row>
                  </View>
                </Row>
                <Row gap={6} style={{ marginTop: 10, flexWrap: 'wrap' }}>
                  <StatusBadge meta={meta} size="sm" />
                  {unsent ? <Badge size="sm" tone="warning" icon="Clock" label={`${unsent} not sent`} /> : null}
                  {ready ? <Badge size="sm" tone="success" icon="BellRing" label={`${ready} ready to serve`} /> : null}
                  {o.source === 'qr' ? <Badge size="sm" tone="neutral" icon="Smartphone" label="QR order" /> : null}
                </Row>
              </Card>
            );
          })}
        </View>
      ) : (
        <Card>
          <EmptyState icon="ClipboardList" title={scope === 'mine' ? 'No running orders' : 'No running orders in the restaurant'} body="Seat guests from Tables to start an order." action="Go to tables" onAction={() => router.push('/tables')} />
        </Card>
      )}
    </Screen>
  );
}
