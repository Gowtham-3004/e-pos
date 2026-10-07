import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FoodType, MenuItem } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Badge, Button, Card, CategoryChips, Checkbox, DataTable, Drawer, EmptyState, FoodMark, KpiCard, SearchInput, Segmented, Select, Switch, TextField, Textarea, useToast, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, number, paiseToRupeesInput, rupeesToPaise } from '@elixir/format';
import { KpiRow, PageFrame, useFirstPaint } from '../../components/common';
import { includesQ, useCloud } from '../../lib/data';
import { saveMaster } from '../../lib/ops';
import { useSession } from '../../lib/session';

export function MenuPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const loading = useFirstPaint();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [avail, setAvail] = useState<'all' | 'available' | 'soldout'>('all');
  const [editing, setEditing] = useState<MenuItem | 'new'>();
  const canEdit = s.can('catalog.edit');

  const data = useLive(cloud, ['menuItems', 'categories', 'stations', 'modifierGroups'], () => ({
    items: cloud.where('menuItems', (m) => m.tenantId === s.tenant.id),
    cats: cloud.where('categories', (c) => c.tenantId === s.tenant.id).sort((a, b) => a.sortOrder - b.sortOrder),
    stations: new Map(cloud.where('stations', (x) => s.scope.includes(x.storeId)).map((x) => [x.id, x])),
    groups: new Map(cloud.all('modifierGroups').map((g) => [g.id, g])),
  }), [s.tenant.id, s.scope.join(',')]);

  const rows = useMemo(() => data.items.filter((m) => (cat === 'all' || m.categoryId === cat) && (avail === 'all' || (avail === 'available' ? m.available : !m.available)) && includesQ(q, m.name, m.description)).sort((a, b) => a.name.localeCompare(b.name)), [data.items, cat, avail, q]);

  const toggle = async (m: MenuItem, available: boolean) => {
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'menuItems', entity: { ...m, available }, summary: `${m.name} marked ${available ? 'available' : 'sold out'}`, actorId: s.user.id, action: available ? 'menu.available' : 'menu.soldout', entityName: 'menu_item', before: m });
    toast.success(available ? `${m.name} is available` : `${m.name} marked sold out`, 'POS, waiter and QR menus update on next sync');
  };

  const cols: Column<MenuItem>[] = [
    {
      key: 'name',
      header: 'Item',
      sortable: true,
      render: (m) => (
        <div className="ex-row" style={{ gap: 10 }}>
          <FoodMark type={m.foodType} />
          <div style={{ minWidth: 0 }}>
            <div className="bo-cell-main">{m.name} {m.popular ? <Badge tone="info" icon="Star">Popular</Badge> : null}</div>
            <div className="bo-cell-sub ex-truncate" style={{ maxWidth: 360 }}>{m.description}</div>
          </div>
        </div>
      ),
    },
    { key: 'cat', header: 'Category', render: (m) => data.cats.find((c) => c.id === m.categoryId)?.name },
    { key: 'station', header: 'Station', render: (m) => data.stations.get(m.stationId)?.name ?? '—' },
    { key: 'mods', header: 'Modifiers', render: (m) => (m.modifierGroupIds.length ? m.modifierGroupIds.map((g) => data.groups.get(g)?.name).join(', ') : <span className="muted">—</span>) },
    { key: 'time', header: 'Timing', render: (m) => (m.availableFrom ? <Badge icon="Clock">{m.availableFrom}–{m.availableTo}</Badge> : <span className="muted">All day</span>) },
    { key: 'prep', header: 'Prep', align: 'right', render: (m) => `${m.prepMinutes} min` },
    { key: 'pricePaise', header: 'Price', align: 'right', sortable: true, render: (m) => <b>{money(m.pricePaise)}</b> },
    {
      key: 'available',
      header: 'Availability',
      render: (m) => (
        <div onClick={(e) => e.stopPropagation()} className="ex-row">
          <Switch checked={m.available} disabled={!canEdit} onChange={(v) => void toggle(m, v)} label={m.available ? 'Available' : 'Sold out'} />
        </div>
      ),
    },
  ];

  return (
    <PageFrame
      title="Menu"
      description="Menu items, prices and availability for POS, waiter app and QR ordering."
      crumbs={[{ label: 'Catalog' }, { label: 'Menu' }]}
      actions={
        <>
          <Button icon="SlidersHorizontal" onClick={() => nav('/menu/modifiers')}>Modifier groups</Button>
          {canEdit ? <Button variant="primary" icon="Plus" onClick={() => setEditing('new')}>Add menu item</Button> : null}
        </>
      }
    >
      <KpiRow>
        <KpiCard label="Menu items" icon="UtensilsCrossed" value={number(data.items.length)} foot={`${data.cats.length} categories`} />
        <KpiCard label="Sold out now" icon="CircleSlash" tone={data.items.some((m) => !m.available) ? 'warning' : undefined} value={number(data.items.filter((m) => !m.available).length)} onClick={() => setAvail('soldout')} />
        <KpiCard label="Veg / Non-veg" icon="Leaf" value={`${data.items.filter((m) => m.foodType === 'veg').length} / ${data.items.filter((m) => m.foodType !== 'veg').length}`} />
        <KpiCard label="Avg price" icon="IndianRupee" value={money(data.items.length ? Math.round(data.items.reduce((a, m) => a + m.pricePaise, 0) / data.items.length) : 0, { whole: true })} />
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          <SearchInput placeholder="Search dishes" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <Segmented label="Availability" items={[{ key: 'all', label: 'All' }, { key: 'available', label: 'Available' }, { key: 'soldout', label: 'Sold out' }]} value={avail} onChange={setAvail} />
        </div>
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-default)' }}>
          <CategoryChips items={[{ key: 'all', label: 'All', count: data.items.length }, ...data.cats.map((c) => ({ key: c.id, label: c.name, count: data.items.filter((m) => m.categoryId === c.id).length }))]} value={cat} onChange={setCat} />
        </div>
        <DataTable columns={cols} rows={rows} rowKey={(m) => m.id} loading={loading} onRowClick={canEdit ? (m) => setEditing(m) : undefined} empty={<EmptyState quiet icon="UtensilsCrossed" title="No dishes match" />} />
      </Card>
      {editing ? <MenuItemDrawer item={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} cats={data.cats} stations={[...data.stations.values()]} groups={[...data.groups.values()]} /> : null}
    </PageFrame>
  );
}

