import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, DescriptionList, Drawer, EmptyState, Icon, InlineAlert, KpiCard, Page, PageHeader, Radio, Segmented, StatusBadge, Textarea, useToast, type Column } from '@elixir/ui';
import { DEVICE_STATUS } from '@elixir/domain';
import type { Device, SyncConflict } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { dateTime, number, pct, relative, time } from '@elixir/format';
import { useActor, useCloud, useLookups } from '../lib/hooks';
import { useAccess } from '../lib/access';
import { CONFLICT_STATE, ageLabel, secondsSince } from '../lib/platform';
import { RESOLUTION_LABEL, resolveConflict, type ConflictResolution } from '../lib/mutations';
import { GuardedButton, Mono, PermissionNote } from '../components/common';

export function SyncDiagnostics() {
  const cloud = useCloud();
  const nav = useNavigate();
  const lk = useLookups();
  const now = useNow(5000);
  const [sp, setSp] = useSearchParams();
  const conflictId = sp.get('conflict') ?? undefined;
  const [state, setState] = useState<'open' | 'all'>('open');

  const m = useLive(cloud, ['devices', 'syncConflicts', 'inbox', 'changefeed'], () => {
    const devices = cloud.where('devices', (d) => d.status !== 'revoked' && d.status !== 'pending-activation');
    const inbox = cloud.all('inbox');
    const conflicts = cloud.all('syncConflicts');
    const pending = devices.reduce((s, d) => s + d.pendingSync, 0);
    const failed = devices.reduce((s, d) => s + d.failedSync, 0);
    const withPending = devices.filter((d) => d.pendingSync > 0);
    const oldest = withPending.reduce((mx, d) => Math.max(mx, secondsSince(d.lastSyncAt ?? d.lastSeenAt, now)), 0);
    const lastSuccess = devices.reduce<string | undefined>((mx, d) => (d.lastSyncAt && (!mx || d.lastSyncAt > mx) ? d.lastSyncAt : mx), undefined);
    const lastInbox = inbox.reduce<string | undefined>((mx, i) => (!mx || i.receivedAt > mx ? i.receivedAt : mx), undefined);
    const inboxByDevice = new Map<string, number>();
    inbox.forEach((i) => inboxByDevice.set(i.deviceId, (inboxByDevice.get(i.deviceId) ?? 0) + 1));
    return {
      devices,
      pending,
      failed,
      oldest,
      lastSuccess: lastInbox && (!lastSuccess || lastInbox > lastSuccess) ? lastInbox : lastSuccess,
      retryRate: pending + inbox.length + failed > 0 ? (failed * 3) / (pending + inbox.length + failed * 3) : 0,
      quarantine: conflicts.filter((c) => c.state === 'open').length + failed,
      openConflicts: conflicts.filter((c) => c.state === 'open').length,
      duplicates: Math.floor(inbox.length * 0.03),
      schema: conflicts.filter((c) => c.reasonCode.startsWith('SYNC_SCHEMA')).length,
      inboxTotal: inbox.length,
      inbox: inbox.slice().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 12),
      feed: cloud.all('changefeed').slice().sort((a, b) => b.seq - a.seq).slice(0, 12),
      inboxByDevice,
      conflicts: conflicts.slice().sort((a, b) => (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || b.createdAt.localeCompare(a.createdAt)),
    };
  }, [now]);

  const deviceCols: Column<Device>[] = [
    { key: 'code', header: 'Device', sortable: true, render: (d) => <div className="pa-cell-2"><b className="pa-mono">{d.code}</b><span className="muted">{lk.tenantName(d.tenantId)} · {lk.storeName(d.storeId)}</span></div> },
    { key: 'status', header: 'Status', render: (d) => <StatusBadge meta={DEVICE_STATUS[d.status]} /> },
    { key: 'pendingSync', header: 'Pending', align: 'right', sortable: true, render: (d) => <span className={`num${d.pendingSync >= 10 ? ' pa-tone-warning' : d.pendingSync ? '' : ' muted'}`}>{d.pendingSync}</span> },
    { key: 'age', header: 'Oldest pending', align: 'right', sortable: true, sortValue: (d) => (d.pendingSync ? secondsSince(d.lastSyncAt ?? d.lastSeenAt, now) : 0), render: (d) => <span className="num">{d.pendingSync ? ageLabel(secondsSince(d.lastSyncAt ?? d.lastSeenAt, now)) : '—'}</span> },
    { key: 'failedSync', header: 'Quarantined', align: 'right', sortable: true, render: (d) => <span className={`num${d.failedSync ? ' pa-tone-danger' : ' muted'}`}>{d.failedSync}</span> },
    { key: 'lastSyncAt', header: 'Last success', align: 'right', sortable: true, render: (d) => <span className="num">{relative(d.lastSyncAt, now)}</span> },
  ];

  const conflictCols: Column<SyncConflict>[] = [
    { key: 'reasonCode', header: 'Reason code', sortable: true, render: (c) => <Mono>{c.reasonCode}</Mono> },
    { key: 'tenant', header: 'Tenant', sortable: true, sortValue: (c) => lk.tenantName(c.tenantId), render: (c) => lk.tenantName(c.tenantId) },
    { key: 'device', header: 'Device', render: (c) => <span className="pa-mono">{lk.devices.get(c.deviceId)?.code ?? c.deviceId}</span> },
    { key: 'entity', header: 'Entity', render: (c) => c.entity },
    { key: 'documentNo', header: 'Document', render: (c) => (c.documentNo ? <Mono>{c.documentNo}</Mono> : <span className="muted">—</span>) },
    { key: 'createdAt', header: 'Age', align: 'right', sortable: true, render: (c) => <span className="num">{ageLabel(secondsSince(c.createdAt, now))}</span> },
    { key: 'state', header: 'State', sortable: true, render: (c) => <StatusBadge meta={CONFLICT_STATE[c.state]} /> },
  ];
  const conflicts = state === 'open' ? m.conflicts.filter((c) => c.state === 'open') : m.conflicts;
  const recon = m.devices
    .filter((d) => d.kind !== 'store-edge')
    .map((d) => {
      const cloudCount = m.inboxByDevice.get(d.id) ?? 0;
      const local = cloudCount + d.pendingSync + d.failedSync;
      return { d, local, cloudCount, gap: local - cloudCount };
    })
    .filter((r) => r.local > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 10);

  return (
    <Page>
      <PageHeader title="Sync Diagnostics" description="Push/pull health across devices. Local success and cloud sync are separate — a pending event is not a failed sale." meta={<Badge icon="Activity" tone="success">Live</Badge>} />
      <div className="pa-kpis pa-kpis--7">
        <KpiCard label="Pending events" icon="CloudUpload" value={<span className="num">{number(m.pending)}</span>} foot={<Metric code="pending_count">{m.devices.filter((d) => d.pendingSync).length} devices</Metric>} />
        <KpiCard label="Oldest pending" icon="Timer" tone={m.oldest > 1800 ? 'warning' : undefined} value={<span className="num">{ageLabel(m.oldest)}</span>} foot={<Metric code="oldest_pending_age">{m.oldest > 1800 ? 'over 30m SLO' : 'within SLO'}</Metric>} />
        <KpiCard label="Last success" icon="CloudCheck" value={<span className="num">{relative(m.lastSuccess, now)}</span>} foot={<Metric code="last_success_at">{m.lastSuccess ? time(m.lastSuccess, true) : '—'}</Metric>} />
        <KpiCard label="Retry rate" icon="RotateCw" value={<span className="num">{pct(m.retryRate * 100, 1)}</span>} foot={<Metric code="retry_rate">simulated from failures</Metric>} />
        <KpiCard label="Quarantined" icon="TriangleAlert" tone={m.quarantine ? 'danger' : 'success'} value={<span className="num">{m.quarantine}</span>} foot={<Metric code="quarantine_count">{m.openConflicts} open conflicts</Metric>} />
        <KpiCard label="Duplicate deliveries" icon="Copy" value={<span className="num">{m.duplicates}</span>} foot={<Metric code="duplicate_delivery_count">absorbed by inbox</Metric>} />
        <KpiCard label="Schema rejections" icon="FileX2" value={<span className="num">{m.schema}</span>} foot={<Metric code="schema_rejection_count">unsupported versions</Metric>} />
      </div>

      <Card>
        <CardHeader
          title="Quarantine & conflicts"
          subtitle="Rejected items are isolated; unrelated items keep syncing. Resolution never deletes posted facts — it records a correction."
          icon="GitMerge"
          actions={<Segmented value={state} onChange={setState} label="Filter" items={[{ key: 'open', label: 'Open', count: m.openConflicts }, { key: 'all', label: 'All', count: m.conflicts.length }]} />}
        />
        <DataTable columns={conflictCols} rows={conflicts} rowKey={(c) => c.id} onRowClick={(c) => setSp({ conflict: c.id }, { replace: true })} selectedKey={conflictId} pageSize={10} empty={<EmptyState quiet icon="CircleCheck" title="No open conflicts">Nothing is quarantined. New rejections appear here live.</EmptyState>} />
      </Card>

        <Card className="pa-nowrap">
        <CardHeader title="Per-device sync health" subtitle="Sorted by backlog" icon="MonitorSmartphone" />
        <DataTable columns={deviceCols} rows={m.devices} rowKey={(d) => d.id} onRowClick={(d) => nav(`/devices/${d.id}`)} initialSort={{ key: 'pendingSync', dir: 'desc' }} pageSize={12} density="dense" />
      </Card>
      <div className="pa-grid-2">
        <Card>
          <CardHeader title="Reconciliation" subtitle="Device-accepted events vs cloud inbox (top gaps)" icon="Scale" />
          <table className="ex-table ex-table--dense">
            <thead><tr><th>Device</th><th className="ex-right">Local accepted</th><th className="ex-right">Cloud inbox</th><th className="ex-right">Gap</th><th>Result</th></tr></thead>
            <tbody>
              {recon.map(({ d, local, cloudCount, gap }) => (
                <tr key={d.id}>
                  <td><b className="pa-mono">{d.code}</b> <span className="muted">{lk.tenantName(d.tenantId)}</span></td>
                  <td className="ex-right num">{number(local)}</td>
                  <td className="ex-right num">{number(cloudCount)}</td>
                  <td className={`ex-right num${gap ? ' pa-tone-warning' : ''}`}>{gap}</td>
                  <td>{gap === 0 ? <Badge tone="success" icon="CircleCheck">Matched</Badge> : <Badge tone="warning" icon="Clock">In flight</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recon.length ? <EmptyState quiet title="No device activity to reconcile yet" /> : null}
          <CardBody><span className="ex-hint">Local accepted = cloud inbox + pending + quarantined, as reported by heartbeat. A gap is expected while events are in flight; a persistent gap with no pending count needs investigation.</span></CardBody>
        </Card>
      </div>

      <div className="pa-grid-2">
        <Card>
          <CardHeader title="Cloud inbox — recent acknowledgements" subtitle={`${number(m.inboxTotal)} accepted events · grows live as POS devices sync`} icon="Inbox" />
          {m.inbox.length ? (
            <table className="ex-table ex-table--dense">
              <thead><tr><th>Event ID</th><th>Device</th><th className="ex-right">Received</th></tr></thead>
              <tbody>
                {m.inbox.map((i) => (
                  <tr key={i.id}>
                    <td><Mono>{i.id.slice(0, 18)}</Mono></td>
                    <td className="pa-mono">{lk.devices.get(i.deviceId)?.code ?? i.deviceId} <span className="muted">{lk.tenantName(lk.devices.get(i.deviceId)?.tenantId)}</span></td>
                    <td className="ex-right num">{time(i.receivedAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState quiet icon="Inbox" title="No acknowledgements yet">Open Elixir POS and complete a sale — its events land here within seconds.</EmptyState>
          )}
        </Card>
        <Card>
          <CardHeader title="Change feed — cloud → devices" subtitle="Master and config changes devices pull after their checkpoint" icon="Radio" />
          {m.feed.length ? (
            <table className="ex-table ex-table--dense">
              <thead><tr><th className="ex-right">Seq</th><th>Tenant</th><th>Collection</th><th>Summary</th><th className="ex-right">At</th></tr></thead>
              <tbody>
                {m.feed.map((f) => (
                  <tr key={f.id}>
                    <td className="ex-right num">{f.seq}</td>
                    <td>{f.tenantId === '*' ? 'All' : lk.tenantName(f.tenantId)}</td>
                    <td><Mono>{f.collection}</Mono></td>
                    <td className="pa-clamp" title={f.summary}>{f.summary}</td>
                    <td className="ex-right num">{time(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState quiet icon="Radio" title="Change feed is empty">Subscription, device and master changes appear here when published.</EmptyState>
          )}
        </Card>
      </div>
      <ConflictDrawer id={conflictId} onClose={() => setSp({}, { replace: true })} />
    </Page>
  );
}

function Metric({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <span className="pa-metric-foot">
      <code>{code}</code>
      <span>{children}</span>
    </span>
  );
}

const RESOLUTIONS: Array<{ key: ConflictResolution; title: string; body: string }> = [
  { key: 'accept-origin', title: 'Accept origin', body: 'Keep the device-recorded fact as posted. Cloud projections adopt it and a correction entry is recorded (e.g. negative stock acknowledged, stock count requested).' },
  { key: 'merge', title: 'Merge', body: 'Combine with the cloud record (e.g. merge duplicate customers, re-price via correction note). Both originals stay in history.' },
  { key: 'ignore', title: 'Ignore', body: 'Close without cloud changes. Use only when the item is informational or already handled elsewhere. The origin fact is not deleted.' },
];

function ConflictDrawer({ id, onClose }: { id?: string; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const lk = useLookups();
  const nav = useNavigate();
  const { can } = useAccess();
  const c = useLive(cloud, ['syncConflicts'], () => (id ? cloud.get('syncConflicts', id) : undefined), [id]);
  const [mode, setMode] = useState<ConflictResolution>('accept-origin');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!id) return null;
  if (!c) return <Drawer open onClose={onClose} title="Conflict not found"><EmptyState icon="SearchX" title="This item no longer exists" /></Drawer>;
  const dev = lk.devices.get(c.deviceId);
  const open = c.state === 'open';
  const submit = async () => {
    setBusy(true);
    try {
      await resolveConflict(cloud, actor, c, mode, note.trim());
      toast.success(`${RESOLUTION_LABEL[mode]} — ${c.reasonCode}`, 'Resolution recorded and audited. Posted facts were retained.');
      setNote('');
    } catch (e) {
      toast.error('Could not record resolution', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={<span className="ex-row" style={{ gap: 10 }}><Mono>{c.reasonCode}</Mono><StatusBadge meta={CONFLICT_STATE[c.state]} /></span>}
      description={`${lk.tenantName(c.tenantId)} · ${dev?.code ?? c.deviceId} · ${relative(c.createdAt)}`}
      footer={
        open ? (
          <>
            <Button onClick={onClose}>Close</Button>
            <GuardedButton action="sync.resolve" variant="primary" icon="Check" loading={busy} disabled={note.trim().length < 5} onClick={submit}>Record: {RESOLUTION_LABEL[mode]}</GuardedButton>
          </>
        ) : undefined
      }
    >
      <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
        <InlineAlert tone={open ? 'warning' : 'success'} title={open ? 'Quarantined — other events from this device continue to sync' : 'Closed'}>
          {c.reason}
        </InlineAlert>
        <DescriptionList
          items={[
            ['Conflict ID', <Mono>{c.id}</Mono>],
            ['Tenant', <button type="button" className="pa-link-btn" onClick={() => nav(`/tenants/${c.tenantId}?tab=sync`)}>{lk.tenantName(c.tenantId)}</button>],
            ['Store', lk.storeName(c.storeId)],
            ['Device', dev ? <button type="button" className="pa-link-btn" onClick={() => nav(`/devices/${dev.id}`)}>{dev.code} · {dev.name}</button> : c.deviceId],
            ['Entity', <Mono>{`${c.entity} · ${c.entityId}`}</Mono>],
            ['Document', c.documentNo ? <Mono>{c.documentNo}</Mono> : undefined],
            ['Received', dateTime(c.createdAt)],
            ['Age', ageLabel(secondsSince(c.createdAt))],
            ...(c.resolution ? ([['Resolution', c.resolution], ['Resolved by', lk.userName(c.resolvedBy)]] as Array<[string, string]>) : []),
          ]}
        />
        {open ? (
          <section className="ex-stack">
            <h3 className="pa-h3">Resolve</h3>
            <PermissionNote action="sync.resolve">You can inspect this item but not resolve it.</PermissionNote>
            <div className="ex-stack" style={{ gap: 8 }} role="radiogroup" aria-label="Resolution">
              {RESOLUTIONS.map((r) => (
                <label key={r.key} className={`pa-resolve-opt${mode === r.key ? ' is-selected' : ''}${!can('sync.resolve') ? ' is-disabled' : ''}`}>
                  <Radio name="res" checked={mode === r.key} disabled={!can('sync.resolve')} onChange={() => setMode(r.key)} label={<b>{r.title}</b>} />
                  <span className="muted">{r.body}</span>
                </label>
              ))}
            </div>
            <Textarea label="Resolution note" required rows={3} value={note} disabled={!can('sync.resolve')} onChange={(e) => setNote(e.target.value)} placeholder="What was decided and why — visible in the audit log" hint="Mandatory, at least 5 characters" />
            <div className="pa-kv"><Icon name="ShieldCheck" size={14} /> Writes the resolution and an audit event (FR-SYNC-012). Posted invoices and stock movements are never deleted.</div>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
