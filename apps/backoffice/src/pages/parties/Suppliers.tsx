import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, SearchInput } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, daysUntil, money, number } from '@elixir/format';
import { KpiRow, PageFrame, useFirstPaint } from '../../components/common';
import { SupplierModal } from '../../components/PartyModals';
import { includesQ, sum, useCloud } from '../../lib/data';
import { supplierDues } from '../../lib/finance';
import { useSession } from '../../lib/session';

export function Suppliers() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const loading = useFirstPaint();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const pharma = s.tenant.vertical === 'pharmacy';
  const data = useLive(cloud, ['suppliers', 'purchases'], () => cloud.where('suppliers', (x) => x.tenantId === s.tenant.id).map((sup) => {
    const purchases = cloud.where('purchases', (p) => p.supplierId === sup.id && p.status === 'posted' && p.totalPaise > 0);
    const dues = supplierDues(cloud, sup);
    return { sup, count: purchases.length, value: sum(purchases, (p) => p.totalPaise), last: purchases.map((p) => p.invoiceDate).sort().pop(), overdue: dues.overdue };
  }), [s.tenant.id]);
  const rows = useMemo(() => data.filter((r) => includesQ(q, r.sup.name, r.sup.gstin, r.sup.city, r.sup.phone)).sort((a, b) => b.sup.outstandingPaise - a.sup.outstandingPaise), [data, q]);
  const licenceAlerts = data.filter((r) => r.sup.licenceValidUntil && daysUntil(r.sup.licenceValidUntil) <= 30);
  return (
    <PageFrame title="Suppliers" description="Vendors you purchase from — payables, terms and compliance." crumbs={[{ label: 'Parties' }, { label: 'Suppliers' }]}
      actions={s.can('suppliers.edit') ? <Button variant="primary" icon="Plus" onClick={() => setAdding(true)}>Add supplier</Button> : undefined}>
      <KpiRow>
        <KpiCard label="Suppliers" icon="Truck" value={number(data.length)} loading={loading} />
        <KpiCard label="Payables" icon="ArrowUpRight" value={money(sum(data, (r) => r.sup.outstandingPaise), { whole: true })} foot={`${data.filter((r) => r.sup.outstandingPaise > 0).length} with balance`} loading={loading} />
        <KpiCard label="Overdue" icon="AlarmClock" tone={data.some((r) => r.overdue) ? 'warning' : undefined} value={money(sum(data, (r) => r.overdue), { whole: true })} foot="Past supplier payable terms" loading={loading} />
        {pharma ? <KpiCard label="Licence alerts" icon="BadgeAlert" tone={licenceAlerts.length ? 'danger' : undefined} value={number(licenceAlerts.length)} foot="Drug licence expiring ≤ 30 days" loading={loading} /> : <KpiCard label="Purchases (all time)" icon="ShoppingCart" value={money(sum(data, (r) => r.value), { whole: true })} loading={loading} />}
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar"><SearchInput placeholder="Search name, GSTIN, city" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} /></div>
        <DataTable loading={loading} rows={rows} rowKey={(r) => r.sup.id} onRowClick={(r) => nav(`/suppliers/${r.sup.id}`)} empty={<EmptyState quiet icon="Truck" title="No suppliers match" />}
          columns={[
            { key: 'name', header: 'Supplier', sortable: true, sortValue: (r) => r.sup.name, render: (r) => <div><div className="bo-cell-main">{r.sup.name}</div><div className="bo-cell-sub">{r.sup.city} · {r.sup.phone}</div></div> },
            { key: 'gstin', header: 'GSTIN', render: (r) => <span className="num">{r.sup.gstin}</span> },
            { key: 'terms', header: 'Terms', align: 'right', render: (r) => `${r.sup.payableDays} days` },
            ...(pharma ? [{ key: 'lic', header: 'Drug licence', render: (r: (typeof rows)[number]) => (r.sup.licenceValidUntil ? (daysUntil(r.sup.licenceValidUntil) <= 30 ? <Badge tone="danger" icon="BadgeAlert">Expires {date(r.sup.licenceValidUntil)}</Badge> : <span className="num">{r.sup.licenceNo} · {date(r.sup.licenceValidUntil)}</span>) : '—') }] : []),
            { key: 'count', header: 'Purchases', align: 'right', render: (r) => number(r.count) },
            { key: 'last', header: 'Last invoice', render: (r) => (r.last ? date(r.last) : '—') },
            { key: 'out', header: 'Outstanding', align: 'right', sortable: true, sortValue: (r) => r.sup.outstandingPaise, render: (r) => (r.sup.outstandingPaise ? <b>{money(r.sup.outstandingPaise)}</b> : <span className="muted">—</span>) },
            { key: 'od', header: 'Overdue', align: 'right', render: (r) => (r.overdue ? <Badge tone="warning" icon="AlarmClock">{money(r.overdue, { whole: true })}</Badge> : <span className="muted">—</span>) },
          ]} />
      </Card>
      {adding ? <SupplierModal onClose={() => setAdding(false)} /> : null}
    </PageFrame>
  );
}
