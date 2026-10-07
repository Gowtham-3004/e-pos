/**
 * Back Office write paths against the simulated cloud.
 * - Master data → publishMasterChange (devices pull via change feed).
 * - Posted documents are immutable; corrections are compensating records + stock movements + audit.
 */
import type { AuditEvent, Batch, Customer, Payment, Purchase, PurchaseLine, StockAdjustment, StockMovement, Supplier, TenderMethod } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { auditFor, commitWithFeed, publishMasterChange, type CollectionName, type LocalDatabase, type WriteOp } from '@elixir/local-store';
import { money } from '@elixir/format';

const now = () => new Date().toISOString();

function fy(at = new Date()) {
  const y = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}

export function formatDoc(kind: string, code: string, seq: number) {
  return `${kind}/${fy()}/${code}/${String(seq).padStart(6, '0')}`;
}

/** Allocate a document number and commit ops atomically with the sequence (serialised). */
async function commitWithDoc<T>(cloud: LocalDatabase, seqKey: string, kind: string, code: string, build: (docNo: string, seq: number) => { ops: WriteOp[]; result: T }): Promise<T> {
  return cloud.exclusive(async () => {
    const seq = cloud.peekSequence(seqKey);
    const { ops, result } = build(formatDoc(kind, code, seq), seq);
    await commitWithFeed(cloud, ops, { sequences: cloud.sequencesWith(seqKey, seq) });
    return result;
  });
}

export function peekDoc(cloud: LocalDatabase, seqKey: string, kind: string, code: string) {
  return formatDoc(kind, code, cloud.peekSequence(seqKey));
}

const storeCode = (cloud: LocalDatabase, storeId: string) => cloud.get('stores', storeId)?.code ?? 'STR';

// ───────── Master data ─────────

export async function saveMaster<C extends CollectionName>(
  cloud: LocalDatabase,
  o: { tenantId: string; collection: C; // eslint-disable-next-line @typescript-eslint/no-explicit-any
    entity: { id: string; [k: string]: any }; summary: string; actorId: string; action: string; entityName: string; before?: unknown; reason?: string; category?: AuditEvent['category']; op?: 'put' | 'delete' },
) {
  const audit = auditFor({ tenantId: o.tenantId, actorId: o.actorId, action: o.action, entity: o.entityName, entityId: o.entity.id, summary: o.summary, before: o.before, after: o.entity, reason: o.reason, category: o.category });
  await publishMasterChange(cloud, { tenantId: o.tenantId, collection: o.collection, entity: o.entity, summary: o.summary, op: o.op, extra: [{ collection: 'auditEvents', put: [audit] }] });
}

// ───────── Stock ─────────

export const ADJ_REASON_LABEL: Record<StockAdjustment['reason'], string> = {
  damage: 'Damage',
  expiry: 'Expiry write-off',
  theft: 'Theft / shrinkage',
  'count-correction': 'Count correction',
  sample: 'Sample / display',
  other: 'Other',
};

export async function postAdjustment(
  cloud: LocalDatabase,
  o: { tenantId: string; storeId: string; productId: string; batchId?: string; qty: number; reason: StockAdjustment['reason']; note?: string; userId: string; approvedBy?: string; sourceType?: StockMovement['sourceType'] },
) {
  const product = cloud.get('products', o.productId);
  return commitWithDoc(cloud, `ADJ|pur-${o.storeId}`, 'ADJ', storeCode(cloud, o.storeId), (docNo) => {
    const ts = now();
    const adj: StockAdjustment = { id: uid('adj'), tenantId: o.tenantId, storeId: o.storeId, documentNo: docNo, productId: o.productId, batchId: o.batchId, qty: o.qty, reason: o.reason, note: o.note, userId: o.userId, approvedBy: o.approvedBy, createdAt: ts };
    const mv: StockMovement = { id: uid('mv'), tenantId: o.tenantId, storeId: o.storeId, productId: o.productId, batchId: o.batchId, type: o.qty >= 0 ? 'adjustment_in' : 'adjustment_out', qty: o.qty, sourceType: o.sourceType ?? 'adjustment', sourceId: adj.id, reason: o.reason, userId: o.userId, createdAt: ts };
    const audit = auditFor({ tenantId: o.tenantId, storeId: o.storeId, actorId: o.userId, approvedBy: o.approvedBy, action: 'stock.adjusted', entity: 'adjustment', entityId: adj.id, documentNo: docNo, summary: `${docNo} · ${product?.name ?? o.productId} ${o.qty > 0 ? '+' : ''}${o.qty} (${ADJ_REASON_LABEL[o.reason]})`, reason: o.note });
    return { ops: [{ collection: 'adjustments', put: [adj] }, { collection: 'stockMovements', put: [mv] }, { collection: 'auditEvents', put: [audit] }], result: adj };
  });
}

