import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JobCard, JobCardStatus } from '@elixir/contracts';
import { isJobCardOpen, JOB_CARD_STATUS } from '@elixir/domain';
import { dateTime, money } from '@elixir/format';
import { jobCardsFor, jobCardTotals } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { Badge, Button, DataTable, EmptyState, SearchInput, Segmented, StatusBadge } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';

type Filter = 'open' | JobCardStatus | 'all';

/** Repair desk: every device in the workshop for this store, with live status. */
export function JobCardsScreen() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const [filter, setFilter] = useState<Filter>('open');
  const [q, setQ] = useState('');
  const all = useLive(device, ['jobCards'], () => jobCardsFor(device, s.store.id), [s.store.id]);
  const count = (f: Filter) => all.filter((j) => match(j, f)).length;
  const t = q.trim().toLowerCase();
  const rows = all.filter((j) => match(j, filter) && (!t || [j.jobNo, j.customerName, j.customerPhone, j.device.imeiOrSerial ?? '', `${j.device.brand} ${j.device.model}`].some((x) => x.toLowerCase().includes(t))));

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Job cards</div>
          <div className="pos-page__desc">Device repairs: intake, diagnosis, services and spare parts. Bill & deliver posts a GST invoice.</div>
        </div>
        <div className="ex-spacer" />
        <Button variant="primary" icon="Plus" onClick={() => nav('/jobcards/new')}>New job card</Button>
      </div>
      <div className="ex-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <Segmented
          label="Status"
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'open', label: `Open (${count('open')})` },
            { key: 'awaiting-approval', label: `Approval (${count('awaiting-approval')})` },
            { key: 'in-progress', label: `In progress (${count('in-progress')})` },
            { key: 'ready', label: `Ready (${count('ready')})` },
            { key: 'delivered', label: 'Delivered' },
            { key: 'all', label: 'All' },
          ]}
        />
        <div className="ex-spacer" />
        <div style={{ width: 300 }}>
          <SearchInput placeholder="Job no, phone, IMEI, model" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
        </div>
      </div>
      <div className="ex-card">
        <DataTable
          rows={rows}
          rowKey={(j) => j.id}
          onRowClick={(j) => nav(`/jobcards/${j.id}`)}
          empty={
            <EmptyState icon="Wrench" title={all.length ? 'No job cards match' : 'No job cards yet'} actions={<Button onClick={() => nav('/jobcards/new')}>New job card</Button>}>
              Create a job card when a customer drops off a device for repair.
            </EmptyState>
          }
          columns={[
            { key: 'jobNo', header: 'Job', render: (j) => <b className="num">{j.jobNo.split('/').pop()}</b> },
            { key: 'device', header: 'Device', render: (j) => (<span>{j.device.brand} {j.device.model}{j.device.imeiOrSerial ? <span className="muted num"> · {j.device.imeiOrSerial}</span> : null}</span>) },
            { key: 'customer', header: 'Customer', render: (j) => (<span>{j.customerName} <span className="muted">· {j.customerPhone}</span></span>) },
            { key: 'problem', header: 'Problem', render: (j) => <span className="muted" title={j.problem}>{j.problem.length > 42 ? `${j.problem.slice(0, 40)}…` : j.problem}</span> },
            { key: 'tech', header: 'Technician', render: (j) => device.get('users', j.technicianId)?.name ?? <span className="muted">—</span> },
            { key: 'value', header: 'Value', align: 'right', render: (j) => <span className="num">{j.lines.length ? money(jobCardTotals(device, j).totalPaise) : '—'}</span> },
            { key: 'status', header: 'Status', render: (j) => <StatusBadge meta={JOB_CARD_STATUS[j.status]} /> },
            {
              key: 'due', header: 'Promised', render: (j) => j.promisedAt ? (
                <span title={dateTime(j.promisedAt)}>
                  {isJobCardOpen(j.status) && new Date(j.promisedAt).getTime() < Date.now() ? <Badge tone="danger" icon="AlarmClock">Overdue</Badge> : dateTime(j.promisedAt)}
                </span>
              ) : <span className="muted">—</span>,
            },
          ]}
        />
      </div>
    </div>
  );
}

function match(j: JobCard, f: Filter) {
  if (f === 'all') return true;
  if (f === 'open') return isJobCardOpen(j.status);
  return j.status === f;
}
