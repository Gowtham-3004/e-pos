import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobCard, JobCardStatus } from '@elixir/contracts';
import { isJobCardOpen, JOB_CARD_STATUS } from '@elixir/domain';
import { jobCardTotals } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { Badge, Card, DataTable, EmptyState, KpiCard, SearchInput, Select, StatusBadge, type Column } from '@elixir/ui';
import { dateTime, money, number } from '@elixir/format';
import { ExportMenu, KpiRow, PageFrame, StoreFilter, useFirstPaint } from '../../components/common';
import { includesQ, sum, useCloud, useLookups, userName } from '../../lib/data';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';

const STATUSES = Object.keys(JOB_CARD_STATUS) as JobCardStatus[];

/** Service desk overview: every repair job synced from POS counters (read-only). */
export function JobCardList() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint();
  const [q, setQ] = useState('');
  const [store, setStore] = useState('');
  const [status, setStatus] = useState<JobCardStatus | 'open' | ''>('open');
  const all = useLive(cloud, ['jobCards'], () => cloud.where('jobCards', (j) => j.tenantId === s.tenant.id && s.scope.includes(j.storeId)), [s.tenant.id, s.scope.join(',')]);
  const value = useLive(cloud, ['jobCards', 'products'], () => new Map(all.map((j) => [j.id, j.lines.length ? jobCardTotals(cloud, j).totalPaise : 0])), [all]);
  const rows = useMemo(
    () =>
      all
        .filter((j) => (!store || j.storeId === store) && (!status || (status === 'open' ? isJobCardOpen(j.status) : j.status === status)) && includesQ(q, j.jobNo, j.customerName, j.customerPhone, j.device.imeiOrSerial, `${j.device.brand} ${j.device.model}`))
        .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
    [all, store, status, q],
  );
  const open = all.filter((j) => isJobCardOpen(j.status));
  const overdue = open.filter((j) => j.promisedAt && new Date(j.promisedAt).getTime() < Date.now());
  const ready = all.filter((j) => j.status === 'ready');
  const deliveredValue = sum(all.filter((j) => j.status === 'delivered'), (j) => cloud.get('sales', j.saleId)?.totalPaise ?? 0);

  const cols: Column<JobCard>[] = [
    { key: 'jobNo', header: 'Job no.', render: (j) => <span className="bo-cell-main num">{j.jobNo}</span> },
    { key: 'openedAt', header: 'Received', render: (j) => <span className="num">{dateTime(j.openedAt)}</span> },
    { key: 'device', header: 'Device', render: (j) => (<div><div className="bo-cell-main">{j.device.brand} {j.device.model}</div>{j.device.imeiOrSerial ? <div className="bo-cell-sub num">{j.device.imeiOrSerial}</div> : null}</div>) },
    { key: 'customer', header: 'Customer', render: (j) => (<div><div>{j.customerName}</div><div className="bo-cell-sub">{j.customerPhone}</div></div>) },
    { key: 'store', header: 'Store', hidden: s.scope.length < 2, render: (j) => s.storeName(j.storeId) },
    { key: 'tech', header: 'Technician', render: (j) => userName(L, j.technicianId) },
    { key: 'value', header: 'Value', align: 'right', render: (j) => (value.get(j.id) ? <b className="num">{money(value.get(j.id)!)}</b> : <span className="muted">—</span>) },
    { key: 'status', header: 'Status', render: (j) => <StatusBadge meta={JOB_CARD_STATUS[j.status]} /> },
    {
      key: 'promised', header: 'Promised', render: (j) => (isJobCardOpen(j.status) && j.promisedAt && new Date(j.promisedAt).getTime() < Date.now() ? <Badge tone="danger" icon="AlarmClock">Overdue</Badge> : j.promisedAt ? <span className="num">{dateTime(j.promisedAt)}</span> : '—'),
    },
  ];

  const exportRows = (kind: 'csv' | 'xls') =>
    downloadTable(
      'job-cards',
      ['Job no.', 'Received', 'Store', 'Customer', 'Phone', 'Device', 'IMEI / Serial', 'Problem', 'Technician', 'Status', 'Value', 'Invoice'],
      rows.map((j) => [j.jobNo, j.openedAt, s.storeName(j.storeId), j.customerName, j.customerPhone, `${j.device.brand} ${j.device.model}`, j.device.imeiOrSerial ?? '', j.problem, userName(L, j.technicianId), JOB_CARD_STATUS[j.status].label, rupees(value.get(j.id) ?? 0), j.saleDocumentNo ?? '']),
      kind,
    );

  return (
    <PageFrame
      title="Job cards"
      description="Repair jobs from the POS service desk: device intake, services, spare parts and delivery."
      crumbs={[{ label: 'Overview', to: '/' }, { label: 'Job cards' }]}
      actions={s.can('reports.export') ? <ExportMenu onCsv={() => exportRows('csv')} onXls={() => exportRows('xls')} /> : undefined}
    >
      <KpiRow>
        <KpiCard label="Open jobs" icon="Wrench" value={number(open.length)} loading={loading} />
        <KpiCard label="Ready for pickup" icon="PackageCheck" value={number(ready.length)} loading={loading} />
        <KpiCard label="Overdue" icon="AlarmClock" value={number(overdue.length)} tone={overdue.length ? 'danger' : undefined} foot="Past promised time, not delivered" loading={loading} />
        <KpiCard label="Billed (delivered)" icon="IndianRupee" value={money(deliveredValue)} loading={loading} />
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <SearchInput placeholder="Search job no., customer, phone, IMEI or model" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <StoreFilter value={store} onChange={setStore} />
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as JobCardStatus | 'open' | '')} options={[{ value: 'open', label: 'Open jobs' }, { value: '', label: 'All statuses' }, ...STATUSES.map((x) => ({ value: x, label: JOB_CARD_STATUS[x].label }))]} />
        </div>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(j) => j.id}
          loading={loading}
          onRowClick={(j) => nav(`/jobcards/${j.id}`)}
          empty={<EmptyState quiet icon="Wrench" title="No job cards match">Job cards are created at the POS service desk and appear here once the counter syncs.</EmptyState>}
        />
      </Card>
    </PageFrame>
  );
}
