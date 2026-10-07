import { useState } from 'react';
import type { DiningTable, Floor } from '@elixir/contracts';
import { TABLE_STATUS, uid } from '@elixir/domain';
import { Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, IconButton, Modal, Select, StatusBadge, Tabs, TextField, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { number } from '@elixir/format';
import { KpiRow, PageFrame } from '../../components/common';
import { KpiCard } from '@elixir/ui';
import { useCloud } from '../../lib/data';
import { saveMaster } from '../../lib/ops';
import { useSession } from '../../lib/session';

export function FloorsPage() {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const data = useLive(cloud, ['floors', 'tables'], () => {
    const floors = cloud.where('floors', (f) => s.scope.includes(f.storeId)).sort((a, b) => a.sortOrder - b.sortOrder);
    const ids = new Set(floors.map((f) => f.id));
    return { floors, tables: cloud.where('tables', (t) => ids.has(t.floorId)) };
  }, [s.scope.join(',')]);
  const [floorId, setFloorId] = useState(data.floors[0]?.id ?? '');
  const [editing, setEditing] = useState<DiningTable | 'new'>();
  const [removing, setRemoving] = useState<DiningTable>();
  const [newFloor, setNewFloor] = useState(false);
  const floor = data.floors.find((f) => f.id === floorId) ?? data.floors[0];
  const tables = data.tables.filter((t) => t.floorId === floor?.id).sort((a, b) => a.y - b.y || a.x - b.x);
  const cols = Math.max(3, ...tables.map((t) => t.x + 1));

  if (!floor) return <PageFrame title="Floors & Tables"><Card><EmptyState icon="LayoutGrid" title="No floors yet" actions={<Button variant="primary" onClick={() => setNewFloor(true)}>Add floor</Button>}>Add a floor, then its tables. Tables appear on POS and waiter app floor maps.</EmptyState></Card>{newFloor ? <FloorModal storeId={s.scope[0]!} order={0} onClose={() => setNewFloor(false)} /> : null}</PageFrame>;

  return (
    <PageFrame title="Floors & Tables" description="Layout used by the POS table map and waiter app. Changes publish to devices." crumbs={[{ label: 'Restaurant' }, { label: 'Floors & Tables' }]}
      actions={<><Button icon="Plus" onClick={() => setNewFloor(true)}>Add floor</Button><Button variant="primary" icon="Plus" onClick={() => setEditing('new')}>Add table</Button></>}>
      <KpiRow>
        <KpiCard label="Floors" icon="Layers" value={number(data.floors.length)} />
        <KpiCard label="Tables" icon="LayoutGrid" value={number(data.tables.length)} />
        <KpiCard label="Seats" icon="Armchair" value={number(data.tables.reduce((a, t) => a + t.seats, 0))} />
        <KpiCard label="Occupied now" icon="Users" value={`${data.tables.filter((t) => !['available', 'cleaning', 'reserved'].includes(t.status)).length} / ${data.tables.length}`} />
      </KpiRow>
      <Tabs items={data.floors.map((f) => ({ key: f.id, label: f.name, count: data.tables.filter((t) => t.floorId === f.id).length }))} value={floor.id} onChange={setFloorId} />
      <div className="bo-grid-main">
        <Card className="bo-card-table">
          <CardHeader title={`${floor.name} · tables`} icon="List" />
          <DataTable rows={tables} rowKey={(t) => t.id} onRowClick={(t) => setEditing(t)} empty={<EmptyState quiet icon="LayoutGrid" title="No tables on this floor" />}
            columns={[
              { key: 'code', header: 'Table', render: (t) => <span className="bo-cell-main num">{t.code}</span> },
              { key: 'seats', header: 'Seats', align: 'right', render: (t) => t.seats },
              { key: 'shape', header: 'Shape', render: (t) => ({ square: 'Square', round: 'Round', rect: 'Long (rect)' })[t.shape] },
              { key: 'pos', header: 'Grid position', render: (t) => <span className="num muted">col {t.x + 1} · row {t.y + 1}</span> },
              { key: 'st', header: 'Live status', render: (t) => <StatusBadge meta={TABLE_STATUS[t.status]} /> },
              { key: 'x', header: '', align: 'right', render: (t) => <IconButton icon="Trash2" label={`Remove ${t.code}`} disabled={t.status !== 'available'} onClick={(e) => { e.stopPropagation(); setRemoving(t); }} /> },
            ]} />
        </Card>
        <Card>
          <CardHeader title="Layout preview" icon="LayoutGrid" subtitle="Click a table to edit" />
          <div style={{ padding: 16 }}>
            <div className="bo-floor" style={{ ['--cols' as string]: cols } as React.CSSProperties}>
              {Array.from({ length: Math.max(1, ...tables.map((t) => t.y + 1)) * cols }).map((_, i) => {
                const x = i % cols, y = Math.floor(i / cols);
                const t = tables.find((tt) => tt.x === x && tt.y === y);
                return t ? (
                  <button key={t.id} type="button" className={`bo-table-tile bo-table-tile--${t.shape === 'round' ? 'round' : 'square'}`} onClick={() => setEditing(t)} title={`${t.code} · ${t.seats} seats · ${TABLE_STATUS[t.status].label}`}>
                    {t.code}<small>{t.seats} seats</small>
                  </button>
                ) : <div key={i} />;
              })}
            </div>
          </div>
        </Card>
      </div>
      {editing ? <TableModal floor={floor} table={editing === 'new' ? undefined : editing} existing={data.tables} onClose={() => setEditing(undefined)} /> : null}
      {newFloor ? <FloorModal storeId={floor.storeId} order={data.floors.length} onClose={() => setNewFloor(false)} /> : null}
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(undefined)} title={`Remove table ${removing?.code}?`} confirmLabel="Remove table" onConfirm={async () => {
        await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'tables', entity: removing!, summary: `Table ${removing!.code} removed`, actorId: s.user.id, action: 'table.removed', entityName: 'table', op: 'delete' });
        toast.success(`Table ${removing!.code} removed`);
        setRemoving(undefined);
      }}>The table disappears from POS and waiter floor maps after sync. Past orders keep their table code.</ConfirmDialog>
    </PageFrame>
  );
}

