import { create } from 'zustand';
import type { Batch, CartLineInput, Customer, HeldCart, Product, SaleLine, SessionContext, TaxRate } from '@elixir/contracts';
import { computeCart, priceLine, type CartTotals, type PricingContext } from '@elixir/domain';
import { derived, onHand, type LocalDatabase } from '@elixir/local-store';

export interface CartLine extends CartLineInput {
  key: string;
  /** Prescription confirmation captured at the counter. */
  rx?: { doctor: string; ref: string };
  /** Manager allowed selling beyond on-hand stock (FR-RET-016 override). */
  negativeApprovedBy?: string;
}

interface CartState {
  lines: CartLine[];
  billDiscountPct: number;
  customerId?: string;
  priceMode: 'retail' | 'wholesale';
  approvedBy?: string;
  selected: number;
  resumedFrom?: string;
  add: (line: Omit<CartLine, 'key'>, merge?: boolean) => void;
  update: (key: string, patch: Partial<CartLine>) => void;
  remove: (key: string) => void;
  select: (i: number) => void;
  setBillDiscount: (pct: number, approvedBy?: string) => void;
  setCustomer: (id?: string) => void;
  setPriceMode: (m: 'retail' | 'wholesale') => void;
  setApprovedBy: (id?: string) => void;
  clear: () => void;
  load: (h: HeldCart) => void;
}

let seq = 0;
const key = () => `ln${Date.now().toString(36)}${(seq++).toString(36)}`;

export const useCart = create<CartState>((set) => ({
  lines: [],
  billDiscountPct: 0,
  priceMode: 'retail',
  selected: -1,
  add: (line, merge = true) =>
    set((s) => {
      const idx = merge && !line.serials?.length ? s.lines.findIndex((l) => l.productId === line.productId && l.batchId === line.batchId && (l.unit ?? '') === (line.unit ?? '') && !l.serials?.length) : -1;
      if (idx >= 0) {
        const lines = s.lines.map((l, i) => (i === idx ? { ...l, qty: Math.round((l.qty + line.qty) * 1000) / 1000 } : l));
        return { lines, selected: idx };
      }
      return { lines: [...s.lines, { ...line, key: key() }], selected: s.lines.length };
    }),
  update: (k, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === k ? { ...l, ...patch } : l)) })),
  remove: (k) =>
    set((s) => {
      const lines = s.lines.filter((l) => l.key !== k);
      return { lines, selected: Math.min(s.selected, lines.length - 1) };
    }),
  select: (i) => set((s) => ({ selected: Math.max(-1, Math.min(i, s.lines.length - 1)) })),
  setBillDiscount: (pct, approvedBy) => set((s) => ({ billDiscountPct: pct, approvedBy: approvedBy ?? s.approvedBy })),
  setCustomer: (id) => set({ customerId: id }),
  setPriceMode: (m) => set({ priceMode: m }),
  setApprovedBy: (id) => set({ approvedBy: id }),
  clear: () => set({ lines: [], billDiscountPct: 0, customerId: undefined, approvedBy: undefined, selected: -1, resumedFrom: undefined, priceMode: 'retail' }),
  load: (h) =>
    set({
      lines: h.lines.map((l) => ({ ...l, key: key() })),
      billDiscountPct: h.billDiscountPct,
      customerId: h.customerId,
      approvedBy: undefined,
      selected: h.lines.length - 1,
      resumedFrom: h.id,
    }),
}));

/** Memoised lookup maps for pricing (recomputed only when the collections change). */
export function pricingMaps(db: LocalDatabase, tenantId: string) {
  const products = derived(db, `pmap:${tenantId}`, ['products'], () => new Map<string, Product>(db.where('products', (p) => p.tenantId === tenantId).map((p) => [p.id, p])));
  const taxRates = derived(db, 'taxmap', ['taxRates'], () => new Map<string, TaxRate>(db.all('taxRates').map((t) => [t.id, t])));
  const batches = derived(db, 'batchmap', ['batches'], () => new Map<string, Batch>(db.all('batches').map((b) => [b.id, b])));
  return { products, taxRates, batches };
}

export function pricingContext(db: LocalDatabase, s: SessionContext, customer: Customer | undefined, priceMode: 'retail' | 'wholesale'): PricingContext {
  const maps = pricingMaps(db, s.tenant.id);
  const pg = customer?.priceGroupId ? db.get('priceGroups', customer.priceGroupId) : undefined;
  return { ...maps, interState: !!customer?.stateCode && customer.stateCode !== s.store.stateCode, priceMode, priceGroupDiscountPct: pg?.discountPct };
}

export interface LineView {
  line: CartLine;
  product?: Product;
  priced?: SaleLine;
  error?: string;
  stock: number;
  stockShort: boolean;
}

export interface CartView {
  totals: CartTotals;
  rows: LineView[];
  blocking: string[];
}

/** Price every line (inline errors) + full bill totals. */
export function evaluateCart(db: LocalDatabase, s: SessionContext, lines: CartLine[], billDiscountPct: number, customer: Customer | undefined, priceMode: 'retail' | 'wholesale'): CartView {
  const ctx = pricingContext(db, s, customer, priceMode);
  const totals = computeCart(lines, billDiscountPct, ctx);
  const byLineNo = new Map(totals.lines.map((l) => [l.lineNo, l]));
  const blocking: string[] = [];
  const rows: LineView[] = lines.map((line, i) => {
    const product = ctx.products instanceof Map ? ctx.products.get(line.productId) : undefined;
    let error: string | undefined;
    try {
      priceLine(line, i + 1, ctx);
    } catch (e) {
      error = (e as Error).message;
    }
    const batch = line.batchId ? (ctx.batches as Map<string, Batch>).get(line.batchId) : undefined;
    if (!error && batch && new Date(batch.expiryDate).getTime() < Date.now()) error = `Batch ${batch.code} expired on ${batch.expiryDate}. Pick another batch.`;
    if (!error && product?.serialTracked && (line.serials?.length ?? 0) !== line.qty) error = `Select ${line.qty} serial/IMEI number(s) for ${product.name}.`;
    if (!error && product?.prescriptionRequired && !line.rx) error = `Prescription details required for ${product.name}.`;
    const stock = onHand(db, s.store.id, line.productId, line.batchId);
    const sameProductQty = lines.filter((l) => l.productId === line.productId && l.batchId === line.batchId).reduce((a, l) => a + l.qty, 0);
    const stockShort = sameProductQty > stock && !line.negativeApprovedBy;
    if (error) blocking.push(error);
    else if (stockShort) blocking.push(`${product?.name ?? 'Item'}: only ${Math.max(0, stock)} in stock.`);
    return { line, product, priced: error ? undefined : byLineNo.get(i + 1), error, stock, stockShort };
  });
  return { totals, rows, blocking };
}
