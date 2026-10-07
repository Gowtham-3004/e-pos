import type { StockMovement } from '@elixir/contracts';
import { derived, onHand, type LocalDatabase } from '@elixir/local-store';
import { stockHealth, type StockHealth } from '@elixir/domain';
import type { StatusMeta } from '@elixir/domain';

export const STOCK_HEALTH: Record<StockHealth, StatusMeta> = {
  ok: { label: 'In stock', tone: 'success', icon: 'CircleCheck' },
  low: { label: 'Low stock', tone: 'warning', icon: 'TriangleAlert' },
  out: { label: 'Out of stock', tone: 'danger', icon: 'CircleX' },
};

export const EXPIRY_HEALTH: Record<'expired' | 'near' | 'ok', StatusMeta> = {
  expired: { label: 'Expired', tone: 'danger', icon: 'CalendarX' },
  near: { label: 'Near expiry', tone: 'warning', icon: 'CalendarClock' },
  ok: { label: 'OK', tone: 'success', icon: 'CalendarCheck' },
};

/** On-hand for a product across a set of stores (from the movement ledger). */
export function onHandIn(db: LocalDatabase, storeIds: string[], productId: string, batchId?: string): number {
  return Math.round(storeIds.reduce((s, id) => s + onHand(db, id, productId, batchId), 0) * 1000) / 1000;
}

/** Damaged bucket (sale_return_damaged) keyed `${storeId}|${productId}`. */
export function damagedIndex(db: LocalDatabase): Map<string, number> {
  return derived(db, 'bo:damaged', ['stockMovements'], () => {
    const m = new Map<string, number>();
    for (const mv of db.all('stockMovements')) {
      if (mv.type !== 'sale_return_damaged') continue;
      const k = `${mv.storeId}|${mv.productId}`;
      m.set(k, (m.get(k) ?? 0) + Math.abs(mv.qty));
    }
    return m;
  });
}

export function damagedIn(db: LocalDatabase, storeIds: string[], productId: string): number {
  const idx = damagedIndex(db);
  return storeIds.reduce((s, id) => s + (idx.get(`${id}|${productId}`) ?? 0), 0);
}

export function healthOf(qty: number, reorder: number): StockHealth {
  return stockHealth(qty, reorder);
}

/** Movements grouped by product (memoised). */
export function movementsByProduct(db: LocalDatabase): Map<string, StockMovement[]> {
  return derived(db, 'bo:mvByProduct', ['stockMovements'], () => {
    const m = new Map<string, StockMovement[]>();
    for (const mv of db.all('stockMovements')) {
      const list = m.get(mv.productId);
      if (list) list.push(mv);
      else m.set(mv.productId, [mv]);
    }
    m.forEach((l) => l.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
    return m;
  });
}

export interface LedgerRow {
  mv: StockMovement;
  qtyIn: number;
  qtyOut: number;
  balance: number;
}

/**
 * Stock ledger for a product in a set of stores (LLD §6):
 * closing = opening + Σ in − Σ out (sale_return_damaged goes to the damaged bucket, not on-hand).
 */
export function ledger(db: LocalDatabase, storeIds: string[], productId: string, from?: string, to?: string) {
  const all = (movementsByProduct(db).get(productId) ?? []).filter((m) => storeIds.includes(m.storeId));
  let opening = 0;
  const rows: LedgerRow[] = [];
  let bal = 0;
  let totalIn = 0;
  let totalOut = 0;
  let damaged = 0;
  for (const mv of all) {
    const day = mv.createdAt.slice(0, 10);
    const counts = mv.type !== 'sale_return_damaged';
    if (from && day < from) {
      if (counts) opening += mv.qty;
      continue;
    }
    if (to && day > to) continue;
    if (rows.length === 0) bal = opening;
    if (!counts) {
      damaged += Math.abs(mv.qty);
      rows.push({ mv, qtyIn: 0, qtyOut: 0, balance: bal });
      continue;
    }
    bal = Math.round((bal + mv.qty) * 1000) / 1000;
    if (mv.qty >= 0) totalIn += mv.qty;
    else totalOut += -mv.qty;
    rows.push({ mv, qtyIn: mv.qty > 0 ? mv.qty : 0, qtyOut: mv.qty < 0 ? -mv.qty : 0, balance: bal });
  }
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return { opening: r3(opening), totalIn: r3(totalIn), totalOut: r3(totalOut), closing: r3(opening + totalIn - totalOut), damaged, rows };
}
