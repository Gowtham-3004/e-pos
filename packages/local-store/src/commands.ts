import type {
  ApprovalAction, ApprovalRequest, AuditEvent, CartLineInput, CashMovement, CashMovementType, DenominationCount, HeldCart, Kot, KotStatus, OrderLine,
  JobCard, JobCardLine, JobCardStatus, OrderType, OriginContext, Paise, Product, RestaurantOrder, Sale, SaleLine, SaleReturn, SaleReturnLine, Shift, StockMovement, SyncOutboxItem, Tender, TenderMethod,
} from '@elixir/contracts';
import { buildKots, canTransition, computeCart, computeGst, denominationTotal, documentNumber, isJobCardOpen, JOB_CARD_STATUS_LABEL, jobCardToCartLines, orderTotals, tableStatusFromOrder, uid } from '@elixir/domain';
import type { CollectionName, LocalDatabase, WriteOp } from './db';

export class LocalCommitError extends Error {
  constructor(message: string, public code: 'VALIDATION' | 'STORAGE' | 'DUPLICATE' | 'TENDER_MISMATCH' | 'NO_SHIFT' | 'NOT_FOUND' = 'STORAGE') {
    super(message);
  }
}

/** Demo fault injection so screens can show recovery states (§47–48). */
export const faults = { failNextCommit: false, failNextPrint: false };

const now = () => new Date().toISOString();

function counterCodes(db: LocalDatabase, counterId: string) {
  const c = db.get('counters', counterId);
  const s = c ? db.get('stores', c.storeId) : undefined;
  return { counter: c, store: s, code: `${s?.code ?? 'STR'}-${c?.code ?? 'C00'}` };
}

function nextDoc(db: LocalDatabase, kind: 'INV' | 'RET' | 'PAY' | 'JOB', counterId: string, seqs: Record<string, number>) {
  const key = `${kind}|${counterId}`;
  const n = (seqs[key] ?? (kind === 'INV' ? 1000 : 0)) + 1;
  seqs[key] = n;
  return documentNumber(kind, counterCodes(db, counterId).code, n);
}

function seqSnapshot(db: LocalDatabase): Record<string, number> {
  return { ...(db.meta<Record<string, number>>('sequences') ?? {}) };
}

/** Build a transactional-outbox row for an entity (ADR-005). */
export function outboxFor(
  db: LocalDatabase,
  seqs: Record<string, number>,
  o: { deviceId: string; storeId: string; eventType: string; collection: CollectionName; entity: { id: string }; documentNo?: string; summary: string },
): SyncOutboxItem {
  const key = `OUTBOX|${o.deviceId}`;
  const seq = (seqs[key] ?? 0) + 1;
  seqs[key] = seq;
  const json = JSON.stringify(o.entity);
  return {
    id: uid('ob'),
    eventId: uid(),
    eventType: o.eventType,
    aggregateType: o.collection,
    aggregateId: o.entity.id,
    documentNo: o.documentNo,
    sequence: seq,
    idempotencyKey: `${o.deviceId}:${o.entity.id}:${o.eventType}`,
    schemaVersion: 1,
    createdAtOrigin: now(),
    status: 'pending',
    attempts: 0,
    deviceId: o.deviceId,
    storeId: o.storeId,
    payloadSummary: o.summary,
    bytes: json.length,
    collection: o.collection,
    payload: o.entity,
  };
}

export function auditFor(o: Omit<AuditEvent, 'id' | 'createdAt' | 'category'> & { category?: AuditEvent['category'] }): AuditEvent {
  return { id: uid('au'), createdAt: now(), category: 'business', ...o };
}

function originAudit(origin: OriginContext) {
  return { tenantId: origin.tenantId, storeId: origin.storeId, counterId: origin.counterId, deviceId: origin.deviceId, shiftId: origin.shiftId, actorId: origin.userId };
}

async function durable(db: LocalDatabase, ops: WriteOp[], seqs: Record<string, number>) {
  if (faults.failNextCommit) {
    faults.failNextCommit = false;
    throw new LocalCommitError('Local database write failed (simulated disk error). Nothing was saved.', 'STORAGE');
  }
  await db.commit(ops, { sequences: seqs });
}

// ───────────────────────── Retail checkout ─────────────────────────

export interface CompleteSaleInput {
  /** Client transaction id — reused on retry so a double-submit never creates two sales. */
  clientTransactionId: string;
  origin: OriginContext;
  lines: CartLineInput[];
  billDiscountPct: number;
  tenders: Array<Omit<Tender, 'id' | 'saleId'>>;
  customerId?: string;
  approvedBy?: string;
  priceMode?: 'retail' | 'wholesale';
  redeemPoints?: number;
}

/**
 * CompleteSaleCommand (LLD §3). One atomic local write:
 * sale header/lines + tenders + stock movements + cash movement + loyalty + audit + outbox + receipt snapshot.
 */
export function completeSale(db: LocalDatabase, input: CompleteSaleInput): Promise<Sale> {
  return db.exclusive(async () => {
    const existing = db.get('sales', input.clientTransactionId);
    if (existing) return existing;
    const seqs = seqSnapshot(db);
    const { sale, ops } = buildRetailSale(db, input, seqs);
    await durable(db, ops, seqs);
    return sale;
  });
}

interface BuildSaleOptions {
  kind?: Sale['kind'];
  customerName?: string;
  jobCardId?: string;
  /** Adjust a product for pricing only (e.g. lift the list-price cap on quoted service labour). */
  productOverride?: (p: Product) => Product | undefined;
  auditSummary?: (documentNo: string) => string;
}

/**
 * Shared retail invoice builder (retail checkout + job card billing): prices via computeCart and returns
 * the sale plus every write (stock out for stocked lines only, cash, serials, customer, audit, outbox).
 */
