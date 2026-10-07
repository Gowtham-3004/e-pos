import type { Batch, CartLineInput, Paise, Product, SaleLine, TaxRate, TaxSummaryRow, Unit } from '@elixir/contracts';
import { computeGst, summarizeTax, roundPaise } from './tax';

export class PricingError extends Error {
  constructor(public code: 'ABOVE_MRP' | 'QTY_INVALID' | 'PRODUCT_INACTIVE' | 'SERIAL_REQUIRED' | 'BATCH_EXPIRED' | 'DISCOUNT_LIMIT', message: string) {
    super(message);
  }
}

export interface PricingContext {
  products: Map<string, Product> | Record<string, Product>;
  taxRates: Map<string, TaxRate> | Record<string, TaxRate>;
  batches?: Map<string, Batch> | Record<string, Batch>;
  interState: boolean;
  priceMode?: 'retail' | 'wholesale';
  priceGroupDiscountPct?: number;
  today?: string;
}

function get<T>(m: Map<string, T> | Record<string, T> | undefined, k: string | undefined): T | undefined {
  if (!m || !k) return undefined;
  return m instanceof Map ? m.get(k) : m[k];
}

/** Effective unit price respecting UOM, price mode and price group. */
export function unitPriceFor(p: Product, line: Pick<CartLineInput, 'unit' | 'unitPricePaise'>, ctx: Pick<PricingContext, 'priceMode' | 'priceGroupDiscountPct'>): Paise {
  if (line.unitPricePaise != null) return line.unitPricePaise;
  if (line.unit && line.unit !== p.unit && p.uomConversions) {
    const conv = p.uomConversions.find((u) => u.unit === line.unit);
    if (conv) return conv.pricePaise;
  }
  let price = ctx.priceMode === 'wholesale' && p.wholesalePaise ? p.wholesalePaise : p.salePaise;
  if (ctx.priceGroupDiscountPct) price = roundPaise(price * (1 - ctx.priceGroupDiscountPct / 100));
  return price;
}

export function mrpFor(p: Product, batch?: Batch, unit?: Unit): Paise {
  if (unit && unit !== p.unit && p.uomConversions) {
    const conv = p.uomConversions.find((u) => u.unit === unit);
    if (conv) return roundPaise(p.mrpPaise * conv.factor);
  }
  return batch?.mrpPaise ?? p.mrpPaise;
}

/**
 * Price a single cart line. Enforces MRP cap (FR-RET-004 / FR-PRICE-002):
 * the effective unit price after discount may never exceed MRP.
 */
export function priceLine(input: CartLineInput, lineNo: number, ctx: PricingContext): SaleLine {
  const p = get(ctx.products, input.productId);
  if (!p) throw new PricingError('PRODUCT_INACTIVE', `Product not found: ${input.productId}`);
  if (!p.active) throw new PricingError('PRODUCT_INACTIVE', `${p.name} is inactive and cannot be sold.`);
  if (!(input.qty > 0)) throw new PricingError('QTY_INVALID', `Quantity must be greater than zero for ${p.name}.`);
  if (!p.decimalQty && !Number.isInteger(input.qty)) throw new PricingError('QTY_INVALID', `${p.name} is sold in whole units.`);
  const batch = get(ctx.batches, input.batchId);
  if (batch && batch.expiryDate < (ctx.today ?? new Date().toISOString().slice(0, 10))) {
    throw new PricingError('BATCH_EXPIRED', `Batch ${batch.code} of ${p.name} expired on ${batch.expiryDate}. Pick another batch.`);
  }
  const unit = input.unit ?? p.unit;
  const mrp = mrpFor(p, batch, unit);
  const unitPrice = unitPriceFor(p, input, ctx);
  if (mrp > 0 && unitPrice > mrp) {
    throw new PricingError('ABOVE_MRP', `Selling price cannot exceed MRP ${(mrp / 100).toFixed(2)} for ${p.name}.`);
  }
  const tax = get(ctx.taxRates, p.taxRateId);
  const ratePct = tax?.ratePct ?? 0;
  const gross = roundPaise(unitPrice * input.qty);
  const discount = roundPaise((gross * (input.lineDiscountPct ?? 0)) / 100);
  const afterDisc = gross - discount;
  const g = computeGst(afterDisc, ratePct, p.taxInclusive, ctx.interState);
  const net = p.taxInclusive ? afterDisc : afterDisc + g.taxPaise;
  const variantLabel = p.variantAttrs ? [p.variantAttrs.color, p.variantAttrs.size].filter(Boolean).join(' · ') : undefined;
  return {
    id: `${lineNo}`,
    saleId: '',
    lineNo,
    productId: p.id,
    name: p.name,
    barcode: p.barcode,
    hsn: p.hsn,
    batchId: batch?.id,
    batchCode: batch?.code,
    expiryDate: batch?.expiryDate,
    serials: input.serials,
    variantLabel: variantLabel || undefined,
    unit,
    qty: input.qty,
    mrpPaise: mrp,
    unitPricePaise: unitPrice,
    grossPaise: gross,
    discountPaise: discount,
    taxablePaise: g.taxablePaise,
    taxRatePct: ratePct,
    cgstPaise: g.cgstPaise,
    sgstPaise: g.sgstPaise,
    igstPaise: g.igstPaise,
    netPaise: net,
    returnedQty: 0,
  };
}

