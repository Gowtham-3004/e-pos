import type { ApprovalRequest, MenuItem, OrderLine, RestaurantOrder } from '@elixir/contracts';
import {
  createApproval, createOrder, decideApproval, outboxFor, publishMasterChange, requestBill, resolveWaiterCall, saveOrder, sendKot, setTableStatus, voidOrderLine,
  type CollectionName, type LocalDatabase,
} from '@elixir/local-store';
import { uid } from '@elixir/domain';
import type { SessionInfo } from './app';

interface OutItem { collection: CollectionName; entity: { id: string }; eventType: string; summary: string; documentNo?: string }

/**
 * Append transactional-outbox rows for entities a command just wrote, so the SyncEngine pushes
 * them to the (simulated) cloud. The shared restaurant/approval commands do not write outbox rows
 * themselves (see report: recommended shared change).
 */
export async function enqueue(db: LocalDatabase, s: Pick<SessionInfo, 'deviceId' | 'store'>, items: OutItem[]) {
  const live = items.filter((i) => i.entity);
  if (!live.length) return;
  await db.exclusive(async () => {
    const seqs = { ...(db.meta<Record<string, number>>('sequences') ?? {}) };
    const rows = live.map((i) => outboxFor(db, seqs, { deviceId: s.deviceId, storeId: s.store.id, ...i }));
    await db.commit([{ collection: 'outbox', put: rows }], { sequences: seqs });
  });
}

/** Extra linkage carried on a KOT-void approval so the approver's decision can apply the void. */
export type VoidApproval = ApprovalRequest & { orderId?: string; lineId?: string };

// ───────────────────────── Approvals (owner / manager) ─────────────────────────

export async function decide(db: LocalDatabase, s: SessionInfo, approval: VoidApproval, decision: 'approved' | 'rejected', reason?: string) {
  await decideApproval(db, approval.id, decision, s.user.id, reason);
  const items: OutItem[] = [{ collection: 'approvals', entity: db.get('approvals', approval.id)!, eventType: `approval.${decision}.v1`, summary: `${approval.summary} — ${decision}` }];
  if (decision === 'approved' && approval.action === 'kot-void' && approval.orderId && approval.lineId) {
    await voidOrderLine(db, { orderId: approval.orderId, lineId: approval.lineId, reason: approval.reason ?? approval.detail, userId: approval.requestedBy, approvedBy: s.user.id });
    const order = db.get('orders', approval.orderId);
    if (order) items.push({ collection: 'orders', entity: order, eventType: 'restaurant.order.updated.v1', summary: `Order ${order.orderNo} line voided`, documentNo: order.orderNo });
  }
  await enqueue(db, s, items);
}

// ───────────────────────── Waiter ─────────────────────────

export async function openTable(db: LocalDatabase, s: SessionInfo, tableId: string, guests: number): Promise<RestaurantOrder> {
  const order = await createOrder(db, { tenantId: s.tenant.id, storeId: s.store.id, type: 'dine-in', tableId, guests, waiterId: s.user.id, source: 'waiter' });
  await enqueue(db, s, [
    { collection: 'orders', entity: order, eventType: 'restaurant.order.opened.v1', summary: `Order ${order.orderNo} opened · Table ${order.tableCode}`, documentNo: order.orderNo },
    { collection: 'tables', entity: db.get('tables', tableId)!, eventType: 'restaurant.table.updated.v1', summary: `Table ${order.tableCode} occupied` },
  ]);
  return order;
}

/**
 * Unsent edits are a local draft (persisted on the phone, not synced until sent).
 * Applied to the freshest copy of the order so concurrent kitchen updates to sent lines are kept.
 */
export function saveDraft(db: LocalDatabase, orderId: string, edit: (lines: OrderLine[]) => OrderLine[]) {
  return db.exclusive(async () => {
    const order = db.get('orders', orderId);
    if (!order) return;
    await saveOrder(db, { ...order, lines: edit(order.lines) });
  });
}

export async function send(db: LocalDatabase, s: SessionInfo, orderId: string) {
  const kots = await sendKot(db, orderId, s.user.id);
  const order = db.get('orders', orderId)!;
  const table = db.get('tables', order.tableId);
  await enqueue(db, s, [
    { collection: 'orders', entity: order, eventType: 'restaurant.order.updated.v1', summary: `Order ${order.orderNo} sent`, documentNo: order.orderNo },
    ...kots.map((k) => ({ collection: 'kots' as const, entity: k, eventType: 'restaurant.kot.sent.v1', summary: `${k.displayNo} · ${k.items.length} items`, documentNo: k.displayNo })),
    ...(table ? [{ collection: 'tables' as const, entity: table, eventType: 'restaurant.table.updated.v1', summary: `Table ${table.code} preparing` }] : []),
  ]);
  return kots;
}