function buildRetailSale(db: LocalDatabase, input: CompleteSaleInput, seqs: Record<string, number>, opts: BuildSaleOptions = {}): { sale: Sale; ops: WriteOp[] } {
  const { origin } = input;
  const store = db.get('stores', origin.storeId)!;
  const customer = db.get('customers', input.customerId);
  const interState = !!customer?.stateCode && customer.stateCode !== store.stateCode;
  const pg = customer?.priceGroupId ? db.get('priceGroups', customer.priceGroupId) : undefined;
  const products = new Map(db.where('products', (p) => p.tenantId === origin.tenantId).map((p) => [p.id, opts.productOverride?.(p) ?? p]));
  const cart = computeCart(input.lines, input.billDiscountPct, {
    products,
    taxRates: new Map(db.all('taxRates').map((t) => [t.id, t])),
    batches: new Map(db.all('batches').map((b) => [b.id, b])),
    interState,
    priceMode: input.priceMode,
    priceGroupDiscountPct: pg?.discountPct,
  });
  if (cart.errors.length) throw new LocalCommitError(cart.errors[0]!.message, 'VALIDATION');
  if (!cart.lines.length) throw new LocalCommitError('Cart is empty.', 'VALIDATION');
  const tendered = input.tenders.reduce((s, t) => s + t.amountPaise, 0);
  if (tendered !== cart.totalPaise) throw new LocalCommitError(`Tender ${tendered / 100} does not match bill total ${cart.totalPaise / 100}.`, 'TENDER_MISMATCH');
  const shift = db.get('shifts', origin.shiftId);
  if (!shift || shift.status === 'closed') throw new LocalCommitError('Open a shift before billing.', 'NO_SHIFT');

  const id = input.clientTransactionId;
  const documentNo = nextDoc(db, 'INV', origin.counterId, seqs);
  const ts = now();
  const tenders: Tender[] = input.tenders.map((t, i) => ({ ...t, id: `${id}-t${i + 1}`, saleId: id }));
  const lines: SaleLine[] = cart.lines.map((l, i) => ({ ...l, id: `${id}-l${i + 1}`, saleId: id }));
  const credit = tenders.filter((t) => t.method === 'credit').reduce((s, t) => s + t.amountPaise, 0);
  const earned = customer ? Math.floor(cart.totalPaise / 10000) : undefined;
  const sale: Sale = {
    ...origin, id, documentNo, kind: opts.kind ?? 'retail', jobCardId: opts.jobCardId, status: credit > 0 ? 'partially-paid' : 'paid', customerId: customer?.id, customerName: customer?.name ?? opts.customerName, lines, tenders,
    itemCount: cart.itemCount, grossPaise: cart.grossPaise, lineDiscountPaise: cart.lineDiscountPaise, billDiscountPaise: cart.billDiscountPaise, taxablePaise: cart.taxablePaise,
    taxPaise: cart.taxPaise, roundOffPaise: cart.roundOffPaise, totalPaise: cart.totalPaise, savingsPaise: cart.savingsPaise, interState, taxSummary: cart.taxSummary,
    approvedBy: input.approvedBy, createdAt: ts, committedAt: ts, syncState: 'pending', printed: false, loyaltyEarned: earned, loyaltyRedeemed: input.redeemPoints,
  };
  const movements: StockMovement[] = lines.filter((l) => !products.get(l.productId)?.isService).map((l) => ({
    id: uid('mv'), tenantId: origin.tenantId, storeId: origin.storeId, productId: l.productId, batchId: l.batchId, type: 'sale_out', qty: -l.qty,
    sourceType: 'sale', sourceId: id, sourceLineNo: l.lineNo, userId: origin.userId, deviceId: origin.deviceId, createdAt: ts,
  }));
  const cash = tenders.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amountPaise, 0);
  const cashMv: CashMovement[] = cash ? [{ ...origin, id: uid('cm'), type: 'cash_sale', amountPaise: cash, reference: documentNo, createdAt: ts }] : [];
  const serialsSold = db.all('serials').filter((s) => lines.some((l) => l.productId === s.productId && l.serials?.includes(s.serial))).map((s) => ({ ...s, status: 'sold' as const, saleId: id }));
  const customerUpd = customer
    ? [{ ...customer, outstandingPaise: customer.outstandingPaise + credit, loyaltyPoints: customer.loyaltyPoints + (earned ?? 0) - (input.redeemPoints ?? 0) }]
    : [];
  const audits: AuditEvent[] = [auditFor({ ...originAudit(origin), action: 'sale.completed', entity: 'sale', entityId: id, documentNo, summary: opts.auditSummary?.(documentNo) ?? `Invoice ${documentNo} committed locally · ${lines.length} lines` })];
  if (input.approvedBy) audits.push(auditFor({ ...originAudit(origin), approvedBy: input.approvedBy, action: 'override.discount', entity: 'sale', entityId: id, documentNo, summary: `Manager approved discount on ${documentNo}` }));
  const outbox = [outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: opts.kind === 'service' ? 'service.sale.completed.v1' : 'retail.sale.completed.v1', collection: 'sales', entity: sale, documentNo, summary: `Sale ${documentNo}` })];
  movements.forEach((m) => outbox.push(outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'inventory.movement.v1', collection: 'stockMovements', entity: m, documentNo, summary: `Stock −${Math.abs(m.qty)}` })));
  cashMv.forEach((m) => outbox.push(outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: m, documentNo, summary: 'Cash sale' })));
  customerUpd.forEach((c) => outbox.push(outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'customer.balance.v1', collection: 'customers', entity: c, summary: `Customer ${c.name}` })));
  serialsSold.forEach((s) => outbox.push(outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'inventory.serial.sold.v1', collection: 'serials', entity: s, documentNo, summary: `Serial ${s.serial}` })));
  audits.forEach((a) => outbox.push(outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: a, summary: a.summary })));

  const ops: WriteOp[] = [
    { collection: 'sales', put: [sale] },
    { collection: 'stockMovements', put: movements },
    { collection: 'cashMovements', put: cashMv },
    { collection: 'serials', put: serialsSold },
    { collection: 'customers', put: customerUpd },
    { collection: 'auditEvents', put: audits },
    { collection: 'outbox', put: outbox },
  ];
  return { sale, ops };
}

/** Mark receipt printed (outside the commit transaction — print never rolls back a sale). */
export async function markPrinted(db: LocalDatabase, saleId: string): Promise<void> {
  if (faults.failNextPrint) {
    faults.failNextPrint = false;
    throw new Error('Receipt printer unavailable — sale is already saved.');
  }
  const s = db.get('sales', saleId);
  if (s) await db.put('sales', { ...s, printed: true });
}

// ───────────────────────── Hold / resume ─────────────────────────

export async function holdCart(db: LocalDatabase, cart: Omit<HeldCart, 'id' | 'heldAt'>): Promise<HeldCart> {
  const h: HeldCart = { ...cart, id: uid('hold'), heldAt: now() };
  await db.put('heldCarts', h);
  return h;
}

