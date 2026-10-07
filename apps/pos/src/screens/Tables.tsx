import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DiningTable, TableStatus } from '@elixir/contracts';
import { orderTotals, TABLE_STATUS } from '@elixir/domain';
import { elapsed, money, relative } from '@elixir/format';
import { createOrder, resolveWaiterCall, setTableStatus, transferTable } from '@elixir/local-store';
import { useLive, useNow } from '@elixir/local-store/react';
import { Avatar, Badge, Button, CategoryChips, EmptyState, Icon, Modal, QuantityStepper, StatusBadge, Tabs, useToast, cx } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';

const CALL_LABEL: Record<string, { label: string; icon: string }> = { 'call-waiter': { label: 'Calling waiter', icon: 'Hand' }, water: { label: 'Water', icon: 'GlassWater' }, bill: { label: 'Bill please', icon: 'Receipt' } };

export function TablesScreen() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(1000);
  const floors = useLive(device, ['floors'], () => device.where('floors', (f) => f.storeId === s.store.id).sort((a, b) => a.sortOrder - b.sortOrder), [s.store.id]);
  const [floorId, setFloorId] = useState<string>(() => floors[0]?.id ?? '');
  const [status, setStatus] = useState<'all' | TableStatus>('all');
  const [active, setActive] = useState<DiningTable>();
  const floorIds = useMemo(() => new Set(floors.map((f) => f.id)), [floors]);
  const tables = useLive(device, ['tables'], () => device.where('tables', (t) => floorIds.has(t.floorId)).sort((a, b) => a.code.localeCompare(b.code)), [floorIds]);
  const orders = useLive(device, ['orders'], () => new Map(device.where('orders', (o) => o.storeId === s.store.id && !o.closedAt).map((o) => [o.id, o])), [s.store.id]);
  const calls = useLive(device, ['waiterCalls'], () => device.where('waiterCalls', (c) => c.storeId === s.store.id && c.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.store.id]);
  const onFloor = tables.filter((t) => t.floorId === floorId);
  const visible = onFloor.filter((t) => status === 'all' || t.status === status);
  const counts = onFloor.reduce<Record<string, number>>((m, t) => ((m[t.status] = (m[t.status] ?? 0) + 1), m), {});
  const statuses = (Object.keys(TABLE_STATUS) as TableStatus[]).filter((k) => counts[k]);

  return (
    <div className="tables">
      <div className="tables__main">
        <div className="ex-row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Tabs value={floorId} onChange={setFloorId} items={floors.map((f) => ({ key: f.id, label: f.name, count: tables.filter((t) => t.floorId === f.id && t.status !== 'available').length }))} />
          <div className="ex-spacer" />
          <Button icon="ShoppingBag" onClick={() => nav('/order?type=takeaway')}>New takeaway</Button>
          <Button icon="Bike" onClick={() => nav('/order?type=delivery')}>New delivery</Button>
        </div>
        <CategoryChips
          label="Filter by status"
          value={status}
          onChange={setStatus}
          items={[{ key: 'all' as const, label: 'All tables', count: onFloor.length }, ...statuses.map((k) => ({ key: k, label: TABLE_STATUS[k].label, icon: TABLE_STATUS[k].icon, count: counts[k] }))]}
        />
        {visible.length ? (
          <div className="tables__grid">
            {visible.map((t) => {
              const o = t.currentOrderId ? orders.get(t.currentOrderId) : undefined;
              const tot = o ? orderTotals(o.lines, o.billDiscountPct).totalPaise : 0;
              const unsent = o?.lines.filter((l) => l.state === 'unsent').length ?? 0;
              return (
                <button key={t.id} type="button" className={cx('tcard', `tcard--${t.status}`)} onClick={() => setActive(t)} aria-label={`Table ${t.code}, ${TABLE_STATUS[t.status].label}`}>
                  <div className="ex-row" style={{ alignItems: 'baseline' }}>
                    <span className="tcard__code">{t.code}</span>
                    <span className="ex-spacer" />
                    {o ? <span className="num muted" style={{ fontSize: 11, fontWeight: 600 }}>{o.orderNo}</span> : null}
                  </div>
                  <div><StatusBadge meta={TABLE_STATUS[t.status]} /></div>
                  <div className="tcard__meta">
                    <span><Icon name="Armchair" size={13} />{o?.guests ? `${o.guests}/${t.seats}` : `${t.seats} seats`}</span>
                    {o ? <span className="num"><Icon name="Timer" size={13} />{elapsed(o.openedAt, now)}</span> : null}
                    {o?.waiterId ? <span>{device.get('users', o.waiterId)?.name.split(' ')[0]}</span> : null}
                  </div>
                  {unsent ? <Badge tone="warning" icon="Send">{unsent} unsent</Badge> : null}
                  <div className="tcard__total">
                    {o ? <><span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{o.lines.filter((l) => l.state !== 'void').length} items</span><span className="num">{money(tot)}</span></> : <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{t.status === 'available' ? 'Tap to seat guests' : t.status === 'cleaning' ? 'Tap when cleaned' : t.status === 'reserved' ? 'Reserved' : ''}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState quiet title="No tables in this state">Choose another filter or floor.</EmptyState>
        )}
        <div className="legend" aria-label="Legend">
          {(Object.keys(TABLE_STATUS) as TableStatus[]).map((k) => <StatusBadge key={k} meta={TABLE_STATUS[k]} />)}
        </div>
      </div>
      <aside className="tables__side" aria-label="Waiter calls">
        <div className="ex-row"><Icon name="BellRing" size={18} /><b>Waiter calls</b><span className="ex-spacer" /><Badge tone={calls.some((c) => c.status === 'open') ? 'danger' : 'neutral'}>{calls.length}</Badge></div>
        {calls.length ? calls.map((c) => (
          <div key={c.id} className="call">
            <Icon name={CALL_LABEL[c.kind]!.icon} size={18} style={{ color: c.status === 'open' ? 'var(--status-danger)' : 'var(--text-muted)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>Table {c.tableCode}</b> · {CALL_LABEL[c.kind]!.label}
              <div className="muted" style={{ fontSize: 12 }}>{c.status === 'open' ? 'Waiting' : 'Acknowledged'} · {relative(c.createdAt, now)}</div>
            </div>
            {c.status === 'open' ? <Button size="sm" onClick={() => void resolveWaiterCall(device, c.id, 'acknowledged')}>Ack</Button> : <Button size="sm" variant="ghost" icon="Check" onClick={() => void resolveWaiterCall(device, c.id, 'done')}>Done</Button>}
          </div>
        )) : <div className="muted" style={{ fontSize: 13 }}>No open calls.</div>}
        <div className="ex-divider" />
        <div className="ex-row"><Icon name="ShoppingBag" size={18} /><b>Takeaway & delivery</b></div>
        {[...orders.values()].filter((o) => o.type !== 'dine-in').map((o) => (
          <button key={o.id} type="button" className="call" style={{ background: 'var(--surface-primary)', cursor: 'pointer', textAlign: 'left' }} onClick={() => nav(`/order/${o.id}`)}>
            <b className="num">Token {o.token}</b>
            <span className="muted ex-truncate" style={{ flex: 1 }}>{o.customerName ?? o.type}</span>
            <span className="num muted">{elapsed(o.openedAt, now)}</span>
          </button>
        ))}
      </aside>
      {active ? <TableActions table={tables.find((t) => t.id === active.id) ?? active} onClose={() => setActive(undefined)} onToast={toast} /> : null}
    </div>
  );
}

function TableActions({ table, onClose, onToast }: { table: DiningTable; onClose: () => void; onToast: ReturnType<typeof useToast> }) {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const order = table.currentOrderId ? device.get('orders', table.currentOrderId) : undefined;
  const waiters = device.where('users', (u) => u.tenantId === s.tenant.id && u.role === 'waiter' && u.storeIds.includes(s.store.id));
  const [guests, setGuests] = useState(Math.min(2, table.seats));
  const [waiter, setWaiter] = useState<string>(s.user.role === 'waiter' ? s.user.id : waiters[0]?.id ?? s.user.id);
  const [mode, setMode] = useState<'main' | 'transfer'>('main');
  const [busy, setBusy] = useState(false);
  const free = device.where('tables', (t) => t.status === 'available' && t.id !== table.id).sort((a, b) => a.code.localeCompare(b.code));

  const open = async () => {
    setBusy(true);
    const o = await createOrder(device, { tenantId: s.tenant.id, storeId: s.store.id, type: 'dine-in', tableId: table.id, guests, waiterId: waiter, source: 'pos' });
    setBusy(false);
    onClose();
    nav(`/order/${o.id}`);
  };

  return (
    <Modal open onClose={onClose} size="md" title={`Table ${table.code}`} description={`${table.seats} seats · ${TABLE_STATUS[table.status].label}${order ? ` · ${order.orderNo}` : ''}`} icon={<StatusBadge meta={TABLE_STATUS[table.status]} size="lg" />}>
      {mode === 'transfer' && order ? (
        <div className="ex-stack">
          <div className="secondary">Move {order.orderNo} ({order.guests ?? '—'} guests) to an available table. KOT history stays with the order.</div>
          <div className="tables__grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
            {free.map((t) => (
              <button key={t.id} type="button" className="tcard tcard--available" style={{ minHeight: 70 }} onClick={async () => { await transferTable(device, order.id, t.id, s.user.id); onToast.success('Table transferred', `${order.orderNo}: ${table.code} → ${t.code}`); onClose(); }}>
                <span className="tcard__code">{t.code}</span><span className="muted" style={{ fontSize: 12 }}>{t.seats} seats</span>
              </button>
            ))}
          </div>
          {!free.length ? <EmptyState quiet title="No free tables" /> : null}
          <Button onClick={() => setMode('main')}>Back</Button>
        </div>
      ) : table.status === 'available' || (table.status === 'reserved' && !order) ? (
        <div className="ex-stack" style={{ gap: 16 }}>
          <div className="ex-row" style={{ justifyContent: 'space-between' }}>
            <b>Guests</b>
            <QuantityStepper size="lg" value={guests} min={1} max={Math.max(table.seats + 4, 4)} onChange={setGuests} label="Guests" />
          </div>
          <div className="ex-stack" style={{ gap: 8 }}>
            <b>Waiter</b>
            <div className="ex-row" style={{ flexWrap: 'wrap' }}>
              {waiters.map((w) => (
                <button key={w.id} type="button" className="ex-chip ex-chip--lg" aria-pressed={waiter === w.id} onClick={() => setWaiter(w.id)}>
                  <Avatar name={w.name} color={w.avatarColor} />{w.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>
          <div className="ex-row">
            {table.status === 'available' ? <Button icon="CalendarCheck" onClick={async () => { await setTableStatus(device, table.id, 'reserved'); onToast.info(`Table ${table.code} reserved`); onClose(); }}>Reserve</Button> : <Button icon="CalendarX" onClick={async () => { await setTableStatus(device, table.id, 'available'); onClose(); }}>Cancel reservation</Button>}
            <div className="ex-spacer" />
            <Button variant="primary" size="lg" icon="UtensilsCrossed" loading={busy} onClick={open}>Open table · {guests} guests</Button>
          </div>
        </div>
      ) : table.status === 'cleaning' && !order ? (
        <div className="ex-stack">
          <div className="secondary">Guests have left. Mark the table available once it is cleaned and reset.</div>
          <Button variant="primary" size="lg" icon="Sparkles" onClick={async () => { await setTableStatus(device, table.id, 'available'); onToast.success(`Table ${table.code} available`); onClose(); }}>Mark cleaned & available</Button>
        </div>
      ) : order ? (
        <div className="ex-stack">
          <div className="pos-kv">
            <span>Order</span><span>{order.orderNo}</span>
            <span>Guests</span><span>{order.guests ?? '—'}</span>
            <span>Waiter</span><span>{device.get('users', order.waiterId)?.name ?? '—'}</span>
            <span>Items</span><span>{order.lines.filter((l) => l.state !== 'void').reduce((a, l) => a + l.qty, 0)}</span>
            <span>KOTs sent</span><span>{order.kotCount}</span>
            <span className="total">Total</span><span className="total">{money(orderTotals(order.lines, order.billDiscountPct).totalPaise)}</span>
          </div>
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            {s.permissions.includes('restaurant.table.transfer') ? <Button icon="ArrowLeftRight" onClick={() => setMode('transfer')}>Transfer table</Button> : null}
            <div className="ex-spacer" />
            <Button variant="primary" size="lg" icon="ClipboardList" onClick={() => { onClose(); nav(`/order/${order.id}`); }}>View order</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
