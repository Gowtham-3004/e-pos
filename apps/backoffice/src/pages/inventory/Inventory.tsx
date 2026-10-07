import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Product, StockAdjustment } from '@elixir/contracts';
import { expiryHealth } from '@elixir/domain';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, KpiCard, SearchInput, Select, StatusBadge, Tabs, type Column } from '@elixir/ui';
import { batchesFor } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { date, dateTime, money, number, qty as fq } from '@elixir/format';
import { ExportMenu, KpiRow, PageFrame, ScopeHint, useFirstPaint } from '../../components/common';
import { includesQ, useCloud, useLookups, useTenantProducts, userName } from '../../lib/data';
import { damagedIn, EXPIRY_HEALTH, healthOf, onHandIn, STOCK_HEALTH } from '../../lib/stock';
import { ADJ_REASON_LABEL } from '../../lib/ops';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';

type Row = { p: Product; onHand: number; damaged: number; available: number; value: number; health: ReturnType<typeof healthOf> };

export function Inventory() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint();
  const products = useTenantProducts();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'stock' | 'adjustments' | 'transfers') ?? 'stock';
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [health, setHealth] = useState(params.get('health') ?? '');
  const [drill, setDrill] = useState<Product>();
  const canAdjust = s.can('inventory.adjust');
  const multi = s.has('multi-store') && s.stores.length > 1;

  const rows: Row[] = useLive(cloud, ['stockMovements'], () => products.filter((p) => p.active).map((p) => {
    const onHand = onHandIn(cloud, s.scope, p.id);
    const damaged = damagedIn(cloud, s.scope, p.id);
    return { p, onHand, damaged, available: Math.max(0, onHand), value: Math.round(Math.max(0, onHand) * p.costPaise), health: healthOf(onHand, p.reorderLevel * s.scope.length) };
  }), [products, s.scope.join(',')]);

  const filtered = useMemo(() => rows.filter((r) => (!cat || r.p.categoryId === cat) && (!health || (health === 'low' ? r.health !== 'ok' : r.health === health)) && includesQ(q, r.p.name, r.p.sku, r.p.barcode)).sort((a, b) => a.p.name.localeCompare(b.p.name)), [rows, cat, health, q]);

  const adjustments = useLive(cloud, ['adjustments'], () => cloud.where('adjustments', (a) => a.tenantId === s.tenant.id && s.scope.includes(a.storeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.tenant.id, s.scope.join(',')]);
  const transfers = useLive(cloud, ['stockMovements'], () => {
    const m = new Map<string, { id: string; doc: string; at: string; from?: string; to?: string; lines: number; qty: number; user?: string }>();
    cloud.all('stockMovements').forEach((mv) => {
      if (mv.tenantId !== s.tenant.id || mv.sourceType !== 'transfer') return;
      const t = m.get(mv.sourceId) ?? { id: mv.sourceId, doc: mv.reason ?? mv.sourceId, at: mv.createdAt, lines: 0, qty: 0, user: mv.userId };
      if (mv.type === 'transfer_out') { t.from = mv.storeId; t.lines++; t.qty += -mv.qty; }
      else t.to = mv.storeId;
      m.set(mv.sourceId, t);
    });
    return [...m.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [s.tenant.id]);

  if (s.family === 'restaurant' && products.length === 0) {
    return (
      <PageFrame title="Inventory" crumbs={[{ label: 'Stock' }, { label: 'Inventory' }]}>
        <Card><EmptyState icon="Boxes" title="No stock-tracked items">Menu items are not stock-tracked. Ingredient inventory (recipes and consumption) can be set up by Elixir onboarding — purchases will then post stock here.</EmptyState></Card>
      </PageFrame>
    );
  }

  const cols: Column<Row>[] = [
    { key: 'name', header: 'Product', sortable: true, sortValue: (r) => r.p.name, render: (r) => <div><div className="bo-cell-main">{r.p.name}{r.p.variantAttrs ? <span className="muted"> · {r.p.variantAttrs.color}/{r.p.variantAttrs.size}</span> : null}</div><div className="bo-cell-sub num">{r.p.sku}{r.p.rack ? ` · Rack ${r.p.rack}` : ''}</div></div> },
    { key: 'cat', header: 'Category', render: (r) => L.categories.get(r.p.categoryId)?.name },
    { key: 'onHand', header: 'On hand', align: 'right', sortable: true, render: (r) => <b className={r.onHand < 0 ? 'bo-neg' : undefined}>{fq(r.onHand, r.p.decimalQty)} <span className="muted" style={{ fontWeight: 400 }}>{r.p.unit}</span></b> },
    { key: 'reserved', header: 'Reserved', align: 'right', render: () => <span className="muted">0</span> },
    { key: 'available', header: 'Available', align: 'right', sortable: true, render: (r) => fq(r.available, r.p.decimalQty) },
    { key: 'damaged', header: 'Damaged', align: 'right', sortable: true, render: (r) => (r.damaged ? <span className="bo-neg">{fq(r.damaged)}</span> : <span className="muted">0</span>) },
    { key: 'reorder', header: 'Reorder at', align: 'right', render: (r) => r.p.reorderLevel * s.scope.length },
    { key: 'health', header: 'Health', render: (r) => <StatusBadge meta={STOCK_HEALTH[r.health]} /> },
    { key: 'value', header: 'Value (cost)', align: 'right', sortable: true, render: (r) => money(r.value) },
    { key: 'act', header: '', align: 'right', render: (r) => <Button size="sm" variant="ghost" icon="History" onClick={(e) => { e.stopPropagation(); nav(`/inventory/ledger/${r.p.id}`); }}>Ledger</Button> },
  ];

  const doExport = (kind: 'csv' | 'xls') => downloadTable('stock-on-hand', ['SKU', 'Product', 'Category', 'On hand', 'Damaged', 'Available', 'Unit', 'Health', 'Cost', 'Value'], filtered.map((r) => [r.p.sku, r.p.name, L.categories.get(r.p.categoryId)?.name, r.onHand, r.damaged, r.available, r.p.unit, STOCK_HEALTH[r.health].label, rupees(r.p.costPaise), rupees(r.value)]), kind);

  return (
    <PageFrame
      title="Inventory"
      description={<>Stock is derived from the immutable movement ledger — never edited directly · <ScopeHint /></>}
      crumbs={[{ label: 'Stock' }, { label: 'Inventory' }]}
      actions={
        <>
          {s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} /> : null}
          {canAdjust ? <Button icon="ClipboardCheck" onClick={() => nav('/inventory/stocktake')}>Stock take</Button> : null}
          {canAdjust && multi ? <Button icon="ArrowRightLeft" onClick={() => nav('/inventory/transfer')}>Transfer</Button> : null}
          {canAdjust ? <Button variant="primary" icon="SlidersHorizontal" onClick={() => nav('/inventory/adjust')}>Stock adjustment</Button> : null}
        </>
      }
    >
      <KpiRow>
        <KpiCard label="Stock value (cost)" icon="IndianRupee" value={money(rows.reduce((a, r) => a + r.value, 0), { whole: true })} foot={`${number(rows.length)} active SKUs`} loading={loading} />
        <KpiCard label="Low stock" icon="TriangleAlert" tone="warning" value={number(rows.filter((r) => r.health === 'low').length)} onClick={() => { setHealth('low'); setParams({ tab: 'stock' }); }} loading={loading} />
        <KpiCard label="Out of stock" icon="CircleX" tone="danger" value={number(rows.filter((r) => r.health === 'out').length)} onClick={() => setHealth('out')} loading={loading} />
        <KpiCard label="Damaged units" icon="PackageX" value={fq(rows.reduce((a, r) => a + r.damaged, 0))} foot="From damaged sale returns (not sellable)" loading={loading} />
      </KpiRow>
      <Tabs items={[{ key: 'stock', label: 'Stock on hand' }, { key: 'adjustments', label: 'Adjustments', count: adjustments.length }, ...(multi ? [{ key: 'transfers', label: 'Transfers', count: transfers.length }] : [])]} value={tab} onChange={(k) => setParams({ tab: k })} />
      {tab === 'stock' ? (
        <Card className="bo-card-table">
          <div className="bo-toolbar">
            <SearchInput placeholder="Search product, SKU, barcode" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
            <Select size="sm" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...[...L.categories.values()].map((c) => ({ value: c.id, label: c.name }))]} />
            <Select size="sm" aria-label="Stock health" value={health} onChange={(e) => setHealth(e.target.value)} options={[{ value: '', label: 'Any stock health' }, { value: 'ok', label: 'In stock' }, { value: 'low', label: 'Low or out' }, { value: 'out', label: 'Out of stock' }]} />
          </div>
          <DataTable columns={cols} rows={filtered} rowKey={(r) => r.p.id} loading={loading} onRowClick={(r) => setDrill(r.p)} empty={<EmptyState quiet icon="SearchX" title="No items match" />} footer={<div className="bo-tfoot"><span>{number(filtered.length)} items</span><span>Value <b>{money(filtered.reduce((a, r) => a + r.value, 0))}</b></span></div>} />
        </Card>
      ) : tab === 'adjustments' ? (
        <Card className="bo-card-table">
          <DataTable<StockAdjustment>
            rows={adjustments}
            rowKey={(a) => a.id}
            loading={loading}
            empty={<EmptyState quiet icon="SlidersHorizontal" title="No adjustments yet">Adjustments record damage, expiry write-offs and count corrections.</EmptyState>}
            columns={[
              { key: 'doc', header: 'Document', render: (a) => <span className="num bo-cell-main">{a.documentNo}</span> },
              { key: 'at', header: 'Date', render: (a) => <span className="num">{dateTime(a.createdAt)}</span> },
              { key: 'store', header: 'Store', hidden: s.scope.length < 2, render: (a) => s.storeName(a.storeId) },
              { key: 'p', header: 'Product', render: (a) => <button type="button" className="bo-link" onClick={() => nav(`/inventory/ledger/${a.productId}`)}>{L.products.get(a.productId)?.name ?? a.productId}</button> },
              { key: 'reason', header: 'Reason', render: (a) => <Badge>{ADJ_REASON_LABEL[a.reason]}</Badge> },
              { key: 'note', header: 'Note', render: (a) => <span className="secondary">{a.note ?? '—'}</span> },
              { key: 'by', header: 'By / approved', render: (a) => `${userName(L, a.userId)}${a.approvedBy ? ` · ${userName(L, a.approvedBy)}` : ''}` },
              { key: 'qty', header: 'Qty', align: 'right', render: (a) => <b className={a.qty < 0 ? 'bo-neg' : 'bo-pos'}>{a.qty > 0 ? '+' : ''}{fq(a.qty)}</b> },
            ]}
          />
        </Card>
      ) : (
        <Card className="bo-card-table">
          <DataTable
            rows={transfers}
            rowKey={(t) => t.id}
            loading={loading}
            empty={<EmptyState quiet icon="ArrowRightLeft" title="No transfers yet" actions={canAdjust ? <Button variant="primary" onClick={() => nav('/inventory/transfer')}>New transfer</Button> : undefined}>Move stock between stores with a paired transfer-out / transfer-in.</EmptyState>}
            columns={[
              { key: 'doc', header: 'Document', render: (t) => <span className="num bo-cell-main">{t.doc}</span> },
              { key: 'at', header: 'Date', render: (t) => <span className="num">{dateTime(t.at)}</span> },
              { key: 'route', header: 'From → To', render: (t) => `${s.storeName(t.from)} → ${s.storeName(t.to)}` },
              { key: 'by', header: 'By', render: (t) => userName(L, t.user) },
              { key: 'lines', header: 'Lines', align: 'right', render: (t) => t.lines },
              { key: 'qty', header: 'Units', align: 'right', render: (t) => fq(t.qty) },
              { key: 'st', header: 'Status', render: () => <Badge tone="success" icon="CircleCheck">Received</Badge> },
            ]}
          />
        </Card>
      )}
      {drill ? <BatchDrawer product={drill} onClose={() => setDrill(undefined)} /> : null}
    </PageFrame>
  );
}