export async function deleteHeldCart(db: LocalDatabase, id: string) {
  await db.remove('heldCarts', id);
}

// ───────────────────────── Returns ─────────────────────────

export interface ReturnInput {
  origin: OriginContext;
  originalSaleId?: string;
  lines: Array<{ saleLineId?: string; productId: string; name: string; qty: number; refundPaise: Paise; restockable: boolean; reason: string; batchId?: string }>;
  refundMethod: TenderMethod;
  approvedBy?: string;
}

export function commitReturn(db: LocalDatabase, input: ReturnInput): Promise<SaleReturn> {
  return db.exclusive(async () => {
    const { origin } = input;
    const seqs = seqSnapshot(db);
    const original = db.get('sales', input.originalSaleId);
    const id = uid('rt');
    const documentNo = nextDoc(db, 'RET', origin.counterId, seqs);
    const ts = now();
    const lines: SaleReturnLine[] = input.lines.map((l) => ({ saleLineId: l.saleLineId ?? '', productId: l.productId, name: l.name, qty: l.qty, refundPaise: l.refundPaise, restockable: l.restockable, reason: l.reason }));
    const refund = lines.reduce((s, l) => s + l.refundPaise, 0);
    const ret: SaleReturn = { ...origin, id, documentNo, originalSaleId: original?.id, originalDocumentNo: original?.documentNo, lines, refundPaise: refund, refundMethod: input.refundMethod, approvedBy: input.approvedBy, createdAt: ts, syncState: 'pending' };
    const movements: StockMovement[] = input.lines.map((l, i) => ({
      id: uid('mv'), tenantId: origin.tenantId, storeId: origin.storeId, productId: l.productId, batchId: l.batchId, type: l.restockable ? 'sale_return_restock' : 'sale_return_damaged',
      qty: l.restockable ? l.qty : -l.qty, sourceType: 'return', sourceId: id, sourceLineNo: i + 1, reason: l.reason, userId: origin.userId, deviceId: origin.deviceId, createdAt: ts,
    }));
    const cashMv: CashMovement[] = input.refundMethod === 'cash' ? [{ ...origin, id: uid('cm'), type: 'cash_refund', amountPaise: -refund, reference: documentNo, createdAt: ts }] : [];
    const updatedSale = original
      ? (() => {
          const ls = original.lines.map((sl) => {
            const r = input.lines.find((l) => l.saleLineId === sl.id);
            return r ? { ...sl, returnedQty: sl.returnedQty + r.qty } : sl;
          });
          return [{ ...original, lines: ls, status: 'returned' as const }];
        })()
      : [];
    const audit = auditFor({ ...originAudit(origin), approvedBy: input.approvedBy, action: 'return.posted', entity: 'return', entityId: id, documentNo, summary: `Return ${documentNo}${original ? ` against ${original.documentNo}` : ' without invoice'} · refund ${refund / 100}` });
    const outbox = [
      outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'retail.return.posted.v1', collection: 'returns', entity: ret, documentNo, summary: `Return ${documentNo}` }),
      ...movements.map((m) => outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'inventory.movement.v1', collection: 'stockMovements', entity: m, documentNo, summary: 'Return stock' })),
      ...cashMv.map((m) => outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: m, documentNo, summary: 'Cash refund' })),
      ...updatedSale.map((s) => outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'retail.sale.returned.v1', collection: 'sales', entity: s, documentNo: s.documentNo, summary: `Sale ${s.documentNo} returned` })),
      outboxFor(db, seqs, { deviceId: origin.deviceId, storeId: origin.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: audit, summary: audit.summary }),
    ];
    await durable(db, [
      { collection: 'returns', put: [ret] },
      { collection: 'stockMovements', put: movements },
      { collection: 'cashMovements', put: cashMv },
      { collection: 'sales', put: updatedSale },
      { collection: 'auditEvents', put: [audit] },
      { collection: 'outbox', put: outbox },
    ], seqs);
    return ret;
  });
}

// ───────────────────────── Shift & cash ─────────────────────────

export function openShift(db: LocalDatabase, input: { tenantId: string; storeId: string; counterId: string; deviceId: string; userId: string; denominations: DenominationCount[]; businessDate: string }): Promise<Shift> {
  return db.exclusive(async () => {
    const seqs = seqSnapshot(db);
    const n = (seqs['SHIFT|global'] ?? 400) + 1;
    seqs['SHIFT|global'] = n;
    const ts = now();
    const opening = denominationTotal(input.denominations);
    const shift: Shift = {
      id: uid('sh'), code: `SH-${n}`, tenantId: input.tenantId, storeId: input.storeId, counterId: input.counterId, deviceId: input.deviceId, openedBy: input.userId,
      businessDate: input.businessDate, openedAt: ts, openingDenominations: input.denominations.filter((d) => d.count > 0), openingCash: opening, status: 'open',
    };
    const origin: OriginContext = { tenantId: input.tenantId, storeId: input.storeId, counterId: input.counterId, deviceId: input.deviceId, userId: input.userId, shiftId: shift.id, businessDate: input.businessDate };
    const cm: CashMovement = { ...origin, id: uid('cm'), type: 'opening', amountPaise: opening, createdAt: ts };
    const audit = auditFor({ ...originAudit(origin), action: 'shift.opened', entity: 'shift', entityId: shift.id, summary: `Shift ${shift.code} opened with ${opening / 100}` });
    const outbox = [
      outboxFor(db, seqs, { deviceId: input.deviceId, storeId: input.storeId, eventType: 'shift.opened.v1', collection: 'shifts', entity: shift, summary: `Shift ${shift.code} opened` }),
      outboxFor(db, seqs, { deviceId: input.deviceId, storeId: input.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: cm, summary: 'Opening cash' }),
      outboxFor(db, seqs, { deviceId: input.deviceId, storeId: input.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: audit, summary: audit.summary }),
    ];
    await durable(db, [
      { collection: 'shifts', put: [shift] },
      { collection: 'cashMovements', put: [cm] },
      { collection: 'auditEvents', put: [audit] },
      { collection: 'outbox', put: outbox },
    ], seqs);
    return shift;
  });
}

