import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Card, CardBody, CardHeader, Checkbox, DataTable, DescriptionList, Drawer, EmptyState, FilterBar, Icon, InlineAlert, KpiCard, Modal, Page, PageHeader,
  Menu, MenuItem, MenuLabel, Radio, SearchInput, Select, StatusBadge, TextField, Textarea, Timeline, useToast,
} from '@elixir/ui';
import { DEVICE_STATUS } from '@elixir/domain';
import type { Counter, Device, DeviceStatus } from '@elixir/contracts';
import { useEntity, useLive, useNow } from '@elixir/local-store/react';
import { dateTime, number, relative } from '@elixir/format';
import { useActor, useCloud, useLookups } from '../lib/hooks';
import { useAccess, type PlatformAction } from '../lib/access';
import { DEVICE_KIND_LABEL, LATEST_APP_VERSION, LATEST_EDGE_VERSION, activationCode, deviceOutdated } from '../lib/platform';
import { activateDevice, logDiagnosticsRequest, reassignDevice, renameDevice, replaceDevice, resetBootstrap, revokeDevice } from '../lib/mutations';
import { deviceColumns } from '../components/deviceColumns';
import { GuardedButton, Mono, PermissionNote } from '../components/common';

export function Devices() {
  const cloud = useCloud();
  const nav = useNavigate();
  const { id } = useParams();
  const lk = useLookups();
  const now = useNow(15000);
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '', status = sp.get('status') ?? '', kind = sp.get('kind') ?? '', tenant = sp.get('tenant') ?? '', outdated = sp.get('outdated') === '1';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const all = useLive(cloud, ['devices'], () => cloud.all('devices'));
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((d) => {
      if (status && d.status !== status) return false;
      if (kind && d.kind !== kind) return false;
      if (tenant && d.tenantId !== tenant) return false;
      if (outdated) {
        const o = deviceOutdated(d, lk.tenants.get(d.tenantId));
        if (!o.app && !o.config) return false;
      }
      return !s || [d.code, d.name, d.id, d.os, lk.tenantName(d.tenantId), lk.storeName(d.storeId)].some((x) => x.toLowerCase().includes(s));
    });
  }, [all, q, status, kind, tenant, outdated, lk]);
  const summary = useMemo(() => {
    const c = { active: 0, offline: 0, attention: 0, revoked: 0, 'pending-activation': 0 } as Record<DeviceStatus, number>;
    all.forEach((d) => c[d.status]++);
    const out = all.filter((d) => { const o = deviceOutdated(d, lk.tenants.get(d.tenantId)); return o.app || o.config; }).length;
    return { ...c, outdated: out };
  }, [all, lk]);

  const active = [
    status && { key: 'status', label: `Status: ${DEVICE_STATUS[status as DeviceStatus]?.label}`, onRemove: () => set('status', '') },
    kind && { key: 'kind', label: `Kind: ${DEVICE_KIND_LABEL[kind as Device['kind']]}`, onRemove: () => set('kind', '') },
    tenant && { key: 'tenant', label: `Tenant: ${lk.tenantName(tenant)}`, onRemove: () => set('tenant', '') },
    outdated && { key: 'outdated', label: 'Outdated version', onRemove: () => set('outdated', '') },
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;

  return (
    <Page>
      <PageHeader title="Device Registry" description={`${all.length} registered devices · identity, assignment, versions, sync backlog and lifecycle`} />
      <div className="pa-kpis pa-kpis--5">
        <KpiCard label="Active" icon="CircleCheck" value={<span className="num">{summary.active}</span>} onClick={() => set('status', 'active')} />
        <KpiCard label="Offline" icon="WifiOff" value={<span className="num">{summary.offline}</span>} foot="Keep selling locally; sync on reconnect" onClick={() => set('status', 'offline')} />
        <KpiCard label="Attention" icon="TriangleAlert" tone={summary.attention ? 'warning' : undefined} value={<span className="num">{summary.attention}</span>} onClick={() => set('status', 'attention')} />
        <KpiCard label="Pending activation" icon="Hourglass" value={<span className="num">{summary['pending-activation']}</span>} onClick={() => set('status', 'pending-activation')} />
        <KpiCard label="Outdated version" icon="ArrowUpCircle" tone={summary.outdated ? 'warning' : undefined} value={<span className="num">{summary.outdated}</span>} foot={`App ${LATEST_APP_VERSION} · Edge ${LATEST_EDGE_VERSION}`} onClick={() => set('outdated', '1')} />
      </div>
      <FilterBar active={active} onClearAll={() => setSp(q ? { q } : {}, { replace: true })}>
        <SearchInput placeholder="Search code, name, tenant, store, OS" value={q} onChange={(e) => set('q', e.target.value)} onClear={() => set('q', '')} wrapClassName="pa-filter-search" aria-label="Search devices" />
        <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={Object.entries(DEVICE_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
        <Select aria-label="Kind" value={kind} onChange={(e) => set('kind', e.target.value)} placeholder="All kinds" options={Object.entries(DEVICE_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Tenant" value={tenant} onChange={(e) => set('tenant', e.target.value)} placeholder="All tenants" options={[...lk.tenants.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.name }))} />
        <Checkbox label="Outdated only" checked={outdated} onChange={(e) => set('outdated', e.target.checked ? '1' : '')} />
      </FilterBar>
      <Card className="pa-nowrap">
        <DataTable
          columns={deviceColumns(lk, now, { tenant: true })}
          rows={rows}
          rowKey={(d) => d.id}
          onRowClick={(d) => nav(`/devices/${d.id}${sp.toString() ? `?${sp}` : ''}`)}
          selectedKey={id}
          initialSort={{ key: 'pendingSync', dir: 'desc' }}
          pageSize={25}
          density="dense"
          empty={<EmptyState icon="SearchX" title="No devices match these filters" actions={<Button onClick={() => setSp({}, { replace: true })}>Clear filters</Button>} />}
        />
      </Card>
      <DeviceDrawer id={id} onClose={() => nav(`/devices${sp.toString() ? `?${sp}` : ''}`)} />
    </Page>
  );
}

type Dialog = 'activate' | 'rename' | 'reassign' | 'revoke' | 'replace' | 'reset' | undefined;

function DeviceDrawer({ id, onClose }: { id?: string; onClose: () => void }) {
  const cloud = useCloud();
  const nav = useNavigate();
  const lk = useLookups();
  const now = useNow(10000);
  const toast = useToast();
  const actor = useActor();
  const { can } = useAccess();
  const d = useEntity(cloud, 'devices', id);
  const [dialog, setDialog] = useState<Dialog>();
  const events = useLive(cloud, ['auditEvents'], () => (id ? cloud.where('auditEvents', (a) => (a.deviceId === id || a.entityId === id) && a.category !== 'business').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25) : []), [id]);
  const inboxCount = useLive(cloud, ['inbox'], () => (id ? cloud.where('inbox', (i) => i.deviceId === id).length : 0), [id]);
  if (!id) return null;
  if (!d) {
    return (
      <Drawer open onClose={onClose} title="Device not found" size="lg">
        <EmptyState icon="SearchX" title="This device no longer exists">The link may be out of date.</EmptyState>
      </Drawer>
    );
  }
  const tenant = lk.tenants.get(d.tenantId);
  const o = deviceOutdated(d, tenant);
  const pending = d.status === 'pending-activation';
  const revoked = d.status === 'revoked';

  const diagnostics = async () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      generatedBy: 'Elixir Platform Admin (prototype)',
      redaction: 'Secrets, tokens, PINs and customer PII are excluded by design',
      device: { id: d.id, code: d.code, kind: d.kind, status: d.status, appVersion: d.appVersion, configVersion: d.configVersion, os: d.os, activatedAt: d.activatedAt, lastSeenAt: d.lastSeenAt, lastSyncAt: d.lastSyncAt },
      assignment: { tenantId: d.tenantId, storeId: d.storeId, counter: lk.counterCode(d.counterId) },
      sync: { pending: d.pendingSync, failed: d.failedSync, cloudInboxAccepted: inboxCount, tenantConfigVersion: tenant?.configVersion },
      peripherals: d.peripherals ?? [],
      localDb: { engine: 'SQLite (WAL)', integrityCheck: 'ok', schemaVersion: 14, sizeMb: 48 + (d.pendingSync % 17) },
      recentEvents: events.slice(0, 10).map((e) => ({ at: e.createdAt, action: e.action, category: e.category })),
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `diagnostics-${d.code}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    await logDiagnosticsRequest(cloud, actor, d);
    toast.success('Diagnostics bundle downloaded', 'No secrets or customer PII included. Request was audited.');
  };

  const timeline = [
    ...(d.status !== 'pending-activation' ? [{ id: 'seen', time: relative(d.lastSeenAt, now), title: 'Last heartbeat', meta: dateTime(d.lastSeenAt), tone: d.status === 'active' ? ('success' as const) : undefined }] : []),
    ...events.map((e) => ({ id: e.id, time: relative(e.createdAt, now), title: e.summary, meta: `${e.action} · ${lk.userName(e.actorId)}${e.reason ? ` · Reason: ${e.reason}` : ''}`, tone: e.category === 'security' ? ('danger' as const) : ('info' as const) })),
    ...(d.activatedAt && !events.some((e) => e.action === 'device.activated') ? [{ id: 'act', time: relative(d.activatedAt, now), title: 'Device activated', meta: dateTime(d.activatedAt), tone: 'success' as const }] : []),
  ];

  return (
    <Drawer
      open
      // Escape inside a nested dialog must not also close the drawer underneath.
      onClose={() => !dialog && onClose()}
      size="lg"
      title={
        <span className="ex-row" style={{ gap: 10 }}>
          <span className="pa-mono">{d.code}</span>
          <StatusBadge meta={DEVICE_STATUS[d.status]} />
        </span>
      }
      description={`${d.name} · ${lk.tenantName(d.tenantId)}`}
      footer={
        <div className="pa-drawer-actions">
          {pending ? <GuardedButton action="device.activate" variant="primary" icon="KeyRound" onClick={() => setDialog('activate')}>Activate</GuardedButton> : null}
          {!revoked ? <GuardedButton action="device.rename" icon="Pencil" onClick={() => setDialog('rename')}>Rename</GuardedButton> : null}
          {!revoked && d.kind !== 'store-edge' ? <GuardedButton action="device.reassign" icon="ArrowLeftRight" onClick={() => setDialog('reassign')}>Reassign</GuardedButton> : null}
          <Menu align="left" trigger={(p) => <Button icon="Ellipsis" iconRight="ChevronUp" {...p}>More</Button>}>
            {(close) => (
              <>
                <MenuLabel>Lifecycle & support</MenuLabel>
                {!revoked && !pending ? <GatedItem action="device.replace" icon="Replace" onClick={() => { close(); setDialog('replace'); }}>Replace device…</GatedItem> : null}
                {!revoked && !pending ? <GatedItem action="device.reset" icon="RotateCcw" onClick={() => { close(); setDialog('reset'); }}>Reset local bootstrap…</GatedItem> : null}
                <GatedItem action="device.diagnostics" icon="Download" onClick={() => { close(); void diagnostics(); }}>Download diagnostics bundle</GatedItem>
              </>
            )}
          </Menu>
          <div className="ex-spacer" />
          {!revoked ? <GuardedButton action="device.revoke" variant="danger-outline" icon="Ban" onClick={() => setDialog('revoke')}>Revoke</GuardedButton> : null}
        </div>
      }
    >
      <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
        {revoked ? (
          <InlineAlert tone="danger" icon="Ban" title="Revoked">
            This device's credentials are invalid. It cannot obtain configuration, pull masters or push new events. Its history and previously synced documents are kept.
          </InlineAlert>
        ) : pending ? (
          <InlineAlert tone="info" icon="Hourglass" title="Awaiting activation">
            The device shows activation code <span className="pa-code">{activationCode(d.id)}</span> on its first-run screen. Confirm it here to issue credentials and configuration.
          </InlineAlert>
        ) : d.status === 'attention' ? (
          <InlineAlert tone="warning" title="Needs attention">{d.failedSync ? `${d.failedSync} event(s) quarantined — see Sync Diagnostics. ` : ''}Check peripherals and sync backlog below.</InlineAlert>
        ) : null}
        {!can('device.revoke') ? <PermissionNote action="device.revoke">Revoke and replace are restricted.</PermissionNote> : null}
        <div className="pa-grid-2">
          <section>
            <h3 className="pa-h3">Identity</h3>
            <DescriptionList items={[['Device ID', <Mono>{d.id}</Mono>], ['Code', <Mono>{d.code}</Mono>], ['Name', d.name], ['Kind', DEVICE_KIND_LABEL[d.kind]], ['OS', d.os], ['Activated', d.activatedAt ? dateTime(d.activatedAt) : '—']]} />
          </section>
          <section>
            <h3 className="pa-h3">Assignment</h3>
            <DescriptionList
              items={[
                ['Tenant', <button type="button" className="pa-link-btn" onClick={() => nav(`/tenants/${d.tenantId}`)}>{lk.tenantName(d.tenantId)}</button>],
                ['Store', lk.storeName(d.storeId)],
                ['Counter', d.counterId ? <Mono>{lk.counterCode(d.counterId)}</Mono> : <span className="muted">Unassigned</span>],
                ['App version', <span className="num">{d.appVersion} {o.app ? <Badge tone="warning">Update available</Badge> : <Badge tone="success">Current</Badge>}</span>],
                ['Config version', <span className={`num${o.config ? ' pa-tone-warning' : ''}`}>v{d.configVersion}{tenant ? ` (tenant v${tenant.configVersion})` : ''}</span>],
                ['Last seen', d.status === 'pending-activation' ? '—' : `${relative(d.lastSeenAt, now)} · ${dateTime(d.lastSeenAt)}`],
              ]}
            />
          </section>
        </div>
        <section>
          <h3 className="pa-h3">Sync backlog & local database</h3>
          <div className="pa-mini-stats">
            <div><span className="muted">Pending</span><b className={`num${d.pendingSync >= 10 ? ' pa-tone-warning' : ''}`}>{number(d.pendingSync)}</b></div>
            <div><span className="muted">Failed / quarantined</span><b className={`num${d.failedSync ? ' pa-tone-danger' : ''}`}>{d.failedSync}</b></div>
            <div><span className="muted">Last sync</span><b className="num">{relative(d.lastSyncAt, now)}</b></div>
            <div><span className="muted">Cloud inbox accepted</span><b className="num">{number(inboxCount)}</b></div>
          </div>
          <div className="pa-localdb">
            {[
              ['Local database', pending ? 'Not initialised' : 'SQLite · WAL · integrity ok', pending ? 'neutral' : 'success'],
              ['Schema version', pending ? '—' : 'v14 (supported)', pending ? 'neutral' : 'success'],
              ['Outbox journal', pending ? '—' : `${d.pendingSync} pending · ${d.failedSync} quarantined`, d.failedSync ? 'warning' : pending ? 'neutral' : 'success'],
              ['Config cache', pending ? 'Awaiting bootstrap' : o.config ? `Stale — v${d.configVersion}, pulls v${tenant?.configVersion} on next sync` : `Current v${d.configVersion}`, o.config ? 'warning' : pending ? 'neutral' : 'success'],
            ].map(([k, v, t]) => (
              <div key={k} className="pa-localdb__row">
                <Icon name={t === 'success' ? 'CircleCheck' : t === 'warning' ? 'TriangleAlert' : 'Circle'} size={15} className={`pa-tone-${t}`} />
                <span>{k}</span>
                <span className="muted">{v}</span>
              </div>
            ))}
            <span className="ex-hint">Local DB summary is reported by the device heartbeat (simulated in this prototype).</span>
          </div>
        </section>
        {d.kind !== 'store-edge' && d.kind !== 'mobile' ? (
          <section>
            <h3 className="pa-h3">Peripherals readiness</h3>
            {d.peripherals?.length ? (
              <div className="pa-periph">
                {d.peripherals.map((p) => (
                  <div key={p.kind} className="pa-periph__row">
                    <Icon name={p.kind === 'printer' ? 'Printer' : p.kind === 'scanner' ? 'ScanBarcode' : p.kind === 'scale' ? 'Scale' : p.kind === 'customer-display' ? 'MonitorSpeaker' : 'Archive'} size={16} className="muted" />
                    <span>{p.name}</span>
                    <span className="muted">{p.kind}</span>
                    <Badge tone={p.state === 'ready' || p.state === 'connected' ? 'success' : p.state === 'error' ? 'danger' : 'warning'} icon={p.state === 'ready' || p.state === 'connected' ? 'CircleCheck' : 'TriangleAlert'}>
                      {p.state === 'ready' ? 'Ready' : p.state === 'connected' ? 'Connected' : p.state === 'error' ? 'Error' : 'Unavailable'}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No peripherals reported{pending ? ' — reported after activation' : ''}.</p>
            )}
          </section>
        ) : null}
        <section>
          <h3 className="pa-h3">Timeline</h3>
          {timeline.length ? <Timeline items={timeline} /> : <p className="muted">No events yet.</p>}
        </section>
      </div>
      <ActivateDialog open={dialog === 'activate'} device={d} onClose={() => setDialog(undefined)} />
      <RenameDialog open={dialog === 'rename'} device={d} onClose={() => setDialog(undefined)} />
      <ReassignDialog open={dialog === 'reassign'} device={d} onClose={() => setDialog(undefined)} />
      <RevokeDialog open={dialog === 'revoke'} device={d} onClose={() => setDialog(undefined)} />
      <ReplaceDialog open={dialog === 'replace'} device={d} onClose={() => setDialog(undefined)} />
      <ResetDialog open={dialog === 'reset'} device={d} onClose={() => setDialog(undefined)} />
    </Drawer>
  );
}

// ───────── Dialogs ─────────

function useCounterOptions(d: Device) {
  const cloud = useCloud();
  return useLive(cloud, ['counters', 'devices', 'stores'], () => {
    const stores = cloud.where('stores', (s) => s.tenantId === d.tenantId);
    return stores.flatMap((s) =>
      cloud.where('counters', (c) => c.storeId === s.id).map((c) => {
        const occupant = cloud.where('devices', (x) => x.counterId === c.id && x.id !== d.id && x.status !== 'revoked')[0];
        return { counter: c, store: s, occupant };
      }),
    );
  }, [d.id, d.tenantId]);
}

function ActivateDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const lk = useLookups();
  const options = useCounterOptions(d);
  const [code, setCode] = useState('');
  const [target, setTarget] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const expected = activationCode(d.id);
  const storeCounters = options.filter((o) => o.store.id === d.storeId);
  const nextCode = `C${String(storeCounters.length + 1).padStart(2, '0')}`;
  const free = storeCounters.filter((o) => !o.occupant);
  const choice = target || (d.counterId ? d.counterId : free[0]?.counter.id ?? 'new');
  const codeOk = code.trim().toUpperCase().replace(/\s/g, '') === expected;
  const tenant = lk.tenants.get(d.tenantId);
  const run = async () => {
    setBusy(true);
    try {
      const store = lk.stores.get(d.storeId);
      const newCounter: Counter | undefined = choice === 'new' ? { id: `c-${d.storeId}-${storeCounters.length + 1}`, storeId: d.storeId, code: nextCode, name: `Counter ${storeCounters.length + 1}`, kind: d.kind === 'kds' ? 'kitchen' : 'billing', printerName: `Counter ${storeCounters.length + 1} Printer`, active: true } : undefined;
      await activateDevice(cloud, actor, d, tenant, { counterId: choice === 'new' || choice === 'none' ? undefined : choice, newCounter });
      toast.success(`${d.code} activated`, `${store?.name ?? ''}${newCounter ? ` · new counter ${newCounter.code}` : ''} · config v${tenant?.configVersion} issued.`);
      onClose();
    } catch (e) {
      toast.error('Activation failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title={`Activate ${d.code}`}
      description={`${d.name} · ${lk.tenantName(d.tenantId)} · ${lk.storeName(d.storeId)}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon="KeyRound" loading={busy} disabled={!codeOk} onClick={run}>Activate device</Button>
        </>
      }
    >
      <div className="ex-stack">
        <p className="secondary">Ask the store to read the code shown on the device's first-run screen. Activation issues device credentials and the tenant's current configuration (v{tenant?.configVersion}).</p>
        <TextField
          label="Activation code shown on device"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          className="pa-mono"
          autoFocus
          maxLength={9}
          error={code.length >= 9 && !codeOk ? 'Code does not match this device. Check for O/0 and I/1 — codes never contain them.' : undefined}
          hint={<>Prototype: this device's code is <span className="pa-code">{expected}</span></>}
          suffix={codeOk ? <Icon name="CircleCheck" size={16} className="pa-tone-success" /> : undefined}
        />
        <div className="ex-field">
          <span className="ex-label">Counter in {lk.storeName(d.storeId)}</span>
          <div className="ex-stack" style={{ gap: 6 }}>
            {storeCounters.map((o) => (
              <Radio
                key={o.counter.id}
                name="ctr"
                checked={choice === o.counter.id}
                disabled={!!o.occupant}
                onChange={() => setTarget(o.counter.id)}
                label={<span><b className="pa-mono">{o.counter.code}</b> {o.counter.name} {o.occupant ? <span className="muted">— in use by {o.occupant.code} ({DEVICE_STATUS[o.occupant.status].label})</span> : <span className="pa-tone-success">— free</span>}</span>}
              />
            ))}
            <Radio name="ctr" checked={choice === 'new'} onChange={() => setTarget('new')} label={<span>Create counter <b className="pa-mono">{nextCode}</b> for this device</span>} />
            <Radio name="ctr" checked={choice === 'none'} onChange={() => setTarget('none')} label="Leave unassigned (device can't bill until assigned)" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

function RenameDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const [name, setName] = useState(d.name);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 3 && name.trim() !== d.name;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Rename ${d.code}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={async () => { setBusy(true); try { await renameDevice(cloud, actor, d, name.trim()); toast.success('Device renamed'); onClose(); } finally { setBusy(false); } }}>Save name</Button>
        </>
      }
    >
      <TextField label="Display name" value={name} onChange={(e) => setName(e.target.value)} autoFocus hint="Shown in Back Office and on the device header. The device code stays the same." error={name.trim().length > 0 && name.trim().length < 3 ? 'Use at least 3 characters.' : undefined} />
    </Modal>
  );
}

function ReassignDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const lk = useLookups();
  const options = useCounterOptions(d);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const sel = options.find((o) => o.counter.id === target);
  const from = d.counterId ? `${lk.storeName(d.storeId)} ${lk.counterCode(d.counterId)}` : `${lk.storeName(d.storeId)} (unassigned)`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reassign ${d.code}`}
      description={`Currently: ${from}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!sel || !!sel.occupant || sel.counter.id === d.counterId} onClick={async () => {
            if (!sel) return;
            setBusy(true);
            try { await reassignDevice(cloud, actor, d, sel.counter, from, `${sel.store.name} ${sel.counter.code}`); toast.success(`${d.code} reassigned to ${sel.store.name} ${sel.counter.code}`); onClose(); } finally { setBusy(false); }
          }}>Reassign</Button>
        </>
      }
    >
      <div className="ex-stack">
        <Select label="Target counter" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Choose a counter" options={options.map((o) => ({ value: o.counter.id, label: `${o.store.name} · ${o.counter.code} ${o.counter.name}${o.occupant ? ` — in use by ${o.occupant.code}` : ''}${o.counter.id === d.counterId ? ' (current)' : ''}`, disabled: !!o.occupant }))} />
        {d.pendingSync > 0 ? <InlineAlert tone="warning" title={`${d.pendingSync} events still pending`}>They sync under the original counter identity — documents already numbered keep their counter prefix. New documents use the new counter's series.</InlineAlert> : null}
        <span className="ex-hint">Counters already used by another non-revoked device are unavailable. Use Replace device to swap hardware on the same counter.</span>
      </div>
    </Modal>
  );
}

function RevokeDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === d.code.toUpperCase() && reason.trim().length >= 5;
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      size="sm"
      title={`Revoke ${d.code}?`}
      icon={<span className="pa-modal-icon pa-soft--danger"><Icon name="ShieldAlert" size={20} /></span>}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" icon="Ban" loading={busy} disabled={!ok} onClick={async () => {
            setBusy(true);
            try { await revokeDevice(cloud, actor, d, reason.trim()); toast.warning(`${d.code} revoked`, 'Credentials invalidated. Audited as a security event.'); onClose(); } finally { setBusy(false); }
          }}>Revoke device</Button>
        </>
      }
    >
      <div className="ex-stack">
        <ul className="pa-bullets">
          <li>The device's credentials are invalidated. It can no longer obtain configuration, pull masters or push new events.</li>
          <li>Documents it already synced stay in the cloud. Its history is kept for audit.</li>
          {d.pendingSync > 0 ? <li className="pa-tone-danger"><b>{d.pendingSync} events have not synced.</b> They stay on the device and will be refused. Recover them first if the device is reachable.</li> : null}
          <li>The counter becomes free for another device.</li>
        </ul>
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Device stolen from store on 06 Oct" />
        <TextField label={<>Type <b className="pa-mono">{d.code}</b> to confirm</>} required value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" className="pa-mono" />
      </div>
    </Modal>
  );
}

function ReplaceDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const lk = useLookups();
  const [rep, setRep] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const data = useLive(cloud, ['devices', 'sales'], () => {
    const candidates = cloud.where('devices', (x) => x.tenantId === d.tenantId && x.id !== d.id && x.kind === d.kind && (x.status === 'pending-activation' || (!x.counterId && x.status !== 'revoked')));
    const last = d.counterId ? cloud.where('sales', (s) => s.counterId === d.counterId).sort((a, b) => b.committedAt.localeCompare(a.committedAt))[0] : undefined;
    return { candidates, last };
  }, [d.id, d.tenantId, d.counterId]);
  const replacement = data.candidates.find((x) => x.id === rep);
  const counter = lk.counterCode(d.counterId);
  const continuity = data.last
    ? `Numbering continues on counter ${counter} after ${data.last.documentNo}; ${d.code} is revoked so it cannot issue further numbers.`
    : `Numbering continues on counter ${counter}'s series; ${d.code} is revoked so it cannot issue further numbers.`;
  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      dismissible={!busy}
      size="lg"
      title={`Replace ${d.code}`}
      description={`${lk.storeName(d.storeId)} · counter ${counter}`}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" icon="Replace" loading={busy} disabled={!replacement || reason.trim().length < 5} onClick={async () => {
            if (!replacement) return;
            setBusy(true);
            try {
              await replaceDevice(cloud, actor, d, replacement, lk.tenants.get(d.tenantId), reason.trim(), continuity);
              toast.success(`${replacement.code} now serves counter ${counter}`, `${d.code} revoked; history preserved.`);
              onClose();
            } finally { setBusy(false); }
          }}>Replace device</Button>
        </>
      }
    >
      <div className="ex-stack">
        <div className="pa-replace">
          <div className="pa-replace__box">
            <span className="muted">Outgoing</span>
            <b className="pa-mono">{d.code}</b>
            <span>{d.name}</span>
            <StatusBadge meta={DEVICE_STATUS.revoked} label="Will be revoked" />
          </div>
          <Icon name="ArrowRight" size={20} className="muted" />
          <div className="pa-replace__box">
            <span className="muted">Counter identity</span>
            <b className="pa-mono">{counter}</b>
            <span>{lk.storeName(d.storeId)}</span>
            <Badge tone="info" icon="Hash">Series continues</Badge>
          </div>
          <Icon name="ArrowRight" size={20} className="muted" />
          <div className="pa-replace__box">
            <span className="muted">Replacement</span>
            <b className="pa-mono">{replacement?.code ?? '—'}</b>
            <span>{replacement?.name ?? 'Choose below'}</span>
            <StatusBadge meta={DEVICE_STATUS.active} label="Will be active" />
          </div>
        </div>
        {data.candidates.length ? (
          <Select label="Replacement device" required value={rep} onChange={(e) => setRep(e.target.value)} placeholder="Choose a pending or unassigned device" options={data.candidates.map((x) => ({ value: x.id, label: `${x.code} · ${x.name} (${DEVICE_STATUS[x.status].label})` }))} />
        ) : (
          <InlineAlert tone="warning" title="No replacement device available">Register the new hardware first — it appears here once it shows as Pending activation for {lk.tenantName(d.tenantId)}.</InlineAlert>
        )}
        <InlineAlert tone="info" icon="Hash" title="Document numbering continuity">
          Invoice numbers are tied to the counter, not the hardware. {continuity} This prevents two devices issuing the same document number.
          {d.pendingSync > 0 ? <> <b>{d.pendingSync} unsynced events</b> on {d.code} must sync before it is retired, otherwise those numbers would be reported as gaps.</> : null}
        </InlineAlert>
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Motherboard failure, hardware swapped under warranty" />
      </div>
    </Modal>
  );
}