export async function postTransfer(cloud: LocalDatabase, o: { tenantId: string; fromStoreId: string; toStoreId: string; lines: Array<{ productId: string; batchId?: string; qty: number }>; note?: string; userId: string }) {
  return commitWithDoc(cloud, `TRF|${o.fromStoreId}`, 'TRF', storeCode(cloud, o.fromStoreId), (docNo) => {
    const ts = now();
    const id = uid('trf');
    const mvs: StockMovement[] = o.lines.flatMap((l, i) => [
      { id: uid('mv'), tenantId: o.tenantId, storeId: o.fromStoreId, productId: l.productId, batchId: l.batchId, type: 'transfer_out' as const, qty: -Math.abs(l.qty), sourceType: 'transfer' as const, sourceId: id, sourceLineNo: i + 1, reason: docNo, userId: o.userId, createdAt: ts },
      { id: uid('mv'), tenantId: o.tenantId, storeId: o.toStoreId, productId: l.productId, batchId: l.batchId, type: 'transfer_in' as const, qty: Math.abs(l.qty), sourceType: 'transfer' as const, sourceId: id, sourceLineNo: i + 1, reason: docNo, userId: o.userId, createdAt: ts },
    ]);
    const from = cloud.get('stores', o.fromStoreId)?.name;
    const to = cloud.get('stores', o.toStoreId)?.name;
    const audit = auditFor({ tenantId: o.tenantId, storeId: o.fromStoreId, actorId: o.userId, action: 'stock.transferred', entity: 'transfer', entityId: id, documentNo: docNo, summary: `${docNo} · ${o.lines.length} item(s) ${from} → ${to}`, reason: o.note });
    return { ops: [{ collection: 'stockMovements', put: mvs }, { collection: 'auditEvents', put: [audit] }], result: { id, docNo } };
  });
}

export async function postStockTake(cloud: LocalDatabase, o: { tenantId: string; storeId: string; lines: Array<{ productId: string; variance: number }>; userId: string; note?: string }) {
  const lines = o.lines.filter((l) => l.variance !== 0);
  const code = storeCode(cloud, o.storeId);
  return cloud.exclusive(async () => {
    const stkKey = `STK|${o.storeId}`;
    const adjKey = `ADJ|pur-${o.storeId}`;
    const stkSeq = cloud.peekSequence(stkKey);
    const base = cloud.peekSequence(adjKey);
    const docNo = formatDoc('STK', code, stkSeq);
    const ts = now();
    const id = uid('stk');
    const adjs: StockAdjustment[] = lines.map((l, i) => ({ id: uid('adj'), tenantId: o.tenantId, storeId: o.storeId, documentNo: formatDoc('ADJ', code, base + i), productId: l.productId, qty: l.variance, reason: 'count-correction', note: `Stock take ${docNo}`, userId: o.userId, createdAt: ts }));
    const mvs: StockMovement[] = adjs.map((a) => ({ id: uid('mv'), tenantId: o.tenantId, storeId: o.storeId, productId: a.productId, type: a.qty >= 0 ? 'adjustment_in' : 'adjustment_out', qty: a.qty, sourceType: 'stocktake', sourceId: a.id, reason: 'count-correction', userId: o.userId, createdAt: ts }));
    const audit = auditFor({ tenantId: o.tenantId, storeId: o.storeId, actorId: o.userId, action: 'stock.stocktake.posted', entity: 'stocktake', entityId: id, documentNo: docNo, summary: `${docNo} posted · ${adjs.length} variance adjustment(s)`, reason: o.note });
    const seqs = { ...cloud.sequencesWith(stkKey, stkSeq) };
    if (adjs.length) seqs[adjKey] = base + adjs.length - 1;
    await commitWithFeed(cloud, [{ collection: 'adjustments', put: adjs }, { collection: 'stockMovements', put: mvs }, { collection: 'auditEvents', put: [audit] }], { sequences: seqs });
    return { docNo, count: adjs.length };
  });
}

