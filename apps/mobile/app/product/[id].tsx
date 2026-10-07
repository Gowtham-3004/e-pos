import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { MOVEMENT_LABEL, expiryHealth } from '@elixir/domain';
import { batchesFor, onHand } from '@elixir/local-store';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, dateTime, daysUntil, money, qty as fmtQty } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { useTheme } from '../../src/lib/theme';
import { Badge, Card, Divider, EmptyState, Header, KeyValue, ListRow, Row, Screen, SectionTitle, T } from '../../src/ui';
import { HealthBadge } from '../../src/ui/stock';

export default function ProductDetail() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { device } = useApp();
  const s = useSession();
  const p = useEntity(device, 'products', id);
  const live = useLive(
    device,
    ['stockMovements', 'batches', 'taxRates', 'categories', 'brands'],
    () => {
      if (!p) return undefined;
      return {
        byStore: s.stores.map((st) => ({ store: st, onHand: onHand(device, st.id, p.id) })),
        batches: p.batchTracked ? batchesFor(device, p.id) : [],
        moves: device.where('stockMovements', (m) => m.productId === p.id && s.user.storeIds.includes(m.storeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10),
        tax: device.get('taxRates', p.taxRateId),
        category: device.get('categories', p.categoryId),
        brand: device.get('brands', p.brandId),
      };
    },
    [p?.id, s.user.id],
  );

  if (!p || !live) {
    return (
      <Screen header={<Header back title="Product" />}>
        <EmptyState icon="Package" title="Product not found" body="It may have been removed from the catalog. Pull to sync from the cloud." />
      </Screen>
    );
  }
  const total = live.byStore.reduce((x, b) => x + b.onHand, 0);
  const margin = p.salePaise ? ((p.salePaise - p.costPaise) / p.salePaise) * 100 : 0;

  return (
    <Screen header={<Header back title={p.name} subtitle={[live.brand?.name, live.category?.name].filter(Boolean).join(' · ')} />}>
      <Card>
        <Row align="flex-end">
          <View style={{ flex: 1 }}>
            <T v="overline" c="muted">Selling price</T>
            <T v="kpi" num>{money(p.salePaise)}</T>
            {p.mrpPaise > p.salePaise ? <T v="meta" c="secondary" num>{`MRP ${money(p.mrpPaise)} · saves ${money(p.mrpPaise - p.salePaise)}`}</T> : <T v="meta" c="secondary" num>{`MRP ${money(p.mrpPaise)}`}</T>}
          </View>
          <HealthBadge value={onHand(device, s.store.id, p.id)} reorder={p.reorderLevel} unit={p.unit} />
        </Row>
        <Divider style={{ marginVertical: 12 }} />
        <KeyValue label="Cost" value={money(p.costPaise)} />
        <KeyValue label="Margin" value={`${margin.toFixed(1)}%`} />
        <KeyValue label="Tax" value={`${live.tax?.name ?? p.taxRateId}${p.taxInclusive ? ' · inclusive' : ''}`} num={false} />
        <KeyValue label="HSN" value={p.hsn} />
        <KeyValue label="SKU" value={p.sku} />
        <KeyValue label="Barcode" value={p.barcode} />
        {p.rack ? <KeyValue label="Rack" value={p.rack} num={false} /> : null}
        <KeyValue label="Reorder level" value={`${p.reorderLevel} ${p.unit}`} />
        {p.molecule ? <KeyValue label="Molecule" value={p.molecule} num={false} /> : null}
        {p.schedule ? <KeyValue label="Schedule" value={p.schedule} num={false} /> : null}
      </Card>

      <SectionTitle title="Stock by store" />
      <Card padded={false}>
        {live.byStore.map((b, i) => (
          <View key={b.store.id}>
            {i ? <Divider inset={16} /> : null}
            <ListRow title={b.store.name} subtitle={`${b.store.code} · ${b.store.city}`} right={<HealthBadge value={b.onHand} reorder={p.reorderLevel} unit={p.unit} />} />
          </View>
        ))}
        {live.byStore.length > 1 ? (
          <>
            <Divider />
            <Row style={{ paddingHorizontal: 16, minHeight: 48 }}>
              <T v="bodyStrong" style={{ flex: 1 }}>All stores</T>
              <T v="h3" num>{`${fmtQty(total)} ${p.unit}`}</T>
            </Row>
          </>
        ) : null}
      </Card>

      {live.batches.length ? (
        <>
          <SectionTitle title={`Batches · ${s.store.name}`} count={live.batches.length} />
          <Card padded={false}>
            {live.batches.map((b, i) => {
              const h = expiryHealth(b.expiryDate, 60);
              const d = daysUntil(b.expiryDate);
              return (
                <View key={b.id}>
                  {i ? <Divider inset={16} /> : null}
                  <ListRow
                    title={`Batch ${b.code}`}
                    subtitle={`Exp ${date(b.expiryDate)} · MRP ${money(b.mrpPaise)} · ${fmtQty(onHand(device, s.store.id, p.id, b.id))} ${p.unit} here`}
                    right={<Badge size="sm" tone={h === 'expired' ? 'danger' : h === 'near' ? 'warning' : 'success'} icon={h === 'ok' ? 'CircleCheck' : 'Calendar'} label={h === 'expired' ? 'Expired' : h === 'near' ? `${d}d left` : 'OK'} />}
                  />
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Last movements" />
      <Card padded={false}>
        {live.moves.length ? (
          live.moves.map((m, i) => (
            <View key={m.id}>
              {i ? <Divider inset={16} /> : null}
              <Row style={{ paddingHorizontal: 16, minHeight: 52, paddingVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong">{MOVEMENT_LABEL[m.type]}</T>
                  <T v="meta" c="secondary">{`${device.get('stores', m.storeId)?.code ?? ''} · ${dateTime(m.createdAt)}${m.reason ? ` · ${m.reason}` : ''}`}</T>
                </View>
                <T v="bodyStrong" num style={{ color: m.qty >= 0 ? t.c.status.success : t.c.text.primary }}>{`${m.qty >= 0 ? '+' : '−'}${fmtQty(Math.abs(m.qty))}`}</T>
              </Row>
            </View>
          ))
        ) : (
          <EmptyState quiet title="No stock movements recorded." />
        )}
      </Card>
    </Screen>
  );
}
