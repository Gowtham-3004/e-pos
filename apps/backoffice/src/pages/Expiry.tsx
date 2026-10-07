import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, SearchInput, StatusBadge, Tabs } from '@elixir/ui';
import { batchesFor } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { date, daysUntil, money, number, qty as fq } from '@elixir/format';
import { ExportMenu, KpiRow, PageFrame, ScopeHint, useFirstPaint } from '../components/common';
import { includesQ, useCloud, useTenantProducts } from '../lib/data';
import { EXPIRY_HEALTH, onHandIn } from '../lib/stock';
import { downloadTable, rupees } from '../lib/csv';
import { useSession } from '../lib/session';

type Bucket = 'expired' | '30' | '60' | '90';

export function ExpiryPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const loading = useFirstPaint();
  const products = useTenantProducts();
  const [tab, setTab] = useState<Bucket>('expired');
  const [q, setQ] = useState('');

  const all = useLive(cloud, ['batches', 'stockMovements'], () => {
    const out: Array<{ key: string; productId: string; name: string; sku: string; batchId: string; code: string; expiry: string; days: number; storeId: string; qty: number; cost: number; mrp: number; rank: number; total: number; supplierHint?: string }> = [];
    for (const p of products) {
      if (!p.batchTracked) continue;
      const bs = batchesFor(cloud, p.id);
      for (const st of s.scope) {
        const withStock = bs.map((b) => ({ b, qty: onHandIn(cloud, [st], p.id, b.id) })).filter((x) => x.qty > 0);
        const live = withStock.filter((x) => daysUntil(x.b.expiryDate) >= 0);
        withStock.forEach((x) => {
          const d = daysUntil(x.b.expiryDate);
          if (d > 90) return;
          out.push({ key: `${st}|${x.b.id}`, productId: p.id, name: p.name, sku: p.sku, batchId: x.b.id, code: x.b.code, expiry: x.b.expiryDate, days: d, storeId: st, qty: x.qty, cost: Math.round(x.qty * x.b.costPaise), mrp: Math.round(x.qty * x.b.mrpPaise), rank: live.findIndex((l) => l.b.id === x.b.id) + 1, total: live.length });
        });
      }
    }
    return out.sort((a, b) => a.expiry.localeCompare(b.expiry));
  }, [products, s.scope.join(',')]);

  const inBucket = (r: (typeof all)[number], b: Bucket) => (b === 'expired' ? r.days < 0 : r.days >= 0 && r.days <= Number(b));
  const rows = useMemo(() => all.filter((r) => inBucket(r, tab) && includesQ(q, r.name, r.sku, r.code)), [all, tab, q]);
  const sumB = (b: Bucket) => all.filter((r) => inBucket(r, b));

  const hint = (r: (typeof all)[number]) => {
    if (r.days < 0) return <Badge tone="danger" icon="Ban">Blocked at POS · write off or return</Badge>;
    if (r.rank === 1 && r.total > 1) return <Badge tone="info" icon="ArrowDownWideNarrow">FEFO: sells first (1 of {r.total})</Badge>;
    if (r.rank === 1) return <Badge tone="info" icon="ArrowDownWideNarrow">FEFO: only live batch</Badge>;
    if (r.days <= 30) return <Badge tone="warning" icon="Tag">Mark down / move to front</Badge>;
    return <span className="muted">Queued #{r.rank} of {r.total}</span>;
  };

  const doExport = (kind: 'csv' | 'xls') => downloadTable(`expiry-${tab}`, ['Product', 'SKU', 'Batch', 'Expiry', 'Days left', 'Store', 'Qty', 'Value at cost', 'Value at MRP'], rows.map((r) => [r.name, r.sku, r.code, r.expiry, r.days, s.storeName(r.storeId), r.qty, rupees(r.cost), rupees(r.mrp)]), kind);

  return (
    <PageFrame
      title="Batch & Expiry"
      description={<>Batches with stock that are expired or expiring within 90 days. POS picks batches first-expiry-first-out (FEFO). · <ScopeHint /></>}
      crumbs={[{ label: 'Stock' }, { label: 'Batch & Expiry' }]}
      actions={s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} onPrint={() => window.print()} /> : undefined}
    >
      <KpiRow>
        <KpiCard label="Expired with stock" icon="CalendarX" tone="danger" value={number(sumB('expired').length)} foot={`${money(sumB('expired').reduce((a, r) => a + r.cost, 0), { whole: true })} at cost`} onClick={() => setTab('expired')} loading={loading} />
        <KpiCard label="Expiring ≤ 30 days" icon="CalendarClock" tone="warning" value={number(sumB('30').length)} foot={`${money(sumB('30').reduce((a, r) => a + r.cost, 0), { whole: true })} at cost`} onClick={() => setTab('30')} loading={loading} />
        <KpiCard label="Expiring ≤ 60 days" icon="CalendarClock" value={number(sumB('60').length)} foot={`${money(sumB('60').reduce((a, r) => a + r.cost, 0), { whole: true })} at cost`} onClick={() => setTab('60')} loading={loading} />
        <KpiCard label="Expiring ≤ 90 days" icon="CalendarRange" value={number(sumB('90').length)} foot={`${money(sumB('90').reduce((a, r) => a + r.mrp, 0), { whole: true })} at MRP`} onClick={() => setTab('90')} loading={loading} />
      </KpiRow>
      <Tabs items={[{ key: 'expired', label: 'Expired', count: sumB('expired').length }, { key: '30', label: '≤ 30 days', count: sumB('30').length }, { key: '60', label: '≤ 60 days', count: sumB('60').length }, { key: '90', label: '≤ 90 days', count: sumB('90').length }]} value={tab} onChange={setTab} />
      <Card className="bo-card-table">
        <div className="bo-toolbar"><SearchInput placeholder="Search product, SKU or batch" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} /></div>
        <DataTable
          loading={loading}
          rows={rows}
          rowKey={(r) => r.key}
          empty={<EmptyState quiet icon="CalendarCheck" title={tab === 'expired' ? 'No expired stock' : 'Nothing expiring in this window'}>Good — no batches with stock fall in this range.</EmptyState>}
          footer={rows.length ? <div className="bo-tfoot"><span>{rows.length} batch-store rows</span><span>Qty <b>{fq(rows.reduce((a, r) => a + r.qty, 0))}</b></span><span>At cost <b>{money(rows.reduce((a, r) => a + r.cost, 0))}</b></span><span>At MRP <b>{money(rows.reduce((a, r) => a + r.mrp, 0))}</b></span></div> : undefined}
          columns={[
            { key: 'name', header: 'Product', render: (r) => <div><button type="button" className="bo-link" onClick={() => nav(`/products/${r.productId}`)}>{r.name}</button><div className="bo-cell-sub num">{r.sku}</div></div> },
            { key: 'code', header: 'Batch', render: (r) => <span className="num bo-cell-main">{r.code}</span> },
            { key: 'expiry', header: 'Expiry', render: (r) => <span className="num">{date(r.expiry)}</span> },
            { key: 'days', header: 'Days', align: 'right', render: (r) => <b className={r.days < 0 ? 'bo-neg' : undefined}>{r.days < 0 ? `${-r.days} ago` : r.days}</b> },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge meta={EXPIRY_HEALTH[r.days < 0 ? 'expired' : 'near']} label={r.days < 0 ? 'Expired' : r.days <= 30 ? 'Near expiry' : 'Watch'} /> },
            { key: 'store', header: 'Store', hidden: s.scope.length < 2, render: (r) => s.storeName(r.storeId) },
            { key: 'qty', header: 'Stock', align: 'right', render: (r) => fq(r.qty) },
            { key: 'cost', header: 'Value (cost)', align: 'right', render: (r) => money(r.cost) },
            { key: 'hint', header: 'FEFO / action', render: (r) => hint(r) },
            { key: 'act', header: '', align: 'right', render: (r) => (s.can('inventory.adjust') && r.days <= 30 ? <Button size="sm" variant={r.days < 0 ? 'danger-outline' : 'ghost'} onClick={() => nav(`/inventory/adjust?product=${r.productId}&store=${r.storeId}&batch=${r.batchId}&reason=expiry`)}>Write off</Button> : null) },
          ]}
        />
      </Card>
    </PageFrame>
  );
}
