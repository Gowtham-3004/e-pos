import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, DataTable, DescriptionList, EmptyState, InlineAlert, KpiCard, StatusBadge, Tabs } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, dateTime, daysUntil, money, number } from '@elixir/format';
import { KpiRow, NotFound, PageFrame } from '../../components/common';
import { PaymentModal, SupplierModal } from '../../components/PartyModals';
import { METHOD_LABEL, sum, useCloud, useLookups, userName } from '../../lib/data';
import { supplierDues } from '../../lib/finance';
import { useSession } from '../../lib/session';
import { isDebitNote, PAYMENT_STATUS, PURCHASE_STATUS } from '../purchase/purchaseMeta';

export function SupplierDetail() {
  const { id } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const sup = useEntity(cloud, 'suppliers', id);
  const [tab, setTab] = useState<'dues' | 'purchases' | 'payments'>('dues');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const data = useLive(cloud, ['purchases', 'payments', 'suppliers'], () => (sup ? {
    purchases: cloud.where('purchases', (p) => p.supplierId === sup.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    payments: cloud.where('payments', (p) => p.partyType === 'supplier' && p.partyId === sup.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    dues: supplierDues(cloud, sup),
  } : null), [sup]);
  if (!sup || sup.tenantId !== s.tenant.id || !data) return <NotFound what="Supplier" back={{ label: 'Back to suppliers', to: '/suppliers' }} />;
  const posted = data.purchases.filter((p) => p.status === 'posted' && !isDebitNote(p));
  const licDays = sup.licenceValidUntil ? daysUntil(sup.licenceValidUntil) : undefined;
  return (
    <PageFrame
      crumbs={[{ label: 'Suppliers', to: '/suppliers' }, { label: sup.name }]}
      title={sup.name}
      description={<span className="num">GSTIN {sup.gstin} · {sup.city} · {sup.phone}</span>}
      actions={<>{s.can('suppliers.edit') ? <Button icon="Pencil" onClick={() => setEdit(true)}>Edit</Button> : null}{s.can('purchase.post') ? <Button icon="ShoppingCart" onClick={() => nav('/purchase/new')}>New purchase</Button> : null}{s.has('payables') && s.can('finance.view') && sup.outstandingPaise > 0 ? <Button variant="primary" icon="HandCoins" onClick={() => setPay(true)}>Record payment</Button> : null}</>}
    >
      {licDays !== undefined && licDays <= 30 ? <InlineAlert tone={licDays < 0 ? 'danger' : 'warning'} title={licDays < 0 ? 'Drug licence expired' : `Drug licence expires in ${licDays} days`}>Licence {sup.licenceNo} valid until {date(sup.licenceValidUntil!)}. Purchases of scheduled drugs from this supplier require a valid licence — collect the renewed copy and update the supplier.</InlineAlert> : null}
      <KpiRow>
        <KpiCard label="Outstanding" icon="ArrowUpRight" value={money(sup.outstandingPaise)} foot={`Terms ${sup.payableDays} days`} />
        <KpiCard label="Overdue" icon="AlarmClock" tone={data.dues.overdue ? 'warning' : undefined} value={money(data.dues.overdue)} foot="Past due date" />
        <KpiCard label="Purchases" icon="ShoppingCart" value={money(sum(posted, (p) => p.totalPaise), { whole: true })} foot={`${posted.length} posted invoices`} />
        <KpiCard label="Paid to date" icon="HandCoins" value={money(sum(data.payments, (p) => p.amountPaise), { whole: true })} foot={`${data.payments.length} payments`} />
      </KpiRow>
      <div className="bo-grid-main">
        <div className="ex-stack" style={{ gap: 12 }}>
          <Tabs items={[{ key: 'dues', label: 'Open dues', count: data.dues.items.length }, { key: 'purchases', label: 'Purchases', count: data.purchases.length }, { key: 'payments', label: 'Payments', count: data.payments.length }]} value={tab} onChange={setTab} />
          <Card className="bo-card-table">
            {tab === 'dues' ? (
              <DataTable rows={data.dues.items} rowKey={(d) => d.purchase.id} onRowClick={(d) => nav(`/purchase/${d.purchase.id}`)} empty={<EmptyState quiet icon="CircleCheck" title="No dues — fully paid" />}
                footer={data.dues.items.length ? <div className="bo-tfoot"><span>Total due <b>{money(data.dues.buckets.total)}</b></span><span>= supplier outstanding <b>{money(sup.outstandingPaise)}</b></span></div> : undefined}
                columns={[
                  { key: 'doc', header: 'Document', render: (d) => <div><div className="num bo-cell-main">{d.purchase.documentNo}</div><div className="bo-cell-sub">{d.purchase.supplierInvoiceNo}</div></div> },
                  { key: 'inv', header: 'Invoice date', render: (d) => date(d.purchase.invoiceDate) },
                  { key: 'due', header: 'Due date', render: (d) => (d.due < 0 ? <Badge tone="info">Credit</Badge> : <span className="num">{date(d.dueDate)}</span>) },
                  { key: 'od', header: 'Status', render: (d) => (d.due < 0 ? <Badge tone="warning" icon="Undo2">Debit note</Badge> : d.overdueDays ? <Badge tone="danger" icon="AlarmClock">{d.overdueDays}d overdue</Badge> : <Badge>Not due</Badge>) },
                  { key: 'tot', header: 'Invoice total', align: 'right', render: (d) => money(d.purchase.totalPaise) },
                  { key: 'paid', header: 'Paid', align: 'right', render: (d) => money(d.purchase.paidPaise) },
                  { key: 'bal', header: 'Balance', align: 'right', render: (d) => <b>{money(d.due)}</b> },
                ]} />
            ) : tab === 'purchases' ? (
              <DataTable rows={data.purchases} rowKey={(p) => p.id} onRowClick={(p) => nav(`/purchase/${p.id}`)} empty={<EmptyState quiet icon="ShoppingCart" title="No purchases yet" />}
                columns={[
                  { key: 'doc', header: 'Document', render: (p) => <span className="num bo-cell-main">{p.documentNo}</span> },
                  { key: 'd', header: 'Invoice date', render: (p) => date(p.invoiceDate) },
                  { key: 'l', header: 'Lines', align: 'right', render: (p) => p.lines.length },
                  { key: 't', header: 'Total', align: 'right', render: (p) => <b>{money(p.totalPaise)}</b> },
                  { key: 's', header: 'Status', render: (p) => (isDebitNote(p) ? <Badge tone="warning" icon="Undo2">Debit note</Badge> : <StatusBadge meta={PURCHASE_STATUS[p.status]} />) },
                  { key: 'p', header: 'Payment', render: (p) => (p.status === 'posted' && !isDebitNote(p) ? <StatusBadge meta={PAYMENT_STATUS[p.paymentStatus]} /> : '—') },
                ]} />
            ) : (
              <DataTable rows={data.payments} rowKey={(p) => p.id} empty={<EmptyState quiet icon="HandCoins" title="No payments yet" />}
                columns={[
                  { key: 'doc', header: 'Payment', render: (p) => <span className="num bo-cell-main">{p.documentNo}</span> },
                  { key: 'at', header: 'Date', render: (p) => <span className="num">{dateTime(p.createdAt)}</span> },
                  { key: 'm', header: 'Method', render: (p) => `${METHOD_LABEL[p.method]}${p.reference ? ` · ${p.reference}` : ''}` },
                  { key: 'ag', header: 'Against', render: (p) => <span className="num secondary">{p.againstDocument ?? 'On account'}</span> },
                  { key: 'by', header: 'By', render: (p) => userName(L, p.userId) },
                  { key: 'a', header: 'Amount', align: 'right', render: (p) => <b>{money(p.amountPaise)}</b> },
                ]} />
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Profile" icon="IdCard" />
          <div style={{ padding: 16 }}>
            <DescriptionList items={[
              ['GSTIN', sup.gstin],
              ['State', `${sup.stateCode}${sup.stateCode !== s.tenant.stateCode ? ' (inter-state · IGST input)' : ''}`],
              ['Phone', sup.phone],
              ['City', sup.city],
              ['Payable terms', `${sup.payableDays} days`],
              ...(sup.licenceNo ? ([['Drug licence', `${sup.licenceNo} · valid until ${date(sup.licenceValidUntil!)}`]] as Array<[string, string]>) : []),
              ['Open invoices', number(data.dues.items.filter((d) => d.due > 0).length)],
            ]} />
          </div>
        </Card>
      </div>
      {edit ? <SupplierModal supplier={sup} onClose={() => setEdit(false)} /> : null}
      {pay ? <PaymentModal party={sup} kind="supplier" onClose={() => setPay(false)} /> : null}
    </PageFrame>
  );
}
