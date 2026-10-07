import type { Capability, Sale } from '@elixir/contracts';
import { MOVEMENT_SIGN, expiryHealth } from '@elixir/domain';
import { batchesFor, type LocalDatabase } from '@elixir/local-store';
import { daysUntil } from '@elixir/format';
import { addDays, METHOD_LABEL, today, type Lookups } from '../../lib/data';
import { onHandIn } from '../../lib/stock';
import type { Session } from '../../lib/session';

export type Fmt = 'money' | 'qty' | 'int' | 'text' | 'pct' | 'date' | 'mono';
export interface RCol {
  key: string;
  header: string;
  fmt: Fmt;
  /** Include in totals row (money/qty/int only). */
  total?: boolean;
}
export type RRow = Record<string, string | number | undefined> & { _id: string; _to?: string };

export interface ReportResult {
  columns: RCol[];
  rows: RRow[];
  summary: Array<{ label: string; value: number; fmt: Fmt; icon?: string }>;
  note?: string;
}

export interface ReportCtx {
  cloud: LocalDatabase;
  s: Session;
  L: Lookups;
  from: string;
  to: string;
  storeIds: string[];
}

export interface ReportDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  group: 'Sales' | 'GST' | 'Stock' | 'Purchase' | 'Cash';
  caps?: Capability[];
  family?: 'retail' | 'restaurant';
  usesDates?: boolean;
  build: (c: ReportCtx) => ReportResult;
}

