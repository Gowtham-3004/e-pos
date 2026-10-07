import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Sale, SyncState, TenderMethod, TransactionStatus } from '@elixir/contracts';
import { SYNC_STATE, TRANSACTION_STATUS } from '@elixir/domain';
import { Card, DataTable, EmptyState, FilterChip, KpiCard, SearchInput, Select, StatusBadge, type Column } from '@elixir/ui';
import { dateTime, money, number } from '@elixir/format';
import { DateRangeControl, ExportMenu, KpiRow, PageFrame, StoreFilter, useFirstPaint, useRange } from '../../components/common';
import { countable, includesQ, METHOD_LABEL, sum, useLookups, useScopedSales, userName } from '../../lib/data';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';

export function SalesList() {
  const s = useSession();
  const nav = useNavigate();
  const L = useLookups();
  const all = useScopedSales();
  const loading = useFirstPaint();
  const [range, setRange] = useRange('7d');
  const [q, setQ] = useState('');
  const [store, setStore] = useState('');
  const [counter, setCounter] = useState('');
  const [cashier, setCashier] = useState('');
  const [method, setMethod] = useState<TenderMethod | ''>('');
  const [status, setStatus] = useState<TransactionStatus | ''>('');
  const [sync, setSync] = useState<SyncState | ''>('');

  const inRange = useMemo(() => all.filter((x) => x.businessDate >= range.from && x.businessDate <= range.to), [all, range.from, range.to]);
  const rows = useMemo(
    () =>
      inRange
        .filter((x) => (!store || x.storeId === store) && (!counter || x.counterId === counter) && (!cashier || x.userId === cashier) && (!method || x.tenders.some((t) => t.method === method)) && (!status || x.status === status) && (!sync || x.syncState === sync) && includesQ(q, x.documentNo, x.customerName, L.customers.get(x.customerId ?? '')?.phone))
        .sort((a, b) => b.committedAt.localeCompare(a.committedAt)),
    [inRange, store, counter, cashier, method, status, sync, q, L.customers],
  );

  const counters = useMemo(() => [...new Set(inRange.map((x) => x.counterId))].map((id) => L.counters.get(id)).filter(Boolean).filter((c) => !store || c!.storeId === store), [inRange, L.counters, store]);
  const cashiers = useMemo(() => [...new Set(inRange.map((x) => x.userId))].map((id) => L.users.get(id)).filter(Boolean), [inRange, L.users]);
  const ok = rows.filter(countable);
  const total = sum(ok, (x) => x.totalPaise);

  const active = [
    store && { key: 'store', label: `Store: ${s.storeName(store)}`, clear: () => setStore('') },
    counter && { key: 'counter', label: `Counter: ${L.counters.get(counter)?.code}`, clear: () => setCounter('') },
    cashier && { key: 'cashier', label: `Cashier: ${userName(L, cashier)}`, clear: () => setCashier('') },
    method && { key: 'method', label: `Method: ${METHOD_LABEL[method]}`, clear: () => setMethod('') },
    status && { key: 'status', label: `Status: ${TRANSACTION_STATUS[status].label}`, clear: () => setStatus('') },
    sync && { key: 'sync', label: `Sync: ${SYNC_STATE[sync].label}`, clear: () => setSync('') },
    q && { key: 'q', label: `Search: “${q}”`, clear: () => setQ('') },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const cols: Column<Sale>[] = [
    { key: 'documentNo', header: 'Invoice', sortable: true, render: (r) => <span className="bo-cell-main num">{r.documentNo}</span> },
    { key: 'committedAt', header: 'Date & time', sortable: true, render: (r) => <span className="num">{dateTime(r.committedAt)}</span> },
    { key: 'store', header: 'Store · Counter', render: (r) => <span>{s.scope.length > 1 ? `${s.storeName(r.storeId)} · ` : ''}{L.counters.get(r.counterId)?.code}</span> },
    { key: 'cashier', header: s.family === 'restaurant' ? 'Cashier' : 'Cashier', render: (r) => userName(L, r.userId) },
    { key: 'customer', header: 'Customer', render: (r) => r.customerName ?? <span className="muted">Walk-in</span> },
    { key: 'itemCount', header: 'Items', align: 'right', sortable: true, render: (r) => number(r.itemCount) },
    { key: 'method', header: 'Payment', render: (r) => r.tenders.map((t) => METHOD_LABEL[t.method]).join(' + ') },
    { key: 'totalPaise', header: 'Total', align: 'right', sortable: true, render: (r) => <b className="num">{money(r.totalPaise)}</b> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge meta={TRANSACTION_STATUS[r.status]} /> },
    { key: 'sync', header: 'Sync', render: (r) => <StatusBadge meta={SYNC_STATE[r.syncState]} /> },
  ];

  const exportRows = (kind: 'csv' | 'xls') =>
    downloadTable(
      `sales-${range.from}-to-${range.to}`,
      ['Invoice', 'Business date', 'Committed at', 'Store', 'Counter', 'Cashier', 'Customer', 'Items', 'Payment', 'Taxable', 'Tax', 'Total', 'Status', 'Sync'],
      rows.map((r) => [r.documentNo, r.businessDate, r.committedAt, s.storeName(r.storeId), L.counters.get(r.counterId)?.code, userName(L, r.userId), r.customerName ?? 'Walk-in', r.itemCount, r.tenders.map((t) => METHOD_LABEL[t.method]).join('+'), rupees(r.taxablePaise), rupees(r.taxPaise), rupees(r.totalPaise), TRANSACTION_STATUS[r.status].label, SYNC_STATE[r.syncState].label]),
      kind,
    );

  return (
    <PageFrame
      title="Sales"
      description="All invoices synced from POS counters. Posted invoices are read-only."
      crumbs={[{ label: 'Overview', to: '/' }, { label: 'Sales' }]}
      actions={s.can('reports.export') ? <ExportMenu onCsv={() => exportRows('csv')} onXls={() => exportRows('xls')} onPrint={() => window.print()} /> : undefined}
    >
      <DateRangeControl value={range} onChange={setRange} />
      <KpiRow>
        <KpiCard label="Net sales" icon="IndianRupee" value={money(total)} loading={loading} />
        <KpiCard label="Invoices" icon="Receipt" value={number(ok.length)} foot={`${rows.length - ok.length} cancelled · ${rows.filter((r) => r.status === 'returned').length} with returns`} loading={loading} />
        <KpiCard label="Average bill" icon="Calculator" value={money(ok.length ? Math.round(total / ok.length) : 0)} loading={loading} />
        <KpiCard label="Awaiting sync" icon="CloudUpload" value={number(rows.filter((r) => r.syncState !== 'synced').length)} tone={rows.some((r) => r.syncState !== 'synced') ? 'warning' : undefined} foot="Committed on device, not yet in cloud" loading={loading} />
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <SearchInput placeholder="Search invoice no., customer or phone" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <StoreFilter value={store} onChange={(v) => { setStore(v); setCounter(''); }} />
          <Select size="sm" aria-label="Counter" value={counter} onChange={(e) => setCounter(e.target.value)} options={[{ value: '', label: 'All counters' }, ...counters.map((c) => ({ value: c!.id, label: `${c!.code}${s.scope.length > 1 ? ` · ${s.storeName(c!.storeId)}` : ''}` }))]} />
          <Select size="sm" aria-label="Cashier" value={cashier} onChange={(e) => setCashier(e.target.value)} options={[{ value: '', label: 'All cashiers' }, ...cashiers.map((u) => ({ value: u!.id, label: u!.name }))]} />
          <Select size="sm" aria-label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as TenderMethod | '')} options={[{ value: '', label: 'All methods' }, ...(['cash', 'upi', 'card', 'credit'] as TenderMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m] }))]} />
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as TransactionStatus | '')} options={[{ value: '', label: 'All statuses' }, ...(['paid', 'partially-paid', 'returned', 'cancelled'] as TransactionStatus[]).map((m) => ({ value: m, label: TRANSACTION_STATUS[m].label }))]} />
          <Select size="sm" aria-label="Sync state" value={sync} onChange={(e) => setSync(e.target.value as SyncState | '')} options={[{ value: '', label: 'Any sync state' }, ...(['synced', 'pending', 'conflict', 'failed'] as SyncState[]).map((m) => ({ value: m, label: SYNC_STATE[m].label }))]} />
        </div>
        {active.length ? (
          <div className="bo-toolbar-chips">
            {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={a.clear} />)}
            <button type="button" className="ex-btn ex-btn--ghost ex-btn--sm" onClick={() => active.forEach((a) => a.clear())}>Clear all</button>
          </div>
        ) : null}
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.id}
          loading={loading}
          onRowClick={(r) => nav(`/sales/${r.id}`)}
          pageSize={25}
          empty={<EmptyState quiet icon="Receipt" title="No invoices match">Try a wider date range or clear filters. Sales made offline appear here once the counter syncs.</EmptyState>}
          footer={rows.length ? <div className="bo-tfoot"><span>{number(ok.length)} invoices</span><span>Taxable <b>{money(sum(ok, (x) => x.taxablePaise))}</b></span><span>Tax <b>{money(sum(ok, (x) => x.taxPaise))}</b></span><span>Total <b>{money(total)}</b></span></div> : undefined}
        />
      </Card>
    </PageFrame>
  );
}
