import type { Product, Sale, TenderMethod } from '@elixir/contracts';
import { useElixirData } from '@elixir/app-kit';
import { useLive } from '@elixir/local-store/react';
import { derived, type LocalDatabase } from '@elixir/local-store';
import { isoDate } from '@elixir/format';
import { useSession } from './session';

export const useCloud = (): LocalDatabase => useElixirData().cloud;

// ───────── Dates ─────────
export const today = () => isoDate();
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86400000);
}
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return `${String(d.getDate()).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}
export interface DateRange {
  from: string;
  to: string;
}
export type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom';
export function presetRange(p: RangePreset, cur?: DateRange): DateRange {
  const t = today();
  switch (p) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday':
      return { from: addDays(t, -1), to: addDays(t, -1) };
    case '7d':
      return { from: addDays(t, -6), to: t };
    case '30d':
      return { from: addDays(t, -29), to: t };
    case 'month':
      return { from: `${t.slice(0, 8)}01`, to: t };
    default:
      return cur ?? { from: addDays(t, -6), to: t };
  }
}

export const METHOD_LABEL: Record<TenderMethod, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit', redemption: 'Points' };

// ───────── Scoped live data ─────────

/** All tenant sales within the current store scope (live). */
export function useScopedSales(): Sale[] {
  const cloud = useCloud();
  const s = useSession();
  const key = `${s.tenant.id}|${s.scope.join(',')}`;
  return useLive(cloud, ['sales'], () => derived(cloud, `sales:${key}`, ['sales'], () => cloud.all('sales').filter((x) => x.tenantId === s.tenant.id && s.scope.includes(x.storeId))), [key]);
}

export function useTenantProducts(): Product[] {
  const cloud = useCloud();
  const s = useSession();
  return useLive(cloud, ['products'], () => cloud.where('products', (p) => p.tenantId === s.tenant.id), [s.tenant.id]);
}

/** Lookup maps for display names. */
export function useLookups() {
  const cloud = useCloud();
  const s = useSession();
  return useLive(
    cloud,
    ['users', 'stores', 'counters', 'devices', 'customers', 'suppliers', 'products', 'categories', 'brands', 'menuItems', 'taxRates'],
    () => {
      const tid = s.tenant.id;
      const m = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));
      return {
        users: m(cloud.all('users')),
        stores: m(cloud.where('stores', (x) => x.tenantId === tid)),
        counters: m(cloud.all('counters')),
        devices: m(cloud.where('devices', (x) => x.tenantId === tid)),
        customers: m(cloud.where('customers', (x) => x.tenantId === tid)),
        suppliers: m(cloud.where('suppliers', (x) => x.tenantId === tid)),
        products: m(cloud.where('products', (x) => x.tenantId === tid)),
        categories: m(cloud.where('categories', (x) => x.tenantId === tid)),
        brands: m(cloud.where('brands', (x) => x.tenantId === tid)),
        menuItems: m(cloud.where('menuItems', (x) => x.tenantId === tid)),
        taxRates: m(cloud.all('taxRates')),
      };
    },
    [s.tenant.id],
  );
}
export type Lookups = ReturnType<typeof useLookups>;

export const userName = (l: Lookups, id?: string) => (id ? l.users.get(id)?.name ?? id : '—');

// ───────── Sales maths (integer paise) ─────────
export const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

/** Revenue-bearing sales (cancelled excluded). */
export const countable = (s: Sale) => s.status !== 'cancelled';

export function paymentSplit(sales: Sale[]): Array<{ method: TenderMethod; amount: number; count: number }> {
  const m = new Map<TenderMethod, { amount: number; count: number }>();
  for (const s of sales) {
    if (!countable(s)) continue;
    for (const t of s.tenders) {
      const cur = m.get(t.method) ?? { amount: 0, count: 0 };
      cur.amount += t.amountPaise;
      cur.count += 1;
      m.set(t.method, cur);
    }
  }
  return [...m].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount);
}

/** Estimated cost of goods for a sale (product cost × qty). Restaurant items have no cost master. */
export function saleCost(sale: Sale, products: Map<string, Product>): number {
  return sum(sale.lines, (l) => {
    const p = products.get(l.productId);
    return p ? Math.round(p.costPaise * (l.qty - l.returnedQty)) : 0;
  });
}

export function pctChange(cur: number, prev: number): number | undefined {
  if (!prev) return undefined;
  return ((cur - prev) / prev) * 100;
}

/** Sales returns in scope. */
export function useScopedReturns() {
  const cloud = useCloud();
  const s = useSession();
  return useLive(cloud, ['returns'], () => cloud.where('returns', (r) => r.tenantId === s.tenant.id && s.scope.includes(r.storeId)), [s.tenant.id, s.scope.join(',')]);
}

export function includesQ(q: string, ...vals: Array<string | undefined>): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return vals.some((v) => v?.toLowerCase().includes(n));
}