export function closeShift(db: LocalDatabase, input: { shiftId: string; userId: string; denominations: DenominationCount[]; varianceReason?: string; approvedBy?: string }): Promise<Shift> {
  return db.exclusive(async () => {
    const shift = db.get('shifts', input.shiftId);
    if (!shift) throw new LocalCommitError('Shift not found', 'NOT_FOUND');
    const seqs = seqSnapshot(db);
    const ts = now();
    const movements = db.where('cashMovements', (m) => m.shiftId === shift.id && m.type !== 'closing');
    const expected = movements.reduce((s, m) => s + m.amountPaise, 0);
    const actual = denominationTotal(input.denominations);
    const closed: Shift = {
      ...shift, status: 'closed', closedAt: ts, closedBy: input.userId, closingDenominations: input.denominations.filter((d) => d.count > 0), closingCash: actual,
      expectedCash: expected, variance: actual - expected, varianceReason: input.varianceReason, varianceApprovedBy: input.approvedBy,
    };
    const origin: OriginContext = { tenantId: shift.tenantId, storeId: shift.storeId, counterId: shift.counterId, deviceId: shift.deviceId, userId: input.userId, shiftId: shift.id, businessDate: shift.businessDate };
    const cm: CashMovement = { ...origin, id: uid('cm'), type: 'closing', amountPaise: actual, createdAt: ts };
    const audit = auditFor({ ...originAudit(origin), approvedBy: input.approvedBy, action: 'shift.closed', entity: 'shift', entityId: shift.id, summary: `Shift ${shift.code} closed · variance ${(actual - expected) / 100}`, reason: input.varianceReason });
    const outbox = [
      outboxFor(db, seqs, { deviceId: shift.deviceId, storeId: shift.storeId, eventType: 'shift.closed.v1', collection: 'shifts', entity: closed, summary: `Shift ${shift.code} closed` }),
      outboxFor(db, seqs, { deviceId: shift.deviceId, storeId: shift.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: cm, summary: 'Closing cash' }),
      outboxFor(db, seqs, { deviceId: shift.deviceId, storeId: shift.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: audit, summary: audit.summary }),
    ];
    await durable(db, [
      { collection: 'shifts', put: [closed] },
      { collection: 'cashMovements', put: [cm] },
      { collection: 'auditEvents', put: [audit] },
      { collection: 'outbox', put: outbox },
    ], seqs);
    return closed;
  });
}

export function recordCashMovement(db: LocalDatabase, input: { origin: OriginContext; type: Extract<CashMovementType, 'petty_paid' | 'petty_received' | 'cash_receipt'>; amountPaise: Paise; note?: string; reference?: string; customerId?: string }): Promise<CashMovement> {
  return db.exclusive(async () => {
    const seqs = seqSnapshot(db);
    const signed = input.type === 'petty_paid' ? -Math.abs(input.amountPaise) : Math.abs(input.amountPaise);
    const cm: CashMovement = { ...input.origin, id: uid('cm'), type: input.type, amountPaise: signed, note: input.note, reference: input.reference, createdAt: now() };
    const ops: WriteOp[] = [{ collection: 'cashMovements', put: [cm] }];
    const outbox = [outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: cm, summary: input.note ?? input.type })];
    if (input.type === 'cash_receipt' && input.customerId) {
      const c = db.get('customers', input.customerId);
      if (c) {
        const upd = { ...c, outstandingPaise: Math.max(0, c.outstandingPaise - Math.abs(input.amountPaise)) };
        ops.push({ collection: 'customers', put: [upd] });
        const pay = { id: uid('pay'), tenantId: c.tenantId, partyType: 'customer' as const, partyId: c.id, documentNo: nextDoc(db, 'PAY', input.origin.counterId, seqs), amountPaise: Math.abs(input.amountPaise), method: 'cash' as const, createdAt: now(), userId: input.origin.userId };
        ops.push({ collection: 'payments', put: [pay] });
        outbox.push(outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'customer.balance.v1', collection: 'customers', entity: upd, summary: `Collection from ${c.name}` }));
        outbox.push(outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'payment.received.v1', collection: 'payments', entity: pay, documentNo: pay.documentNo, summary: `Receipt ${pay.documentNo}` }));
      }
    }
    ops.push({ collection: 'outbox', put: outbox });
    await durable(db, ops, seqs);
    return cm;
  });
}

// ───────────────────────── Approvals ─────────────────────────

export async function createApproval(db: LocalDatabase, a: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'> & { action: ApprovalAction }): Promise<ApprovalRequest> {
  const req: ApprovalRequest = { ...a, id: uid('ap'), status: 'pending', createdAt: now() };
  await db.put('approvals', req);
  return req;
}

export async function decideApproval(db: LocalDatabase, id: string, decision: 'approved' | 'rejected', userId: string, reason?: string) {
  const a = db.get('approvals', id);
  if (!a) return;
  const upd: ApprovalRequest = { ...a, status: decision, decidedBy: userId, decidedAt: now(), reason };
  const audit = auditFor({ tenantId: a.tenantId, storeId: a.storeId, counterId: a.counterId, actorId: a.requestedBy, approvedBy: decision === 'approved' ? userId : undefined, action: `approval.${decision}`, entity: 'approval', entityId: a.id, summary: `${a.summary} — ${decision}`, reason });
  await db.commit([{ collection: 'approvals', put: [upd] }, { collection: 'auditEvents', put: [audit] }]);
}

// ───────────────────────── Restaurant ─────────────────────────

export function createOrder(db: LocalDatabase, input: { tenantId: string; storeId: string; type: OrderType; tableId?: string; guests?: number; waiterId?: string; customerName?: string; customerPhone?: string; source?: RestaurantOrder['source'] }): Promise<RestaurantOrder> {
  return db.exclusive(async () => {
    const seqs = seqSnapshot(db);
    const n = (seqs['ORD|global'] ?? 300) + 1;
    seqs['ORD|global'] = n;
    let token: number | undefined;
    if (input.type !== 'dine-in') {
      token = (seqs['TOKEN|daily'] ?? 42) + 1;
      seqs['TOKEN|daily'] = token;
    }
    const table = db.get('tables', input.tableId);
    const order: RestaurantOrder = {
      id: uid('ro'), tenantId: input.tenantId, storeId: input.storeId, orderNo: `ORD-${String(n).padStart(4, '0')}`, type: input.type, tableId: table?.id, tableCode: table?.code, token,
      guests: input.guests, waiterId: input.waiterId, customerName: input.customerName, customerPhone: input.customerPhone, lines: [], status: 'new', kotCount: 0, billDiscountPct: 0,
      billRequested: false, openedAt: now(), source: input.source ?? 'pos',
    };
    const ops: WriteOp[] = [{ collection: 'orders', put: [order] }];
    if (table) ops.push({ collection: 'tables', put: [{ ...table, status: 'occupied', currentOrderId: order.id }] });
    await durable(db, ops, seqs);
    return order;
  });
}

