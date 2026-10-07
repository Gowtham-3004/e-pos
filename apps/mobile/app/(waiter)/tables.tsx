import { useEffect, useMemo, useState } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import type { DiningTable } from '@elixir/contracts';
import { TABLE_STATUS, orderTotals } from '@elixir/domain';
import { useLive, useNow } from '@elixir/local-store/react';
import { elapsed, elapsedMinutes, initials, money } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { markTable, openTable } from '../../src/lib/actions';
import { sectionOf } from '../../src/lib/fmt';
import { useTheme } from '../../src/lib/theme';
import { Button, Chip, ChipRow, Header, Icon, InlineAlert, OfflinePill, Row, Screen, Segmented, Sheet, StatusBadge, Stepper, T, useToast } from '../../src/ui';

export default function Tables() {
  const t = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const { device } = useApp();
  const s = useSession();
  const now = useNow(1000);
  const mySection = sectionOf(s.user.id);
  const floors = useMemo(() => device.where('floors', (f) => f.storeId === s.store.id).sort((a, b) => a.sortOrder - b.sortOrder), [device, s.store.id]);
  const [floorId, setFloorId] = useState(mySection ?? floors[0]?.id);
  const [filter, setFilter] = useState<'all' | 'mine' | 'free'>('all');
  const [seat, setSeat] = useState<DiningTable>();
  const [guests, setGuests] = useState(2);
  const [cleaning, setCleaning] = useState<DiningTable>();
  const [busy, setBusy] = useState(false);

  const data = useLive(
    device,
    ['tables', 'orders', 'waiterCalls'],
    () => {
      const floorIds = new Set(floors.map((f) => f.id));
      const tables = device.where('tables', (tb) => floorIds.has(tb.floorId)).sort((a, b) => a.code.localeCompare(b.code));
      const calls = new Set(device.where('waiterCalls', (c) => c.storeId === s.store.id && c.status === 'open').map((c) => c.tableId));
      return { tables, calls };
    },
    [floors],
  );
  useEffect(() => {
    if (seat) setGuests(Math.min(2, seat.seats));
  }, [seat]);

  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const gap = 10;
  const cardW = (Math.min(width, 720) - 32 - gap * (cols - 1)) / cols;
  const onFloor = data.tables.filter((tb) => tb.floorId === floorId);
  const shown = onFloor.filter((tb) => {
    if (filter === 'free') return tb.status === 'available';
    if (filter === 'mine') return !!tb.currentOrderId && device.get('orders', tb.currentOrderId)?.waiterId === s.user.id;
    return true;
  });
  const sectionName = floors.find((f) => f.id === mySection)?.name;

  const tap = (tb: DiningTable) => {
    if (tb.currentOrderId) return router.push(`/order/${tb.currentOrderId}`);
    if (tb.status === 'cleaning') return setCleaning(tb);
    setSeat(tb);
  };

  return (
    <Screen
      padded={false}
      header={<Header title="Tables" subtitle={`${s.user.name.split(' ')[0]} · ${sectionName ? `${sectionName} section` : s.store.name}`} right={<OfflinePill compact onPress={() => router.push('/profile')} />} />}
    >
      <View style={{ backgroundColor: t.c.surface.primary, paddingTop: 10, borderBottomWidth: 1, borderBottomColor: t.c.border.default }}>
        <Segmented
          value={floorId ?? ''}
          onChange={setFloorId}
          style={{ marginHorizontal: 16 }}
          options={floors.map((f) => ({ value: f.id, label: f.name.replace(' Floor', ''), count: data.tables.filter((tb) => tb.floorId === f.id && tb.currentOrderId).length }))}
        />
        <ChipRow>
          <Chip label="All" selected={filter === 'all'} onPress={() => setFilter('all')} count={onFloor.length} />
          <Chip label="My tables" icon="User" selected={filter === 'mine'} onPress={() => setFilter('mine')} />
          <Chip label="Free" icon="Circle" selected={filter === 'free'} onPress={() => setFilter('free')} count={onFloor.filter((x) => x.status === 'available').length} />
        </ChipRow>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap, padding: 16, paddingBottom: 32, maxWidth: 720, alignSelf: 'center', width: '100%' }}>
        {shown.map((tb) => {
          const order = device.get('orders', tb.currentOrderId);
          const meta = TABLE_STATUS[tb.status];
          const tone = t.tone(meta.tone);
          const mine = order?.waiterId === s.user.id;
          const waiter = order?.waiterId && !mine ? device.get('users', order.waiterId) : undefined;
          const total = order ? orderTotals(order.lines, order.billDiscountPct).totalPaise : 0;
          const unsent = order?.lines.filter((l) => l.state === 'unsent').length ?? 0;
          const late = order ? elapsedMinutes(order.openedAt, now) >= 45 : false;
          const free = tb.status === 'available';
          return (
            <Pressable
              key={tb.id}
              accessibilityRole="button"
              accessibilityLabel={`Table ${tb.code}, ${meta.label}${order ? `, ${order.guests ?? 0} guests, ${money(total)}` : `, ${tb.seats} seats`}`}
              onPress={() => tap(tb)}
              style={({ pressed }) => ({
                width: cardW, minHeight: 132, borderRadius: t.radius.lg, borderWidth: 1, borderColor: free ? t.c.border.default : tone.fg + (t.dark ? '88' : '55'),
                backgroundColor: pressed ? t.c.surface.selected : t.c.surface.primary, overflow: 'hidden',
              })}
            >
              <View style={{ height: 4, backgroundColor: free ? t.c.border.default : tone.fg }} />
              <View style={{ padding: 12, gap: 6, flex: 1 }}>
                <Row>
                  <T v="title" num style={{ flex: 1 }}>{tb.code}</T>
                  {data.calls.has(tb.id) ? <Icon name="Bell" size={16} color={t.c.status.danger} /> : null}
                  <Row gap={3}>
                    <Icon name="Users" size={13} color={t.c.text.muted} />
                    <T v="meta" c="secondary" num>{order ? `${order.guests ?? '—'}/${tb.seats}` : tb.seats}</T>
                  </Row>
                </Row>
                <StatusBadge meta={meta} size="sm" />
                {order ? (
                  <>
                    <T v="bodyStrong" num>{money(total)}</T>
                    <Row gap={4}>
                      <Icon name="Clock" size={12} color={late ? t.c.status.warning : t.c.text.muted} />
                      <T v="meta" num style={{ color: late ? t.c.status.warning : t.c.text.secondary }}>{elapsed(order.openedAt, now)}</T>
                      {waiter ? <T v="meta" c="muted" style={{ marginLeft: 'auto' }}>{initials(waiter.name)}</T> : null}
                    </Row>
                    {unsent ? <T v="meta" style={{ color: t.c.status.warning, fontWeight: '600' }}>{`${unsent} not sent`}</T> : null}
                  </>
                ) : (
                  <T v="meta" c="muted" style={{ marginTop: 'auto' }}>{free ? 'Tap to seat guests' : tb.status === 'cleaning' ? 'Tap when ready' : 'Tap to seat'}</T>
                )}
              </View>
            </Pressable>
          );
        })}
        {!shown.length ? (
          <View style={{ width: '100%' }}>
            <InlineAlert tone="neutral" title={filter === 'mine' ? 'No running tables of yours on this floor' : 'No free tables on this floor'}>Try another floor or clear the filter.</InlineAlert>
          </View>
        ) : null}
      </View>

      <Sheet
        open={!!seat}
        onClose={() => setSeat(undefined)}
        title={`Seat guests · ${seat?.code ?? ''}`}
        subtitle={seat ? `${seat.seats} seats · ${floors.find((f) => f.id === seat.floorId)?.name}${seat.status === 'reserved' ? ' · reserved' : ''}` : undefined}
        footer={
          <Button
            label="Open order"
            size="lg"
            icon="ClipboardList"
            loading={busy}
            block
            onPress={async () => {
              if (!seat) return;
              setBusy(true);
              try {
                const order = await openTable(device, s, seat.id, guests);
                setSeat(undefined);
                router.push(`/order/${order.id}`);
              } catch (e) {
                toast('Could not open table', { body: (e as Error).message, tone: 'danger', haptic: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          />
        }
      >
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
          <T v="label" c="secondary">Number of guests</T>
          <Stepper value={guests} onChange={setGuests} min={1} max={(seat?.seats ?? 4) + 4} size={56} label="Guests" />
          {seat && guests > seat.seats ? <T v="meta" style={{ color: t.c.status.warning }}>{`More guests than seats (${seat.seats}) — add chairs`}</T> : null}
        </View>
      </Sheet>

      <Sheet
        open={!!cleaning}
        onClose={() => setCleaning(undefined)}
        title={`Table ${cleaning?.code ?? ''} is being cleaned`}
        footer={
          <Button
            label="Mark available"
            size="lg"
            icon="CircleCheck"
            block
            onPress={async () => {
              if (!cleaning) return;
              await markTable(device, s, cleaning.id, 'available');
              toast(`Table ${cleaning.code} available`, { haptic: 'light' });
              setCleaning(undefined);
            }}
          />
        }
      >
        <T c="secondary">Mark the table available once it is cleared and reset for the next guests.</T>
      </Sheet>
    </Screen>
  );
}
