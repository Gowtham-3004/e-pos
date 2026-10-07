import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Shift } from '@elixir/contracts';
import { Badge, Card, DataTable, EmptyState, KpiCard, Select, StatusBadge, Switch, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, money, number, time } from '@elixir/format';
import type { StatusMeta } from '@elixir/domain';
import { DateRangeControl, KpiRow, PageFrame, StoreFilter, useFirstPaint, useRange } from '../../components/common';
import { sum, useCloud, useLookups, userName } from '../../lib/data';
import { useSession } from '../../lib/session';

export const SHIFT_STATUS: Record<Shift['status'], StatusMeta> = {
  open: { label: 'Open', tone: 'info', icon: 'CircleDot' },
  closed: { label: 'Closed', tone: 'neutral', icon: 'Lock' },
  reopened: { label: 'Reopened', tone: 'warning', icon: 'LockOpen' },
};

export function VarianceBadge({ v }: { v?: number }) {
  if (v == null) return <span className="muted">—</span>;
  if (v === 0) return <Badge tone="success" icon="CircleCheck">Balanced</Badge>;
  const big = Math.abs(v) > 10000;
  return <Badge tone={big ? 'danger' : 'warning'} icon={v < 0 ? 'TrendingDown' : 'TrendingUp'}>{v < 0 ? 'Short' : 'Excess'} {money(Math.abs(v))}</Badge>;
}

export function ShiftsPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint();
  const [params] = useSearchParams();
  const [range, setRange] = useRange('7d');
  const [store, setStore] = useState('');
  const [status, setStatus] = useState('');
  const [varOnly, setVarOnly] = useState(params.get('variance') === '1');
  const all = useLive(cloud, ['shifts', 'sales'], () => {
    const totals = new Map<string, { total: number; bills: number }>();
    cloud.all('sales').forEach((x) => {
      if (x.tenantId !== s.tenant.id || x.status === 'cancelled') return;
      const t = totals.get(x.shiftId) ?? { total: 0, bills: 0 };
      t.total += x.totalPaise;
      t.bills++;
      totals.set(x.shiftId, t);
    });
    return cloud.where('shifts', (x) => x.tenantId === s.tenant.id && s.scope.includes(x.storeId)).map((sh) => ({ sh, ...(totals.get(sh.id) ?? { total: 0, bills: 0 }) }));
  }, [s.tenant.id, s.scope.join(',')]);
  const rows = useMemo(() => all.filter(({ sh }) => sh.businessDate >= range.from && sh.businessDate <= range.to && (!store || sh.storeId === store) && (!status || sh.status === status) && (!varOnly || !!sh.variance)).sort((a, b) => b.sh.openedAt.localeCompare(a.sh.openedAt)), [all, range.from, range.to, store, status, varOnly]);
  type Row = (typeof rows)[number];
  const cols: Column<Row>[] = [
    { key: 'code', header: 'Shift', render: ({ sh }) => <div><div className="bo-cell-main num">{sh.code}</div><div className="bo-cell-sub">{date(sh.businessDate)}</div></div> },
    { key: 'where', header: 'Store · Counter', render: ({ sh }) => `${s.scope.length > 1 ? `${s.storeName(sh.storeId)} · ` : ''}${L.counters.get(sh.counterId)?.code ?? ''}` },
    { key: 'who', header: 'Cashier', render: ({ sh }) => userName(L, sh.openedBy) },
    { key: 'time', header: 'Opened – Closed', render: ({ sh }) => <span className="num">{time(sh.openedAt)} – {sh.closedAt ? time(sh.closedAt) : <span className="muted">open</span>}</span> },
    { key: 'sales', header: 'Sales', align: 'right', render: (r) => <div><div>{money(r.total, { whole: true })}</div><div className="bo-cell-sub">{r.bills} bills</div></div> },
    { key: 'open', header: 'Opening', align: 'right', render: ({ sh }) => money(sh.openingCash) },
    { key: 'exp', header: 'Expected cash', align: 'right', render: ({ sh }) => (sh.expectedCash != null ? money(sh.expectedCash) : '—') },
    { key: 'cnt', header: 'Counted', align: 'right', render: ({ sh }) => (sh.closingCash != null ? money(sh.closingCash) : '—') },
    { key: 'var', header: 'Variance', render: ({ sh }) => <VarianceBadge v={sh.status === 'open' ? undefined : sh.variance} /> },
    { key: 'st', header: 'Status', render: ({ sh }) => <StatusBadge meta={SHIFT_STATUS[sh.status]} /> },
  ];
  const closed = rows.filter((r) => r.sh.status === 'closed');
  return (
    <PageFrame title="Shifts" description="Cashier shifts from POS counters. Open a shift for its Z-report." crumbs={[{ label: 'Finance' }, { label: 'Shifts' }]}>
      <DateRangeControl value={range} onChange={setRange} />
      <KpiRow>
        <KpiCard label="Shifts" icon="Clock" value={number(rows.length)} foot={`${rows.filter((r) => r.sh.status === 'open').length} open now`} loading={loading} />
        <KpiCard label="Sales in shifts" icon="IndianRupee" value={money(sum(rows, (r) => r.total), { whole: true })} loading={loading} />
        <KpiCard label="Shifts with variance" icon="Scale" tone={closed.some((r) => r.sh.variance) ? 'warning' : undefined} value={number(closed.filter((r) => r.sh.variance).length)} onClick={() => setVarOnly(true)} loading={loading} />
        <KpiCard label="Net variance" icon="Calculator" tone={sum(closed, (r) => r.sh.variance ?? 0) < 0 ? 'danger' : undefined} value={money(sum(closed, (r) => r.sh.variance ?? 0), { signed: true })} loading={loading} />
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <StoreFilter value={store} onChange={setStore} />
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'Any status' }, { value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'reopened', label: 'Reopened' }]} />
          <Switch label="Variances only" checked={varOnly} onChange={setVarOnly} />
        </div>
        <DataTable columns={cols} rows={rows} rowKey={(r) => r.sh.id} loading={loading} onRowClick={(r) => nav(`/shifts/${r.sh.id}`)} empty={<EmptyState quiet icon="Clock" title="No shifts in this range" />} />
      </Card>
    </PageFrame>
  );
}