// ───────── Purchase ─────────

export function lineNet(l: Pick<PurchaseLine, 'qty' | 'costPaise' | 'discountPct' | 'taxRatePct'>): number {
  const gross = l.qty * l.costPaise;
  const afterDisc = gross * (1 - (l.discountPct || 0) / 100);
  return Math.round(afterDisc * (1 + (l.taxRatePct || 0) / 100));
}

export function purchaseTotals(lines: PurchaseLine[]) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  let total = 0;
  for (const l of lines) {
    const gross = Math.round(l.qty * l.costPaise);
    const disc = Math.round(gross * ((l.discountPct || 0) / 100));
    const net = lineNet(l);
    subtotal += gross;
    discount += disc;
    total += net;
    tax += net - (gross - disc);
  }
  return { subtotalPaise: subtotal, discountPaise: discount, taxPaise: tax, totalPaise: total };
}

export async function savePurchaseDraft(cloud: LocalDatabase, p: Purchase, userId: string) {
  const isNew = !cloud.get('purchases', p.id);
  if (isNew && !p.documentNo) {
    return commitWithDoc(cloud, `PUR|pur-${p.storeId}`, 'PUR', storeCode(cloud, p.storeId), (docNo) => {
      const doc: Purchase = { ...p, documentNo: docNo, status: 'draft' };
      const audit = auditFor({ tenantId: p.tenantId, storeId: p.storeId, actorId: userId, action: 'purchase.draft.saved', entity: 'purchase', entityId: p.id, documentNo: docNo, summary: `Purchase draft ${docNo} saved · ${money(p.totalPaise)}` });
      return { ops: [{ collection: 'purchases', put: [doc] }, { collection: 'auditEvents', put: [audit] }], result: doc };
    });
  }
  const audit = auditFor({ tenantId: p.tenantId, storeId: p.storeId, actorId: userId, action: 'purchase.draft.saved', entity: 'purchase', entityId: p.id, documentNo: p.documentNo, summary: `Purchase draft ${p.documentNo} updated · ${money(p.totalPaise)}` });
  await commitWithFeed(cloud, [{ collection: 'purchases', put: [{ ...p, status: 'draft' }] }, { collection: 'auditEvents', put: [audit] }]);
  return p;
}

