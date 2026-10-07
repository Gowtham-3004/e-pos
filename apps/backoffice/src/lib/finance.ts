import type { Customer, Purchase, Sale, Supplier } from '@elixir/contracts';
import type { LocalDatabase } from '@elixir/local-store';
import { addDays, daysBetween, today } from './data';

export interface AgeBuckets {
  b0: number;
  b31: number;
  b61: number;
  total: number;
}

export interface OpenItem {
  sale?: Sale;
  label: string;
  date: string;
  amount: number;
  age: number;
}

/**
 * Customer ageing: allocate the outstanding balance (customer master) to the most recent credit
 * invoices first; any remainder is an opening balance aged 60+. Totals always equal outstanding (FR-RPT-005).
 */
export function customerAgeing(cloud: LocalDatabase, c: Customer): { buckets: AgeBuckets; items: OpenItem[] } {
  const t = today();
  const credit = cloud
    .where('sales', (s) => s.customerId === c.id && s.status !== 'cancelled' && s.tenders.some((x) => x.method === 'credit'))
    .sort((a, b) => b.committedAt.localeCompare(a.committedAt));
  let left = c.outstandingPaise;
  const items: OpenItem[] = [];
  for (const s of credit) {
    if (left <= 0) break;
    const amt = Math.min(left, s.tenders.filter((x) => x.method === 'credit').reduce((a, x) => a + x.amountPaise, 0));
    left -= amt;
    items.push({ sale: s, label: s.documentNo, date: s.businessDate, amount: amt, age: daysBetween(s.businessDate, t) });
  }
  if (left > 0) items.push({ label: 'Opening balance', date: c.createdAt.slice(0, 10), amount: left, age: Math.max(61, daysBetween(c.createdAt.slice(0, 10), t)) });
  const b: AgeBuckets = { b0: 0, b31: 0, b61: 0, total: 0 };
  for (const i of items) {
    if (i.age <= 30) b.b0 += i.amount;
    else if (i.age <= 60) b.b31 += i.amount;
    else b.b61 += i.amount;
    b.total += i.amount;
  }
  return { buckets: b, items };
}

export interface DueItem {
  purchase: Purchase;
  due: number;
  dueDate: string;
  overdueDays: number;
}

/** Supplier dues = Σ (total − paid) of posted purchases (debit notes negative). Equals supplier outstanding. */
export function supplierDues(cloud: LocalDatabase, s: Supplier): { items: DueItem[]; buckets: AgeBuckets; overdue: number } {
  const t = today();
  const items = cloud
    .where('purchases', (p) => p.supplierId === s.id && p.status === 'posted' && p.totalPaise - p.paidPaise !== 0)
    .map((p) => {
      const dueDate = p.totalPaise < 0 ? p.invoiceDate : addDays(p.invoiceDate, s.payableDays);
      return { purchase: p, due: p.totalPaise - p.paidPaise, dueDate, overdueDays: Math.max(0, daysBetween(dueDate, t)) };
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const b: AgeBuckets = { b0: 0, b31: 0, b61: 0, total: 0 };
  let overdue = 0;
  for (const i of items) {
    const age = daysBetween(i.purchase.invoiceDate, t);
    if (age <= 30) b.b0 += i.due;
    else if (age <= 60) b.b31 += i.due;
    else b.b61 += i.due;
    b.total += i.due;
    if (i.overdueDays > 0 && i.due > 0) overdue += i.due;
  }
  return { items, buckets: b, overdue };
}