/** Persist unsent line edits / discount on a running order. */
export async function saveOrder(db: LocalDatabase, order: RestaurantOrder): Promise<void> {
  const ops: WriteOp[] = [{ collection: 'orders', put: [order] }];
  const table = db.get('tables', order.tableId);
  if (table) ops.push({ collection: 'tables', put: [{ ...table, status: tableStatusFromOrder(order), currentOrderId: order.id }] });
  await db.commit(ops);
}

/** Send unsent items to kitchen → KOT per station, new increment each time (FR-KOT-001/003). */
export function sendKot(db: LocalDatabase, orderId: string, userId: string): Promise<Kot[]> {
  return db.exclusive(async () => {
    const order = db.get('orders', orderId);
    if (!order) throw new LocalCommitError('Order not found', 'NOT_FOUND');
    const seqs = seqSnapshot(db);
    let g = seqs['KOT|global'] ?? 300;
    const built = buildKots(order, { createdBy: userId, nextId: () => uid('kot'), globalSeq: () => ++g });
    if (!built.kots.length) return [];
    seqs['KOT|global'] = g;
    const updated: RestaurantOrder = { ...order, lines: built.lines, kotCount: built.kotCount, status: order.status === 'new' || order.status === 'ready' ? 'accepted' : order.status };
    const ops: WriteOp[] = [{ collection: 'orders', put: [updated] }, { collection: 'kots', put: built.kots }];
    const table = db.get('tables', order.tableId);
    if (table) ops.push({ collection: 'tables', put: [{ ...table, status: 'preparing', currentOrderId: order.id }] });
    const audit = auditFor({ tenantId: order.tenantId, storeId: order.storeId, actorId: userId, action: 'kot.sent', entity: 'order', entityId: order.id, documentNo: order.orderNo, summary: `${built.kots.map((k) => k.displayNo).join(', ')} sent for ${order.tableCode ? `Table ${order.tableCode}` : `Token ${order.token}`}` });
    ops.push({ collection: 'auditEvents', put: [audit] });
    await durable(db, ops, seqs);
    return built.kots;
  });
}

const KOT_TO_LINE: Partial<Record<KotStatus, OrderLine['state']>> = { accepted: 'preparing', preparing: 'preparing', ready: 'ready', completed: 'served' };

/** KDS status change propagates to order lines and table status (FR-KDS-004). */
export async function setKotStatus(db: LocalDatabase, kotId: string, status: KotStatus): Promise<void> {
  const kot = db.get('kots', kotId);
  if (!kot) return;
  const ts = now();
  const updKot: Kot = { ...kot, status, acceptedAt: kot.acceptedAt ?? (status !== 'new' ? ts : undefined), readyAt: status === 'ready' ? ts : kot.readyAt, completedAt: status === 'completed' ? ts : kot.completedAt };
  const ops: WriteOp[] = [{ collection: 'kots', put: [updKot] }];
  const order = db.get('orders', kot.orderId);
  if (order) {
    const lineState = KOT_TO_LINE[status];
    const ids = new Set(kot.items.map((i) => i.orderLineId));
    const lines = lineState ? order.lines.map((l) => (ids.has(l.id) && l.state !== 'void' ? { ...l, state: lineState } : l)) : order.lines;
    const live = lines.filter((l) => l.state !== 'void' && l.state !== 'unsent');
    const st: RestaurantOrder['status'] = live.length && live.every((l) => l.state === 'served') ? 'served' : live.length && live.every((l) => l.state === 'ready' || l.state === 'served') ? 'ready' : live.some((l) => l.state === 'preparing') ? 'preparing' : order.status;
    const updOrder = { ...order, lines, status: st };
    ops.push({ collection: 'orders', put: [updOrder] });
    const table = db.get('tables', order.tableId);
    if (table && table.currentOrderId === order.id) ops.push({ collection: 'tables', put: [{ ...table, status: tableStatusFromOrder(updOrder) }] });
  }
  await db.commit(ops);
}

/** Void a line. If already sent, emits a void KOT so kitchen history stays explicit (§17). */
export function voidOrderLine(db: LocalDatabase, input: { orderId: string; lineId: string; reason: string; userId: string; approvedBy?: string }): Promise<void> {
  return db.exclusive(async () => {
    const order = db.get('orders', input.orderId);
    if (!order) return;
    const line = order.lines.find((l) => l.id === input.lineId);
    if (!line) return;
    const seqs = seqSnapshot(db);
    const ops: WriteOp[] = [];
    if (line.state === 'unsent') {
      ops.push({ collection: 'orders', put: [{ ...order, lines: order.lines.filter((l) => l.id !== line.id) }] });
    } else {
      const g = (seqs['KOT|global'] ?? 300) + 1;
      seqs['KOT|global'] = g;
      const voidKot: Kot = {
        id: uid('kot'), orderId: order.id, storeId: order.storeId, kotNo: order.kotCount + 1, displayNo: `KOT #${g} · VOID`, stationId: line.stationId, orderType: order.type, tableCode: order.tableCode, token: order.token,
        items: [{ orderLineId: line.id, name: line.name, qty: line.qty, modifiers: line.modifiers.map((m) => m.name), note: input.reason, void: true }], status: 'new', createdBy: input.userId, createdAt: now(), isVoid: true,
      };
      ops.push({ collection: 'kots', put: [voidKot] });
      ops.push({ collection: 'orders', put: [{ ...order, kotCount: order.kotCount + 1, lines: order.lines.map((l) => (l.id === line.id ? { ...l, state: 'void' as const, voidReason: input.reason } : l)) }] });
    }
    ops.push({ collection: 'auditEvents', put: [auditFor({ tenantId: order.tenantId, storeId: order.storeId, actorId: input.userId, approvedBy: input.approvedBy, action: 'kot.void', entity: 'order', entityId: order.id, documentNo: order.orderNo, summary: `Voided ${line.qty} × ${line.name}`, reason: input.reason })] });
    await durable(db, ops, seqs);
  });
}