/** Post: draft → posted (read-only), purchase_in movements, supplier outstanding, audit. */
export async function postPurchase(cloud: LocalDatabase, draft: Purchase, userId: string) {
  const saved = draft.documentNo ? draft : await savePurchaseDraft(cloud, draft, userId);
  const p: Purchase = { ...saved, status: 'posted', postedAt: now(), paymentStatus: saved.paidPaise <= 0 ? 'unpaid' : saved.paidPaise >= saved.totalPaise ? 'paid' : 'partially-paid' };
  const newBatches: Batch[] = [];
  const mvs: StockMovement[] = p.lines.map((l, i) => {
    let batchId: string | undefined;
    if (l.batchCode) {
      const existing = cloud.where('batches', (b) => b.productId === l.productId && b.code === l.batchCode)[0] ?? newBatches.find((b) => b.productId === l.productId && b.code === l.batchCode);
      if (existing) batchId = existing.id;
      else if (l.expiryDate) {
        const b: Batch = { id: uid('b'), productId: l.productId, code: l.batchCode, expiryDate: l.expiryDate, mrpPaise: l.mrpPaise, costPaise: l.costPaise };
        newBatches.push(b);
        batchId = b.id;
      }
    }
    return { id: uid('mv'), tenantId: p.tenantId, storeId: p.storeId, productId: l.productId, batchId, type: 'purchase_in', qty: l.qty + (l.freeQty || 0), sourceType: 'purchase', sourceId: p.id, sourceLineNo: i + 1, userId, createdAt: p.postedAt! };
  });
  const supplier = cloud.get('suppliers', p.supplierId)!;
  const due = p.totalPaise - p.paidPaise;
  const audit = auditFor({ tenantId: p.tenantId, storeId: p.storeId, actorId: userId, action: 'purchase.posted', entity: 'purchase', entityId: p.id, documentNo: p.documentNo, summary: `Purchase ${p.documentNo} posted · ${p.lines.length} lines · ${money(p.totalPaise)} from ${supplier.name}` });
  const ops: WriteOp[] = [
    { collection: 'purchases', put: [p] },
    { collection: 'stockMovements', put: mvs },
    { collection: 'auditEvents', put: [audit] },
  ];
  if (p.paidPaise > 0) {
    ops.push({ collection: 'payments', put: [{ id: uid('pay'), tenantId: p.tenantId, partyType: 'supplier', partyId: supplier.id, documentNo: `${p.documentNo}/PAY`, amountPaise: p.paidPaise, method: 'upi', againstDocument: p.documentNo, createdAt: now(), userId } satisfies Payment] });
  }
  // Supplier (master) carries the new outstanding; purchase + movements ride in the same atomic commit.
  await publishMasterChange(cloud, { tenantId: p.tenantId, collection: 'suppliers', entity: { ...supplier, outstandingPaise: supplier.outstandingPaise + due }, summary: `Supplier ${supplier.name} outstanding updated`, extra: ops });
  for (const b of newBatches) await publishMasterChange(cloud, { tenantId: p.tenantId, collection: 'batches', entity: b, summary: `Batch ${b.code} received` });
  return p;
}

/** Purchase return = compensating debit note (negative purchase) + purchase_return movements. */
export async function postPurchaseReturn(cloud: LocalDatabase, o: { purchase: Purchase; lines: Array<{ index: number; qty: number }>; reason: string; userId: string }) {
  const src = o.purchase;
  const lines: PurchaseLine[] = o.lines
    .filter((l) => l.qty > 0)
    .map((l) => {
      const s = src.lines[l.index]!;
      const r = { ...s, qty: -l.qty, freeQty: 0 };
      return { ...r, netPaise: -lineNet({ ...s, qty: l.qty }) };
    });
  const t = purchaseTotals(lines.map((l) => ({ ...l, qty: -l.qty })));
  const supplier = cloud.get('suppliers', src.supplierId)!;
  const doc = await commitWithDoc(cloud, `PRN|pur-${src.storeId}`, 'PRN', storeCode(cloud, src.storeId), (docNo) => {
    const ts = now();
    const ret: Purchase = {
      id: uid('prn'), tenantId: src.tenantId, storeId: src.storeId, documentNo: docNo, supplierId: src.supplierId, supplierInvoiceNo: `Return against ${src.documentNo}`, invoiceDate: ts.slice(0, 10), lines,
      subtotalPaise: -t.subtotalPaise, taxPaise: -t.taxPaise, discountPaise: -t.discountPaise, totalPaise: -t.totalPaise, paidPaise: 0, status: 'posted', paymentStatus: 'paid', createdBy: o.userId, createdAt: ts, postedAt: ts,
    };
    const mvs: StockMovement[] = lines.map((l, i) => {
      const b = l.batchCode ? cloud.where('batches', (x) => x.productId === l.productId && x.code === l.batchCode)[0] : undefined;
      return { id: uid('mv'), tenantId: src.tenantId, storeId: src.storeId, productId: l.productId, batchId: b?.id, type: 'purchase_return', qty: l.qty, sourceType: 'purchase', sourceId: ret.id, sourceLineNo: i + 1, reason: o.reason, userId: o.userId, createdAt: ts };
    });
    const audit = auditFor({ tenantId: src.tenantId, storeId: src.storeId, actorId: o.userId, action: 'purchase.returned', entity: 'purchase', entityId: src.id, documentNo: src.documentNo, summary: `Purchase return ${docNo} against ${src.documentNo} · ${money(t.totalPaise)}`, reason: o.reason });
    return { ops: [{ collection: 'purchases', put: [ret] }, { collection: 'stockMovements', put: mvs }, { collection: 'auditEvents', put: [audit] }], result: ret };
  });
  await publishMasterChange(cloud, { tenantId: src.tenantId, collection: 'suppliers', entity: { ...supplier, outstandingPaise: supplier.outstandingPaise - t.totalPaise }, summary: `Supplier ${supplier.name} debit note ${doc.documentNo}` });
  return doc;
}

