import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SYNC_STATE, TRANSACTION_STATUS } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, DataTable, DescriptionList, EmptyState, KpiCard, Progress, StatusBadge, Tabs } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, dateTime, money, number } from '@elixir/format';
import { KpiRow, NotFound, PageFrame } from '../../components/common';
import { CustomerModal, PaymentModal } from '../../components/PartyModals';
import { METHOD_LABEL, sum, useCloud, useLookups, userName } from '../../lib/data';
import { customerAgeing } from '../../lib/finance';
import { useSession } from '../../lib/session';
import { TIER_TONE } from './Customers';

export function CustomerDetail() {
  const { id } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const c = useEntity(cloud, 'customers', id);
  const [tab, setTab] = useState<'sales' | 'open' | 'receipts'>('sales');
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  const data = useLive(cloud, ['sales', 'payments', 'customers'], () => {
    if (!c) return null;
    const sales = cloud.where('sales', (x) => x.customerId === c.id).sort((a, b) => b.committedAt.localeCompare(a.committedAt));
    const receipts = cloud.where('payments', (p) => p.partyType === 'customer' && p.partyId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { sales, receipts, ageing: customerAgeing(cloud, c) };
  }, [c]);
  if (!c || c.tenantId !== s.tenant.id || !data) return <NotFound what="Customer" back={{ label: 'Back to customers', to: '/customers' }} />;
  const ok = data.sales.filter((x) => x.status !== 'cancelled');
  const spent = sum(ok, (x) => x.totalPaise);
  const usedPct = c.creditLimitPaise ? (c.outstandingPaise / c.creditLimitPaise) * 100 : 0;
  const earned = sum(ok, (x) => x.loyaltyEarned ?? 0);
  const redeemed = sum(ok, (x) => x.loyaltyRedeemed ?? 0);

  return (
    <PageFrame
      crumbs={[{ label: 'Customers', to: '/customers' }, { label: c.name }]}
      title={c.name}
      meta={<>{c.tier && s.has('loyalty') ? <Badge tone={TIER_TONE[c.tier]} icon="Award">{c.tier}</Badge> : null}{c.gstin ? <Badge tone="info">B2B</Badge> : null}{!c.active ? <Badge icon="CirclePause">Inactive</Badge> : null}</>}
      description={<span className="num">+91 {c.phone}{c.email ? ` · ${c.email}` : ''}{c.gstin ? ` · GSTIN ${c.gstin}` : ''}</span>}
      actions={<>{s.can('customers.edit') ? <Button icon="Pencil" onClick={() => setEdit(true)}>Edit</Button> : null}{s.has('receivables') && s.can('finance.view') && c.outstandingPaise > 0 ? <Button variant="primary" icon="HandCoins" onClick={() => setPay(true)}>Record receipt</Button> : null}</>}
    >
      <KpiRow>
        <KpiCard label="Lifetime spend" icon="IndianRupee" value={money(spent, { whole: true })} foot={`${ok.length} invoices · avg ${money(ok.length ? Math.round(spent / ok.length) : 0, { whole: true })}`} />
        <KpiCard label="Outstanding" icon="ArrowDownLeft" tone={usedPct > 80 ? 'danger' : undefined} value={money(c.outstandingPaise)} foot={c.creditLimitPaise ? <div className="ex-stack" style={{ gap: 4 }}><Progress value={usedPct} tone={usedPct > 80 ? 'danger' : usedPct > 50 ? 'warning' : 'success'} label="Credit used" /><span>{usedPct.toFixed(0)}% of {money(c.creditLimitPaise, { whole: true })} limit · {c.creditDays} days</span></div> : 'No credit allowed'} />
        {s.has('loyalty') ? <KpiCard label="Loyalty points" icon="Gift" value={number(c.loyaltyPoints)} foot={`${number(earned)} earned · ${number(redeemed)} redeemed in history`} /> : <KpiCard label="Visits" icon="Repeat" value={number(ok.length)} />}
        <KpiCard label="Last purchase" icon="CalendarDays" value={ok[0] ? date(ok[0].businessDate) : '—'} foot={ok[0] ? `${s.storeName(ok[0].storeId)} · ${money(ok[0].totalPaise)}` : 'No purchases yet'} />
      </KpiRow>
      <div className="bo-grid-main">
        <div className="ex-stack" style={{ gap: 12 }}>
          <Tabs items={[{ key: 'sales', label: 'Sales history', count: data.sales.length }, { key: 'open', label: 'Open credit', count: data.ageing.items.length }, { key: 'receipts', label: 'Receipts', count: data.receipts.length }]} value={tab} onChange={setTab} />
          <Card className="bo-card-table">
            {tab === 'sales' ? (
              <DataTable rows={data.sales} rowKey={(x) => x.id} onRowClick={(x) => nav(`/sales/${x.id}`)} empty={<EmptyState quiet icon="Receipt" title="No purchases yet" />}
                columns={[
                  { key: 'doc', header: 'Invoice', render: (x) => <span className="num bo-cell-main">{x.documentNo}</span> },
                  { key: 'at', header: 'Date', render: (x) => <span className="num">{dateTime(x.committedAt)}</span> },
                  { key: 'store', header: 'Store', render: (x) => s.storeName(x.storeId) },
                  { key: 'items', header: 'Items', align: 'right', render: (x) => x.itemCount },
                  { key: 'pay', header: 'Payment', render: (x) => x.tenders.map((t) => METHOD_LABEL[t.method]).join(' + ') },
                  { key: 'pts', header: 'Points', align: 'right', hidden: !s.has('loyalty'), render: (x) => (x.loyaltyEarned ? `+${x.loyaltyEarned}` : '—') },
                  { key: 'tot', header: 'Total', align: 'right', render: (x) => <b>{money(x.totalPaise)}</b> },
                  { key: 'st', header: 'Status', render: (x) => <StatusBadge meta={TRANSACTION_STATUS[x.status]} /> },
                  { key: 'sy', header: 'Sync', render: (x) => <StatusBadge meta={SYNC_STATE[x.syncState]} /> },
                ]} />
            ) : tab === 'open' ? (
              <DataTable rows={data.ageing.items} rowKey={(x) => x.label + x.date} onRowClick={(x) => x.sale && nav(`/sales/${x.sale.id}`)} empty={<EmptyState quiet icon="CircleCheck" title="Nothing outstanding" />}
                footer={data.ageing.items.length ? <div className="bo-tfoot"><span>0–30 <b>{money(data.ageing.buckets.b0)}</b></span><span>31–60 <b>{money(data.ageing.buckets.b31)}</b></span><span>60+ <b>{money(data.ageing.buckets.b61)}</b></span><span>Total <b>{money(data.ageing.buckets.total)}</b></span></div> : undefined}
                columns={[
                  { key: 'l', header: 'Document', render: (x) => <span className="num bo-cell-main">{x.label}</span> },
                  { key: 'd', header: 'Date', render: (x) => date(x.date) },
                  { key: 'a', header: 'Age', align: 'right', render: (x) => `${x.age} days` },
                  { key: 'b', header: 'Bucket', render: (x) => <Badge tone={x.age > 60 ? 'danger' : x.age > 30 ? 'warning' : 'neutral'}>{x.age > 60 ? '60+' : x.age > 30 ? '31–60' : '0–30'}</Badge> },
                  { key: 'm', header: 'Outstanding', align: 'right', render: (x) => <b>{money(x.amount)}</b> },
                ]} />
            ) : (
              <DataTable rows={data.receipts} rowKey={(x) => x.id} empty={<EmptyState quiet icon="HandCoins" title="No receipts recorded" />}
                columns={[
                  { key: 'doc', header: 'Receipt', render: (x) => <span className="num bo-cell-main">{x.documentNo}</span> },
                  { key: 'at', header: 'Date', render: (x) => <span className="num">{dateTime(x.createdAt)}</span> },
                  { key: 'm', header: 'Method', render: (x) => `${METHOD_LABEL[x.method]}${x.reference ? ` · ${x.reference}` : ''}` },
                  { key: 'by', header: 'Recorded by', render: (x) => userName(L, x.userId) },
                  { key: 'a', header: 'Amount', align: 'right', render: (x) => <b>{money(x.amountPaise)}</b> },
                ]} />
            )}
          </Card>
        </div>
        <Card>
          <CardHeader title="Profile" icon="IdCard" />
          <div style={{ padding: 16 }}>
            <DescriptionList items={[
              ['Mobile', `+91 ${c.phone}`],
              ['Email', c.email],
              ['GSTIN', c.gstin],
              ['Place of supply', c.stateCode ? `State ${c.stateCode}${c.stateCode !== s.tenant.stateCode ? ' (inter-state · IGST)' : ''}` : '—'],
              ['Price group', c.priceGroupId ? cloud.get('priceGroups', c.priceGroupId)?.name : 'Retail'],
              ['Credit', c.creditLimitPaise ? `${money(c.creditLimitPaise, { whole: true })} · ${c.creditDays} days` : 'Not allowed'],
              ['Customer since', date(c.createdAt)],
            ]} />
          </div>
        </Card>
      </div>
      {edit ? <CustomerModal customer={c} onClose={() => setEdit(false)} /> : null}
      {pay ? <PaymentModal party={c} kind="customer" onClose={() => setPay(false)} /> : null}
    </PageFrame>
  );
}
