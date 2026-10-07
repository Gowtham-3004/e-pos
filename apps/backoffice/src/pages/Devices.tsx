import { useState } from 'react';
import type { Counter, Device } from '@elixir/contracts';
import { DEVICE_STATUS, uid } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, Icon, IconButton, InlineAlert, KpiCard, Menu, MenuItem, Modal, Select, StatusBadge, TextField, useToast } from '@elixir/ui';
import { useLive, useNow } from '@elixir/local-store/react';
import { dateTime, number, relative } from '@elixir/format';
import { KpiRow, PageFrame } from '../components/common';
import { useCloud } from '../lib/data';
import { saveMaster } from '../lib/ops';
import { useSession } from '../lib/session';

const KIND_LABEL: Record<Device['kind'], string> = { 'pos-desktop': 'POS Desktop', 'pos-web': 'POS Web', kds: 'Kitchen Display', mobile: 'Mobile', 'store-edge': 'Store Edge' };
const KIND_ICON: Record<Device['kind'], string> = { 'pos-desktop': 'Monitor', 'pos-web': 'Globe', kds: 'ChefHat', mobile: 'Smartphone', 'store-edge': 'Router' };
const PERI_ICON: Record<string, string> = { printer: 'Printer', scanner: 'ScanBarcode', 'cash-drawer': 'Archive', scale: 'Weight', 'customer-display': 'MonitorSpeaker' };

