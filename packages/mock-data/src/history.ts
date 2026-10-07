import type {
  ApprovalRequest, AuditEvent, Batch, CashMovement, Counter, Customer, EdgeNode, MenuItem, Payment, Product, Purchase, PurchaseLine,
  Sale, SaleLine, SaleReturn, SerialNumber, Shift, StockAdjustment, StockMovement, Supplier, SupportTicket, SyncConflict, Tender, TenderMethod,
} from '@elixir/contracts';
import { computeCart, computeGst, documentNumber, orderTotals } from '@elixir/domain';
import { taxRates } from './catalog';
import { counters as allCounters, devices, stores as allStores, TENANT_IDS, tenants, users } from './platform';
import { DAY, iso, isoDay, startOfDay, type Rng } from './rng';

const NOW = Date.now();
const TODAY0 = startOfDay(NOW);
const HISTORY_DAYS = 30;

interface Input {
  rng: Rng;
  products: Product[];
  batches: Batch[];
  serials: SerialNumber[];
  customers: Customer[];
  suppliers: Supplier[];
  menuItems: MenuItem[];
}

export function buildHistory({ rng, products, batches, serials, customers, suppliers, menuItems }: Input) {
  const sales: Sale[] = [];
  const stockMovements: StockMovement[] = [];
  const purchases: Purchase[] = [];
  const shifts: Shift[] = [];
  const cashMovements: CashMovement[] = [];
  const payments: Payment[] = [];
  const returns: SaleReturn[] = [];
  const adjustments: StockAdjustment[] = [];
  const auditEvents: AuditEvent[] = [];
  const counterSeq = new Map<string, number>();
  let mvSeq = 0;
  const taxMap = Object.fromEntries(taxRates.map((t) => [t.id, t]));
  const batchMap = Object.fromEntries(batches.map((b) => [b.id, b]));

  const nextDoc = (kind: 'INV' | 'RET' | 'PUR' | 'ADJ' | 'PAY', counter: Counter | { id: string; code: string }, at: number) => {
    const key = `${kind}|${counter.id}`;
    const n = (counterSeq.get(key) ?? (kind === 'INV' ? 1000 : 0)) + 1;
    counterSeq.set(key, n);
    const store = 'storeId' in counter ? allStores.find((x) => x.id === counter.storeId) : undefined;
    return documentNumber(kind, store ? `${store.code}-${counter.code}` : counter.code, n, new Date(at));
  };
  const live = new Map<string, number>();
  const lkey = (storeId: string, productId: string, batchId?: string) => `${storeId}|${productId}|${batchId ?? ''}`;
  const avail = (storeId: string, productId: string, batchId?: string) => live.get(lkey(storeId, productId, batchId)) ?? 0;
  const mv = (m: Omit<StockMovement, 'id'>) => {
    stockMovements.push({ id: `mv-${++mvSeq}`, ...m });
    if (m.type !== 'sale_return_damaged') live.set(lkey(m.storeId, m.productId, m.batchId), avail(m.storeId, m.productId, m.batchId) + m.qty);
  };

  const retailTenants = [TENANT_IDS.abc, TENANT_IDS.trendz, TENANT_IDS.wellness, TENANT_IDS.volt];

  for (const tid of retailTenants) {
    const tenant = tenants.find((t) => t.id === tid)!;
    const tStores = allStores.filter((s) => s.tenantId === tid);
    const tProducts = products.filter((p) => p.tenantId === tid);
    const tCustomers = customers.filter((c) => c.tenantId === tid && c.active);
    const tSuppliers = suppliers.filter((s) => s.tenantId === tid);
    const cashiers = users.filter((u) => u.tenantId === tid && (u.role === 'cashier' || u.role === 'manager'));
    const productMap = Object.fromEntries(tProducts.map((p) => [p.id, p]));

    // Opening stock per store (dated before history window)
    for (const s of tStores) {
      for (const p of tProducts) {
        const pb = batches.filter((b) => b.productId === p.id);
        const openAt = iso(TODAY0 - (HISTORY_DAYS + 5) * DAY);
        if (p.serialTracked) {
          if (s === tStores[0]) mv({ tenantId: tid, storeId: s.id, productId: p.id, type: 'opening', qty: serials.filter((x) => x.productId === p.id).length, sourceType: 'opening', sourceId: 'opening', createdAt: openAt });
        } else if (pb.length) {
          pb.forEach((b) => mv({ tenantId: tid, storeId: s.id, productId: p.id, batchId: b.id, type: 'opening', qty: rng.int(20, 80), sourceType: 'opening', sourceId: 'opening', createdAt: openAt }));
        } else {
          const base = p.variantAttrs ? rng.int(8, 22) : p.weighted ? rng.int(120, 260) : rng.int(60, 220);
          mv({ tenantId: tid, storeId: s.id, productId: p.id, type: 'opening', qty: base, sourceType: 'opening', sourceId: 'opening', createdAt: openAt });
        }
      }
    }

    // Purchases (posted + drafts), first store
    const s0 = tStores[0]!;
    const purCounter = { id: `pur-${s0.id}`, code: s0.code };
    for (let i = 0; i < 12; i++) {
      const at = TODAY0 - rng.int(0, HISTORY_DAYS) * DAY + rng.int(10, 17) * 3600000;
      const sup = rng.pick(tSuppliers);
      const picks = rng.shuffle(tProducts.filter((p) => !p.serialTracked)).slice(0, rng.int(4, 8));
      const lines: PurchaseLine[] = picks.map((p) => {
        const qty = p.variantAttrs ? rng.int(4, 12) : rng.int(12, 60);
        const tax = taxMap[p.taxRateId]!.ratePct;
        const net = Math.round(p.costPaise * qty * (1 + tax / 100));
        const b = batches.find((bb) => bb.productId === p.id);
        return { productId: p.id, name: p.name, batchCode: b?.code, expiryDate: b?.expiryDate, qty, freeQty: qty > 40 ? 2 : 0, costPaise: p.costPaise, mrpPaise: p.mrpPaise, taxRatePct: tax, discountPct: 0, netPaise: net };
      });
      const subtotal = lines.reduce((s, l) => s + l.costPaise * l.qty, 0);
      const total = lines.reduce((s, l) => s + l.netPaise, 0);
      const draft = i >= 10;
      const paid = draft ? 0 : i % 3 === 0 ? 0 : i % 3 === 1 ? total : Math.round(total / 2 / 100) * 100;
      const doc = nextDoc('PUR', purCounter, at);
      const pur: Purchase = {
        id: `pu-${tid}-${i + 1}`, tenantId: tid, storeId: s0.id, documentNo: doc, supplierId: sup.id, supplierInvoiceNo: `${sup.name.slice(0, 3).toUpperCase()}/${rng.int(1000, 9999)}`,
        invoiceDate: isoDay(at), lines, subtotalPaise: subtotal, taxPaise: total - subtotal, discountPaise: 0, totalPaise: total, paidPaise: paid,
        status: draft ? 'draft' : 'posted', paymentStatus: paid === 0 ? 'unpaid' : paid >= total ? 'paid' : 'partially-paid',
        createdBy: `u-${tid}-inv`, createdAt: iso(at), postedAt: draft ? undefined : iso(at + 600000),
      };
      purchases.push(pur);
      if (!draft) {
        lines.forEach((l, li) => {
          const b = batches.find((bb) => bb.productId === l.productId);
          mv({ tenantId: tid, storeId: s0.id, productId: l.productId, batchId: b?.id, type: 'purchase_in', qty: l.qty + l.freeQty, sourceType: 'purchase', sourceId: pur.id, sourceLineNo: li + 1, userId: pur.createdBy, createdAt: pur.postedAt! });
        });
        sup.outstandingPaise += total - paid;
        if (paid > 0) payments.push({ id: `pay-${pur.id}`, tenantId: tid, partyType: 'supplier', partyId: sup.id, documentNo: nextDoc('PAY', purCounter, at), amountPaise: paid, method: rng.pick(['upi', 'cash', 'card'] as TenderMethod[]), againstDocument: doc, createdAt: iso(at + 3600000), userId: `u-${tid}-owner` });
      }
    }

    // Sales
    const soldSerials = new Set<string>();
    for (const s of tStores) {
      const sCounters = allCounters.filter((c) => c.storeId === s.id && c.kind === 'billing');
      const perDay = tid === TENANT_IDS.abc ? (s === tStores[0] ? 22 : 12) : tid === TENANT_IDS.volt ? 4 : 9;
      for (let d = HISTORY_DAYS; d >= 0; d--) {
        const day0 = TODAY0 - d * DAY;
        const weekend = [0, 6].includes(new Date(day0).getDay());
        const isToday = d === 0;
        const nowHour = new Date(NOW).getHours() + new Date(NOW).getMinutes() / 60;
        const count = Math.round(perDay * (weekend ? 1.35 : 1) * (0.75 + rng.next() * 0.5));
        const activeCounters = sCounters.slice(0, Math.max(1, Math.min(sCounters.length, isToday ? 1 : Math.ceil(count / 10))));
        for (const c of activeCounters) {
          const cashier = rng.pick(cashiers.filter((u) => u.storeIds.includes(s.id)));
          const shiftOpen = day0 + 9 * 3600000;
          const isOpenShiftToday = isToday && c === sCounters[0];
          if (isToday && !isOpenShiftToday) continue;
          const shiftUser = isOpenShiftToday ? users.find((u) => u.id === `u-${tid}-meena`)! : cashier;
          const dev = devices.find((dd) => dd.counterId === c.id)!;
          const shift: Shift = {
            id: `sh-${c.id}-${isoDay(day0)}`, code: `SH-${String(200 + shifts.length).padStart(3, '0')}`, tenantId: tid, storeId: s.id, counterId: c.id, deviceId: dev.id,
            openedBy: shiftUser.id, businessDate: isoDay(day0), openedAt: iso(shiftOpen),
            openingDenominations: [{ denomination: 50000, count: 4 }, { denomination: 20000, count: 5 }, { denomination: 10000, count: 15 }, { denomination: 5000, count: 10 }],
            openingCash: 500000, status: 'open',
          };
          shifts.push(shift);
          let cashSales = 0;
          const n = Math.ceil(count / activeCounters.length) * (isToday ? Math.max(0, Math.min(1, (nowHour - 9) / 12)) : 1);
          for (let k = 0; k < n; k++) {
            const at = shiftOpen + Math.floor(((k + rng.next()) / Math.max(1, n)) * (isToday ? Math.max(0.2, nowHour - 9.2) : 12) * 3600000);
            if (at > NOW - 60000) break;
            const lineCount = tid === TENANT_IDS.volt ? rng.int(1, 2) : tid === TENANT_IDS.trendz ? rng.int(1, 3) : rng.int(2, 7);
            const picks = rng.shuffle(tProducts.filter((p) => p.active)).slice(0, lineCount);
            const inputs = picks
              .map((p) => {
                const allB = batches.filter((b) => b.productId === p.id);
                const pb = allB.filter((b) => new Date(b.expiryDate).getTime() > at && avail(s.id, p.id, b.id) >= 3);
                if (allB.length && !pb.length) return null;
                const b = pb.length ? rng.pick(pb) : undefined;
                if (!b && avail(s.id, p.id) < (p.weighted ? 3 : 3)) return null;
                let serialsPicked: string[] | undefined;
                if (p.serialTracked) {
                  const avail = serials.find((x) => x.productId === p.id && x.status === 'in-stock' && !soldSerials.has(x.id));
                  if (!avail || rng.chance(0.4)) return null;
                  soldSerials.add(avail.id);
                  avail.status = 'sold';
                  serialsPicked = [avail.serial];
                }
                return { productId: p.id, qty: p.weighted ? Math.round((0.25 + rng.next() * 2) * 1000) / 1000 : p.serialTracked ? 1 : rng.int(1, 3), batchId: b?.id, serials: serialsPicked, lineDiscountPct: rng.chance(0.06) ? 5 : 0 };
              })
              .filter((x): x is NonNullable<typeof x> => !!x);
            if (!inputs.length) continue;
            const customer = rng.chance(0.45) ? rng.pick(tCustomers) : undefined;
            const interState = !!customer?.stateCode && customer.stateCode !== s.stateCode;
            const billDisc = rng.chance(0.05) ? 5 : 0;
            const cart = computeCart(inputs, billDisc, { products: productMap, taxRates: taxMap, batches: batchMap, interState });
            if (!cart.lines.length) continue;
            const saleId = `sa-${tid}-${sales.length + 1}`;
            const docNo = nextDoc('INV', c, at);
            const methodRoll = rng.next();
            const method: TenderMethod = customer && customer.creditLimitPaise > 0 && methodRoll > 0.94 ? 'credit' : methodRoll < 0.45 ? 'cash' : methodRoll < 0.8 ? 'upi' : 'card';
            const received = method === 'cash' ? Math.ceil(cart.totalPaise / 10000) * 10000 : undefined;
            const tenders: Tender[] = [{ id: `${saleId}-t1`, saleId, method, amountPaise: cart.totalPaise, receivedPaise: received, changePaise: received ? received - cart.totalPaise : undefined, reference: method === 'upi' ? `UPI${rng.int(100000000, 999999999)}` : method === 'card' ? `XXXX${rng.int(1000, 9999)}` : undefined, confirmation: method === 'cash' || method === 'credit' ? 'n/a' : 'provider' }];
            if (method === 'cash') cashSales += cart.totalPaise;
            const offlineDevice = dev.status === 'offline' && isToday;
            const sale: Sale = {
              id: saleId, documentNo: docNo, kind: 'retail', status: method === 'credit' ? 'partially-paid' : 'paid', tenantId: tid, storeId: s.id, counterId: c.id, deviceId: dev.id, userId: shiftUser.id, shiftId: shift.id,
              businessDate: isoDay(day0), customerId: customer?.id, customerName: customer?.name,
              lines: cart.lines.map((l, i) => ({ ...l, id: `${saleId}-l${i + 1}`, saleId })), tenders,
              itemCount: cart.itemCount, grossPaise: cart.grossPaise, lineDiscountPaise: cart.lineDiscountPaise, billDiscountPaise: cart.billDiscountPaise, taxablePaise: cart.taxablePaise, taxPaise: cart.taxPaise,
              roundOffPaise: cart.roundOffPaise, totalPaise: cart.totalPaise, savingsPaise: cart.savingsPaise, interState, taxSummary: cart.taxSummary,
              createdAt: iso(at - 45000), committedAt: iso(at), syncState: offlineDevice ? 'pending' : 'synced', syncedAt: offlineDevice ? undefined : iso(at + 4000), printed: true,
              loyaltyEarned: customer && tenant.addOns.includes('loyalty') ? Math.floor(cart.totalPaise / 10000) : customer ? Math.floor(cart.totalPaise / 10000) : undefined,
            };
            sales.push(sale);
            sale.lines.forEach((l) => mv({ tenantId: tid, storeId: s.id, productId: l.productId, batchId: l.batchId, type: 'sale_out', qty: -l.qty, sourceType: 'sale', sourceId: sale.id, sourceLineNo: l.lineNo, userId: sale.userId, deviceId: sale.deviceId, createdAt: sale.committedAt }));
            serials.filter((x) => sale.lines.some((l) => l.serials?.includes(x.serial))).forEach((x) => (x.saleId = sale.id));
            if (isToday || d === 1) {
              auditEvents.push({ id: `au-${sale.id}`, tenantId: tid, storeId: s.id, counterId: c.id, deviceId: dev.id, shiftId: shift.id, actorId: sale.userId, action: 'sale.completed', entity: 'sale', entityId: sale.id, documentNo: docNo, summary: `Invoice ${docNo} committed locally`, category: 'business', createdAt: sale.committedAt });
            }
          }
          if (isOpenShiftToday) {
            const ctx = { tenantId: tid, storeId: s.id, counterId: c.id, deviceId: dev.id, userId: shiftUser.id, shiftId: shift.id, businessDate: shift.businessDate };
            cashMovements.push({ ...ctx, id: `cm-${shift.id}-open`, type: 'opening', amountPaise: shift.openingCash, createdAt: shift.openedAt });
            sales.filter((x) => x.shiftId === shift.id).forEach((x) => x.tenders.filter((t) => t.method === 'cash').forEach((t) => cashMovements.push({ ...ctx, id: `cm-${x.id}`, type: 'cash_sale', amountPaise: t.amountPaise, reference: x.documentNo, createdAt: x.committedAt })));
            cashMovements.push({ ...ctx, id: `cm-${shift.id}-petty`, type: 'petty_paid', amountPaise: -15000, note: 'Tea & snacks for staff', createdAt: iso(shiftOpen + 2 * 3600000) });
            auditEvents.push({ id: `au-${shift.id}`, tenantId: tid, storeId: s.id, counterId: c.id, deviceId: dev.id, shiftId: shift.id, actorId: shiftUser.id, action: 'shift.opened', entity: 'shift', entityId: shift.id, summary: `Shift ${shift.code} opened with ₹5,000.00`, category: 'business', createdAt: shift.openedAt });
          } else {
            const expected = shift.openingCash + cashSales;
            const v = rng.chance(0.18) ? rng.pick([-5000, -2000, 1000, -12000, 500]) : 0;
            Object.assign(shift, {
              status: 'closed', closedAt: iso(day0 + 21 * 3600000), closedBy: shift.openedBy, expectedCash: expected, closingCash: expected + v, variance: v,
              varianceReason: v ? (v < 0 ? 'Change shortage' : 'Excess from rounding') : undefined, varianceApprovedBy: Math.abs(v) > 10000 ? `u-${tid}-mgr` : undefined,
            });
          }
        }
      }
    }

    // A few returns with stock effects
    const tSales = sales.filter((x) => x.tenantId === tid && x.businessDate < isoDay(TODAY0));
    for (let i = 0; i < 5 && tSales.length; i++) {
      const sale = rng.pick(tSales);
      const line = sale.lines[0]!;
      const restock = i % 3 !== 0;
      const counter = allCounters.find((c) => c.id === sale.counterId)!;
      const at = new Date(sale.committedAt).getTime() + 2 * DAY;
      if (at > NOW) continue;
      const qty = line.qty;
      const ret: SaleReturn = {
        id: `rt-${tid}-${i + 1}`, documentNo: nextDoc('RET', counter, at), originalSaleId: sale.id, originalDocumentNo: sale.documentNo,
        lines: [{ saleLineId: line.id, productId: line.productId, name: line.name, qty, refundPaise: line.netPaise, restockable: restock, reason: restock ? 'Customer changed mind' : 'Damaged packaging' }],
        refundPaise: line.netPaise, refundMethod: sale.tenders[0]!.method === 'credit' ? 'credit' : 'cash', approvedBy: `u-${tid}-mgr`,
        tenantId: tid, storeId: sale.storeId, counterId: sale.counterId, deviceId: sale.deviceId, userId: sale.userId, shiftId: sale.shiftId, businessDate: isoDay(at), createdAt: iso(at), syncState: 'synced',
      };
      line.returnedQty = qty;
      sale.status = 'returned';
      returns.push(ret);
      mv({ tenantId: tid, storeId: sale.storeId, productId: line.productId, batchId: line.batchId, type: restock ? 'sale_return_restock' : 'sale_return_damaged', qty: restock ? qty : -qty, sourceType: 'return', sourceId: ret.id, sourceLineNo: 1, createdAt: ret.createdAt });
    }

    // Stock adjustments
    for (let i = 0; i < 4; i++) {
      const p = rng.pick(tProducts.filter((pp) => !pp.serialTracked));
      const at = TODAY0 - rng.int(1, 20) * DAY + 11 * 3600000;
      const reason = rng.pick(['damage', 'expiry', 'count-correction', 'theft'] as const);
      const wanted = reason === 'count-correction' && i % 2 ? 2 : -rng.int(1, 4);
      const qty = wanted < 0 ? -Math.min(-wanted, Math.max(0, Math.floor(avail(s0.id, p.id)))) : wanted;
      if (qty === 0) continue;
      const adj: StockAdjustment = { id: `adj-${tid}-${i + 1}`, tenantId: tid, storeId: s0.id, documentNo: nextDoc('ADJ', purCounter, at), productId: p.id, qty, reason, note: reason === 'damage' ? 'Found broken during shelf audit' : undefined, userId: `u-${tid}-inv`, approvedBy: `u-${tid}-mgr`, createdAt: iso(at) };
      adjustments.push(adj);
      mv({ tenantId: tid, storeId: s0.id, productId: p.id, type: qty > 0 ? 'adjustment_in' : 'adjustment_out', qty, sourceType: 'adjustment', sourceId: adj.id, reason, userId: adj.userId, createdAt: adj.createdAt });
    }

    // Customer receipts against credit
    tCustomers.filter((c) => c.outstandingPaise > 0).slice(0, 4).forEach((c, i) => {
      const at = TODAY0 - (i + 2) * DAY + 15 * 3600000;
      payments.push({ id: `rc-${c.id}`, tenantId: tid, partyType: 'customer', partyId: c.id, documentNo: nextDoc('PAY', { id: `rc-${s0.id}`, code: s0.code }, at), amountPaise: Math.round(c.outstandingPaise / 3 / 100) * 100, method: 'upi', createdAt: iso(at), userId: `u-${tid}-mgr` });
    });
  }

  // Restaurant historical sales
  const rTid = TENANT_IDS.spice;
  const rStore = allStores.find((s) => s.tenantId === rTid)!;
  const rCounter = allCounters.find((c) => c.storeId === rStore.id && c.kind === 'billing')!;
  const rDev = devices.find((d) => d.counterId === rCounter.id)!;
  // Today's service runs on the second billing counter (C02) so POS counter C01 starts with a clean shift flow.
  const rCounterToday = allCounters.filter((c) => c.storeId === rStore.id && c.kind === 'billing')[1] ?? rCounter;
  const rDevToday = devices.find((d) => d.counterId === rCounterToday.id) ?? rDev;
  for (let d = HISTORY_DAYS; d >= 0; d--) {
    const day0 = TODAY0 - d * DAY;
    const isToday = d === 0;
    const counter = isToday ? rCounterToday : rCounter;
    const dev = isToday ? rDevToday : rDev;
    const shiftId = `sh-${counter.id}-${isoDay(day0)}`;
    let cashSales = 0;
    const sinceOpen = Math.max(0, NOW - (day0 + 7 * 3600000));
    const count = isToday ? Math.min(30, Math.floor(sinceOpen / (25 * 60000))) : rng.int(24, 40);
    for (let k = 0; k < count; k++) {
      const lunch = k < count * 0.45;
      const at = isToday ? day0 + 7 * 3600000 + Math.floor(((k + rng.next()) / Math.max(1, count)) * (sinceOpen - 120000)) : day0 + (lunch ? 12 : 19) * 3600000 + rng.int(0, 150) * 60000;
      if (at > NOW - 60000) continue;
      const items = rng.shuffle(menuItems.filter((m) => m.available)).slice(0, rng.int(2, 6));
      const ol = items.map((m, i) => ({ id: `${i}`, menuItemId: m.id, name: m.name, qty: rng.int(1, 3), unitPricePaise: m.pricePaise, modifiers: [], state: 'served' as const, stationId: m.stationId, foodType: m.foodType }));
      const tot = orderTotals(ol, 0, 5);
      const saleId = `sa-${rTid}-${sales.length + 1}`;
      const lines: SaleLine[] = ol.map((l, i) => {
        const gross = l.qty * l.unitPricePaise;
        const g = computeGst(gross, 5, false, false);
        return { id: `${saleId}-l${i + 1}`, saleId, lineNo: i + 1, productId: l.menuItemId, name: l.name, barcode: '', hsn: '996331', unit: 'pcs', qty: l.qty, mrpPaise: l.unitPricePaise, unitPricePaise: l.unitPricePaise, grossPaise: gross, discountPaise: 0, taxablePaise: g.taxablePaise, taxRatePct: 5, cgstPaise: g.cgstPaise, sgstPaise: g.sgstPaise, igstPaise: 0, netPaise: gross + g.taxPaise, returnedQty: 0 };
      });
      const method: TenderMethod = rng.next() < 0.35 ? 'cash' : rng.next() < 0.7 ? 'upi' : 'card';
      if (method === 'cash') cashSales += tot.totalPaise;
      sales.push({
        id: saleId, documentNo: nextDoc('INV', counter, at), kind: 'restaurant', status: 'paid', tenantId: rTid, storeId: rStore.id, counterId: counter.id, deviceId: dev.id, userId: `u-${rTid}-arun`, shiftId, businessDate: isoDay(day0),
        lines, tenders: [{ id: `${saleId}-t1`, saleId, method, amountPaise: tot.totalPaise, confirmation: method === 'cash' ? 'n/a' : 'provider' }], itemCount: tot.itemCount, grossPaise: tot.subtotalPaise, lineDiscountPaise: 0, billDiscountPaise: 0,
        taxablePaise: tot.taxablePaise, taxPaise: tot.taxPaise, roundOffPaise: tot.roundOffPaise, totalPaise: tot.totalPaise, savingsPaise: 0, interState: false,
        taxSummary: [{ ratePct: 5, taxablePaise: tot.taxablePaise, cgstPaise: tot.cgstPaise, sgstPaise: tot.sgstPaise, igstPaise: 0 }], createdAt: iso(at - 3600000), committedAt: iso(at), syncState: 'synced', syncedAt: iso(at + 3000), printed: true,
      });
    }
    const baseShift = { id: shiftId, code: `SH-${String(200 + shifts.length).padStart(3, '0')}`, tenantId: rTid, storeId: rStore.id, counterId: counter.id, deviceId: dev.id, openedBy: `u-${rTid}-arun`, businessDate: isoDay(day0), openingDenominations: [{ denomination: 50000, count: 6 }], openingCash: 300000 };
    shifts.push(isToday
      ? { ...baseShift, openedAt: iso(day0 + 7 * 3600000), status: 'open' }
      : { ...baseShift, closedBy: `u-${rTid}-arun`, openedAt: iso(day0 + 11 * 3600000), closedAt: iso(day0 + 23 * 3600000), expectedCash: 300000 + cashSales, closingCash: 300000 + cashSales, variance: 0, status: 'closed' });
  }

  // Platform-side records
  const approvals: ApprovalRequest[] = [
    { id: 'ap-1', tenantId: TENANT_IDS.abc, storeId: `s-${TENANT_IDS.abc}-1`, counterId: `c-s-${TENANT_IDS.abc}-1-2`, action: 'discount', requestedBy: `u-${TENANT_IDS.abc}-arun`, summary: 'Bill discount 18%', detail: 'Bulk purchase by regular customer Balaji Krishnan — cashier limit 10%', requestedValue: 18, allowedValue: 10, amountPaise: 486000, status: 'pending', createdAt: iso(NOW - 2 * 60000) },
    { id: 'ap-2', tenantId: TENANT_IDS.abc, storeId: `s-${TENANT_IDS.abc}-2`, action: 'return-no-invoice', requestedBy: `u-${TENANT_IDS.abc}-meena`, summary: 'Return without invoice', detail: 'Surf Excel 1kg × 1 — customer lost receipt', amountPaise: 13800, status: 'pending', createdAt: iso(NOW - 11 * 60000) },
    { id: 'ap-3', tenantId: TENANT_IDS.abc, storeId: `s-${TENANT_IDS.abc}-1`, action: 'shift-variance', requestedBy: `u-${TENANT_IDS.abc}-meena`, summary: 'Shift variance −₹180.00', detail: 'Counter C03 close — change shortage', amountPaise: -18000, status: 'pending', createdAt: iso(NOW - 40 * 60000) },
    { id: 'ap-4', tenantId: TENANT_IDS.abc, storeId: `s-${TENANT_IDS.abc}-1`, action: 'price-override', requestedBy: `u-${TENANT_IDS.abc}-arun`, summary: 'Price override Tata Tea Gold', detail: '₹289 → ₹270 matching flyer promotion', status: 'approved', decidedBy: `u-${TENANT_IDS.abc}-mgr`, decidedAt: iso(NOW - 3 * 3600000), createdAt: iso(NOW - 3 * 3600000 - 60000) },
    { id: 'ap-5', tenantId: TENANT_IDS.spice, storeId: `s-${TENANT_IDS.spice}-1`, action: 'kot-void', requestedBy: `u-${TENANT_IDS.spice}-ravi`, summary: 'Void KOT item — Table A08', detail: 'Chettinad Chicken Curry × 1 — customer changed order', amountPaise: 34000, status: 'pending', createdAt: iso(NOW - 4 * 60000) },
    { id: 'ap-6', tenantId: TENANT_IDS.spice, storeId: `s-${TENANT_IDS.spice}-1`, action: 'discount', requestedBy: `u-${TENANT_IDS.spice}-arun`, summary: 'Bill discount 15% — Table B04', detail: 'Delay compensation for 40-min wait', requestedValue: 15, allowedValue: 10, amountPaise: 214000, status: 'pending', createdAt: iso(NOW - 7 * 60000) },
    { id: 'ap-7', tenantId: TENANT_IDS.trendz, storeId: `s-${TENANT_IDS.trendz}-1`, action: 'discount', requestedBy: `u-${TENANT_IDS.trendz}-arun`, summary: 'Line discount 25% Denim Jacket', detail: 'Minor stain on sleeve', requestedValue: 25, allowedValue: 10, amountPaise: 299900, status: 'pending', createdAt: iso(NOW - 15 * 60000) },
  ];

  const syncConflicts: SyncConflict[] = [
    { id: 'sc-1', tenantId: TENANT_IDS.abc, deviceId: `d-c-s-${TENANT_IDS.abc}-1-3`, storeId: `s-${TENANT_IDS.abc}-1`, entity: 'stock_movement', entityId: 'mv-x1', documentNo: 'INV/26-27/C03/001422', reasonCode: 'STOCK_NEGATIVE_POLICY', reason: 'Sale posted offline drove Fortune Sunflower Oil 1L to −2 at store level.', state: 'open', createdAt: iso(NOW - 26 * 60000) },
    { id: 'sc-2', tenantId: TENANT_IDS.wellness, deviceId: `d-c-s-${TENANT_IDS.wellness}-1-2`, storeId: `s-${TENANT_IDS.wellness}-1`, entity: 'sale', entityId: 'sa-x2', documentNo: 'INV/26-27/C02/001201', reasonCode: 'PRICE_VERSION_STALE', reason: 'Sale priced with config v39; cloud price v42 effective since 06 Oct.', state: 'open', createdAt: iso(NOW - 3 * 3600000) },
    { id: 'sc-3', tenantId: 't-tandoor', deviceId: 'd-c-s-t-tandoor-1-1', storeId: 's-t-tandoor-1', entity: 'customer', entityId: 'cu-x3', reasonCode: 'CUSTOMER_MERGE_REQUIRED', reason: 'Same phone registered on two devices offline with different names.', state: 'open', createdAt: iso(NOW - 5 * 3600000) },
    { id: 'sc-4', tenantId: TENANT_IDS.abc, deviceId: `d-c-s-${TENANT_IDS.abc}-2-1`, storeId: `s-${TENANT_IDS.abc}-2`, entity: 'shift', entityId: 'sh-x4', reasonCode: 'SHIFT_OVERLAP', reason: 'Shift close received after reopen on another device.', state: 'resolved', resolution: 'Kept origin close; reopen logged as correction.', resolvedBy: 'u-t-platform-admin', createdAt: iso(NOW - 2 * DAY) },
  ];

  const edgeNodes: EdgeNode[] = allStores.filter((s) => s.edgeEnabled).map((s, i) => ({
    id: `edge-${s.id}`, tenantId: s.tenantId, storeId: s.id, version: '1.2.1', uptimeHours: 214 + i * 31, connectedDevices: devices.filter((d) => d.storeId === s.id && d.kind !== 'store-edge').length,
    wanState: i === 1 ? 'down' : 'up', cloudCheckpointAt: iso(NOW - (i === 1 ? 42 * 60000 : 20000)), queueCount: i === 1 ? 64 : 3, queueAgeSec: i === 1 ? 2520 : 12, kdsLagMs: 40 + i * 25, diskFreePct: 71 - i * 20, lastBackupAt: iso(NOW - (2 + i) * 3600000),
    status: i === 1 ? 'degraded' : 'healthy',
  }));

  const tickets: SupportTicket[] = [
    { id: 'tk-1041', tenantId: TENANT_IDS.abc, subject: 'Counter C03 receipt printer not detected', priority: 'high', status: 'in-progress', createdAt: iso(NOW - 3 * 3600000), assignee: 'Rahul Dev' },
    { id: 'tk-1040', tenantId: TENANT_IDS.wellness, subject: 'Price version mismatch on KK Nagar C02', priority: 'medium', status: 'open', createdAt: iso(NOW - 5 * 3600000) },
    { id: 'tk-1039', tenantId: 't-fresh', subject: 'Renewal payment failed — grace period', priority: 'urgent', status: 'waiting', createdAt: iso(NOW - DAY), assignee: 'Nisha Varma' },
    { id: 'tk-1038', tenantId: 't-bean', subject: 'Help configuring KDS stations', priority: 'low', status: 'open', createdAt: iso(NOW - 2 * DAY) },
    { id: 'tk-1037', tenantId: TENANT_IDS.spice, subject: 'Store Edge WAN flapping in evenings', priority: 'medium', status: 'resolved', createdAt: iso(NOW - 4 * DAY), assignee: 'Rahul Dev' },
  ];

  // Platform/security audit
  auditEvents.push(
    { id: 'au-p1', tenantId: TENANT_IDS.abc, actorId: 'u-t-platform-admin', action: 'device.activated', entity: 'device', entityId: `d-c-s-${TENANT_IDS.abc}-1-4`, summary: 'Device POS-04 activated for Anna Nagar C04', category: 'security', createdAt: iso(NOW - 6 * DAY) },
    { id: 'au-p2', tenantId: 't-style', actorId: 'u-t-platform-admin', action: 'subscription.suspended', entity: 'tenant', entityId: 't-style', summary: 'Subscription suspended after 21 days overdue', category: 'security', createdAt: iso(NOW - DAY) },
    { id: 'au-p3', tenantId: TENANT_IDS.abc, actorId: `u-${TENANT_IDS.abc}-arun`, approvedBy: `u-${TENANT_IDS.abc}-mgr`, action: 'override.price', entity: 'sale', entityId: 'x', summary: 'Price override Tata Tea Gold ₹289 → ₹270', reason: 'Flyer promotion', category: 'business', createdAt: iso(NOW - 3 * 3600000) },
    { id: 'au-p4', tenantId: TENANT_IDS.wellness, actorId: 'u-t-platform-support', action: 'sync.quarantine.viewed', entity: 'sync_conflict', entityId: 'sc-2', summary: 'Support viewed quarantined sale INV/26-27/C02/001201', category: 'technical', createdAt: iso(NOW - 2 * 3600000) },
    { id: 'au-p5', tenantId: 't-metro', actorId: 'u-t-platform-admin', action: 'addon.enabled', entity: 'tenant', entityId: 't-metro', summary: 'Add-on Integrations & APIs enabled', category: 'security', createdAt: iso(NOW - 9 * DAY) },
  );

  return { sales, stockMovements, purchases, shifts, cashMovements, payments, returns, adjustments, auditEvents, approvals, syncConflicts, edgeNodes, tickets, counterSeq };
}

export type HistoryBundle = ReturnType<typeof buildHistory>;