function ResetDialog({ open, device: d, onClose }: { open: boolean; device: Device; onClose: () => void }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const blocked = d.pendingSync > 0 || d.failedSync > 0;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Reset local bootstrap on ${d.code}?`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" icon="RotateCcw" loading={busy} disabled={blocked} onClick={async () => {
            setBusy(true);
            try { await resetBootstrap(cloud, actor, d); toast.success('Bootstrap reset queued', `${d.code} re-downloads catalog and configuration on next start.`); onClose(); } finally { setBusy(false); }
          }}>Reset bootstrap</Button>
        </>
      }
    >
      <div className="ex-stack">
        <p className="secondary">The device discards its cached catalog and configuration and downloads them again on next start. Transactions and the outbox journal are not touched.</p>
        {blocked ? (
          <InlineAlert tone="danger" title="Blocked — unsynced data on device">
            {d.pendingSync} pending and {d.failedSync} quarantined events must sync or be resolved first. Resetting now could strand local facts.
          </InlineAlert>
        ) : (
          <InlineAlert tone="success">No unsynced events. Safe to reset.</InlineAlert>
        )}
      </div>
    </Modal>
  );
}

/** Menu item that stays visible but explains the missing permission instead of acting (§67). */
function GatedItem({ action, icon, onClick, children }: { action: PlatformAction; icon: string; onClick: () => void; children: React.ReactNode }) {
  const { can, why } = useAccess();
  const toast = useToast();
  return can(action) ? (
    <MenuItem icon={icon} onClick={onClick}>{children}</MenuItem>
  ) : (
    <MenuItem icon="Lock" onClick={() => toast.warning('Not permitted', why(action))}>
      <span className="muted">{children}</span>
    </MenuItem>
  );
}
