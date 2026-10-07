import { useState } from 'react';
import type { SyncOutboxItem } from '@elixir/contracts';
import { CONNECTIVITY, OUTBOX_STATUS } from '@elixir/domain';
import { dateTime, relative } from '@elixir/format';
import { useLive, useMeta, useNow } from '@elixir/local-store/react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, Icon, InlineAlert, Segmented, StatusBadge, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';

/** Sync Center (§26) — managers only. Cashiers never manage queues. */
export function SyncCenterScreen() {
  const s = useSession();
  const { device, engine, sync, network } = usePos();
  const toast = useToast();
  const now = useNow(5000);
  const [filter, setFilter] = useState<'open' | 'all' | 'quarantined'>('open');
  const [busy, setBusy] = useState(false);
  const [dismiss, setDismiss] = useState<SyncOutboxItem>();
  const items = useLive(device, ['outbox'], () => (engine ? engine.outbox() : []).sort((a, b) => b.sequence - a.sequence), [engine]);
  const rows = items.filter((o) => (filter === 'all' ? true : filter === 'quarantined' ? o.status === 'quarantined' : o.status !== 'acknowledged'));
  const lastPull = useMeta<string[]>(device, 'lastPullSummary');
  const lastPullAt = useMeta<string>(device, 'lastPullAt');
  const canResolve = s.permissions.includes('sync.resolve') || s.permissions.includes('approvals.act');
  if (!sync) return null;
  const edgeLabel = network.edge === 'connected' ? 'Connected' : network.edge === 'unavailable' ? 'Unavailable' : 'Not configured';

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Sync Center</div>
          <div className="pos-page__desc">Device {s.device.code} · {s.device.id} · local sales are already safe; this queue only uploads copies to Elixir Cloud.</div>
        </div>
        <div className="ex-spacer" />
        <Button icon="GitMerge" onClick={async () => { await engine?.injectConflict(s.store.id); toast.warning('Conflict simulated', 'One stock movement will be rejected by the cloud.'); }}>Simulate conflict</Button>
        <Button variant="primary" icon="RefreshCw" loading={busy} disabled={!sync.cloudReachable} onClick={async () => { setBusy(true); await engine?.syncNow(); setBusy(false); toast.success('Sync attempted', `${engine?.status().pending ?? 0} still pending`); }}>Sync now</Button>
      </div>
      {!sync.cloudReachable ? (
        <InlineAlert tone="neutral" icon="CloudOff" title={network.wan === 'offline' ? 'Internet is offline' : 'Elixir Cloud is unreachable'}>
          Sync now requires a cloud connection. Billing continues normally; {sync.pending} change(s) will upload automatically on reconnect.
        </InlineAlert>
      ) : null}
      {sync.quarantined ? <InlineAlert tone="danger" icon="TriangleAlert" title={`${sync.quarantined} item(s) need attention`}>The cloud rejected these on business rules. Unrelated items keep syncing. Retry after correcting, or dismiss with a reason.</InlineAlert> : null}
      <div className="pos-kpis">
        <div className="pos-stat"><span className="pos-stat__k">Connectivity</span><span className="pos-stat__v"><StatusBadge meta={CONNECTIVITY[sync.connectivity]} size="lg" /></span></div>
        <div className="pos-stat"><span className="pos-stat__k">Last successful sync</span><span className="pos-stat__v">{relative(sync.lastSuccessAt, now)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Pending</span><span className="pos-stat__v">{sync.pending}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Retrying</span><span className="pos-stat__v">{sync.failed}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Quarantined</span><span className="pos-stat__v" style={{ color: sync.quarantined ? 'var(--status-danger)' : undefined }}>{sync.quarantined}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Oldest pending</span><span className="pos-stat__v">{sync.oldestPendingAt ? relative(sync.oldestPendingAt, now) : '—'}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Elixir Cloud</span><span className="pos-stat__v"><Badge tone={sync.cloudReachable ? 'success' : 'neutral'} icon={sync.cloudReachable ? 'Cloud' : 'CloudOff'} size="lg">{sync.cloudReachable ? 'Reachable' : network.wan === 'offline' ? 'Offline' : 'Down'}</Badge></span></div>
        <div className="pos-stat"><span className="pos-stat__k">Store Edge</span><span className="pos-stat__v"><Badge tone={network.edge === 'connected' ? 'success' : network.edge === 'unavailable' ? 'warning' : 'neutral'} icon="Router" size="lg">{edgeLabel}</Badge></span></div>
      </div>
      <div className="pos-split" style={{ gridTemplateColumns: 'minmax(0,1fr) 320px' }}>
        <Card>
          <CardHeader title="Outbox" subtitle="Transactional outbox rows from this device, in sequence order" icon="Inbox" actions={<Segmented label="Filter" value={filter} onChange={setFilter} items={[{ key: 'open', label: 'Open', count: items.filter((o) => o.status !== 'acknowledged').length }, { key: 'quarantined', label: 'Attention', count: sync.quarantined }, { key: 'all', label: 'All' }]} />} />
          <DataTable
            rows={rows}
            rowKey={(o) => o.id}
            pageSize={12}
            density="dense"
            empty={<EmptyState quiet icon="CloudCheck" title={filter === 'open' ? 'Everything is synced' : 'Nothing here'}>No changes waiting on this device.</EmptyState>}
            columns={[
              { key: 'sequence', header: 'Seq', align: 'right', render: (o) => <span className="num">{o.sequence}</span> },
              { key: 'doc', header: 'Document / event', render: (o) => (
                <div style={{ minWidth: 0 }}>
                  <div className="num ex-truncate" title={o.documentNo ?? o.payloadSummary} style={{ maxWidth: 200, fontWeight: 600 }}>{o.documentNo ?? o.payloadSummary}</div>
                  <code className="muted" style={{ fontSize: 11 }}>{o.eventType}</code>
                </div>
              ) },
              { key: 'status', header: 'Status', render: (o) => <StatusBadge meta={OUTBOX_STATUS[o.status]} /> },
              { key: 'attempts', header: 'Tries', align: 'right', render: (o) => o.attempts },
              { key: 'err', header: 'Last error', render: (o) => (o.lastError ? <span className="ex-truncate" title={o.lastError} style={{ maxWidth: 160, display: 'inline-block', color: o.status === 'quarantined' ? 'var(--status-danger)' : 'var(--text-secondary)', fontSize: 12 }}>{o.lastError}</span> : <span className="muted">—</span>) },
              { key: 'age', header: 'Age', render: (o) => <span title={dateTime(o.createdAtOrigin)}>{relative(o.createdAtOrigin, now)}</span> },
              {
                key: 'act', header: '', align: 'right', render: (o) =>
                  o.status === 'quarantined' && canResolve ? (
                    <span className="ex-row" style={{ justifyContent: 'flex-end' }}>
                      <Button size="sm" icon="RotateCw" onClick={async () => { await engine?.resolveQuarantined(o.id, 'retry'); toast.info('Queued for retry', `Seq ${o.sequence}`); }}>Retry</Button>
                      <Button size="sm" variant="danger-outline" onClick={() => setDismiss(o)}>Dismiss</Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        </Card>
        <div className="ex-stack">
          <Card>
            <CardHeader title="Recently pulled from cloud" subtitle={lastPullAt ? `Applied ${relative(lastPullAt, now)}` : 'No master changes pulled yet'} icon="CloudDownload" />
            <div className="pos-card-pad">
              {lastPull?.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                  {lastPull.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>Price and product changes published from Back Office appear here after the next pull.</span>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Diagnostics" icon="Stethoscope" />
            <div className="pos-card-pad pos-kv">
              <span>Device code</span><span>{s.device.code}</span>
              <span>Device id</span><span style={{ fontSize: 11 }}>{s.device.id}</span>
              <span>Checkpoint</span><span>{device.meta<number>('syncCheckpoint') ?? 0}</span>
              <span>Outbox rows (kept)</span><span>{items.length}</span>
              <span>Transport</span><span>{sync.cloudReachable ? 'HTTPS · idempotent' : 'Queued locally'}</span>
            </div>
          </Card>
          <InlineAlert tone="info" icon="Info">Retries use the same idempotency key, so a repeated upload never duplicates a sale in the cloud.</InlineAlert>
        </div>
      </div>
      <ConfirmDialog open={!!dismiss} onClose={() => setDismiss(undefined)} requireReason title="Dismiss quarantined item?" confirmLabel="Dismiss item" onConfirm={async () => { if (dismiss) await engine?.resolveQuarantined(dismiss.id, 'dismiss'); toast.info('Item dismissed', 'Origin facts are kept on the device; resolution is audited.'); setDismiss(undefined); }}>
        <span className="ex-row"><Icon name="TriangleAlert" size={16} /> {dismiss?.payloadSummary} · {dismiss?.lastError}</span>
      </ConfirmDialog>
    </div>
  );
}