export async function askBill(db: LocalDatabase, s: SessionInfo, orderId: string) {
  await requestBill(db, orderId);
  const order = db.get('orders', orderId)!;
  const table = db.get('tables', order.tableId);
  await enqueue(db, s, [
    { collection: 'orders', entity: order, eventType: 'restaurant.bill.requested.v1', summary: `Bill requested · ${order.orderNo}`, documentNo: order.orderNo },
    ...(table ? [{ collection: 'tables' as const, entity: table, eventType: 'restaurant.table.updated.v1', summary: `Table ${table.code} bill requested` }] : []),
  ]);
}

export async function requestVoid(db: LocalDatabase, s: SessionInfo, order: RestaurantOrder, line: OrderLine, reason: string) {
  const unit = line.unitPricePaise + line.modifiers.reduce((x, m) => x + m.pricePaise, 0);
  const input: Omit<VoidApproval, 'id' | 'status' | 'createdAt'> = {
    tenantId: s.tenant.id, storeId: s.store.id, action: 'kot-void', requestedBy: s.user.id,
    summary: `Void KOT item — Table ${order.tableCode ?? order.token}`, detail: `${line.name} × ${line.qty} — ${reason}`, amountPaise: unit * line.qty, reason,
    orderId: order.id, lineId: line.id,
  };
  const req = await createApproval(db, input);
  await enqueue(db, s, [{ collection: 'approvals', entity: req, eventType: 'approval.requested.v1', summary: req.summary }]);
  return req;
}

export async function resolveCall(db: LocalDatabase, s: SessionInfo, id: string, status: 'acknowledged' | 'done') {
  await resolveWaiterCall(db, id, status);
  await enqueue(db, s, [{ collection: 'waiterCalls', entity: db.get('waiterCalls', id)!, eventType: 'restaurant.call.updated.v1', summary: `Call ${status}` }]);
}

export async function markTable(db: LocalDatabase, s: SessionInfo, tableId: string, status: 'available' | 'cleaning' | 'reserved') {
  await setTableStatus(db, tableId, status);
  await enqueue(db, s, [{ collection: 'tables', entity: db.get('tables', tableId)!, eventType: 'restaurant.table.updated.v1', summary: `Table ${status}` }]);
}

export async function setAvailability(db: LocalDatabase, s: SessionInfo, item: MenuItem, available: boolean) {
  const upd = { ...item, available };
  await db.put('menuItems', upd);
  await enqueue(db, s, [{ collection: 'menuItems', entity: upd, eventType: 'catalog.menu.availability.v1', summary: `${item.name} ${available ? 'available' : 'sold out'}` }]);
}

// ───────────────────────── Demo: cloud → phone ─────────────────────────

const DEMO_REQUESTS: Array<Pick<ApprovalRequest, 'action' | 'summary' | 'detail' | 'amountPaise' | 'requestedValue' | 'allowedValue'>> = [
  { action: 'discount', summary: 'Bill discount 15%', detail: 'Festival bulk order — cashier limit 10%', requestedValue: 15, allowedValue: 10, amountPaise: 324000 },
  { action: 'price-override', summary: 'Price override', detail: 'Match competitor shelf price (−₹12.00)', amountPaise: 1200 },
  { action: 'return-no-invoice', summary: 'Return without invoice', detail: 'Customer lost receipt — 1 item', amountPaise: 24900 },
];

/**
 * Simulate a POS terminal raising an approval: written to the cloud and published on the change
 * feed, so it reaches this phone only through the sync engine's pull (and only while online).
 */
export async function simulateIncomingApproval(cloud: LocalDatabase, s: SessionInfo) {
  const pick = DEMO_REQUESTS[Math.floor(Math.random() * DEMO_REQUESTS.length)]!;
  const cashier = cloud.where('users', (u) => u.tenantId === s.tenant.id && u.role === 'cashier')[0];
  const counter = cloud.where('counters', (c) => c.storeId === s.store.id && c.kind === 'billing')[0];
  const req: ApprovalRequest = { ...pick, id: uid('ap'), tenantId: s.tenant.id, storeId: s.store.id, counterId: counter?.id, requestedBy: cashier?.id ?? s.user.id, status: 'pending', createdAt: new Date().toISOString() };
  await publishMasterChange(cloud, { tenantId: s.tenant.id, collection: 'approvals', entity: req, summary: `Approval requested: ${req.summary}` });
}