function MenuItemDrawer({ item, onClose, cats, stations, groups }: { item?: MenuItem; onClose: () => void; cats: Array<{ id: string; name: string }>; stations: Array<{ id: string; name: string }>; groups: Array<{ id: string; name: string; required: boolean }> }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: item?.name ?? '',
    description: item?.description ?? '',
    categoryId: item?.categoryId ?? cats[0]?.id ?? '',
    price: item ? paiseToRupeesInput(item.pricePaise) : '',
    foodType: item?.foodType ?? ('veg' as FoodType),
    stationId: item?.stationId ?? stations[0]?.id ?? '',
    modifierGroupIds: item?.modifierGroupIds ?? [],
    prepMinutes: String(item?.prepMinutes ?? 15),
    availableFrom: item?.availableFrom ?? '',
    availableTo: item?.availableTo ?? '',
    available: item?.available ?? true,
    popular: !!item?.popular,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Enter the dish name.';
    if (!(rupeesToPaise(f.price) > 0)) e.price = 'Enter a price greater than zero.';
    if (!f.stationId) e.station = 'Choose the kitchen station that prepares this item.';
    if ((f.availableFrom && !f.availableTo) || (!f.availableFrom && f.availableTo)) e.time = 'Set both start and end time, or leave both empty for all day.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const m: MenuItem = {
      ...(item ?? { id: `mi-${uid().slice(-8)}`, tenantId: s.tenant.id, taxRateId: 'gst5' }),
      name: f.name.trim(), description: f.description || undefined, categoryId: f.categoryId, pricePaise: rupeesToPaise(f.price), foodType: f.foodType, stationId: f.stationId, modifierGroupIds: f.modifierGroupIds, prepMinutes: Number(f.prepMinutes) || 10,
      availableFrom: f.availableFrom || undefined, availableTo: f.availableTo || undefined, available: f.available, popular: f.popular || undefined,
    } as MenuItem;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'menuItems', entity: m, summary: item ? (item.pricePaise !== m.pricePaise ? `Menu price ${m.name}: ${money(item.pricePaise)} → ${money(m.pricePaise)}` : `Menu item ${m.name} updated`) : `Menu item ${m.name} added`, actorId: s.user.id, action: item ? 'menu.updated' : 'menu.created', entityName: 'menu_item', before: item });
    setBusy(false);
    toast.success(item ? 'Menu item saved' : 'Menu item added', 'Publishes to POS and waiter devices');
    onClose();
  };

  return (
    <Drawer open onClose={onClose} size="lg" title={item ? `Edit ${item.name}` : 'New menu item'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Save" loading={busy} onClick={() => void save()}>Save item</Button></>}>
      <div className="ex-stack" style={{ gap: 14 }}>
        <TextField label="Dish name" required value={f.name} onChange={(e) => set('name', e.target.value)} error={errors.name} />
        <Textarea label="Description" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} hint="Shown on the waiter app and QR menu" />
        <div className="bo-form-grid bo-form-grid--2">
          <Select label="Category" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} options={cats.map((c) => ({ value: c.id, label: c.name }))} />
          <TextField label="Price (before GST)" required prefix="₹" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} error={errors.price} hint="Restaurant GST 5% applied on bill" />
          <Select label="Kitchen station" required value={f.stationId} onChange={(e) => set('stationId', e.target.value)} error={errors.station} options={stations.map((x) => ({ value: x.id, label: x.name }))} />
          <TextField label="Prep time (min)" inputMode="numeric" value={f.prepMinutes} onChange={(e) => set('prepMinutes', e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="ex-field">
          <span className="ex-label">Food type</span>
          <Segmented label="Food type" items={[{ key: 'veg', label: 'Veg' }, { key: 'non-veg', label: 'Non-veg' }, { key: 'egg', label: 'Egg' }]} value={f.foodType} onChange={(k) => set('foodType', k as FoodType)} />
        </div>
        <div className="ex-field">
          <span className="ex-label">Modifier groups</span>
          <div className="bo-form-grid bo-form-grid--2">
            {groups.map((g) => (
              <Checkbox key={g.id} label={`${g.name}${g.required ? ' (required)' : ''}`} checked={f.modifierGroupIds.includes(g.id)} onChange={(e) => set('modifierGroupIds', e.target.checked ? [...f.modifierGroupIds, g.id] : f.modifierGroupIds.filter((x) => x !== g.id))} />
            ))}
          </div>
        </div>
        <div className="bo-form-grid bo-form-grid--2">
          <TextField label="Available from" type="time" value={f.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} error={errors.time} />
          <TextField label="Available to" type="time" value={f.availableTo} onChange={(e) => set('availableTo', e.target.value)} hint="Leave empty for all day" />
        </div>
        <Switch label="Available now (turn off to mark sold out)" checked={f.available} onChange={(v) => set('available', v)} />
        <Switch label="Highlight as popular" checked={f.popular} onChange={(v) => set('popular', v)} />
      </div>
    </Drawer>
  );
}
