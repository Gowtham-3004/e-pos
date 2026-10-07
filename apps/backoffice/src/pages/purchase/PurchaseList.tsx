import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Purchase } from '@elixir/contracts';
import { Badge, Button, Card, DataTable, EmptyState, KpiCard, SearchInput, Select, StatusBadge, Tabs, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, money, number } from '@elixir/format';
import { DateRangeControl, ExportMenu, KpiRow, PageFrame, StoreFilter, useFirstPaint, useRange } from '../../components/common';
import { includesQ, sum, useCloud, useLookups } from '../../lib/data';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';
import { PAYMENT_STATUS, PURCHASE_STATUS, isDebitNote } from './purchaseMeta';

export function PurchaseList() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint();
  const [tab, setTab] = useState<'all' | 'draft' | 'posted' | 'debit' | 'cancelled'>('all');
  const [range, setRange] = useRange('30d');
  const [q, setQ] = useState('');
  const [supplier, setSupplier] = useState('');
  const [pay, setPay] = useState('');
  const [store, setStore] = useState('');
  const all = useLive(cloud, ['purchases'], () => cloud.where('purchases', (p) => p.tenantId === s.tenant.id && s.scope.includes(p.storeId)), [s.tenant.id, s.scope.join(',')]);
  const inRange = useMemo(() => all.filter((p) => p.status === 'draft' || (p.invoiceDate >= range.from && p.invoiceDate <= range.to)), [all, range.from, range.to]);
  const rows = useMemo(() => inRange.filter((p) => {
    if (tab === 'draft' && p.status !== 'draft') return false;
    if (tab === 'posted' && (p.status !== 'posted' || isDebitNote(p))) return false;
    if (tab === 'debit' && !isDebitNote(p)) return false;
    if (tab === 'cancelled' && p.status !== 'cancelled') return false;
    return (!supplier || p.supplierId === supplier) && (!pay || (p.status === 'posted' && !isDebitNote(p) && p.paymentStatus === pay)) && (!store || p.storeId === store) && includesQ(q, p.documentNo, p.supplierInvoiceNo, L.suppliers.get(p.supplierId)?.name);
  }).sort((a, b) => (a.status === 'draft' ? -1 : 0) - (b.status === 'draft' ? -1 : 0) || b.createdAt.localeCompare(a.createdAt)), [inRange, tab, supplier, pay, store, q, L.suppliers]);
  const posted = inRange.filter((p) => p.status === 'posted' && !isDebitNote(p));
  const dn = inRange.filter(isDebitNote);

  const cols: Column<Purchase>[] = [
    { key: 'documentNo', header: 'Document', sortable: true, render: (p) => <div><div className="bo-cell-main num">{p.documentNo}</div><div className="bo-cell-sub">{p.supplierInvoiceNo}</div></div> },
    { key: 'invoiceDate', header: 'Invoice date', sortable: true, render: (p) => <span className="num">{date(p.invoiceDate)}</span> },
    { key: 'supplier', header: 'Supplier', render: (p) => L.suppliers.get(p.supplierId)?.name },
    { key: 'store', header: 'Store', hidden: s.scope.length < 2, render: (p) => s.storeName(p.storeId) },
    { key: 'lines', header: 'Lines', align: 'right', render: (p) => p.lines.length },
    { key: 'totalPaise', header: 'Total', align: 'right', sortable: true, render: (p) => <b>{money(p.totalPaise)}</b> },
    { key: 'due', header: 'Balance', align: 'right', render: (p) => (p.status === 'posted' && !isDebitNote(p) ? money(p.totalPaise - p.paidPaise) : '—') },
    { key: 'status', header: 'Status', render: (p) => (isDebitNote(p) ? <Badge tone="warning" icon="Undo2">Debit note</Badge> : <StatusBadge meta={PURCHASE_STATUS[p.status]} />) },
    { key: 'pay', header: 'Payment', render: (p) => (p.status === 'posted' && !isDebitNote(p) ? <StatusBadge meta={PAYMENT_STATUS[p.paymentStatus]} /> : <span className="muted">—</span>) },
  ];

  const doExport = (kind: 'csv' | 'xls') => downloadTable(`purchases-${range.from}-${range.to}`, ['Document', 'Supplier invoice', 'Invoice date', 'Supplier', 'GSTIN', 'Store', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Status', 'Payment'], rows.map((p) => [p.documentNo, p.supplierInvoiceNo, p.invoiceDate, L.suppliers.get(p.supplierId)?.name, L.suppliers.get(p.supplierId)?.gstin, s.storeName(p.storeId), rupees(p.subtotalPaise), rupees(p.discountPaise), rupees(p.taxPaise), rupees(p.totalPaise), rupees(p.paidPaise), isDebitNote(p) ? 'Debit note' : PURCHASE_STATUS[p.status].label, p.paymentStatus]), kind);

  return (
    <PageFrame
      title="Purchase"
      description="Supplier invoices. Drafts can be edited; posted purchases are read-only and update stock and payables."
      crumbs={[{ label: 'Stock' }, { label: 'Purchase' }]}
      actions={
        <>
          {s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} /> : null}
          {s.can('purchase.post') ? <Button variant="primary" icon="Plus" onClick={() => nav('/purchase/new')}>New purchase</Button> : null}
        </>
      }
    >
      <DateRangeControl value={range} onChange={setRange} />
      <KpiRow>
        <KpiCard label="Purchases posted" icon="ShoppingCart" value={money(sum(posted, (p) => p.totalPaise), { whole: true })} foot={`${posted.length} invoices in range`} loading={loading} />
        <KpiCard label="Drafts" icon="FilePen" value={number(all.filter((p) => p.status === 'draft').length)} foot="Not yet affecting stock" onClick={() => setTab('draft')} loading={loading} />
        <KpiCard label="Unpaid balance" icon="Landmark" tone="warning" value={money(sum(posted, (p) => p.totalPaise - p.paidPaise), { whole: true })} foot={`${posted.filter((p) => p.paymentStatus !== 'paid').length} invoices open`} loading={loading} />
        <KpiCard label="Debit notes (returns)" icon="Undo2" value={money(-sum(dn, (p) => p.totalPaise), { whole: true })} foot={`${dn.length} in range`} onClick={() => setTab('debit')} loading={loading} />
      </KpiRow>
      <Tabs items={[{ key: 'all', label: 'All', count: inRange.length }, { key: 'draft', label: 'Drafts', count: inRange.filter((p) => p.status === 'draft').length }, { key: 'posted', label: 'Posted', count: posted.length }, { key: 'debit', label: 'Debit notes', count: dn.length }, { key: 'cancelled', label: 'Cancelled', count: inRange.filter((p) => p.status === 'cancelled').length }]} value={tab} onChange={setTab} />
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <SearchInput placeholder="Search document, supplier invoice, supplier" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <Select size="sm" aria-label="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} options={[{ value: '', label: 'All suppliers' }, ...[...L.suppliers.values()].map((x) => ({ value: x.id, label: x.name }))]} />
          <Select size="sm" aria-label="Payment status" value={pay} onChange={(e) => setPay(e.target.value)} options={[{ value: '', label: 'Any payment' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'partially-paid', label: 'Partially Paid' }, { value: 'paid', label: 'Paid' }]} />
          <StoreFilter value={store} onChange={setStore} />
        </div>
        <DataTable columns={cols} rows={rows} rowKey={(p) => p.id} loading={loading} onRowClick={(p) => nav(`/purchase/${p.id}`)} empty={<EmptyState quiet icon="ShoppingCart" title="No purchases in this view" actions={s.can('purchase.post') ? <Button variant="primary" onClick={() => nav('/purchase/new')}>New purchase</Button> : undefined}>Record supplier invoices to receive stock and track payables.</EmptyState>} footer={rows.length ? <div className="bo-tfoot"><span>{rows.length} documents</span><span>Total <b>{money(sum(rows.filter((p) => p.status !== 'cancelled'), (p) => p.totalPaise))}</b></span></div> : undefined} />
      </Card>
    </PageFrame>
  );
}
