import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Customer } from '@elixir/contracts';
import { Avatar, Badge, Button, Card, DataTable, EmptyState, KpiCard, SearchInput, Select, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, money, number } from '@elixir/format';
import { ExportMenu, KpiRow, PageFrame, useFirstPaint } from '../../components/common';
import { CustomerModal } from '../../components/PartyModals';
import { includesQ, sum, useCloud } from '../../lib/data';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';

export const TIER_TONE = { Silver: 'neutral', Gold: 'warning', Platinum: 'info' } as const;

export function Customers() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const loading = useFirstPaint();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [tier, setTier] = useState('');
  const [adding, setAdding] = useState(false);
  const data = useLive(cloud, ['customers', 'sales'], () => {
    const cs = cloud.where('customers', (c) => c.tenantId === s.tenant.id);
    const stats = new Map<string, { spent: number; visits: number; last?: string }>();
    cloud.all('sales').forEach((x) => {
      if (x.tenantId !== s.tenant.id || !x.customerId || x.status === 'cancelled') return;
      const st = stats.get(x.customerId) ?? { spent: 0, visits: 0 };
      st.spent += x.totalPaise;
      st.visits++;
      if (!st.last || x.businessDate > st.last) st.last = x.businessDate;
      stats.set(x.customerId, st);
    });
    return cs.map((c) => ({ c, ...(stats.get(c.id) ?? { spent: 0, visits: 0 }) }));
  }, [s.tenant.id]);
  const rows = useMemo(() => data.filter(({ c }) => includesQ(q, c.name, c.phone, c.gstin, c.email) && (!tier || c.tier === tier) && (!type || (type === 'b2b' ? !!c.gstin : type === 'credit' ? c.creditLimitPaise > 0 : type === 'due' ? c.outstandingPaise > 0 : type === 'inactive' ? !c.active : true))).sort((a, b) => b.spent - a.spent), [data, q, tier, type]);
  type Row = (typeof rows)[number];
  const cols: Column<Row>[] = [
    { key: 'name', header: 'Customer', sortable: true, sortValue: (r) => r.c.name, render: ({ c }) => <div className="ex-row" style={{ gap: 10 }}><Avatar name={c.name} /><div><div className="bo-cell-main">{c.name}</div><div className="bo-cell-sub num">+91 {c.phone}</div></div></div> },
    { key: 'gstin', header: 'GSTIN', render: ({ c }) => (c.gstin ? <span className="num">{c.gstin}</span> : <span className="muted">—</span>) },
    { key: 'tier', header: 'Loyalty', hidden: !s.has('loyalty'), render: ({ c }) => (c.tier ? <Badge tone={TIER_TONE[c.tier]} icon="Award">{c.tier} · {number(c.loyaltyPoints)} pts</Badge> : '—') },
    { key: 'visits', header: 'Visits', align: 'right', sortable: true, render: (r) => number(r.visits) },
    { key: 'spent', header: 'Lifetime spend', align: 'right', sortable: true, render: (r) => money(r.spent, { whole: true }) },
    { key: 'last', header: 'Last purchase', sortable: true, render: (r) => (r.last ? <span className="num">{date(r.last)}</span> : <span className="muted">Never</span>) },
    { key: 'limit', header: 'Credit limit', align: 'right', render: ({ c }) => (c.creditLimitPaise ? money(c.creditLimitPaise, { whole: true }) : <span className="muted">No credit</span>) },
    { key: 'out', header: 'Outstanding', align: 'right', sortable: true, sortValue: (r) => r.c.outstandingPaise, render: ({ c }) => (c.outstandingPaise ? <b className={c.outstandingPaise > c.creditLimitPaise * 0.8 ? 'bo-neg' : undefined}>{money(c.outstandingPaise)}</b> : <span className="muted">—</span>) },
    { key: 'st', header: 'Status', render: ({ c }) => (c.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge icon="CirclePause">Inactive</Badge>) },
  ];
  const doExport = (kind: 'csv' | 'xls') => downloadTable('customers', ['Name', 'Phone', 'Email', 'GSTIN', 'Tier', 'Points', 'Visits', 'Lifetime spend', 'Credit limit', 'Outstanding'], rows.map(({ c, visits, spent }) => [c.name, c.phone, c.email, c.gstin, c.tier, c.loyaltyPoints, visits, rupees(spent), rupees(c.creditLimitPaise), rupees(c.outstandingPaise)]), kind);
  return (
    <PageFrame
      title="Customers"
      description="Customer master shared with POS. Credit, loyalty and GST details apply at billing."
      crumbs={[{ label: 'Parties' }, { label: 'Customers' }]}
      actions={<>{s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} /> : null}{s.can('customers.edit') ? <Button variant="primary" icon="UserPlus" onClick={() => setAdding(true)}>Add customer</Button> : null}</>}
    >
      <KpiRow>
        <KpiCard label="Customers" icon="Users" value={number(data.filter((r) => r.c.active).length)} foot={`${data.filter((r) => r.c.gstin).length} B2B with GSTIN`} loading={loading} />
        <KpiCard label="Receivables" icon="ArrowDownLeft" value={money(sum(data, (r) => r.c.outstandingPaise), { whole: true })} foot={`${data.filter((r) => r.c.outstandingPaise > 0).length} customers owe`} onClick={() => setType('due')} loading={loading} />
        <KpiCard label="Credit customers" icon="CreditCard" value={number(data.filter((r) => r.c.creditLimitPaise > 0).length)} onClick={() => setType('credit')} loading={loading} />
        {s.has('loyalty') ? <KpiCard label="Points balance" icon="Gift" value={number(sum(data, (r) => r.c.loyaltyPoints))} foot={`${data.filter((r) => r.c.tier === 'Platinum').length} Platinum members`} loading={loading} /> : <KpiCard label="Repeat customers" icon="Repeat" value={number(data.filter((r) => r.visits > 1).length)} loading={loading} />}
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <SearchInput placeholder="Search name, mobile, GSTIN, email" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <Select size="sm" aria-label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All customers' }, { value: 'b2b', label: 'B2B (GSTIN)' }, { value: 'credit', label: 'Credit customers' }, { value: 'due', label: 'With outstanding' }, { value: 'inactive', label: 'Inactive' }]} />
          {s.has('loyalty') ? <Select size="sm" aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value)} options={[{ value: '', label: 'All tiers' }, { value: 'Silver', label: 'Silver' }, { value: 'Gold', label: 'Gold' }, { value: 'Platinum', label: 'Platinum' }]} /> : null}
        </div>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.c.id} loading={loading} onRowClick={(r) => nav(`/customers/${r.c.id}`)} empty={<EmptyState quiet icon="Users" title="No customers match" />} />
      </Card>
      {adding ? <CustomerModal onClose={() => setAdding(false)} onSaved={(c: Customer) => nav(`/customers/${c.id}`)} /> : null}
    </PageFrame>
  );
}
