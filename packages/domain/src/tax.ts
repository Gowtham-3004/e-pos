import type { Paise, TaxSummaryRow } from '@elixir/contracts';

/** Banker-safe integer rounding of paise. */
export const roundPaise = (n: number): Paise => Math.round(n);

export interface TaxSplit {
  taxablePaise: Paise;
  taxPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

/**
 * Split an amount into taxable + GST (FR-TAX-003).
 * inclusive=true: amount already contains tax (Indian MRP retail norm).
 * interState=true → IGST, else CGST + SGST halves.
 */
export function computeGst(amountPaise: Paise, ratePct: number, inclusive: boolean, interState: boolean): TaxSplit {
  let taxable: number;
  let tax: number;
  if (inclusive) {
    taxable = roundPaise((amountPaise * 100) / (100 + ratePct));
    tax = amountPaise - taxable;
  } else {
    taxable = amountPaise;
    tax = roundPaise((amountPaise * ratePct) / 100);
  }
  if (interState) {
    return { taxablePaise: taxable, taxPaise: tax, cgstPaise: 0, sgstPaise: 0, igstPaise: tax };
  }
  const cgst = Math.floor(tax / 2);
  const sgst = tax - cgst;
  return { taxablePaise: taxable, taxPaise: tax, cgstPaise: cgst, sgstPaise: sgst, igstPaise: 0 };
}

export function summarizeTax(rows: Array<{ taxRatePct: number; taxablePaise: Paise; cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise }>): TaxSummaryRow[] {
  const map = new Map<number, TaxSummaryRow>();
  for (const r of rows) {
    const cur = map.get(r.taxRatePct) ?? { ratePct: r.taxRatePct, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    cur.taxablePaise += r.taxablePaise;
    cur.cgstPaise += r.cgstPaise;
    cur.sgstPaise += r.sgstPaise;
    cur.igstPaise += r.igstPaise;
    map.set(r.taxRatePct, cur);
  }
  return [...map.values()].sort((a, b) => a.ratePct - b.ratePct);
}

/** Interstate if store state differs from customer place-of-supply. */
export function isInterState(storeStateCode: string, customerStateCode?: string): boolean {
  return !!customerStateCode && customerStateCode !== storeStateCode;
}
