import type { StockLevel, StockMovement, StockMovementType } from '@elixir/contracts';

/** Sign convention for each movement type (LLD §6 stock invariant). */
export const MOVEMENT_SIGN: Record<StockMovementType, 1 | -1> = {
  opening: 1,
  purchase_in: 1,
  purchase_return: -1,
  sale_out: -1,
  sale_return_restock: 1,
  sale_return_damaged: 1, // goes to damaged bucket, not sellable
  adjustment_in: 1,
  adjustment_out: -1,
  transfer_in: 1,
  transfer_out: -1,
  repack_input: -1,
  repack_output: 1,
  restaurant_consumption: -1,
};

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  opening: 'Opening',
  purchase_in: 'Purchase',
  purchase_return: 'Purchase return',
  sale_out: 'Sale',
  sale_return_restock: 'Sale return (restock)',
  sale_return_damaged: 'Sale return (damaged)',
  adjustment_in: 'Adjustment in',
  adjustment_out: 'Adjustment out',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  repack_input: 'Repack input',
  repack_output: 'Repack output',
  restaurant_consumption: 'Consumption',
};

/**
 * Project stock levels from the immutable ledger. Stock is never stored without a movement.
 * Key = `${storeId}|${productId}|${batchId ?? ''}`.
 */
export function projectStock(movements: Iterable<StockMovement>): Map<string, StockLevel> {
  const out = new Map<string, StockLevel>();
  for (const m of movements) {
    const key = `${m.storeId}|${m.productId}|${m.batchId ?? ''}`;
    const cur = out.get(key) ?? { productId: m.productId, storeId: m.storeId, batchId: m.batchId, onHand: 0, reserved: 0, damaged: 0, inTransit: 0 };
    if (m.type === 'sale_return_damaged') cur.damaged += Math.abs(m.qty);
    else cur.onHand += m.qty;
    out.set(key, cur);
  }
  return out;
}

/** Product-level (all batches) on-hand for a store. */
export function onHandByProduct(movements: Iterable<StockMovement>, storeId?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of movements) {
    if (storeId && m.storeId !== storeId) continue;
    if (m.type === 'sale_return_damaged') continue;
    out.set(m.productId, (out.get(m.productId) ?? 0) + m.qty);
  }
  return out;
}

/** closing = opening + Σ signed movements — used by reconciliation reports. */
export function closingBalance(opening: number, movements: StockMovement[]): number {
  return movements.reduce((s, m) => (m.type === 'sale_return_damaged' ? s : s + m.qty), opening);
}

/** Signed qty for a movement type given a positive magnitude. */
export function signedQty(type: StockMovementType, magnitude: number): number {
  return MOVEMENT_SIGN[type] * Math.abs(magnitude);
}

export type StockHealth = 'out' | 'low' | 'ok';
export function stockHealth(onHand: number, reorderLevel: number): StockHealth {
  if (onHand <= 0) return 'out';
  if (onHand <= reorderLevel) return 'low';
  return 'ok';
}

export type ExpiryHealth = 'expired' | 'near' | 'ok';
export function expiryHealth(expiryDate: string, nearDays = 60, now = Date.now()): ExpiryHealth {
  const d = Math.ceil((new Date(expiryDate).getTime() - now) / 86400000);
  if (d < 0) return 'expired';
  if (d <= nearDays) return 'near';
  return 'ok';
}

/** FEFO batch pick: earliest non-expired expiry with stock. */
export function pickBatchFefo<T extends { id: string; expiryDate: string }>(batches: T[], stockOf: (batchId: string) => number, now = Date.now()): T | undefined {
  return [...batches]
    .filter((b) => new Date(b.expiryDate).getTime() >= now && stockOf(b.id) > 0)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
}