export function DevicesPage() {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  useNow(15000);
  const [rename, setRename] = useState<Device | Counter>();
  const [revoke, setRevoke] = useState<Device>();
  const [deactCounter, setDeactCounter] = useState<Counter>();
  const [activate, setActivate] = useState(false);
  const data = useLive(cloud, ['devices', 'counters', 'stores'], () => {
    const devices = cloud.where('devices', (d) => d.tenantId === s.tenant.id && s.scope.includes(d.storeId));
    return s.stores.filter((st) => s.scope.includes(st.id)).map((st) => ({
      store: st,
      counters: cloud.where('counters', (c) => c.storeId === st.id).sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ c, device: devices.find((d) => d.counterId === c.id) })),
      other: devices.filter((d) => d.storeId === st.id && (!d.counterId || !cloud.get('counters', d.counterId))),
      devices: devices.filter((d) => d.storeId === st.id),
    }));
  }, [s.tenant.id, s.scope.join(',')]);
  const all = data.flatMap((d) => d.devices);
  const latestCfg = s.tenant.configVersion;

  const doRevoke = async (d: Device, reason?: string) => {
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'devices', entity: { ...d, status: 'revoked' }, summary: `Device ${d.code} (${d.name}) revoked`, actorId: s.user.id, action: 'device.revoked', entityName: 'device', reason, category: 'security' });
    toast.success(`${d.code} revoked`, 'The device is blocked from syncing and signing in. Unsynced sales on it stay on the device until support recovers them.');
    setRevoke(undefined);
  };

  const deviceCell = (d: Device | undefined) => {
    if (!d) return <span className="muted">No device assigned</span>;
    return (
      <div className="ex-row" style={{ gap: 10 }}>
        <Icon name={KIND_ICON[d.kind]} size={18} className="muted" />
        <div style={{ minWidth: 0 }}>
          <div className="bo-cell-main">{d.code} · {d.name}</div>
          <div className="bo-cell-sub">{KIND_LABEL[d.kind]} · {d.os} · v{d.appVersion} · config {d.configVersion}{d.configVersion < latestCfg && d.status !== 'pending-activation' ? <span style={{ color: 'var(--status-warning)' }}> (behind {latestCfg})</span> : null}</div>
        </div>
      </div>
    );
  };
  const actions = (d: Device | undefined, c?: Counter) => (
    <Menu trigger={(p) => <IconButton icon="EllipsisVertical" label="Actions" {...p} />}>
      {(close) => (
        <>
          {d ? <MenuItem icon="Pencil" onClick={() => { close(); setRename(d); }}>Rename device</MenuItem> : null}
          {c ? <MenuItem icon="Pencil" onClick={() => { close(); setRename(c); }}>Rename counter</MenuItem> : null}
          {d && d.status !== 'revoked' ? <MenuItem icon="Ban" danger onClick={() => { close(); setRevoke(d); }}>Revoke device…</MenuItem> : null}
          {c && c.active ? <MenuItem icon="CirclePause" danger onClick={() => { close(); setDeactCounter(c); }}>Deactivate counter…</MenuItem> : null}
        </>
      )}
    </Menu>
  );
  const syncCell = (d?: Device) => (d ? (
    <div>
      <div className="num">{relative(d.lastSyncAt)}</div>
      <div className="bo-cell-sub">{d.pendingSync ? <span style={{ color: 'var(--status-warning)' }}>{d.pendingSync} pending</span> : 'Up to date'}{d.failedSync ? <span className="bo-neg"> · {d.failedSync} failed</span> : null}</div>
    </div>
  ) : '—');
  const periCell = (d?: Device) => (d?.peripherals?.length ? d.peripherals.map((p) => <span key={p.kind} className={`bo-peri ${p.state === 'unavailable' || p.state === 'error' ? 'bo-peri--bad' : ''}`} title={`${p.name} · ${p.state}`}><Icon name={PERI_ICON[p.kind] ?? 'Plug'} size={14} />{p.state === 'unavailable' || p.state === 'error' ? 'Error' : 'OK'}</span>) : <span className="muted">—</span>);

  return (
    <PageFrame title="Counters & Devices" description="Billing counters, the device bound to each, health, sync backlog and peripherals." crumbs={[{ label: 'Administration' }, { label: 'Counters & Devices' }]}
      actions={<Button variant="primary" icon="QrCode" onClick={() => setActivate(true)}>Activate new device</Button>}>
      <KpiRow>
        <KpiCard label="Devices" icon="MonitorSmartphone" value={number(all.filter((d) => d.status !== 'revoked').length)} foot={`${data.reduce((a, d) => a + d.counters.length, 0)} counters`} />
        <KpiCard label="Online / active" icon="Wifi" tone="success" value={number(all.filter((d) => d.status === 'active').length)} />
        <KpiCard label="Offline or attention" icon="TriangleAlert" tone={all.some((d) => d.status === 'offline' || d.status === 'attention') ? 'warning' : undefined} value={number(all.filter((d) => d.status === 'offline' || d.status === 'attention').length)} foot={`${all.reduce((a, d) => a + d.pendingSync, 0)} records waiting to sync`} />
        <KpiCard label="Config behind" icon="RefreshCcw" value={number(all.filter((d) => d.configVersion < latestCfg && d.status !== 'revoked' && d.status !== 'pending-activation').length)} foot={`Latest config v${latestCfg}`} />
      </KpiRow>
      {all.some((d) => d.status === 'offline' && d.pendingSync > 0) ? <InlineAlert tone="warning" title="Some counters have sales that haven't reached the cloud">Offline devices keep billing locally. Their sales appear in reports once they reconnect — totals for today may be incomplete.</InlineAlert> : null}
      {data.map(({ store, counters, other }) => (
        <Card key={store.id} className="bo-card-table">
          <CardHeader title={store.name} subtitle={`${store.code} · ${store.city}${store.edgeEnabled ? ' · Store Edge enabled' : ''}`} icon="Store" />
          <DataTable
            rows={[...counters.map((x) => ({ key: x.c.id, c: x.c as Counter | undefined, d: x.device })), ...other.map((d) => ({ key: d.id, c: undefined as Counter | undefined, d: d as Device | undefined }))]}
            rowKey={(r) => r.key}
            empty={<EmptyState quiet title="No counters" />}
            columns={[
              { key: 'c', header: 'Counter', render: (r) => (r.c ? <div><div className="bo-cell-main">{r.c.code} · {r.c.name}</div><div className="bo-cell-sub">{r.c.kind === 'kitchen' ? 'Kitchen' : 'Billing'}{r.c.printerName ? ` · ${r.c.printerName}` : ''}{!r.c.active ? ' · Inactive' : ''}</div></div> : <span className="muted">Not counter-bound</span>) },
              { key: 'd', header: 'Device', render: (r) => deviceCell(r.d) },
              { key: 's', header: 'Status', render: (r) => (r.d ? <StatusBadge meta={DEVICE_STATUS[r.d.status]} /> : r.c && !r.c.active ? <Badge icon="CirclePause">Inactive</Badge> : '—') },
              { key: 'seen', header: 'Last seen', render: (r) => (r.d ? <span className="num" title={dateTime(r.d.lastSeenAt)}>{relative(r.d.lastSeenAt)}</span> : '—') },
              { key: 'sync', header: 'Last sync', render: (r) => syncCell(r.d) },
              { key: 'p', header: 'Peripherals', render: (r) => periCell(r.d) },
              { key: 'a', header: '', align: 'right', render: (r) => actions(r.d, r.c) },
            ]}
          />
        </Card>
      ))}
      {rename ? <RenameModal target={rename} onClose={() => setRename(undefined)} /> : null}
      <ConfirmDialog open={!!revoke} onClose={() => setRevoke(undefined)} title={`Revoke ${revoke?.code}?`} confirmLabel="Revoke device" requireReason reasonLabel="Reason (security audit)" onConfirm={(r) => doRevoke(revoke!, r)}>
        {revoke?.name} will be signed out and blocked from syncing. {revoke?.pendingSync ? <b>It still has {revoke.pendingSync} unsynced record(s) — those stay on the device for support recovery.</b> : null} Re-activation needs a new activation code.
      </ConfirmDialog>
      <ConfirmDialog open={!!deactCounter} onClose={() => setDeactCounter(undefined)} title={`Deactivate counter ${deactCounter?.code}?`} confirmLabel="Deactivate counter" requireReason onConfirm={async (r) => {
        await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'counters', entity: { ...deactCounter!, active: false }, summary: `Counter ${deactCounter!.code} deactivated`, actorId: s.user.id, action: 'counter.deactivated', entityName: 'counter', reason: r, category: 'security' });
        toast.success(`Counter ${deactCounter!.code} deactivated`);
        setDeactCounter(undefined);
      }}>No new shifts can be opened on this counter. Its invoice series and history are kept.</ConfirmDialog>
      {activate ? <ActivateModal onClose={() => setActivate(false)} /> : null}
    </PageFrame>
  );
}