const sales = (c: ReportCtx): Sale[] => c.cloud.where('sales', (x) => x.tenantId === c.s.tenant.id && c.storeIds.includes(x.storeId) && x.businessDate >= c.from && x.businessDate <= c.to && x.status !== 'cancelled');
const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export const REPORTS: ReportDef[] = [
  {
    key: 'sales-summary', title: 'Sales summary', description: 'Day-wise bills, discounts, taxable value, GST and net sales.', icon: 'CalendarDays', group: 'Sales', usesDates: true,
    build: (c) => {
      const ss = sales(c);
      const rets = c.cloud.where('returns', (r) => r.tenantId === c.s.tenant.id && c.storeIds.includes(r.storeId) && r.businessDate >= c.from && r.businessDate <= c.to);
      const days = new Map<string, Sale[]>();
      ss.forEach((x) => days.set(x.businessDate, [...(days.get(x.businessDate) ?? []), x]));
      const rows: RRow[] = [...days].sort((a, b) => a[0].localeCompare(b[0])).map(([d, xs]) => ({
        _id: d, date: d, bills: xs.length, gross: sumBy(xs, (x) => x.grossPaise), discount: sumBy(xs, (x) => x.lineDiscountPaise + x.billDiscountPaise), taxable: sumBy(xs, (x) => x.taxablePaise), tax: sumBy(xs, (x) => x.taxPaise), round: sumBy(xs, (x) => x.roundOffPaise), net: sumBy(xs, (x) => x.totalPaise),
        returns: sumBy(rets.filter((r) => r.businessDate === d), (r) => r.refundPaise), avg: Math.round(sumBy(xs, (x) => x.totalPaise) / xs.length),
      }));
      return {
        columns: [{ key: 'date', header: 'Date', fmt: 'date' }, { key: 'bills', header: 'Bills', fmt: 'int', total: true }, { key: 'gross', header: 'Gross', fmt: 'money', total: true }, { key: 'discount', header: 'Discount', fmt: 'money', total: true }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'tax', header: 'GST', fmt: 'money', total: true }, { key: 'round', header: 'Round off', fmt: 'money', total: true }, { key: 'net', header: 'Net sales', fmt: 'money', total: true }, { key: 'returns', header: 'Returns', fmt: 'money', total: true }, { key: 'avg', header: 'Avg bill', fmt: 'money' }],
        rows,
        summary: [{ label: 'Net sales', value: sumBy(ss, (x) => x.totalPaise), fmt: 'money', icon: 'IndianRupee' }, { label: 'Bills', value: ss.length, fmt: 'int', icon: 'Receipt' }, { label: 'GST collected', value: sumBy(ss, (x) => x.taxPaise), fmt: 'money', icon: 'Percent' }, { label: 'Returns', value: sumBy(rets, (r) => r.refundPaise), fmt: 'money', icon: 'Undo2' }],
      };
    },
  },
  {
    key: 'sales-by-product', title: 'Sales by product', description: 'Quantity, taxable value, GST and net per item.', icon: 'Package', group: 'Sales', usesDates: true,
    build: (c) => {
      const m = new Map<string, RRow>();
      sales(c).forEach((x) => x.lines.forEach((l) => {
        const r = m.get(l.productId) ?? { _id: l.productId, name: l.name, sku: c.L.products.get(l.productId)?.sku ?? '—', category: c.L.categories.get(c.L.products.get(l.productId)?.categoryId ?? c.L.menuItems.get(l.productId)?.categoryId ?? '')?.name ?? '—', qty: 0, bills: 0, taxable: 0, tax: 0, net: 0 };
        r.qty = r3((r.qty as number) + l.qty); r.bills = (r.bills as number) + 1; r.taxable = (r.taxable as number) + l.taxablePaise; r.tax = (r.tax as number) + l.cgstPaise + l.sgstPaise + l.igstPaise; r.net = (r.net as number) + l.netPaise;
        m.set(l.productId, r);
      }));
      const rows = [...m.values()].sort((a, b) => (b.net as number) - (a.net as number));
      return {
        columns: [{ key: 'name', header: 'Item', fmt: 'text' }, { key: 'sku', header: 'SKU', fmt: 'mono' }, { key: 'category', header: 'Category', fmt: 'text' }, { key: 'bills', header: 'Bills', fmt: 'int', total: true }, { key: 'qty', header: 'Qty', fmt: 'qty', total: true }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'tax', header: 'GST', fmt: 'money', total: true }, { key: 'net', header: 'Net sales', fmt: 'money', total: true }],
        rows, summary: [{ label: 'Items sold', value: rows.length, fmt: 'int', icon: 'Package' }, { label: 'Units', value: r3(sumBy(rows, (r) => r.qty as number)), fmt: 'qty', icon: 'Boxes' }, { label: 'Net sales', value: sumBy(rows, (r) => r.net as number), fmt: 'money', icon: 'IndianRupee' }],
      };
    },
  },
  {
    key: 'sales-by-category', title: 'Sales by category', description: 'Category contribution and share of net sales.', icon: 'Tags', group: 'Sales', usesDates: true,
    build: (c) => {
      const m = new Map<string, RRow>();
      sales(c).forEach((x) => x.lines.forEach((l) => {
        const catId = c.L.products.get(l.productId)?.categoryId ?? c.L.menuItems.get(l.productId)?.categoryId ?? 'none';
        const r = m.get(catId) ?? { _id: catId, category: c.L.categories.get(catId)?.name ?? 'Uncategorised', qty: 0, taxable: 0, tax: 0, net: 0, share: 0 };
        r.qty = r3((r.qty as number) + l.qty); r.taxable = (r.taxable as number) + l.taxablePaise; r.tax = (r.tax as number) + l.cgstPaise + l.sgstPaise + l.igstPaise; r.net = (r.net as number) + l.netPaise;
        m.set(catId, r);
      }));
      const rows = [...m.values()].sort((a, b) => (b.net as number) - (a.net as number));
      const tot = sumBy(rows, (r) => r.net as number);
      rows.forEach((r) => (r.share = tot ? ((r.net as number) / tot) * 100 : 0));
      return { columns: [{ key: 'category', header: 'Category', fmt: 'text' }, { key: 'qty', header: 'Qty', fmt: 'qty', total: true }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'tax', header: 'GST', fmt: 'money', total: true }, { key: 'net', header: 'Net sales', fmt: 'money', total: true }, { key: 'share', header: 'Share', fmt: 'pct' }], rows, summary: [{ label: 'Categories', value: rows.length, fmt: 'int', icon: 'Tags' }, { label: 'Net sales', value: tot, fmt: 'money', icon: 'IndianRupee' }] };
    },
  },
  {
    key: 'payments', title: 'Payment / tender report', description: 'Collections by tender — cash, UPI, card, credit.', icon: 'Wallet', group: 'Sales', usesDates: true,
    build: (c) => {
      const m = new Map<string, RRow>();
      sales(c).forEach((x) => x.tenders.forEach((t) => {
        const r = m.get(t.method) ?? { _id: t.method, method: METHOD_LABEL[t.method], count: 0, amount: 0, manual: 0, share: 0 };
        r.count = (r.count as number) + 1; r.amount = (r.amount as number) + t.amountPaise; if (t.confirmation === 'manual') r.manual = (r.manual as number) + 1;
        m.set(t.method, r);
      }));
      const rows = [...m.values()].sort((a, b) => (b.amount as number) - (a.amount as number));
      const tot = sumBy(rows, (r) => r.amount as number);
      rows.forEach((r) => (r.share = tot ? ((r.amount as number) / tot) * 100 : 0));
      return { columns: [{ key: 'method', header: 'Tender', fmt: 'text' }, { key: 'count', header: 'Transactions', fmt: 'int', total: true }, { key: 'manual', header: 'Manual refs (offline)', fmt: 'int', total: true }, { key: 'amount', header: 'Amount', fmt: 'money', total: true }, { key: 'share', header: 'Share', fmt: 'pct' }], rows, summary: [{ label: 'Collected', value: tot, fmt: 'money', icon: 'Wallet' }, { label: 'Transactions', value: sumBy(rows, (r) => r.count as number), fmt: 'int', icon: 'Receipt' }] };
    },
  },
  {
    key: 'gst-b2b', title: 'GSTR-1 · B2B invoices', description: 'Invoices to registered customers (with GSTIN), rate-wise.', icon: 'Building2', group: 'GST', caps: ['gst'], usesDates: true,
    build: (c) => {
      const rows: RRow[] = [];
      sales(c).filter((x) => x.customerId && c.L.customers.get(x.customerId)?.gstin).forEach((x) => {
        const cu = c.L.customers.get(x.customerId!)!;
        x.taxSummary.forEach((t) => rows.push({ _id: `${x.id}|${t.ratePct}`, _to: `/sales/${x.id}`, gstin: cu.gstin, customer: cu.name, invoice: x.documentNo, date: x.businessDate, pos: cu.stateCode ?? c.s.tenant.stateCode, value: x.totalPaise, rate: t.ratePct, taxable: t.taxablePaise, igst: t.igstPaise, cgst: t.cgstPaise, sgst: t.sgstPaise }));
      });
      rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      return { columns: [{ key: 'gstin', header: 'Customer GSTIN', fmt: 'mono' }, { key: 'customer', header: 'Customer', fmt: 'text' }, { key: 'invoice', header: 'Invoice no.', fmt: 'mono' }, { key: 'date', header: 'Date', fmt: 'date' }, { key: 'pos', header: 'Place of supply', fmt: 'text' }, { key: 'value', header: 'Invoice value', fmt: 'money' }, { key: 'rate', header: 'Rate %', fmt: 'int' }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'igst', header: 'IGST', fmt: 'money', total: true }, { key: 'cgst', header: 'CGST', fmt: 'money', total: true }, { key: 'sgst', header: 'SGST', fmt: 'money', total: true }], rows, summary: [{ label: 'B2B invoices', value: new Set(rows.map((r) => r.invoice)).size, fmt: 'int', icon: 'Receipt' }, { label: 'Taxable value', value: sumBy(rows, (r) => r.taxable as number), fmt: 'money', icon: 'IndianRupee' }, { label: 'Total GST', value: sumBy(rows, (r) => (r.igst as number) + (r.cgst as number) + (r.sgst as number)), fmt: 'money', icon: 'Percent' }] };
    },
  },
  {
    key: 'gst-b2c', title: 'GSTR-1 · B2C (small)', description: 'Unregistered sales summarised by place of supply and rate.', icon: 'Users', group: 'GST', caps: ['gst'], usesDates: true,
    build: (c) => {
      const m = new Map<string, RRow>();
      sales(c).filter((x) => !(x.customerId && c.L.customers.get(x.customerId)?.gstin)).forEach((x) => {
        const pos = (x.customerId && c.L.customers.get(x.customerId)?.stateCode) || c.s.tenant.stateCode;
        x.taxSummary.forEach((t) => {
          const k = `${pos}|${t.ratePct}`;
          const r = m.get(k) ?? { _id: k, pos, type: pos === c.s.tenant.stateCode ? 'Intra-state' : 'Inter-state', rate: t.ratePct, invoices: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
          r.invoices = (r.invoices as number) + 1; r.taxable = (r.taxable as number) + t.taxablePaise; r.igst = (r.igst as number) + t.igstPaise; r.cgst = (r.cgst as number) + t.cgstPaise; r.sgst = (r.sgst as number) + t.sgstPaise;
          m.set(k, r);
        });
      });
      const rows = [...m.values()].sort((a, b) => (a.rate as number) - (b.rate as number));
      return { columns: [{ key: 'pos', header: 'Place of supply', fmt: 'text' }, { key: 'type', header: 'Supply type', fmt: 'text' }, { key: 'rate', header: 'Rate %', fmt: 'int' }, { key: 'invoices', header: 'Invoice lines', fmt: 'int', total: true }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'igst', header: 'IGST', fmt: 'money', total: true }, { key: 'cgst', header: 'CGST', fmt: 'money', total: true }, { key: 'sgst', header: 'SGST', fmt: 'money', total: true }], rows, summary: [{ label: 'Taxable value', value: sumBy(rows, (r) => r.taxable as number), fmt: 'money', icon: 'IndianRupee' }, { label: 'CGST + SGST', value: sumBy(rows, (r) => (r.cgst as number) + (r.sgst as number)), fmt: 'money', icon: 'Percent' }, { label: 'IGST', value: sumBy(rows, (r) => r.igst as number), fmt: 'money', icon: 'Percent' }] };
    },
  },
  {
    key: 'gst-hsn', title: 'GSTR-1 · HSN summary', description: 'Taxable value and CGST / SGST / IGST by HSN / SAC code.', icon: 'Hash', group: 'GST', caps: ['gst'], usesDates: true,
    build: (c) => {
      const m = new Map<string, RRow>();
      sales(c).forEach((x) => x.lines.forEach((l) => {
        const k = `${l.hsn}|${l.taxRatePct}`;
        const r = m.get(k) ?? { _id: k, hsn: l.hsn || '—', desc: c.L.categories.get(c.L.products.get(l.productId)?.categoryId ?? c.L.menuItems.get(l.productId)?.categoryId ?? '')?.name ?? l.name, uqc: l.unit === 'kg' ? 'KGS' : l.unit === 'l' ? 'LTR' : 'NOS', rate: l.taxRatePct, qty: 0, value: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
        r.qty = r3((r.qty as number) + l.qty); r.value = (r.value as number) + l.netPaise; r.taxable = (r.taxable as number) + l.taxablePaise; r.cgst = (r.cgst as number) + l.cgstPaise; r.sgst = (r.sgst as number) + l.sgstPaise; r.igst = (r.igst as number) + l.igstPaise; r.totalTax = (r.totalTax as number) + l.cgstPaise + l.sgstPaise + l.igstPaise;
        m.set(k, r);
      }));
      const rows = [...m.values()].sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)) || (a.rate as number) - (b.rate as number));
      return {
        columns: [{ key: 'hsn', header: 'HSN', fmt: 'mono' }, { key: 'desc', header: 'Description', fmt: 'text' }, { key: 'uqc', header: 'UQC', fmt: 'text' }, { key: 'rate', header: 'Rate %', fmt: 'int' }, { key: 'qty', header: 'Total qty', fmt: 'qty', total: true }, { key: 'value', header: 'Total value', fmt: 'money', total: true }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'cgst', header: 'CGST', fmt: 'money', total: true }, { key: 'sgst', header: 'SGST', fmt: 'money', total: true }, { key: 'igst', header: 'IGST', fmt: 'money', total: true }, { key: 'totalTax', header: 'Total tax', fmt: 'money', total: true }],
        rows,
        summary: [{ label: 'HSN codes', value: new Set(rows.map((r) => r.hsn)).size, fmt: 'int', icon: 'Hash' }, { label: 'Taxable value', value: sumBy(rows, (r) => r.taxable as number), fmt: 'money', icon: 'IndianRupee' }, { label: 'CGST + SGST', value: sumBy(rows, (r) => (r.cgst as number) + (r.sgst as number)), fmt: 'money', icon: 'Percent' }, { label: 'IGST', value: sumBy(rows, (r) => r.igst as number), fmt: 'money', icon: 'Percent' }],
        note: 'Line-level tax from posted invoices; totals are exact integer-paise sums and match the invoice tax summaries.',
      };
    },
  },
  {
    key: 'stock-summary', title: 'Stock summary', description: 'Opening, inward, outward and closing per product — reconciled to the ledger.', icon: 'Boxes', group: 'Stock', caps: ['inventory'], family: 'retail', usesDates: true,
    build: (c) => {
      const prods = c.cloud.where('products', (p) => p.tenantId === c.s.tenant.id);
      const idx = new Map(prods.map((p) => [p.id, { opening: 0, inQ: 0, outQ: 0 }]));
      c.cloud.all('stockMovements').forEach((mv) => {
        const r = idx.get(mv.productId);
        if (!r || !c.storeIds.includes(mv.storeId) || mv.type === 'sale_return_damaged') return;
        const d = mv.createdAt.slice(0, 10);
        if (d < c.from) r.opening += mv.qty;
        else if (d <= c.to) { if (MOVEMENT_SIGN[mv.type] > 0 || mv.qty > 0) r.inQ += Math.max(0, mv.qty); if (mv.qty < 0) r.outQ += -mv.qty; }
      });
      const rows: RRow[] = prods.map((p) => {
        const r = idx.get(p.id)!;
        const closing = r3(r.opening + r.inQ - r.outQ);
        return { _id: p.id, _to: `/inventory/ledger/${p.id}`, name: p.name, sku: p.sku, unit: p.unit, opening: r3(r.opening), inQ: r3(r.inQ), outQ: r3(r.outQ), closing, value: Math.round(Math.max(0, closing) * p.costPaise) };
      }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      const now = c.to >= today() ? prods.reduce((a, p) => a + onHandIn(c.cloud, c.storeIds, p.id), 0) : undefined;
      const closingTot = r3(sumBy(rows, (r) => r.closing as number));
      return {
        columns: [{ key: 'name', header: 'Product', fmt: 'text' }, { key: 'sku', header: 'SKU', fmt: 'mono' }, { key: 'unit', header: 'Unit', fmt: 'text' }, { key: 'opening', header: 'Opening', fmt: 'qty', total: true }, { key: 'inQ', header: 'In', fmt: 'qty', total: true }, { key: 'outQ', header: 'Out', fmt: 'qty', total: true }, { key: 'closing', header: 'Closing', fmt: 'qty', total: true }, { key: 'value', header: 'Closing value (cost)', fmt: 'money', total: true }],
        rows,
        summary: [{ label: 'Opening units', value: r3(sumBy(rows, (r) => r.opening as number)), fmt: 'qty', icon: 'CircleDot' }, { label: 'Inward', value: r3(sumBy(rows, (r) => r.inQ as number)), fmt: 'qty', icon: 'ArrowDownLeft' }, { label: 'Outward', value: r3(sumBy(rows, (r) => r.outQ as number)), fmt: 'qty', icon: 'ArrowUpRight' }, { label: 'Closing value', value: sumBy(rows, (r) => r.value as number), fmt: 'money', icon: 'IndianRupee' }],
        note: now !== undefined ? (Math.abs(r3(now) - closingTot) < 0.001 ? `Reconciled: closing ${closingTot} units = current on-hand from the movement ledger.` : `Closing ${closingTot} differs from on-hand ${r3(now)} — investigate.`) : 'closing = opening + in − out for the selected period.',
      };
    },
  },
  {
    key: 'expiry', title: 'Expiry report', description: 'Batches with stock expired or expiring in the next 90 days.', icon: 'CalendarClock', group: 'Stock', caps: ['batch-expiry'],
    build: (c) => {
      const rows: RRow[] = [];
      c.cloud.where('products', (p) => p.tenantId === c.s.tenant.id && !!p.batchTracked).forEach((p) => batchesFor(c.cloud, p.id).forEach((b) => {
        const d = daysUntil(b.expiryDate);
        if (d > 90) return;
        const qty = onHandIn(c.cloud, c.storeIds, p.id, b.id);
        if (qty <= 0) return;
        rows.push({ _id: b.id, _to: `/products/${p.id}`, name: p.name, batch: b.code, expiry: b.expiryDate, days: d, status: expiryHealth(b.expiryDate, 30) === 'expired' ? 'Expired' : d <= 30 ? '≤ 30 days' : d <= 60 ? '≤ 60 days' : '≤ 90 days', qty, cost: Math.round(qty * b.costPaise), mrp: Math.round(qty * b.mrpPaise) });
      }));
      rows.sort((a, b) => String(a.expiry).localeCompare(String(b.expiry)));
      return { columns: [{ key: 'name', header: 'Product', fmt: 'text' }, { key: 'batch', header: 'Batch', fmt: 'mono' }, { key: 'expiry', header: 'Expiry', fmt: 'date' }, { key: 'days', header: 'Days left', fmt: 'int' }, { key: 'status', header: 'Window', fmt: 'text' }, { key: 'qty', header: 'Qty', fmt: 'qty', total: true }, { key: 'cost', header: 'Value (cost)', fmt: 'money', total: true }, { key: 'mrp', header: 'Value (MRP)', fmt: 'money', total: true }], rows, summary: [{ label: 'Expired batches', value: rows.filter((r) => (r.days as number) < 0).length, fmt: 'int', icon: 'CalendarX' }, { label: 'At risk (cost)', value: sumBy(rows, (r) => r.cost as number), fmt: 'money', icon: 'IndianRupee' }] };
    },
  },
  {
    key: 'purchase-register', title: 'Purchase register', description: 'Posted supplier invoices and debit notes with GST (input tax).', icon: 'ShoppingCart', group: 'Purchase', caps: ['purchase'], usesDates: true,
    build: (c) => {
      const rows: RRow[] = c.cloud.where('purchases', (p) => p.tenantId === c.s.tenant.id && c.storeIds.includes(p.storeId) && p.status === 'posted' && p.invoiceDate >= c.from && p.invoiceDate <= c.to).sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate)).map((p) => ({
        _id: p.id, _to: `/purchase/${p.id}`, doc: p.documentNo, date: p.invoiceDate, supplier: c.L.suppliers.get(p.supplierId)?.name, gstin: c.L.suppliers.get(p.supplierId)?.gstin, invoice: p.supplierInvoiceNo, taxable: p.subtotalPaise - p.discountPaise, tax: p.taxPaise, total: p.totalPaise, paid: p.paidPaise,
      }));
      return { columns: [{ key: 'doc', header: 'Document', fmt: 'mono' }, { key: 'date', header: 'Invoice date', fmt: 'date' }, { key: 'supplier', header: 'Supplier', fmt: 'text' }, { key: 'gstin', header: 'GSTIN', fmt: 'mono' }, { key: 'invoice', header: 'Supplier invoice', fmt: 'text' }, { key: 'taxable', header: 'Taxable', fmt: 'money', total: true }, { key: 'tax', header: 'Input GST', fmt: 'money', total: true }, { key: 'total', header: 'Total', fmt: 'money', total: true }, { key: 'paid', header: 'Paid', fmt: 'money', total: true }], rows, summary: [{ label: 'Documents', value: rows.length, fmt: 'int', icon: 'FileText' }, { label: 'Purchases', value: sumBy(rows, (r) => r.total as number), fmt: 'money', icon: 'ShoppingCart' }, { label: 'Input GST', value: sumBy(rows, (r) => r.tax as number), fmt: 'money', icon: 'Percent' }] };
    },
  },
  {
    key: 'cashier-shift', title: 'Cashier / shift report', description: 'Per-shift sales, tender split and cash variance by cashier.', icon: 'UserCheck', group: 'Cash', caps: ['shift'], usesDates: true,
    build: (c) => {
      const ss = sales(c);
      const shifts = c.cloud.where('shifts', (x) => x.tenantId === c.s.tenant.id && c.storeIds.includes(x.storeId) && x.businessDate >= c.from && x.businessDate <= c.to).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
      const rows: RRow[] = shifts.map((sh) => {
        const xs = ss.filter((x) => x.shiftId === sh.id);
        const t = (m: string) => sumBy(xs, (x) => sumBy(x.tenders.filter((y) => y.method === m), (y) => y.amountPaise));
        return { _id: sh.id, _to: `/shifts/${sh.id}`, shift: sh.code, date: sh.businessDate, cashier: c.L.users.get(sh.openedBy)?.name, counter: c.L.counters.get(sh.counterId)?.code, bills: xs.length, sales: sumBy(xs, (x) => x.totalPaise), cash: t('cash'), upi: t('upi'), card: t('card'), credit: t('credit'), variance: sh.status === 'open' ? 0 : sh.variance ?? 0, status: sh.status === 'open' ? 'Open' : 'Closed' };
      });
      return { columns: [{ key: 'shift', header: 'Shift', fmt: 'mono' }, { key: 'date', header: 'Date', fmt: 'date' }, { key: 'cashier', header: 'Cashier', fmt: 'text' }, { key: 'counter', header: 'Counter', fmt: 'text' }, { key: 'bills', header: 'Bills', fmt: 'int', total: true }, { key: 'sales', header: 'Sales', fmt: 'money', total: true }, { key: 'cash', header: 'Cash', fmt: 'money', total: true }, { key: 'upi', header: 'UPI', fmt: 'money', total: true }, { key: 'card', header: 'Card', fmt: 'money', total: true }, { key: 'credit', header: 'Credit', fmt: 'money', total: true }, { key: 'variance', header: 'Variance', fmt: 'money', total: true }, { key: 'status', header: 'Status', fmt: 'text' }], rows, summary: [{ label: 'Shifts', value: rows.length, fmt: 'int', icon: 'Clock' }, { label: 'Sales', value: sumBy(rows, (r) => r.sales as number), fmt: 'money', icon: 'IndianRupee' }, { label: 'Net variance', value: sumBy(rows, (r) => r.variance as number), fmt: 'money', icon: 'Scale' }] };
    },
  },
];

export const defaultFrom = () => addDays(today(), -6);