function BatchDrawer({ product, onClose }: { product: Product; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const data = useLive(cloud, ['stockMovements', 'batches'], () => {
    const batches = batchesFor(cloud, product.id);
    return s.stores.filter((st) => s.scope.includes(st.id)).map((st) => ({
      store: st,
      total: onHandIn(cloud, [st.id], product.id),
      damaged: damagedIn(cloud, [st.id], product.id),
      batches: batches.map((b) => ({ b, qty: onHandIn(cloud, [st.id], product.id, b.id) })).filter((x) => x.qty !== 0),
    }));
  }, [product.id]);
  return (
    <Drawer open onClose={onClose} size="lg" title={product.name} description={`${product.sku} · stock by store${product.batchTracked ? ' and batch' : ''}`} footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon="History" onClick={() => nav(`/inventory/ledger/${product.id}`)}>Open stock ledger</Button></>}>
      <div className="ex-stack" style={{ gap: 16 }}>
        {data.map((d) => (
          <Card key={d.store.id} flat>
            <div className="bo-toolbar" style={{ justifyContent: 'space-between' }}>
              <b>{d.store.name}</b>
              <span className="num">On hand <b>{fq(d.total, product.decimalQty)}</b> {product.unit}{d.damaged ? <> · <span className="bo-neg">damaged {d.damaged}</span></> : null}</span>
            </div>
            {d.batches.length ? (
              <DataTable
                density="dense"
                rows={d.batches}
                rowKey={(x) => x.b.id}
                columns={[
                  { key: 'code', header: 'Batch', render: (x) => <span className="num bo-cell-main">{x.b.code}</span> },
                  { key: 'exp', header: 'Expiry', render: (x) => <span className="num">{date(x.b.expiryDate)}</span> },
                  { key: 'h', header: 'Status', render: (x) => <StatusBadge meta={EXPIRY_HEALTH[expiryHealth(x.b.expiryDate, 60)]} /> },
                  { key: 'qty', header: 'Qty', align: 'right', render: (x) => <b>{fq(x.qty)}</b> },
                  { key: 'val', header: 'Value', align: 'right', render: (x) => money(Math.round(x.qty * x.b.costPaise)) },
                ]}
              />
            ) : (
              <div className="muted" style={{ padding: 12, fontSize: 13 }}>{product.batchTracked ? 'No batch stock in this store.' : 'Not batch-tracked.'}</div>
            )}
          </Card>
        ))}
      </div>
    </Drawer>
  );
}