function TableModal({ floor, table, existing, onClose }: { floor: Floor; table?: DiningTable; existing: DiningTable[]; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const onFloor = existing.filter((t) => t.floorId === floor.id);
  const nextPos = () => { const cols = 4; for (let i = 0; i < 100; i++) { const x = i % cols, y = Math.floor(i / cols); if (!onFloor.some((t) => t.x === x && t.y === y)) return { x, y }; } return { x: 0, y: 0 }; };
  const [f, setF] = useState(() => ({ code: table?.code ?? '', seats: String(table?.seats ?? 4), shape: table?.shape ?? 'square', x: String((table?.x ?? nextPos().x) + 1), y: String((table?.y ?? nextPos().y) + 1) }));
  const [e, setE] = useState<Record<string, string>>({});
  const save = async () => {
    const er: Record<string, string> = {};
    if (!/^[A-Z0-9-]{1,6}$/.test(f.code)) er.code = 'Use 1–6 letters/numbers, e.g. A13.';
    else if (existing.some((t) => t.id !== table?.id && t.code === f.code)) er.code = 'Another table already uses this code.';
    if (!(Number(f.seats) >= 1 && Number(f.seats) <= 20)) er.seats = 'Seats must be 1–20.';
    const x = Number(f.x) - 1, y = Number(f.y) - 1;
    if (!(x >= 0 && y >= 0)) er.pos = 'Column and row start at 1.';
    else if (onFloor.some((t) => t.id !== table?.id && t.x === x && t.y === y)) er.pos = 'That grid position is taken.';
    setE(er);
    if (Object.keys(er).length) return;
    const t: DiningTable = { ...(table ?? { id: `tb-${uid().slice(-8)}`, floorId: floor.id, status: 'available' }), code: f.code, seats: Number(f.seats), shape: f.shape as DiningTable['shape'], x, y } as DiningTable;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'tables', entity: t, summary: `Table ${t.code} ${table ? 'updated' : 'added'} on ${floor.name}`, actorId: s.user.id, action: table ? 'table.updated' : 'table.created', entityName: 'table', before: table });
    toast.success(`Table ${t.code} saved`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={table ? `Edit table ${table.code}` : `New table · ${floor.name}`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save table</Button></>}>
      <div className="bo-form-grid bo-form-grid--2">
        <TextField label="Table code" required value={f.code} onChange={(x) => setF({ ...f, code: x.target.value.toUpperCase() })} error={e.code} autoFocus />
        <TextField label="Seats" inputMode="numeric" value={f.seats} onChange={(x) => setF({ ...f, seats: x.target.value.replace(/\D/g, '') })} error={e.seats} />
        <div className="bo-span-2"><Select label="Shape" value={f.shape} onChange={(x) => setF({ ...f, shape: x.target.value as DiningTable['shape'] })} options={[{ value: 'square', label: 'Square' }, { value: 'round', label: 'Round' }, { value: 'rect', label: 'Long (rect)' }]} /></div>
        <TextField label="Grid column" inputMode="numeric" value={f.x} onChange={(x) => setF({ ...f, x: x.target.value.replace(/\D/g, '') })} error={e.pos} />
        <TextField label="Grid row" inputMode="numeric" value={f.y} onChange={(x) => setF({ ...f, y: x.target.value.replace(/\D/g, '') })} />
      </div>
    </Modal>
  );
}

function FloorModal({ storeId, order, onClose }: { storeId: string; order: number; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [name, setName] = useState('');
  const [err, setErr] = useState<string>();
  const save = async () => {
    if (!name.trim()) return setErr('Enter a floor or section name, e.g. Rooftop.');
    const f: Floor = { id: `fl-${uid().slice(-8)}`, storeId, name: name.trim(), sortOrder: order };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'floors', entity: f, summary: `Floor ${f.name} added`, actorId: s.user.id, action: 'floor.created', entityName: 'floor' });
    toast.success(`Floor ${f.name} added`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="New floor / section" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Add floor</Button></>}>
      <TextField label="Name" required value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} error={err} autoFocus />
    </Modal>
  );
}
