import type { CashMovement, DenominationCount, Paise } from '@elixir/contracts';

export const DENOMINATIONS: Paise[] = [200000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];

export function denominationTotal(counts: DenominationCount[]): Paise {
  return counts.reduce((s, c) => s + c.denomination * c.count, 0);
}

export function emptyDenominations(): DenominationCount[] {
  return DENOMINATIONS.map((d) => ({ denomination: d, count: 0 }));
}

/**
 * Expected Cash = Opening + Cash Sales + Cash Receipts + Petty Received − Petty Paid − Cash Refunds (FR-SHF-006).
 * Cash movements are stored signed, so expected = Σ amounts excluding closing.
 */
export function expectedCash(movements: CashMovement[]): Paise {
  return movements.filter((m) => m.type !== 'closing').reduce((s, m) => s + m.amountPaise, 0);
}

/** Variance = Actual − Expected (FR-SHF-007). */
export function variance(actual: Paise, expected: Paise): Paise {
  return actual - expected;
}

export function varianceNeedsApproval(v: Paise, thresholdPaise = 10000): boolean {
  return Math.abs(v) > thresholdPaise;
}

export interface CashBreakdown {
  opening: Paise;
  cashSales: Paise;
  cashReceipts: Paise;
  pettyReceived: Paise;
  pettyPaid: Paise;
  cashRefunds: Paise;
  expected: Paise;
}

export function cashBreakdown(movements: CashMovement[]): CashBreakdown {
  const sum = (t: CashMovement['type']) => movements.filter((m) => m.type === t).reduce((s, m) => s + m.amountPaise, 0);
  const b = {
    opening: sum('opening'),
    cashSales: sum('cash_sale'),
    cashReceipts: sum('cash_receipt'),
    pettyReceived: sum('petty_received'),
    pettyPaid: -sum('petty_paid'),
    cashRefunds: -sum('cash_refund'),
    expected: 0,
  };
  b.expected = b.opening + b.cashSales + b.cashReceipts + b.pettyReceived - b.pettyPaid - b.cashRefunds;
  return b;
}
