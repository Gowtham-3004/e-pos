import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AuditEvent } from '@elixir/contracts';
import { Badge, Card, DataTable, DescriptionList, Drawer, EmptyState, Icon, KpiCard, SearchInput, Select, Tabs, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { dateTime, number } from '@elixir/format';
import { DateRangeControl, ExportMenu, KpiRow, PageFrame, StoreFilter, useFirstPaint, useRange } from '../components/common';
import { includesQ, useCloud, useLookups, userName } from '../lib/data';
import { downloadTable } from '../lib/csv';
import { useSession } from '../lib/session';

const CAT: Record<AuditEvent['category'], { tone: 'info' | 'neutral' | 'danger'; icon: string; label: string }> = {
  business: { tone: 'info', icon: 'Briefcase', label: 'Business' },
  technical: { tone: 'neutral', icon: 'Cpu', label: 'Technical' },
  security: { tone: 'danger', icon: 'ShieldAlert', label: 'Security' },
};

export function AuditPage() {
  const s = useSession();
  const cloud = useCloud();
  const L = useLookups();
  const loading = useFirstPaint();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'events' | 'conflicts') ?? 'events';
  const [range, setRange] = useRange('7d');
  const [cat, setCat] = useState(params.get('category') ?? '');
  const [actor, setActor] = useState('');
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEvent>();
  const events = useLive(cloud, ['auditEvents'], () => cloud.where('auditEvents', (a) => a.tenantId === s.tenant.id && (!a.storeId || s.scope.includes(a.storeId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.tenant.id, s.scope.join(',')]);
  const conflicts = useLive(cloud, ['syncConflicts'], () => cloud.where('syncConflicts', (c) => c.tenantId === s.tenant.id && s.scope.includes(c.storeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.tenant.id, s.scope.join(',')]);
  const inRange = useMemo(() => events.filter((a) => a.createdAt.slice(0, 10) >= range.from && a.createdAt.slice(0, 10) <= range.to), [events, range.from, range.to]);
  const rows = useMemo(() => inRange.filter((a) => (!cat || a.category === cat) && (!actor || a.actorId === actor || a.approvedBy === actor) && (!store || a.storeId === store) && includesQ(q, a.summary, a.action, a.documentNo, a.reason)), [inRange, cat, actor, store, q]);
  const actors = useMemo(() => [...new Set(inRange.map((a) => a.actorId))].map((id) => ({ value: id, label: userName(L, id) })).sort((a, b) => a.label.localeCompare(b.label)), [inRange, L]);

  const cols: Column<AuditEvent>[] = [
    { key: 'at', header: 'Time', render: (a) => <span className="num">{dateTime(a.createdAt)}</span> },
    { key: 'cat', header: 'Category', render: (a) => <Badge tone={CAT[a.category].tone} icon={CAT[a.category].icon}>{CAT[a.category].label}</Badge> },
    { key: 'action', header: 'Action', render: (a) => <span className="bo-mono">{a.action}</span> },
    { key: 'summary', header: 'Event', render: (a) => <div style={{ maxWidth: 420 }}><div className="bo-cell-main ex-truncate">{a.summary}</div>{a.reason ? <div className="bo-cell-sub ex-truncate">Reason: {a.reason}</div> : null}</div> },
    { key: 'entity', header: 'Entity / document', render: (a) => <span className="secondary">{a.entity}{a.documentNo ? <span className="num"> · {a.documentNo}</span> : ''}</span> },
    { key: 'actor', header: 'Actor', render: (a) => userName(L, a.actorId) },
    { key: 'approver', header: 'Approver', render: (a) => (a.approvedBy ? userName(L, a.approvedBy) : <span className="muted">—</span>) },
    { key: 'where', header: 'Where', render: (a) => <span className="secondary">{a.storeId ? s.storeName(a.storeId) : 'Cloud'}{a.counterId ? ` · ${L.counters.get(a.counterId)?.code ?? ''}` : ''}</span> },
  ];

  const doExport = (kind: 'csv' | 'xls') => downloadTable(`audit-${range.from}-${range.to}`, ['Time', 'Category', 'Action', 'Summary', 'Entity', 'Document', 'Actor', 'Approver', 'Store', 'Reason'], rows.map((a) => [a.createdAt, a.category, a.action, a.summary, a.entity, a.documentNo, userName(L, a.actorId), a.approvedBy ? userName(L, a.approvedBy) : '', a.storeId ? s.storeName(a.storeId) : 'Cloud', a.reason]), kind);

  return (
    <PageFrame title="Audit log" description={<><Icon name="Lock" size={13} style={{ verticalAlign: -2 }} /> Immutable record of business, technical and security events from POS devices and Back Office.</>} crumbs={[{ label: 'Administration' }, { label: 'Audit Log' }]}
      actions={s.can('reports.export') && tab === 'events' ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} /> : undefined}>
      <Tabs items={[{ key: 'events', label: 'Events' }, { key: 'conflicts', label: 'Sync conflicts', count: conflicts.filter((c) => c.state === 'open').length }]} value={tab} onChange={(k) => setParams({ tab: k })} />
      {tab === 'events' ? (
        <>
          <DateRangeControl value={range} onChange={setRange} />
          <KpiRow>
            <KpiCard label="Events" icon="ScrollText" value={number(inRange.length)} loading={loading} />
            <KpiCard label="Business" icon="Briefcase" value={number(inRange.filter((a) => a.category === 'business').length)} onClick={() => setCat('business')} loading={loading} />
            <KpiCard label="Security" icon="ShieldAlert" tone={inRange.some((a) => a.category === 'security') ? 'danger' : undefined} value={number(inRange.filter((a) => a.category === 'security').length)} onClick={() => setCat('security')} loading={loading} />
            <KpiCard label="With approver" icon="ShieldCheck" value={number(inRange.filter((a) => a.approvedBy).length)} foot="Manager overrides & approvals" loading={loading} />
          </KpiRow>
          <Card className="bo-card-table">
            <div className="bo-toolbar">
              <SearchInput placeholder="Search event, action, document, reason" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
              <Select size="sm" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, { value: 'business', label: 'Business' }, { value: 'technical', label: 'Technical' }, { value: 'security', label: 'Security' }]} />
              <Select size="sm" aria-label="Actor" value={actor} onChange={(e) => setActor(e.target.value)} options={[{ value: '', label: 'Any actor / approver' }, ...actors]} />
              <StoreFilter value={store} onChange={setStore} />
            </div>
            <DataTable columns={cols} rows={rows} rowKey={(a) => a.id} loading={loading} density="dense" pageSize={50} onRowClick={setOpen} empty={<EmptyState quiet icon="ScrollText" title="No events match">Widen the date range or clear filters.</EmptyState>} />
          </Card>
        </>
      ) : (
        <Card className="bo-card-table">
          <DataTable rows={conflicts} rowKey={(c) => c.id} empty={<EmptyState quiet icon="GitMerge" title="No sync conflicts">Devices are syncing cleanly.</EmptyState>}
            columns={[
              { key: 'at', header: 'Raised', render: (c) => <span className="num">{dateTime(c.createdAt)}</span> },
              { key: 'code', header: 'Reason code', render: (c) => <span className="bo-mono">{c.reasonCode}</span> },
              { key: 'r', header: 'Detail', render: (c) => <span className="secondary">{c.reason}</span> },
              { key: 'doc', header: 'Document', render: (c) => <span className="num">{c.documentNo ?? c.entity}</span> },
              { key: 'dev', header: 'Device · store', render: (c) => `${L.devices.get(c.deviceId)?.code ?? c.deviceId} · ${s.storeName(c.storeId)}` },
              { key: 'st', header: 'State', render: (c) => (c.state === 'open' ? <Badge tone="danger" icon="GitMerge">Conflict</Badge> : <Badge tone="success" icon="CircleCheck">{c.state === 'resolved' ? 'Resolved' : 'Ignored'}</Badge>) },
              { key: 'res', header: 'Resolution', render: (c) => <span className="secondary">{c.resolution ?? (c.state === 'open' ? 'Awaiting Elixir support / manager review on device' : '—')}</span> },
            ]} />
        </Card>
      )}
      <Drawer open={!!open} onClose={() => setOpen(undefined)} size="lg" title={open?.summary} description={open ? `${open.action} · ${dateTime(open.createdAt)}` : undefined}>
        {open ? (
          <div className="ex-stack" style={{ gap: 16 }}>
            <DescriptionList items={[
              ['Category', CAT[open.category].label], ['Actor', userName(L, open.actorId)], ['Approved by', open.approvedBy ? userName(L, open.approvedBy) : '—'], ['Entity', `${open.entity} · ${open.entityId}`], ['Document', open.documentNo],
              ['Store', open.storeId ? s.storeName(open.storeId) : 'Cloud (Back Office)'], ['Counter', open.counterId ? L.counters.get(open.counterId)?.code : '—'], ['Device', open.deviceId ? L.devices.get(open.deviceId)?.code ?? open.deviceId : '—'], ['Reason', open.reason], ['Event id', <span key="id" className="bo-mono">{open.id}</span>],
            ]} />
            {open.before !== undefined || open.after !== undefined ? (
              <div className="bo-grid-2">
                <div><div className="ex-label">Before</div><pre className="bo-mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-sunken)', padding: 10, borderRadius: 8, maxHeight: 360, overflow: 'auto' }}>{open.before ? JSON.stringify(open.before, null, 2) : '—'}</pre></div>
                <div><div className="ex-label">After</div><pre className="bo-mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-sunken)', padding: 10, borderRadius: 8, maxHeight: 360, overflow: 'auto' }}>{open.after ? JSON.stringify(open.after, null, 2) : '—'}</pre></div>
              </div>
            ) : null}
            <div className="ex-hint"><Icon name="Lock" size={12} style={{ verticalAlign: -2 }} /> Audit events cannot be edited or deleted.</div>
          </div>
        ) : null}
      </Drawer>
    </PageFrame>
  );
}
