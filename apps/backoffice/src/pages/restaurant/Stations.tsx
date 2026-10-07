import { useState } from 'react';
import type { KitchenStation } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, DataTable, KpiCard, Modal, TextField, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { number } from '@elixir/format';
import { KpiRow, PageFrame } from '../../components/common';
import { today, useCloud } from '../../lib/data';
import { saveMaster } from '../../lib/ops';
import { useSession } from '../../lib/session';

export function StationsPage() {
  const s = useSession();
  const cloud = useCloud();
  const [editing, setEditing] = useState<KitchenStation | 'new'>();
  const t = today();
  const data = useLive(cloud, ['stations', 'menuItems', 'kots', 'devices'], () => {
    const stations = cloud.where('stations', (x) => s.scope.includes(x.storeId));
    const items = cloud.where('menuItems', (m) => m.tenantId === s.tenant.id);
    const kots = cloud.where('kots', (k) => s.scope.includes(k.storeId));
    return {
      rows: stations.map((st) => ({
        st,
        items: items.filter((m) => m.stationId === st.id),
        active: kots.filter((k) => k.stationId === st.id && ['new', 'accepted', 'preparing'].includes(k.status)).length,
        ready: kots.filter((k) => k.stationId === st.id && k.status === 'ready').length,
        today: kots.filter((k) => k.stationId === st.id && k.createdAt.slice(0, 10) === t).length,
      })),
      kds: cloud.where('devices', (d) => d.tenantId === s.tenant.id && d.kind === 'kds' && s.scope.includes(d.storeId)),
    };
  }, [s.scope.join(','), t]);
  return (
    <PageFrame title="Kitchen stations" description="Each menu item routes its KOT to one station (KDS screen or printer)." crumbs={[{ label: 'Restaurant' }, { label: 'Kitchen Stations' }]}
      actions={<Button variant="primary" icon="Plus" onClick={() => setEditing('new')}>Add station</Button>}>
      <KpiRow>
        <KpiCard label="Stations" icon="ChefHat" value={number(data.rows.length)} />
        <KpiCard label="Tickets in kitchen" icon="Flame" tone={data.rows.some((r) => r.active > 5) ? 'warning' : undefined} value={number(data.rows.reduce((a, r) => a + r.active, 0))} />
        <KpiCard label="KOTs today" icon="ClipboardList" value={number(data.rows.reduce((a, r) => a + r.today, 0))} />
        <KpiCard label="KDS screens" icon="MonitorSmartphone" value={number(data.kds.length)} foot={data.kds.map((d) => d.code).join(', ')} />
      </KpiRow>
      <Card className="bo-card-table">
        <CardHeader title="Stations" icon="ChefHat" />
        <DataTable rows={data.rows} rowKey={(r) => r.st.id} onRowClick={(r) => setEditing(r.st)}
          columns={[
            { key: 'n', header: 'Station', render: (r) => <span className="bo-cell-main">{r.st.name}</span> },
            { key: 'store', header: 'Store', hidden: s.scope.length < 2, render: (r) => s.storeName(r.st.storeId) },
            { key: 'items', header: 'Menu items', align: 'right', render: (r) => number(r.items.length) },
            { key: 'sample', header: 'Examples', render: (r) => <span className="secondary ex-truncate" style={{ display: 'inline-block', maxWidth: 360 }}>{r.items.slice(0, 4).map((m) => m.name).join(', ')}{r.items.length > 4 ? ` +${r.items.length - 4}` : ''}</span> },
            { key: 'active', header: 'In kitchen now', align: 'right', render: (r) => (r.active ? <Badge tone={r.active > 5 ? 'warning' : 'info'} icon="Flame">{r.active}</Badge> : <span className="muted">0</span>) },
            { key: 'ready', header: 'Ready to serve', align: 'right', render: (r) => (r.ready ? <Badge tone="success" icon="BellRing">{r.ready}</Badge> : <span className="muted">0</span>) },
            { key: 'today', header: 'KOTs today', align: 'right', render: (r) => number(r.today) },
          ]} />
      </Card>
      {editing ? <StationModal station={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} /> : null}
    </PageFrame>
  );
}

function StationModal({ station, onClose }: { station?: KitchenStation; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [name, setName] = useState(station?.name ?? '');
  const [err, setErr] = useState<string>();
  const save = async () => {
    if (!name.trim()) return setErr('Enter a station name, e.g. Tandoor.');
    const st: KitchenStation = { ...(station ?? { id: `st-${uid().slice(-8)}`, storeId: s.storeId !== 'all' ? s.storeId : s.scope[0]! }), name: name.trim() };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'stations', entity: st, summary: `Kitchen station ${st.name} ${station ? 'renamed' : 'added'}`, actorId: s.user.id, action: station ? 'station.updated' : 'station.created', entityName: 'station', before: station });
    toast.success('Station saved');
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={station ? `Edit ${station.name}` : 'New kitchen station'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <TextField label="Station name" required value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} error={err} autoFocus />
    </Modal>
  );
}
