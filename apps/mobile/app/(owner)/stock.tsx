import { useEffect, useMemo, useState } from 'react';
import { Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Product } from '@elixir/contracts';
import { expiryHealth } from '@elixir/domain';
import { expiringBatches, lowStock, onHand, searchProducts, tenantProducts } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { daysUntil, money, number, qty as fmtQty } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { setAvailability } from '../../src/lib/actions';
import { useTheme } from '../../src/lib/theme';
import { HealthBadge } from '../../src/ui/stock';
import { Badge, Card, Chip, ChipRow, Divider, EmptyState, FoodMark, Header, ListRow, OfflinePill, Row, Screen, SearchField, SectionTitle, Segmented, T, useToast } from '../../src/ui';

type View_ = 'search' | 'low' | 'expiry';

export default function Stock() {
  const s = useSession();
  return s.family === 'restaurant' ? <MenuAvailability /> : <RetailStock />;
}

function RetailStock() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ view?: string }>();
  const { device, setStore } = useApp();
  const s = useSession();
  const batchTenant = s.has('batch-expiry');
  const [view, setView] = useState<View_>('search');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (params.view === 'low' || (params.view === 'expiry' && batchTenant)) setView(params.view);
  }, [params.view, batchTenant]);
  const storeId = s.store.id;

  const data = useLive(
    device,
    ['products', 'stockMovements', 'batches'],
    () => ({
      low: lowStock(device, s.tenant.id, storeId).sort((a, b) => a.onHand - b.onHand),
      expiry: batchTenant ? expiringBatches(device, s.tenant.id, storeId, 60) : [],
      browse: tenantProducts(device, s.tenant.id).filter((p) => p.active).slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30),
    }),
    [s.tenant.id, storeId, batchTenant],
  );
  const results = useLive(device, ['products'], () => searchProducts(device, s.tenant.id, q, 40), [q, s.tenant.id]);
  const list: Product[] = q ? results : data.browse;

  const row = (p: Product, i: number, extra?: string) => (
    <View key={p.id}>
      {i ? <Divider inset={16} /> : null}
      <ListRow
        title={p.name}
        subtitle={extra ?? `${p.sku} · ${p.barcode}${p.rack ? ` · Rack ${p.rack}` : ''} · ${money(p.salePaise)}`}
        right={<HealthBadge value={onHand(device, storeId, p.id)} reorder={p.reorderLevel} unit={p.unit} />}
        onPress={() => router.push(`/product/${p.id}`)}
      />
    </View>
  );

  return (
    <Screen header={<Header title="Stock" subtitle={`${s.store.name} · on hand`} right={<OfflinePill compact />} />} padded={false}>
      {s.stores.length > 1 ? (
        <View style={{ backgroundColor: t.c.surface.primary, borderBottomWidth: 1, borderBottomColor: t.c.border.default }}>
          <ChipRow>
            {s.stores.map((st) => (
              <Chip key={st.id} label={st.name} selected={st.id === storeId} onPress={() => void setStore(st.id)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <View style={{ padding: 16, paddingBottom: 32, gap: 12 }}>
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'search', label: 'Search', icon: 'Search' },
            { value: 'low', label: 'Low stock', count: data.low.length },
            ...(batchTenant ? [{ value: 'expiry' as const, label: 'Expiry', count: data.expiry.length }] : []),
          ]}
        />
        {view === 'search' ? (
          <>
            <SearchField value={q} onChangeText={setQ} placeholder="Name, barcode, SKU or molecule" />
            <SectionTitle title={q ? `Results for “${q}”` : 'Browse A–Z'} count={list.length} />
            <Card padded={false}>
              {list.length ? list.map((p, i) => row(p, i)) : <EmptyState icon="Search" title="No matching products" body="Check the spelling, or scan the barcode on the POS terminal." />}
            </Card>
          </>
        ) : null}
        {view === 'low' ? (
          <Card padded={false}>
            {data.low.length ? data.low.map((x, i) => row(x.product, i, `Reorder level ${number(x.product.reorderLevel)} · ${x.product.sku}`)) : <EmptyState icon="CircleCheck" title="Nothing low on stock" body="Items at or below their reorder level appear here." />}
          </Card>
        ) : null}
        {view === 'expiry' ? (
          <Card padded={false}>
            {data.expiry.length ? (
              data.expiry.map((x, i) => {
                const d = daysUntil(x.batch.expiryDate);
                const h = expiryHealth(x.batch.expiryDate, 60);
                return (
                  <View key={x.batch.id}>
                    {i ? <Divider inset={16} /> : null}
                    <ListRow
                      title={x.product.name}
                      subtitle={`Batch ${x.batch.code} · ${fmtQty(x.onHand)} ${x.product.unit} on hand · MRP ${money(x.batch.mrpPaise)}`}
                      right={<Badge tone={h === 'expired' ? 'danger' : 'warning'} icon={h === 'expired' ? 'CircleX' : 'Calendar'} label={h === 'expired' ? `Expired ${Math.abs(d)}d ago` : `${d}d left`} />}
                      onPress={() => router.push(`/product/${x.product.id}`)}
                    />
                  </View>
                );
              })
            ) : (
              <EmptyState icon="CircleCheck" title="No batches expiring in 60 days" />
            )}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

/** Restaurant owners: mark dishes sold out / available (pushed to POS and waiter phones via sync). */
function MenuAvailability() {
  const t = useTheme();
  const { device } = useApp();
  const s = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const items = useLive(device, ['menuItems'], () => device.where('menuItems', (m) => m.tenantId === s.tenant.id), [s.tenant.id]);
  const cats = useMemo(() => device.where('categories', (c) => c.tenantId === s.tenant.id).sort((a, b) => a.sortOrder - b.sortOrder), [device, s.tenant.id]);
  const shown = items.filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()));
  const soldOut = items.filter((m) => !m.available).length;
  return (
    <Screen header={<Header title="Menu" subtitle={`${items.length} dishes · ${soldOut} sold out`} right={<OfflinePill compact />} />}>
      <SearchField value={q} onChangeText={setQ} placeholder="Search dishes" />
      {cats.map((c) => {
        const list = shown.filter((m) => m.categoryId === c.id);
        if (!list.length) return null;
        return (
          <View key={c.id}>
            <SectionTitle title={c.name} count={list.length} />
            <Card padded={false}>
              {list.map((m, i) => (
                <View key={m.id}>
                  {i ? <Divider inset={44} /> : null}
                  <ListRow
                    left={<FoodMark type={m.foodType} size={16} />}
                    title={m.name}
                    subtitle={`${money(m.pricePaise)} · ${m.prepMinutes} min`}
                    right={
                      <Row gap={8}>
                        <Badge size="sm" tone={m.available ? 'success' : 'danger'} icon={m.available ? 'CircleCheck' : 'Ban'} label={m.available ? 'Available' : 'Sold out'} />
                        <Switch
                          trackColor={{ true: t.c.status.success, false: t.c.border.strong }}
                          thumbColor="#ffffff"
                          accessibilityLabel={`${m.name} available`}
                          value={m.available}
                          onValueChange={(v) => void setAvailability(device, s, m, v).then(() => toast(v ? `${m.name} available` : `${m.name} marked sold out`, { tone: v ? 'success' : 'neutral', haptic: 'light' }))}
                        />
                      </Row>
                    }
                  />
                </View>
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}
