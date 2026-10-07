import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, KpiCard, SearchInput, Select, Segmented, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, number, qty as fq } from '@elixir/format';
import { KpiRow, PageFrame } from '../../components/common';
import { includesQ, useCloud, useLookups, useTenantProducts } from '../../lib/data';
import { onHandIn } from '../../lib/stock';
import { postStockTake } from '../../lib/ops';
import { useSession } from '../../lib/session';

/** Count sheet → variance → post count-correction adjustments. */
export function StockTakePage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const L = useLookups();
  const products = useTenantProducts();
  const [store, setStore] = useState(s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? '');
  const [cat, setCat] = useState(() => [...L.categories.values()].sort((a, b) => a.sortOrder - b.sortOrder)[0]?.id ?? '');
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [show, setShow] = useState<'all' | 'variance' | 'uncounted'>('all');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const sheet = useLive(cloud, ['stockMovements'], () => products.filter((p) => p.active && (!cat || p.categoryId === cat)).map((p) => ({ p, system: onHandIn(cloud, [store], p.id) })).sort((a, b) => (a.p.rack ?? '').localeCompare(b.p.rack ?? '') || a.p.name.localeCompare(b.p.name)), [products, cat, store]);
  const rows = useMemo(() => sheet.map((r) => {
    const c = counts[r.p.id];
    const counted = c === undefined || c === '' ? undefined : Number(c);
    const variance = counted === undefined || !isFinite(counted) ? undefined : Math.round((counted - r.system) * 1000) / 1000;
    return { ...r, counted, variance };
  }).filter((r) => includesQ(q, r.p.name, r.p.sku, r.p.barcode, r.p.rack) && (show === 'all' || (show === 'variance' ? !!r.variance : r.counted === undefined))), [sheet, counts, q, show]);
  const counted = sheet.filter((r) => counts[r.p.id] !== undefined && counts[r.p.id] !== '');
  const withVar = counted.map((r) => ({ r, v: Math.round((Number(counts[r.p.id]) - r.system) * 1000) / 1000 })).filter((x) => x.v !== 0 && isFinite(x.v));
  const value = withVar.reduce((a, x) => a + Math.round(x.v * x.r.p.costPaise), 0);

  const post = async () => {
    setBusy(true);
    const r = await postStockTake(cloud, { tenantId: s.tenant.id, storeId: store, lines: withVar.map((x) => ({ productId: x.r.p.id, variance: x.v })), userId: s.user.id, note: `${L.categories.get(cat)?.name ?? 'All'} count sheet` });
    setBusy(false);
    setConfirm(false);
    toast.success(`Stock take ${r.docNo} posted`, `${r.count} count-correction adjustment(s) created`);
    nav('/inventory?tab=adjustments');
  };

  return (
    <PageFrame crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: 'Stock take' }]} title="Stock take" description="Enter physical counts. Only lines with a variance post a count-correction adjustment.">
      <div className="ex-row" style={{ flexWrap: 'wrap' }}>
        <Select size="sm" aria-label="Store" value={store} onChange={(e) => { setStore(e.target.value); setCounts({}); }} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
        <Select size="sm" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...[...L.categories.values()].map((c) => ({ value: c.id, label: c.name }))]} />
      </div>
      <KpiRow>
        <KpiCard label="Items on sheet" icon="ClipboardList" value={number(sheet.length)} />
        <KpiCard label="Counted" icon="ClipboardCheck" value={`${counted.length} / ${sheet.length}`} />
        <KpiCard label="Lines with variance" icon="Scale" tone={withVar.length ? 'warning' : undefined} value={number(withVar.length)} />
        <KpiCard label="Variance value (cost)" icon="IndianRupee" tone={value < 0 ? 'danger' : undefined} value={money(value, { signed: true })} />
      </KpiRow>
      <Card className="bo-card-table">
        <CardHeader title={`Count sheet · ${s.storeName(store)}`} subtitle="Sorted by rack for walking order" icon="ClipboardList" actions={<Button size="sm" variant="ghost" onClick={() => setCounts(Object.fromEntries(sheet.map((r) => [r.p.id, String(r.system)])))}>Fill with system qty</Button>} />
        <div className="bo-toolbar">
          <SearchInput placeholder="Search or scan" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <Segmented label="Show" items={[{ key: 'all', label: 'All' }, { key: 'uncounted', label: 'Uncounted' }, { key: 'variance', label: 'Variances' }]} value={show} onChange={setShow} />
        </div>
        <div className="bo-doc-grid">
          <DataTable
            rows={rows}
            rowKey={(r) => r.p.id}
            pageSize={50}
            columns={[
              { key: 'rack', header: 'Rack', render: (r) => <span className="num muted">{r.p.rack ?? '—'}</span> },
              { key: 'p', header: 'Product', render: (r) => <div><div className="bo-cell-main">{r.p.name}</div><div className="bo-cell-sub num">{r.p.sku}</div></div> },
              { key: 'sys', header: 'System qty', align: 'right', render: (r) => fq(r.system, r.p.decimalQty) },
              { key: 'cnt', header: 'Counted', align: 'right', width: 130, render: (r) => <input className="num" inputMode="decimal" aria-label={`Count for ${r.p.name}`} value={counts[r.p.id] ?? ''} placeholder="—" onChange={(e) => setCounts({ ...counts, [r.p.id]: e.target.value })} /> },
              { key: 'var', header: 'Variance', align: 'right', render: (r) => (r.variance === undefined ? <span className="muted">—</span> : r.variance === 0 ? <Badge tone="success" icon="Check">Match</Badge> : <b className={r.variance < 0 ? 'bo-neg' : 'bo-pos'}>{r.variance > 0 ? '+' : ''}{fq(r.variance)}</b>) },
              { key: 'val', header: 'Value', align: 'right', render: (r) => (r.variance ? money(Math.round(r.variance * r.p.costPaise), { signed: true }) : '') },
            ]}
          />
        </div>
      </Card>
      <div className="bo-sticky-actions">
        <span className="muted">{withVar.length} variance line(s) will post · {sheet.length - counted.length} uncounted items are left unchanged</span>
        <div className="ex-spacer" />
        <Button onClick={() => nav('/inventory')}>Discard</Button>
        <Button variant="primary" icon="Check" disabled={!withVar.length} onClick={() => setConfirm(true)}>Post variances</Button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} busy={busy} title="Post stock take variances?" confirmLabel={`Post ${withVar.length} adjustment(s)`} onConfirm={post}>
        {withVar.length} count-correction adjustment(s) worth {money(value, { signed: true })} at cost will be posted to {s.storeName(store)}. Each creates an immutable stock movement and audit entry.
      </ConfirmDialog>
    </PageFrame>
  );
}
