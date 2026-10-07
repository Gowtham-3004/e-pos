import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useLive, useNow } from '@elixir/local-store/react';
import { dateLong, money, moneyCompact, number } from '@elixir/format';
import { useApp, useNetwork, useSession, useSync } from '../../src/lib/app';
import { ago } from '../../src/lib/fmt';
import { TENDER_LABEL, freshness, homeAlerts, homeMetrics } from '../../src/lib/metrics';
import { useTheme } from '../../src/lib/theme';
import {
  Badge, Card, Chip, ChipRow, CloudOnlyNotice, Delta, Divider, EmptyState, Header, Icon, Kpi, ListRow, MiniBars, OfflinePill, Row, Screen, SectionTitle, ShareBars, T,
} from '../../src/ui';

export default function OwnerHome() {
  const t = useTheme();
  const router = useRouter();
  const { device, setStore } = useApp();
  const s = useSession();
  const sync = useSync();
  const { online } = useNetwork();
  const now = useNow(30000);
  const all = s.storeId === 'all';
  const storeIds = all ? s.stores.map((x) => x.id) : [s.store.id];
  const multi = s.stores.length > 1;

  const m = useLive(device, ['sales'], () => homeMetrics(device, s.tenant.id, storeIds), [s.tenant.id, storeIds.join()]);
  const alerts = useLive(device, ['approvals', 'stockMovements', 'devices', 'batches'], () => homeAlerts(device, s, storeIds), [s.tenant.id, storeIds.join(), s.user.id]);
  const fresh = useLive(device, ['devices'], () => freshness(device, s.tenant.id, storeIds), [s.tenant.id, storeIds.join()]);
  const floor = useLive(
    device,
    ['orders', 'kots', 'tables', 'sales'],
    () => {
      if (s.family !== 'restaurant') return undefined;
      const tables = device.all('tables');
      const running = device.where('orders', (o) => storeIds.includes(o.storeId) && !o.closedAt && o.status !== 'cancelled');
      const open = running.reduce((sum, o) => sum + o.lines.filter((l) => l.state !== 'void').reduce((x, l) => x + l.qty * (l.unitPricePaise + l.modifiers.reduce((a, b) => a + b.pricePaise, 0)), 0), 0);
      const kitchen = device.where('kots', (k) => storeIds.includes(k.storeId) && !k.isVoid && (k.status === 'new' || k.status === 'accepted' || k.status === 'preparing')).length;
      const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const dish = new Map<string, number>();
      device.where('sales', (x) => x.tenantId === s.tenant.id && x.kind === 'restaurant' && x.businessDate >= since).forEach((x) => x.lines.forEach((l) => {
        const name = l.name.replace(/ \(.*\)$/, '');
        dish.set(name, (dish.get(name) ?? 0) + l.qty);
      }));
      return {
        busy: tables.filter((tb) => tb.currentOrderId).length,
        total: tables.length,
        open,
        kitchen,
        dineIn: running.filter((o) => o.type === 'dine-in').length,
        takeaway: running.filter((o) => o.type !== 'dine-in').length,
        top: [...dish].sort((a, b) => b[1] - a[1]).slice(0, 5),
      };
    },
    [s.family, storeIds.join()],
  );

  const asOf = sync.lastSuccessAt ? `Data as of ${ago(sync.lastSuccessAt)}` : online ? 'Data as of just now' : 'Offline · data saved on this phone';
  const stale = fresh.offline > 0 || fresh.pending > 0;

  return (
    <Screen
      header={
        <Header
          title={s.tenant.name}
          subtitle={all ? `All stores · ${s.stores.length} locations` : `${s.store.name} · ${s.store.city}`}
          right={<OfflinePill compact onPress={() => router.push('/more')} />}
          above={null}
        />
      }
      padded={false}
    >
      {multi ? (
        <View style={{ backgroundColor: t.c.surface.primary, borderBottomWidth: 1, borderBottomColor: t.c.border.default }}>
          <ChipRow>
            {s.has('multi-store') ? <Chip label="All stores" icon="Layers" selected={all} onPress={() => void setStore('all')} /> : null}
            {s.stores.map((st) => (
              <Chip key={st.id} label={st.name} selected={!all && st.id === s.store.id} onPress={() => void setStore(st.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}

      <View style={{ padding: 16, paddingBottom: 32 }}>
        {all ? <CloudOnlyNotice /> : null}

        <Row gap={6} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <Icon name="Clock" size={14} color={t.c.text.muted} />
          <T v="meta" c="secondary" num>
            {`${asOf} · ${fresh.synced} device${fresh.synced === 1 ? '' : 's'} synced${fresh.offline ? `, ${fresh.offline} offline` : ''}${fresh.pending ? `, ${fresh.pending} pending` : ''}`}
          </T>
          {stale ? <Badge size="sm" tone="warning" icon="TriangleAlert" label={`Partial · ${number(fresh.unsynced)} records not yet synced`} /> : null}
        </Row>

        <Card>
          <Row>
            <T v="overline" c="muted" style={{ flex: 1 }}>{`Today's sales · ${dateLong(now)}`}</T>
          </Row>
          <T v="display" num style={{ marginTop: 6 }} selectable>{money(m.todayPaise)}</T>
          <View style={{ marginTop: 4 }}>
            {m.bills && m.deltaPct !== null ? (
              <Delta pct={m.deltaPct} label={`vs same time yesterday (${moneyCompact(m.yesterdaySoFarPaise)})`} />
            ) : (
              <T v="meta" c="muted">{m.bills ? `Yesterday closed at ${money(m.yesterdayPaise, { whole: true })}` : `No bills settled yet today · yesterday ${money(m.yesterdayPaise, { whole: true })}`}</T>
            )}
          </View>
          <Row gap={10} style={{ marginTop: 14 }}>
            <Kpi label="Bills" value={number(m.bills)} icon="FileText" />
            <Kpi label="Avg bill" value={m.bills ? money(m.avgPaise, { whole: true }) : '—'} icon="ShoppingBag" />
          </Row>
          {m.mix.length ? (
            <>
              <Divider style={{ marginVertical: 16 }} />
              <T v="label" c="secondary" style={{ marginBottom: 10 }}>Payment mix</T>
              <ShareBars items={m.mix.map((x) => ({ label: TENDER_LABEL[x.method].label, icon: TENDER_LABEL[x.method].icon, value: x.paise, display: money(x.paise, { whole: true }) }))} />
            </>
          ) : null}
        </Card>

        <SectionTitle title="Last 7 days" />
        <Card>
          <Row style={{ marginBottom: 12 }}>
            <T v="label" c="secondary" style={{ flex: 1 }}>Net sales</T>
            <T v="label" num>{money(m.week.reduce((x, d) => x + d.paise, 0), { whole: true })}</T>
          </Row>
          <MiniBars data={m.week.map((d) => ({ label: d.label, value: d.paise, display: moneyCompact(d.paise) }))} />
        </Card>

        {floor ? (
          <>
            <SectionTitle title="Floor right now" />
            <Card>
              <Row gap={10}>
                <Kpi label="Tables in use" value={`${floor.busy}/${floor.total}`} icon="Grid" />
                <Kpi label="KOTs in kitchen" value={number(floor.kitchen)} icon="Flame" tone="warning" />
              </Row>
              <Row gap={10} style={{ marginTop: 10 }}>
                <Kpi label="Open orders value" value={money(floor.open, { whole: true })} sub={`${floor.dineIn} dine-in · ${floor.takeaway} takeaway`} icon="ClipboardList" />
              </Row>
              {floor.top.length ? (
                <>
                  <Divider style={{ marginVertical: 14 }} />
                  <T v="label" c="secondary" style={{ marginBottom: 6 }}>Top dishes · last 7 days</T>
                  {floor.top.map(([name, qty], i) => (
                    <Row key={name} style={{ minHeight: 32 }}>
                      <T v="meta" c="muted" num style={{ width: 18 }}>{i + 1}</T>
                      <T style={{ flex: 1 }} lines={1}>{name}</T>
                      <T v="label" num>{`${number(qty)} sold`}</T>
                    </Row>
                  ))}
                </>
              ) : null}
            </Card>
          </>
        ) : null}

        <SectionTitle title="Needs attention" count={alerts.length} />
        <Card padded={false}>
          {alerts.length ? (
            alerts.map((a, i) => (
              <View key={a.key}>
                {i ? <Divider inset={64} /> : null}
                <ListRow icon={a.icon} iconTone={a.tone} title={a.title} subtitle={a.detail} chevron onPress={() => router.push(a.href as never)} />
              </View>
            ))
          ) : (
            <EmptyState quiet title="Nothing needs your attention right now." />
          )}
        </Card>
      </View>
    </Screen>
  );
}