export interface CartTotals {
  lines: SaleLine[];
  itemCount: number;
  grossPaise: Paise;
  lineDiscountPaise: Paise;
  billDiscountPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  savingsPaise: Paise;
  taxSummary: TaxSummaryRow[];
  errors: Array<{ productId: string; code: string; message: string }>;
}

/**
 * Compute the full bill. Bill discount is allocated proportionally across lines and
 * taxable value is recomputed after allocation (FR-TAX-004). Total rounds to nearest rupee.
 */
export function computeCart(inputs: CartLineInput[], billDiscountPct: number, ctx: PricingContext): CartTotals {
  const errors: CartTotals['errors'] = [];
  const priced: SaleLine[] = [];
  inputs.forEach((inp, i) => {
    try {
      priced.push(priceLine(inp, i + 1, ctx));
    } catch (e) {
      const err = e as PricingError;
      errors.push({ productId: inp.productId, code: err.code ?? 'ERROR', message: err.message });
    }
  });

  const afterLineDisc = priced.reduce((s, l) => s + (l.grossPaise - l.discountPaise), 0);
  const billDiscountTotal = roundPaise((afterLineDisc * (billDiscountPct || 0)) / 100);
  let allocated = 0;
  const lines = priced.map((l, idx) => {
    if (!billDiscountTotal) return l;
    const base = l.grossPaise - l.discountPaise;
    const share = idx === priced.length - 1 ? billDiscountTotal - allocated : roundPaise((billDiscountTotal * base) / (afterLineDisc || 1));
    allocated += share;
    const p = get(ctx.products, l.productId)!;
    const amt = base - share;
    const g = computeGst(amt, l.taxRatePct, p.taxInclusive, ctx.interState);
    return {
      ...l,
      discountPaise: l.discountPaise + share,
      taxablePaise: g.taxablePaise,
      cgstPaise: g.cgstPaise,
      sgstPaise: g.sgstPaise,
      igstPaise: g.igstPaise,
      netPaise: p.taxInclusive ? amt : amt + g.taxPaise,
    };
  });

  const gross = lines.reduce((s, l) => s + l.grossPaise, 0);
  const lineDiscount = priced.reduce((s, l) => s + l.discountPaise, 0);
  const taxable = lines.reduce((s, l) => s + l.taxablePaise, 0);
  const tax = lines.reduce((s, l) => s + l.cgstPaise + l.sgstPaise + l.igstPaise, 0);
  const rawTotal = lines.reduce((s, l) => s + l.netPaise, 0);
  const total = Math.round(rawTotal / 100) * 100;
  const mrpValue = lines.reduce((s, l) => s + roundPaise(l.mrpPaise * l.qty), 0);
  return {
    lines,
    itemCount: lines.reduce((s, l) => s + (Number.isInteger(l.qty) ? l.qty : 1), 0),
    grossPaise: gross,
    lineDiscountPaise: lineDiscount,
    billDiscountPaise: billDiscountTotal,
    taxablePaise: taxable,
    taxPaise: tax,
    roundOffPaise: total - rawTotal,
    totalPaise: total,
    savingsPaise: Math.max(0, mrpValue - total),
    taxSummary: summarizeTax(lines),
    errors,
  };
}

/** Whether a discount needs manager approval given the role limit (Design System §29). */
export function discountNeedsApproval(requestedPct: number, roleLimitPct: number): boolean {
  return requestedPct > roleLimitPct;
}

/** Cash change for a tender. */
export function changeDue(receivedPaise: Paise, duePaise: Paise): Paise {
  return Math.max(0, receivedPaise - duePaise);
}

/** Quick-cash suggestions for the payment keypad. */
export function quickCashOptions(duePaise: Paise): Paise[] {
  const r = duePaise / 100;
  const notes = [10, 20, 50, 100, 200, 500, 2000];
  const out = new Set<number>([Math.ceil(r)]);
  for (const n of notes) {
    const v = Math.ceil(r / n) * n;
    if (v >= r) out.add(v);
  }
  return [...out].sort((a, b) => a - b).slice(0, 5).map((v) => v * 100);
}