export async function cancelDraftPurchase(cloud: LocalDatabase, p: Purchase, userId: string, reason?: string) {
  const audit = auditFor({ tenantId: p.tenantId, storeId: p.storeId, actorId: userId, action: 'purchase.draft.cancelled', entity: 'purchase', entityId: p.id, documentNo: p.documentNo, summary: `Purchase draft ${p.documentNo} cancelled`, reason });
  await commitWithFeed(cloud, [{ collection: 'purchases', put: [{ ...p, status: 'cancelled' }] }, { collection: 'auditEvents', put: [audit] }]);
}

// ───────── Receivables / payables ─────────

export async function recordCustomerReceipt(cloud: LocalDatabase, o: { customer: Customer; storeId: string; amountPaise: number; method: TenderMethod; reference?: string; userId: string }) {
  const pay = await commitWithDoc(cloud, `PAY|rc-${o.storeId}`, 'RCT', storeCode(cloud, o.storeId), (docNo) => {
    const p: Payment = { id: uid('rc'), tenantId: o.customer.tenantId, partyType: 'customer', partyId: o.customer.id, documentNo: docNo, amountPaise: o.amountPaise, method: o.method, reference: o.reference, createdAt: now(), userId: o.userId };
    const audit = auditFor({ tenantId: o.customer.tenantId, storeId: o.storeId, actorId: o.userId, action: 'receipt.recorded', entity: 'payment', entityId: p.id, documentNo: docNo, summary: `Receipt ${docNo} · ${money(o.amountPaise)} from ${o.customer.name}` });
    return { ops: [{ collection: 'payments', put: [p] }, { collection: 'auditEvents', put: [audit] }], result: p };
  });
  await publishMasterChange(cloud, { tenantId: o.customer.tenantId, collection: 'customers', entity: { ...o.customer, outstandingPaise: Math.max(0, o.customer.outstandingPaise - o.amountPaise) }, summary: `Customer ${o.customer.name} receipt ${pay.documentNo}` });
  return pay;
}

