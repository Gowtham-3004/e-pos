import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Customer, Supplier } from '@elixir/contracts';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, InlineAlert, KpiCard, SearchInput, Tabs } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, dateTime, money, number } from '@elixir/format';
import { ExportMenu, KpiRow, PageFrame, useFirstPaint } from '../components/common';
import { PaymentModal } from '../components/PartyModals';
import { includesQ, METHOD_LABEL, sum, useCloud, useLookups, userName } from '../lib/data';
import { customerAgeing, supplierDues } from '../lib/finance';
import { downloadTable, rupees } from '../lib/csv';
import { useSession } from '../lib/session';

export function FinancePage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint();
  const [params, setParams] = useSearchParams();
  const hasR = s.has('receivables');
  const hasP = s.has('payables');
  const tab = (params.get('tab') as 'receivables' | 'payables') ?? (hasR ? 'receivables' : 'payables');
  const [q, setQ] = useState('');
  const [payFor, setPayFor] = useState<{ party: Customer | Supplier; kind: 'customer' | 'supplier' }>();
  const canRecord = s.can('finance.view') && (s.role.code === 'owner' || s.role.code === 'manager' || s.role.code === 'accountant');

  const rec = useLive(cloud, ['customers', 'sales'], () => cloud.where('customers', (c) => c.tenantId === s.tenant.id && c.outstandingPaise > 0).map((c) => ({ c, ...customerAgeing(cloud, c) })).sort((a, b) => b.c.outstandingPaise - a.c.outstandingPaise), [s.tenant.id]);
  const pay = useLive(cloud, ['suppliers', 'purchases'], () => cloud.where('suppliers', (x) => x.tenantId === s.tenant.id && x.outstandingPaise !== 0).map((sup) => {
    const d = supplierDues(cloud, sup);
    const next = d.items.filter((i) => i.due > 0 && i.overdueDays === 0)[0];
    return { sup, ...d, next };
  }).sort((a, b) => b.overdue - a.overdue || b.sup.outstandingPaise - a.sup.outstandingPaise), [s.tenant.id]);
  const recent = useLive(cloud, ['payments'], () => cloud.where('payments', (p) => p.tenantId === s.tenant.id && p.partyType === (tab === 'receivables' ? 'customer' : 'supplier')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8), [s.tenant.id, tab]);

  const rRows = rec.filter((r) => includesQ(q, r.c.name, r.c.phone, r.c.gstin));
  const pRows = pay.filter((r) => includesQ(q, r.sup.name, r.sup.gstin));
  const rB = { b0: sum(rec, (r) => r.buckets.b0), b31: sum(rec, (r) => r.buckets.b31), b61: sum(rec, (r) => r.buckets.b61), total: sum(rec, (r) => r.buckets.total) };
  const pB = { b0: sum(pay, (r) => r.buckets.b0), b31: sum(pay, (r) => r.buckets.b31), b61: sum(pay, (r) => r.buckets.b61), total: sum(pay, (r) => r.buckets.total), overdue: sum(pay, (r) => r.overdue) };
  const masterR = sum(rec, (r) => r.c.outstandingPaise);
  const masterP = sum(pay, (r) => r.sup.outstandingPaise);

  const doExport = (kind: 'csv' | 'xls') => tab === 'receivables'
    ? downloadTable('receivables-ageing', ['Customer', 'Phone', 'GSTIN', 'Credit limit', '0-30', '31-60', '60+', 'Total'], rRows.map((r) => [r.c.name, r.c.phone, r.c.gstin, rupees(r.c.creditLimitPaise), rupees(r.buckets.b0), rupees(r.buckets.b31), rupees(r.buckets.b61), rupees(r.buckets.total)]), kind)
    : downloadTable('payables-ageing', ['Supplier', 'GSTIN', 'Terms', '0-30', '31-60', '60+', 'Overdue', 'Total'], pRows.map((r) => [r.sup.name, r.sup.gstin, r.sup.payableDays, rupees(r.buckets.b0), rupees(r.buckets.b31), rupees(r.buckets.b61), rupees(r.overdue), rupees(r.buckets.total)]), kind);

  return (
    <PageFrame title="Receivables & Payables" description="Ageing reconciles exactly with customer and supplier balances (FR-RPT-005)." crumbs={[{ label: 'Finance' }, { label: 'Receivables & Payables' }]}
      actions={s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} onPrint={() => window.print()} /> : undefined}>
      <Tabs items={[...(hasR ? [{ key: 'receivables' as const, label: 'Receivables', count: rec.length }] : []), ...(hasP ? [{ key: 'payables' as const, label: 'Payables', count: pay.length }] : [])]} value={tab} onChange={(k) => setParams({ tab: k })} />
      {tab === 'receivables' ? (
        <>
          <KpiRow>
            <KpiCard label="Total receivable" icon="ArrowDownLeft" value={money(rB.total)} foot={`${rec.length} customers`} loading={loading} />
            <KpiCard label="0 – 30 days" icon="Clock" value={money(rB.b0)} loading={loading} />
            <KpiCard label="31 – 60 days" icon="Clock" tone="warning" value={money(rB.b31)} loading={loading} />
            <KpiCard label="60+ days" icon="AlarmClock" tone="danger" value={money(rB.b61)} loading={loading} />
          </KpiRow>
          {rB.total !== masterR ? <InlineAlert tone="danger">Ageing total {money(rB.total)} ≠ customer balances {money(masterR)}.</InlineAlert> : null}
          <Card className="bo-card-table">
            <div className="bo-toolbar"><SearchInput placeholder="Search customer" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} /></div>
            <DataTable loading={loading} rows={rRows} rowKey={(r) => r.c.id} onRowClick={(r) => nav(`/customers/${r.c.id}`)} empty={<EmptyState quiet icon="CircleCheck" title="No receivables">No customer owes money right now.</EmptyState>}
              footer={<div className="bo-tfoot"><span>0–30 <b>{money(sum(rRows, (r) => r.buckets.b0))}</b></span><span>31–60 <b>{money(sum(rRows, (r) => r.buckets.b31))}</b></span><span>60+ <b>{money(sum(rRows, (r) => r.buckets.b61))}</b></span><span>Total <b>{money(sum(rRows, (r) => r.buckets.total))}</b></span>{rB.total === masterR ? <Badge tone="success" icon="CircleCheck">Reconciled with customer balances</Badge> : null}</div>}
              columns={[
                { key: 'n', header: 'Customer', render: (r) => <div><div className="bo-cell-main">{r.c.name}</div><div className="bo-cell-sub num">{r.c.phone}{r.c.gstin ? ` · ${r.c.gstin}` : ''}</div></div> },
                { key: 'lim', header: 'Credit limit', align: 'right', render: (r) => money(r.c.creditLimitPaise, { whole: true }) },
                { key: 'b0', header: '0–30', align: 'right', render: (r) => (r.buckets.b0 ? money(r.buckets.b0) : '—') },
                { key: 'b31', header: '31–60', align: 'right', render: (r) => (r.buckets.b31 ? <span style={{ color: 'var(--status-warning)' }}>{money(r.buckets.b31)}</span> : '—') },
                { key: 'b61', header: '60+', align: 'right', render: (r) => (r.buckets.b61 ? <span className="bo-neg">{money(r.buckets.b61)}</span> : '—') },
                { key: 'tot', header: 'Total', align: 'right', sortable: true, sortValue: (r) => r.c.outstandingPaise, render: (r) => <b>{money(r.c.outstandingPaise)}</b> },
                { key: 'a', header: '', align: 'right', render: (r) => (canRecord ? <Button size="sm" icon="HandCoins" onClick={(e) => { e.stopPropagation(); setPayFor({ party: r.c, kind: 'customer' }); }}>Receipt</Button> : null) },
              ]} />
          </Card>
        </>
      ) : (
        <>
          <KpiRow>
            <KpiCard label="Total payable" icon="ArrowUpRight" value={money(pB.total)} foot={`${pay.length} suppliers`} loading={loading} />
            <KpiCard label="Overdue" icon="AlarmClock" tone="danger" value={money(pB.overdue)} foot="Past payable terms" loading={loading} />
            <KpiCard label="Invoices 31–60 days old" icon="Clock" tone="warning" value={money(pB.b31)} loading={loading} />
            <KpiCard label="Invoices 60+ days old" icon="Clock" value={money(pB.b61)} loading={loading} />
          </KpiRow>
          {pB.total !== masterP ? <InlineAlert tone="danger">Dues total {money(pB.total)} ≠ supplier balances {money(masterP)}.</InlineAlert> : null}
          <Card className="bo-card-table">
            <div className="bo-toolbar"><SearchInput placeholder="Search supplier" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} /></div>
            <DataTable loading={loading} rows={pRows} rowKey={(r) => r.sup.id} onRowClick={(r) => nav(`/suppliers/${r.sup.id}`)} empty={<EmptyState quiet icon="CircleCheck" title="No supplier dues" />}
              footer={<div className="bo-tfoot"><span>Overdue <b>{money(sum(pRows, (r) => r.overdue))}</b></span><span>Total <b>{money(sum(pRows, (r) => r.buckets.total))}</b></span>{pB.total === masterP ? <Badge tone="success" icon="CircleCheck">Reconciled with supplier balances</Badge> : null}</div>}
              columns={[
                { key: 'n', header: 'Supplier', render: (r) => <div><div className="bo-cell-main">{r.sup.name}</div><div className="bo-cell-sub num">{r.sup.gstin} · {r.sup.payableDays}d terms</div></div> },
                { key: 'inv', header: 'Open invoices', align: 'right', render: (r) => number(r.items.filter((i) => i.due > 0).length) },
                { key: 'next', header: 'Next due', render: (r) => (r.next ? <span className="num">{date(r.next.dueDate)} · {money(r.next.due, { whole: true })}</span> : '—') },
                { key: 'od', header: 'Overdue', align: 'right', render: (r) => (r.overdue ? <Badge tone="danger" icon="AlarmClock">{money(r.overdue)}</Badge> : '—') },
                { key: 'tot', header: 'Total due', align: 'right', render: (r) => <b>{money(r.sup.outstandingPaise)}</b> },
                { key: 'a', header: '', align: 'right', render: (r) => (canRecord && r.sup.outstandingPaise > 0 ? <Button size="sm" icon="HandCoins" onClick={(e) => { e.stopPropagation(); setPayFor({ party: r.sup, kind: 'supplier' }); }}>Pay</Button> : null) },
              ]} />
          </Card>
        </>
      )}
      <Card className="bo-card-table">
        <CardHeader title={tab === 'receivables' ? 'Recent receipts' : 'Recent payments'} icon="History" />
        <DataTable density="dense" rows={recent} rowKey={(p) => p.id} empty={<EmptyState quiet title="Nothing recorded yet" />}
          columns={[
            { key: 'doc', header: 'Document', render: (p) => <span className="num bo-cell-main">{p.documentNo}</span> },
            { key: 'at', header: 'Date', render: (p) => <span className="num">{dateTime(p.createdAt)}</span> },
            { key: 'party', header: tab === 'receivables' ? 'Customer' : 'Supplier', render: (p) => (tab === 'receivables' ? L.customers.get(p.partyId)?.name : L.suppliers.get(p.partyId)?.name) },
            { key: 'm', header: 'Method', render: (p) => `${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}` },
            { key: 'by', header: 'By', render: (p) => userName(L, p.userId) },
            { key: 'a', header: 'Amount', align: 'right', render: (p) => <b>{money(p.amountPaise)}</b> },
          ]} />
      </Card>
      {payFor ? <PaymentModal party={payFor.party} kind={payFor.kind} onClose={() => setPayFor(undefined)} /> : null}
    </PageFrame>
  );
}