export async function requestBill(db: LocalDatabase, orderId: string): Promise<void> {
  const order = db.get('orders', orderId);
  if (!order) return;
  await saveOrder(db, { ...order, billRequested: true });
}

export async function transferTable(db: LocalDatabase, orderId: string, toTableId: string, userId: string): Promise<void> {
  const order = db.get('orders', orderId);
  const to = db.get('tables', toTableId);
  if (!order || !to) return;
  const from = db.get('tables', order.tableId);
  const upd = { ...order, tableId: to.id, tableCode: to.code };
  const ops: WriteOp[] = [
    { collection: 'orders', put: [upd] },
    { collection: 'tables', put: [{ ...to, status: tableStatusFromOrder(upd), currentOrderId: order.id }, ...(from ? [{ ...from, status: 'cleaning' as const, currentOrderId: undefined }] : [])] },
    { collection: 'auditEvents', put: [auditFor({ tenantId: order.tenantId, storeId: order.storeId, actorId: userId, action: 'table.transferred', entity: 'order', entityId: order.id, documentNo: order.orderNo, summary: `Moved ${order.orderNo} from ${from?.code ?? '—'} to ${to.code}` })] },
  ];
  await db.commit(ops);
}

export async function setTableStatus(db: LocalDatabase, tableId: string, status: 'available' | 'cleaning' | 'reserved') {
  const t = db.get('tables', tableId);
  if (t) await db.put('tables', { ...t, status, currentOrderId: status === 'available' ? undefined : t.currentOrderId });
}

/**
 * Settle a restaurant order (or a split portion of its lines) into a posted sale.
 * Pass lineIds for split-by-item; omitted = full settlement and table closes (FR-RES-016).
 */
export function settleOrder(db: LocalDatabase, input: { clientTransactionId: string; orderId: string; origin: OriginContext; tenders: Array<Omit<Tender, 'id' | 'saleId'>>; billDiscountPct: number; lineIds?: string[]; approvedBy?: string; customerId?: string }): Promise<Sale> {
  return db.exclusive(async () => {
    const existing = db.get('sales', input.clientTransactionId);
    if (existing) return existing;
    const order = db.get('orders', input.orderId);
    if (!order) throw new LocalCommitError('Order not found', 'NOT_FOUND');
    const shift = db.get('shifts', input.origin.shiftId);
    if (!shift || shift.status === 'closed') throw new LocalCommitError('Open a shift before settling bills.', 'NO_SHIFT');
    const portion = order.lines.filter((l) => l.state !== 'void' && (!input.lineIds || input.lineIds.includes(l.id)));
    if (!portion.length) throw new LocalCommitError('Nothing to bill.', 'VALIDATION');
    const tot = orderTotals(portion, input.billDiscountPct, 5);
    const tendered = input.tenders.reduce((s, t) => s + t.amountPaise, 0);
    if (tendered !== tot.totalPaise) throw new LocalCommitError('Tender does not match bill total.', 'TENDER_MISMATCH');
    const seqs = seqSnapshot(db);
    const id = input.clientTransactionId;
    const documentNo = nextDoc(db, 'INV', input.origin.counterId, seqs);
    const ts = now();
    const ratio = tot.subtotalPaise ? (tot.subtotalPaise - tot.discountPaise) / tot.subtotalPaise : 1;
    const lines: SaleLine[] = portion.map((l, i) => {
      const unit = l.unitPricePaise + l.modifiers.reduce((s, m) => s + m.pricePaise, 0);
      const gross = unit * l.qty;
      const after = Math.round(gross * ratio);
      const g = computeGst(after, 5, false, false);
      return {
        id: `${id}-l${i + 1}`, saleId: id, lineNo: i + 1, productId: l.menuItemId, name: l.modifiers.length ? `${l.name} (${l.modifiers.map((m) => m.name).join(', ')})` : l.name, barcode: '', hsn: '996331', unit: 'pcs', qty: l.qty,
        mrpPaise: unit, unitPricePaise: unit, grossPaise: gross, discountPaise: gross - after, taxablePaise: g.taxablePaise, taxRatePct: 5, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: 0, netPaise: after + g.taxPaise, returnedQty: 0,
      };
    });
    const tenders: Tender[] = input.tenders.map((t, i) => ({ ...t, id: `${id}-t${i + 1}`, saleId: id }));
    const customer = db.get('customers', input.customerId);
    const sale: Sale = {
      ...input.origin, id, documentNo, kind: 'restaurant', status: 'paid', customerId: customer?.id, customerName: customer?.name ?? order.customerName, lines, tenders, itemCount: tot.itemCount,
      grossPaise: tot.subtotalPaise, lineDiscountPaise: 0, billDiscountPaise: tot.discountPaise, taxablePaise: tot.taxablePaise, taxPaise: tot.taxPaise, roundOffPaise: tot.roundOffPaise,
      totalPaise: tot.totalPaise, savingsPaise: tot.discountPaise, interState: false, taxSummary: [{ ratePct: 5, taxablePaise: tot.taxablePaise, cgstPaise: tot.cgstPaise, sgstPaise: tot.sgstPaise, igstPaise: 0 }],
      approvedBy: input.approvedBy, createdAt: order.openedAt, committedAt: ts, syncState: 'pending', printed: false, restaurantOrderId: order.id,
    };
    const remaining = order.lines.filter((l) => l.state !== 'void' && !portion.includes(l));
    const fullySettled = remaining.length === 0;
    const updOrder: RestaurantOrder = fullySettled
      ? { ...order, status: order.type === 'dine-in' ? 'served' : 'collected', closedAt: ts, saleId: id, billRequested: false }
      : { ...order, lines: order.lines.filter((l) => !portion.includes(l)) };
    const ops: WriteOp[] = [{ collection: 'sales', put: [sale] }, { collection: 'orders', put: [updOrder] }];
    const table = db.get('tables', order.tableId);
    if (table && fullySettled) ops.push({ collection: 'tables', put: [{ ...table, status: 'cleaning', currentOrderId: undefined }] });
    const cash = tenders.filter((t) => t.method === 'cash').reduce((s, t) => s + t.amountPaise, 0);
    const cashMv: CashMovement[] = cash ? [{ ...input.origin, id: uid('cm'), type: 'cash_sale', amountPaise: cash, reference: documentNo, createdAt: ts }] : [];
    ops.push({ collection: 'cashMovements', put: cashMv });
    const audit = auditFor({ ...originAudit(input.origin), approvedBy: input.approvedBy, action: 'sale.completed', entity: 'sale', entityId: id, documentNo, summary: `Bill ${documentNo} settled for ${order.tableCode ? `Table ${order.tableCode}` : `Token ${order.token}`}${fullySettled ? '' : ' (split)'}` });
    ops.push({ collection: 'auditEvents', put: [audit] });
    ops.push({
      collection: 'outbox',
      put: [
        outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'restaurant.bill.settled.v1', collection: 'sales', entity: sale, documentNo, summary: `Bill ${documentNo}` }),
        outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'restaurant.order.updated.v1', collection: 'orders', entity: updOrder, documentNo: order.orderNo, summary: `Order ${order.orderNo}` }),
        ...cashMv.map((m) => outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'cash.movement.v1', collection: 'cashMovements', entity: m, documentNo, summary: 'Cash sale' })),
        outboxFor(db, seqs, { deviceId: input.origin.deviceId, storeId: input.origin.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: audit, summary: audit.summary }),
      ],
    });
    await durable(db, ops, seqs);
    return sale;
  });
}