export async function recordSupplierPayment(cloud: LocalDatabase, o: { supplier: Supplier; storeId: string; amountPaise: number; method: TenderMethod; reference?: string; userId: string }) {
  // Allocate oldest-first against posted purchases with a balance.
  const open = cloud
    .where('purchases', (p) => p.supplierId === o.supplier.id && p.status === 'posted' && p.totalPaise > 0 && p.totalPaise - p.paidPaise > 0)
    .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate));
  let left = o.amountPaise;
  const updated: Purchase[] = [];
  const against: string[] = [];
  for (const p of open) {
    if (left <= 0) break;
    const take = Math.min(left, p.totalPaise - p.paidPaise);
    left -= take;
    const paid = p.paidPaise + take;
    updated.push({ ...p, paidPaise: paid, paymentStatus: paid >= p.totalPaise ? 'paid' : 'partially-paid' });
    against.push(p.documentNo);
  }
  const pay = await commitWithDoc(cloud, `PAY|pur-${o.storeId}`, 'PAY', storeCode(cloud, o.storeId), (docNo) => {
    const p: Payment = { id: uid('pay'), tenantId: o.supplier.tenantId, partyType: 'supplier', partyId: o.supplier.id, documentNo: docNo, amountPaise: o.amountPaise, method: o.method, reference: o.reference, againstDocument: against.join(', ') || undefined, createdAt: now(), userId: o.userId };
    const audit = auditFor({ tenantId: o.supplier.tenantId, storeId: o.storeId, actorId: o.userId, action: 'payment.recorded', entity: 'payment', entityId: p.id, documentNo: docNo, summary: `Payment ${docNo} · ${money(o.amountPaise)} to ${o.supplier.name}${against.length ? ` against ${against.length} invoice(s)` : ''}` });
    return { ops: [{ collection: 'payments', put: [p] }, { collection: 'purchases', put: updated }, { collection: 'auditEvents', put: [audit] }], result: p };
  });
  await publishMasterChange(cloud, { tenantId: o.supplier.tenantId, collection: 'suppliers', entity: { ...o.supplier, outstandingPaise: Math.max(0, o.supplier.outstandingPaise - o.amountPaise) }, summary: `Supplier ${o.supplier.name} payment ${pay.documentNo}` });
  return pay;
}

// ───────── Settings (cloud meta) ─────────

export interface TenantSettings {
  businessName: string;
  legalName: string;
  gstin: string;
  address: string;
  phone: string;
  email: string;
  invoicePrefix: string;
  invoiceFooter: string;
  showSavings: boolean;
  printLogo: boolean;
  paperWidth: '58mm' | '80mm' | 'A4';
  autoPrint: boolean;
  copies: number;
  offlineGraceDays: number;
  negativeStock: 'block' | 'warn';
  staleConfigHours: number;
  loyaltyEarnPer100: number;
  loyaltyRedeemValuePaise: number;
  loyaltyMinRedeem: number;
  loyaltyExpiryMonths: number;
}

export function defaultSettings(cloud: LocalDatabase, tenantId: string): TenantSettings {
  const t = cloud.get('tenants', tenantId)!;
  const s = cloud.where('stores', (x) => x.tenantId === tenantId)[0];
  return {
    businessName: t.name,
    legalName: t.legalName,
    gstin: t.gstin ?? '',
    address: s?.address ?? '',
    phone: t.contactPhone,
    email: `accounts@${t.name.toLowerCase().replace(/[^a-z]/g, '')}.in`,
    invoicePrefix: 'INV',
    invoiceFooter: 'Thank you for shopping with us! Goods once sold can be exchanged within 7 days with invoice.',
    showSavings: true,
    printLogo: true,
    paperWidth: '80mm',
    autoPrint: true,
    copies: 1,
    offlineGraceDays: 7,
    negativeStock: 'warn',
    staleConfigHours: 24,
    loyaltyEarnPer100: 1,
    loyaltyRedeemValuePaise: 100,
    loyaltyMinRedeem: 100,
    loyaltyExpiryMonths: 12,
  };
}

export const settingsKey = (tenantId: string) => `bo-settings:${tenantId}`;

export async function saveSettings(cloud: LocalDatabase, tenantId: string, s: TenantSettings, userId: string, section: string) {
  await cloud.setMeta(settingsKey(tenantId), s);
  await cloud.put('auditEvents', auditFor({ tenantId, actorId: userId, action: 'settings.updated', entity: 'settings', entityId: tenantId, summary: `${section} settings updated`, category: 'technical' }));
}
