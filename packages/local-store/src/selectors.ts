import type { Batch, Capability, JobCard, Permission, Product, Sale, SessionContext } from '@elixir/contracts';
import { computeCart, expiryHealth, familyOf, isJobCardOpen, jobCardToCartLines, resolveCapabilities, roleByCode, stockHealth, type CartTotals } from '@elixir/domain';
import type { LocalDatabase } from './db';
import { jobCardPricingOverride } from './commands';

const memo = new WeakMap<LocalDatabase, Map<string, { v: string; value: unknown }>>();

/** Memoize a derived projection by the versions of the collections it reads. */
export function derived<T>(db: LocalDatabase, key: string, deps: Parameters<LocalDatabase['version']>[0][], compute: () => T): T {
  let m = memo.get(db);
  if (!m) memo.set(db, (m = new Map()));
  const v = deps.map((d) => db.version(d)).join('.');
  const hit = m.get(key);
  if (hit && hit.v === v) return hit.value as T;
  const value = compute();
  m.set(key, { v, value });
  return value;
}

/** Stock projection from the immutable ledger: `${storeId}|${productId}` and `${storeId}|${productId}|${batchId}`. */
export function stockIndex(db: LocalDatabase): Map<string, number> {
  return derived(db, 'stockIndex', ['stockMovements'], () => {
    const idx = new Map<string, number>();
    for (const m of db.all('stockMovements')) {
      if (m.type === 'sale_return_damaged') continue;
      const k = `${m.storeId}|${m.productId}`;
      idx.set(k, (idx.get(k) ?? 0) + m.qty);
      if (m.batchId) {
        const kb = `${k}|${m.batchId}`;
        idx.set(kb, (idx.get(kb) ?? 0) + m.qty);
      }
    }
    return idx;
  });
}

export function onHand(db: LocalDatabase, storeId: string, productId: string, batchId?: string): number {
  return Math.round((stockIndex(db).get(batchId ? `${storeId}|${productId}|${batchId}` : `${storeId}|${productId}`) ?? 0) * 1000) / 1000;
}

/** Tenant-wide on-hand across stores. */
export function onHandAllStores(db: LocalDatabase, tenantId: string, productId: string): number {
  return db.where('stores', (s) => s.tenantId === tenantId).reduce((sum, s) => sum + onHand(db, s.id, productId), 0);
}

export function tenantProducts(db: LocalDatabase, tenantId: string): Product[] {
  return derived(db, `products:${tenantId}`, ['products'], () => db.where('products', (p) => p.tenantId === tenantId));
}

export function productByBarcode(db: LocalDatabase, tenantId: string, code: string): Product | undefined {
  const c = code.trim();
  return tenantProducts(db, tenantId).find((p) => p.active && (p.barcode === c || p.sku.toLowerCase() === c.toLowerCase() || (p.plu && p.plu === c)));
}

/**
 * Local product search: barcode, name, code, local name, molecule, brand-ish attributes (§23).
 * Exact code matches rank first, then prefix, then contains.
 */
export function searchProducts(db: LocalDatabase, tenantId: string, query: string, limit = 20): Product[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<[number, Product]> = [];
  for (const p of tenantProducts(db, tenantId)) {
    if (!p.active) continue;
    let score = 0;
    if (p.barcode === q || p.sku.toLowerCase() === q || p.plu === q) score = 100;
    else if (p.name.toLowerCase().startsWith(q)) score = 60;
    else if (p.name.toLowerCase().includes(q)) score = 40;
    else if (p.molecule?.toLowerCase().includes(q) || p.localName?.toLowerCase().includes(q) || p.styleCode?.toLowerCase().includes(q) || p.model?.toLowerCase().includes(q)) score = 30;
    else if (p.variantAttrs && `${p.variantAttrs.color} ${p.variantAttrs.size}`.toLowerCase().includes(q)) score = 20;
    else if (p.barcode.includes(q) || p.sku.toLowerCase().includes(q)) score = 15;
    if (score) scored.push([score, p]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).slice(0, limit).map((x) => x[1]);
}

export function batchesFor(db: LocalDatabase, productId: string): Batch[] {
  return derived(db, 'batchesByProduct', ['batches'], () => {
    const m = new Map<string, Batch[]>();
    db.all('batches').forEach((b) => m.set(b.productId, [...(m.get(b.productId) ?? []), b]));
    m.forEach((list) => list.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate)));
    return m;
  }).get(productId) ?? [];
}