export async function resolveWaiterCall(db: LocalDatabase, id: string, status: 'acknowledged' | 'done') {
  const c = db.get('waiterCalls', id);
  if (c) await db.put('waiterCalls', { ...c, status });
}

// ───────────────────────── Service job cards ─────────────────────────

/** Who is acting on a job card. Job cards can be opened/updated without an open shift; billing needs one. */
export type JobCardActor = Pick<OriginContext, 'tenantId' | 'storeId' | 'counterId' | 'deviceId' | 'userId'> & { shiftId?: string };

export interface OpenJobCardInput {
  actor: JobCardActor;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  device: JobCard['device'];
  problem: string;
  estimatePaise?: Paise;
  advancePaise?: Paise;
  technicianId?: string;
  promisedAt?: string;
}

function jobCardWrite(db: LocalDatabase, seqs: Record<string, number>, card: JobCard, actor: JobCardActor, action: string, summary: string): WriteOp[] {
  const audit = auditFor({ tenantId: actor.tenantId, storeId: actor.storeId, counterId: actor.counterId, deviceId: actor.deviceId, shiftId: actor.shiftId, actorId: actor.userId, action, entity: 'jobCard', entityId: card.id, documentNo: card.jobNo, summary });
  return [
    { collection: 'jobCards', put: [card] },
    { collection: 'auditEvents', put: [audit] },
    {
      collection: 'outbox',
      put: [
        outboxFor(db, seqs, { deviceId: actor.deviceId, storeId: actor.storeId, eventType: 'service.jobcard.updated.v1', collection: 'jobCards', entity: card, documentNo: card.jobNo, summary }),
        outboxFor(db, seqs, { deviceId: actor.deviceId, storeId: actor.storeId, eventType: 'audit.event.v1', collection: 'auditEvents', entity: audit, summary }),
      ],
    },
  ];
}

function editableCard(db: LocalDatabase, id: string): JobCard {
  const card = db.get('jobCards', id);
  if (!card) throw new LocalCommitError('Job card not found.', 'NOT_FOUND');
  if (!isJobCardOpen(card.status)) throw new LocalCommitError(`Job card ${card.jobNo} is ${JOB_CARD_STATUS_LABEL[card.status].toLowerCase()} and can no longer be changed.`, 'VALIDATION');
  return card;
}

/** Device intake — creates the job card with a counter-scoped JOB number. */
export function openJobCard(db: LocalDatabase, input: OpenJobCardInput): Promise<JobCard> {
  return db.exclusive(async () => {
    if (!input.customerName.trim() || !input.customerPhone.trim()) throw new LocalCommitError('Customer name and phone are required.', 'VALIDATION');
    if (!input.device.brand.trim() || !input.device.model.trim()) throw new LocalCommitError('Device brand and model are required.', 'VALIDATION');
    if (!input.problem.trim()) throw new LocalCommitError('Describe the reported problem.', 'VALIDATION');
    const { actor } = input;
    const seqs = seqSnapshot(db);
    const ts = now();
    const card: JobCard = {
      id: uid('jc'), tenantId: actor.tenantId, storeId: actor.storeId, counterId: actor.counterId, jobNo: nextDoc(db, 'JOB', actor.counterId, seqs),
      customerId: input.customerId, customerName: input.customerName.trim(), customerPhone: input.customerPhone.trim(), device: input.device, problem: input.problem.trim(),
      estimatePaise: input.estimatePaise, advancePaise: input.advancePaise, technicianId: input.technicianId, promisedAt: input.promisedAt,
      status: 'received', lines: [], statusHistory: [{ status: 'received', at: ts, userId: actor.userId }], openedBy: actor.userId, openedAt: ts, updatedAt: ts,
    };
    await durable(db, jobCardWrite(db, seqs, card, actor, 'jobcard.opened', `Job card ${card.jobNo} opened · ${card.device.brand} ${card.device.model}`), seqs);
    return card;
  });
}

export type JobCardPatch = Partial<Pick<JobCard, 'diagnosis' | 'estimatePaise' | 'advancePaise' | 'technicianId' | 'promisedAt' | 'problem' | 'device' | 'customerId' | 'customerName' | 'customerPhone'>>;

export function updateJobCard(db: LocalDatabase, id: string, patch: JobCardPatch, actor: JobCardActor): Promise<JobCard> {
  return db.exclusive(async () => {
    const card = editableCard(db, id);
    const seqs = seqSnapshot(db);
    const upd: JobCard = { ...card, ...patch, updatedAt: now() };
    await durable(db, jobCardWrite(db, seqs, upd, actor, 'jobcard.updated', `Job card ${card.jobNo} updated`), seqs);
    return upd;
  });
}