function RenameModal({ target, onClose }: { target: Device | Counter; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const isDevice = 'kind' in target && 'appVersion' in target;
  const [name, setName] = useState(target.name);
  const save = async () => {
    if (!name.trim()) return;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: isDevice ? 'devices' : 'counters', entity: { ...target, name: name.trim() }, summary: `${isDevice ? 'Device' : 'Counter'} ${target.code} renamed to ${name.trim()}`, actorId: s.user.id, action: isDevice ? 'device.renamed' : 'counter.renamed', entityName: isDevice ? 'device' : 'counter', category: 'technical' });
    toast.success('Renamed');
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Rename ${target.code}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>Save</Button></>}>
      <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
    </Modal>
  );
}

function ActivateModal({ onClose }: { onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [store, setStore] = useState(s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? '');
  const counters = cloud.where('counters', (c) => c.storeId === store && c.active && !cloud.where('devices', (d) => d.counterId === c.id && d.status !== 'revoked').length);
  const [counter, setCounter] = useState('');
  const [code, setCode] = useState<string>();
  const create = async () => {
    const c = String(Math.floor(100000 + Math.random() * 900000));
    const st = cloud.get('stores', store)!;
    const ct = cloud.get('counters', counter);
    const d: Device = { id: `d-${uid().slice(-10)}`, tenantId: s.tenant.id, storeId: store, counterId: ct?.id, code: ct ? `POS-0${ct.code.slice(-1)}` : 'POS-NEW', name: `${st.name} ${ct?.name ?? 'New device'}`, kind: 'pos-desktop', status: 'pending-activation', appVersion: '—', configVersion: 0, lastSeenAt: new Date().toISOString(), pendingSync: 0, failedSync: 0, os: 'Awaiting activation' };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'devices', entity: d, summary: `Activation code issued for ${d.name}`, actorId: s.user.id, action: 'device.activation.issued', entityName: 'device', category: 'security' });
    setCode(c);
    toast.info('Activation code issued', 'Valid for 30 minutes');
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Activate a new device" description="Install Elixir POS on the counter PC, choose “Activate with code” and enter this code." footer={code ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="QrCode" onClick={() => void create()}>Generate code</Button></>}>
      {code ? (
        <div className="ex-stack" style={{ alignItems: 'stretch' }}>
          <div className="bo-code num" aria-label={`Activation code ${code}`}>{code.slice(0, 3)} {code.slice(3)}</div>
          <InlineAlert tone="info">Expires in 30 minutes · single use · binds the device to {s.storeName(store)}{counter ? ` · ${cloud.get('counters', counter)?.code}` : ''}. The device shows as “Pending activation” until it connects.</InlineAlert>
        </div>
      ) : (
        <div className="ex-stack">
          <Select label="Store" value={store} onChange={(e) => { setStore(e.target.value); setCounter(''); }} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
          <Select label="Bind to counter" value={counter} onChange={(e) => setCounter(e.target.value)} placeholder={counters.length ? 'Choose a free counter' : 'No free counter — device will be unbound'} options={counters.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))} />
        </div>
      )}
    </Modal>
  );
}