export function lowStock(db: LocalDatabase, tenantId: string, storeId: string) {
  return tenantProducts(db, tenantId)
    .filter((p) => !p.isService)
    .map((p) => ({ product: p, onHand: onHand(db, storeId, p.id) }))
    .filter((x) => stockHealth(x.onHand, x.product.reorderLevel) !== 'ok');
}

export function expiringBatches(db: LocalDatabase, tenantId: string, storeId: string, days = 60) {
  const prodIds = new Set(tenantProducts(db, tenantId).map((p) => p.id));
  return db
    .all('batches')
    .filter((b) => prodIds.has(b.productId) && expiryHealth(b.expiryDate, days) !== 'ok')
    .map((b) => ({ batch: b, product: db.get('products', b.productId)!, onHand: onHand(db, storeId, b.productId, b.id), health: expiryHealth(b.expiryDate, days) }))
    .filter((x) => x.onHand > 0)
    .sort((a, b) => a.batch.expiryDate.localeCompare(b.batch.expiryDate));
}

export function salesFor(db: LocalDatabase, f: { tenantId: string; storeId?: string; from?: string; to?: string }): Sale[] {
  return db.all('sales').filter((s) => s.tenantId === f.tenantId && (!f.storeId || s.storeId === f.storeId) && (!f.from || s.businessDate >= f.from) && (!f.to || s.businessDate <= f.to));
}

export function salesByDay(sales: Sale[]): Array<{ date: string; totalPaise: number; count: number }> {
  const m = new Map<string, { totalPaise: number; count: number }>();
  for (const s of sales) {
    const cur = m.get(s.businessDate) ?? { totalPaise: 0, count: 0 };
    cur.totalPaise += s.totalPaise;
    cur.count += 1;
    m.set(s.businessDate, cur);
  }
  return [...m].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
}

export function tenantCapabilities(db: LocalDatabase, tenantId: string): Capability[] {
  const t = db.get('tenants', tenantId);
  return t ? resolveCapabilities(t) : [];
}

/** Resolve the full operator context: tenant + store + counter + device + user + role + shift + capabilities (§27). */
export function resolveSession(db: LocalDatabase, input: { deviceId: string; userId: string; authMode?: SessionContext['authMode']; storeId?: string }): SessionContext | undefined {
  const device = db.get('devices', input.deviceId);
  const user = db.get('users', input.userId);
  if (!device || !user) return undefined;
  const tenant = db.get('tenants', device.tenantId)!;
  const store = db.get('stores', input.storeId ?? device.storeId)!;
  const counter = db.get('counters', device.counterId);
  const role = roleByCode(user.role);
  const shift = counter ? db.where('shifts', (s) => s.counterId === counter.id && s.status !== 'closed').sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0] : undefined;
  const capabilities = resolveCapabilities(tenant);
  let permissions: Permission[] = role.permissions;
  if (familyOf(tenant.vertical) === 'retail') permissions = permissions.filter((p) => !p.startsWith('restaurant.') && p !== 'kds.operate');
  return { tenant, store, counter, device, user, role, shift, capabilities, permissions, authMode: input.authMode ?? 'online' };
}

/** Job cards for a store, newest first; `open` limits to cards still in the workshop. */
export function jobCardsFor(db: LocalDatabase, storeId: string, open?: boolean): JobCard[] {
  return db.where('jobCards', (j) => j.storeId === storeId && (!open || isJobCardOpen(j.status))).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

/** Live bill preview for a job card — same pricing path as billJobCard. */
export function jobCardTotals(db: LocalDatabase, card: JobCard, billDiscountPct = 0): CartTotals {
  const store = db.get('stores', card.storeId);
  const customer = db.get('customers', card.customerId);
  const override = jobCardPricingOverride(card);
  const pg = customer?.priceGroupId ? db.get('priceGroups', customer.priceGroupId) : undefined;
  return computeCart(jobCardToCartLines(card), billDiscountPct, {
    products: new Map(db.where('products', (p) => p.tenantId === card.tenantId).map((p) => [p.id, override(p) ?? p])),
    taxRates: new Map(db.all('taxRates').map((t) => [t.id, t])),
    batches: new Map(db.all('batches').map((b) => [b.id, b])),
    interState: !!customer?.stateCode && customer.stateCode !== store?.stateCode,
    priceGroupDiscountPct: pg?.discountPct,
  });
}