/** Add a service (labour) or spare part. Price defaults to the product's sale price. */
export function addJobCardLine(
  db: LocalDatabase,
  id: string,
  line: Pick<JobCardLine, 'productId' | 'qty'> & Partial<Pick<JobCardLine, 'unitPricePaise' | 'lineDiscountPct' | 'batchId' | 'serials' | 'technicianId'>>,
  actor: JobCardActor,
): Promise<JobCard> {
  return db.exclusive(async () => {
    const card = editableCard(db, id);
    const p = db.get('products', line.productId);
    if (!p || p.tenantId !== card.tenantId || !p.active) throw new LocalCommitError('Product not found or inactive.', 'VALIDATION');
    if (!(line.qty > 0) || (!p.decimalQty && !Number.isInteger(line.qty))) throw new LocalCommitError(`Enter a valid quantity for ${p.name}.`, 'VALIDATION');
    if (p.serialTracked && (line.serials?.length ?? 0) !== line.qty) throw new LocalCommitError(`Pick ${line.qty} serial number(s) for ${p.name}.`, 'VALIDATION');
    const inUse = new Set(card.lines.flatMap((l) => l.serials ?? []));
    if (line.serials?.some((x) => inUse.has(x))) throw new LocalCommitError('That serial is already on this job card.', 'VALIDATION');
    const seqs = seqSnapshot(db);
    const ts = now();
    const newLine: JobCardLine = {
      id: uid('jcl'), kind: p.isService ? 'service' : 'part', productId: p.id, name: p.name, qty: line.qty, unitPricePaise: line.unitPricePaise ?? p.salePaise,
      lineDiscountPct: line.lineDiscountPct, batchId: line.batchId, serials: line.serials, technicianId: line.technicianId ?? card.technicianId, addedAt: ts,
    };
    const upd: JobCard = { ...card, lines: [...card.lines, newLine], updatedAt: ts };
    await durable(db, jobCardWrite(db, seqs, upd, actor, 'jobcard.line.added', `${newLine.kind === 'service' ? 'Service' : 'Part'} ${p.name} ×${line.qty} added to ${card.jobNo}`), seqs);
    return upd;
  });
}

export function removeJobCardLine(db: LocalDatabase, id: string, lineId: string, actor: JobCardActor): Promise<JobCard> {
  return db.exclusive(async () => {
    const card = editableCard(db, id);
    const line = card.lines.find((l) => l.id === lineId);
    if (!line) throw new LocalCommitError('Line not found.', 'NOT_FOUND');
    const seqs = seqSnapshot(db);
    const upd: JobCard = { ...card, lines: card.lines.filter((l) => l.id !== lineId), updatedAt: now() };
    await durable(db, jobCardWrite(db, seqs, upd, actor, 'jobcard.line.removed', `${line.name} removed from ${card.jobNo}`), seqs);
    return upd;
  });
}

/** Move the job through its workflow. `delivered` is reached only via billJobCard. */
export function setJobCardStatus(db: LocalDatabase, id: string, status: JobCardStatus, actor: JobCardActor, note?: string): Promise<JobCard> {
  return db.exclusive(async () => {
    const card = editableCard(db, id);
    if (status === 'delivered') throw new LocalCommitError('Bill the job card to deliver the device.', 'VALIDATION');
    if (!canTransition(card.status, status)) throw new LocalCommitError(`Cannot move ${card.jobNo} from ${JOB_CARD_STATUS_LABEL[card.status]} to ${JOB_CARD_STATUS_LABEL[status]}.`, 'VALIDATION');
    if (status === 'ready' && !card.lines.length) throw new LocalCommitError('Add the services and parts used before marking the job ready.', 'VALIDATION');
    const seqs = seqSnapshot(db);
    const ts = now();
    const upd: JobCard = { ...card, status, statusHistory: [...card.statusHistory, { status, at: ts, userId: actor.userId, note }], updatedAt: ts, closedAt: status === 'cancelled' ? ts : undefined };
    await durable(db, jobCardWrite(db, seqs, upd, actor, `jobcard.${status}`, `Job card ${card.jobNo} → ${JOB_CARD_STATUS_LABEL[status]}${note ? ` · ${note}` : ''}`), seqs);
    return upd;
  });
}

/**
 * Service labour is quoted per job, so its list price is not an MRP ceiling:
 * lift it to the highest quoted price on the card for pricing.
 */
export function jobCardPricingOverride(card: Pick<JobCard, 'lines'>) {
  const quoted = new Map<string, number>();
  card.lines.forEach((l) => quoted.set(l.productId, Math.max(quoted.get(l.productId) ?? 0, l.unitPricePaise)));
  return (p: Product): Product | undefined => (p.isService && (quoted.get(p.id) ?? 0) > p.mrpPaise ? { ...p, mrpPaise: quoted.get(p.id)! } : undefined);
}

export interface BillJobCardInput {
  clientTransactionId: string;
  jobCardId: string;
  origin: OriginContext;
  tenders: Array<Omit<Tender, 'id' | 'saleId'>>;
  billDiscountPct: number;
  approvedBy?: string;
}

/**
 * Bill & deliver: one atomic write of the GST invoice (services + parts), parts stock out,
 * serials sold, cash, customer balance, and the job card closed as delivered.
 */
export function billJobCard(db: LocalDatabase, input: BillJobCardInput): Promise<Sale> {
  return db.exclusive(async () => {
    const existing = db.get('sales', input.clientTransactionId);
    if (existing) return existing;
    const card = editableCard(db, input.jobCardId);
    if (card.saleId) throw new LocalCommitError(`Job card ${card.jobNo} is already billed.`, 'DUPLICATE');
    if (card.status !== 'ready') throw new LocalCommitError('Mark the job ready before billing.', 'VALIDATION');
    if (!card.lines.length) throw new LocalCommitError('Nothing to bill on this job card.', 'VALIDATION');
    const seqs = seqSnapshot(db);
    const { sale, ops } = buildRetailSale(
      db,
      { clientTransactionId: input.clientTransactionId, origin: input.origin, lines: jobCardToCartLines(card), billDiscountPct: input.billDiscountPct, tenders: input.tenders, customerId: card.customerId, approvedBy: input.approvedBy },
      seqs,
      { kind: 'service', jobCardId: card.id, customerName: card.customerName, productOverride: jobCardPricingOverride(card), auditSummary: (doc) => `Invoice ${doc} for job card ${card.jobNo} · ${card.lines.length} lines` },
    );
    const ts = sale.committedAt;
    const delivered: JobCard = {
      ...card, status: 'delivered', saleId: sale.id, saleDocumentNo: sale.documentNo, closedAt: ts, updatedAt: ts,
      statusHistory: [...card.statusHistory, { status: 'delivered', at: ts, userId: input.origin.userId, note: `Billed ${sale.documentNo}` }],
    };
    ops.push(...jobCardWrite(db, seqs, delivered, input.origin, 'jobcard.delivered', `Job card ${card.jobNo} delivered · ${sale.documentNo}`));
    await durable(db, ops, seqs);
    return sale;
  });
}
