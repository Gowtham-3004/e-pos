import type { Sale, SaleReturn } from '@elixir/contracts';
import { dateTime, money, qty as fmtQty } from '@elixir/format';
import type { LocalDatabase } from '@elixir/local-store';

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit', redemption: 'Points' };

/** 80mm thermal receipt (§25). Used in success screen, sales history and print. */
export function Receipt({ db, sale, copy }: { db: LocalDatabase; sale: Sale; copy?: boolean }) {
  const tenant = db.get('tenants', sale.tenantId);
  const store = db.get('stores', sale.storeId);
  const counter = db.get('counters', sale.counterId);
  const cashier = db.get('users', sale.userId);
  const customer = db.get('customers', sale.customerId);
  const order = sale.restaurantOrderId ? db.get('orders', sale.restaurantOrderId) : undefined;
  const job = sale.jobCardId ? db.get('jobCards', sale.jobCardId) : undefined;
  const cash = sale.tenders.find((t) => t.method === 'cash');
  return (
    <div className="receipt" aria-label={`Receipt ${sale.documentNo}`}>
      <div className="receipt__center">
        <div className="receipt__store">{tenant?.name}</div>
        <div>{store?.name} · {store?.address}</div>
        <div>Ph {store?.phone}</div>
        {tenant?.gstin ? <div>GSTIN {tenant.gstin}</div> : null}
        <div className="receipt__title">{copy ? 'TAX INVOICE (DUPLICATE)' : 'TAX INVOICE'}</div>
      </div>
      <div className="receipt__rule" />
      <div className="receipt__kv"><span>Invoice</span><span>{sale.documentNo}</span></div>
      <div className="receipt__kv"><span>Date</span><span>{dateTime(sale.committedAt)}</span></div>
      <div className="receipt__kv"><span>Counter</span><span>{counter?.code} · {cashier?.name}</span></div>
      {order ? <div className="receipt__kv"><span>Order</span><span>{order.orderNo} · {order.tableCode ? `Table ${order.tableCode}` : `Token ${order.token}`}</span></div> : null}
      {job ? <div className="receipt__kv"><span>Job</span><span>{job.jobNo} · {job.device.brand} {job.device.model}{job.device.imeiOrSerial ? ` · ${job.device.imeiOrSerial}` : ''}</span></div> : null}
      {customer || sale.customerName ? <div className="receipt__kv"><span>Customer</span><span>{customer?.name ?? sale.customerName}{customer?.phone ? ` · ${customer.phone}` : ''}</span></div> : null}
      <div className="receipt__rule" />
      <div className="receipt__line receipt__line--head"><span>Item</span><span>Qty</span><span>Rate</span><span>Amount</span></div>
      {sale.lines.map((l) => (
        <div key={l.id} className="receipt__item">
          <div className="receipt__name">{l.name}{l.variantLabel ? ` (${l.variantLabel})` : ''}</div>
          <div className="receipt__line">
            <span className="receipt__meta">HSN {l.hsn}{l.batchCode ? ` · B ${l.batchCode}` : ''}{l.serials?.length ? ` · SN ${l.serials.join(', ')}` : ''}</span>
            <span>{fmtQty(l.qty, l.unit === 'kg')}</span>
            <span>{money(l.unitPricePaise)}</span>
            <span>{money(l.netPaise)}</span>
          </div>
          {l.discountPaise ? <div className="receipt__meta">  Discount −{money(l.discountPaise)}</div> : null}
        </div>
      ))}
      <div className="receipt__rule" />
      <div className="receipt__kv"><span>Items</span><span>{sale.itemCount}</span></div>
      <div className="receipt__kv"><span>Gross</span><span>{money(sale.grossPaise)}</span></div>
      {sale.lineDiscountPaise + sale.billDiscountPaise > 0 ? <div className="receipt__kv"><span>Discount</span><span>−{money(sale.lineDiscountPaise + sale.billDiscountPaise)}</span></div> : null}
      <div className="receipt__kv"><span>Taxable value</span><span>{money(sale.taxablePaise)}</span></div>
      {sale.roundOffPaise ? <div className="receipt__kv"><span>Round off</span><span>{money(sale.roundOffPaise, { signed: true })}</span></div> : null}
      <div className="receipt__kv receipt__total"><span>TOTAL</span><span>{money(sale.totalPaise)}</span></div>
      <div className="receipt__rule" />
      <div className="receipt__line receipt__line--head receipt__line--tax"><span>GST</span><span>Taxable</span><span>{sale.interState ? 'IGST' : 'CGST'}</span><span>{sale.interState ? '' : 'SGST'}</span></div>
      {sale.taxSummary.map((t) => (
        <div key={t.ratePct} className="receipt__line receipt__line--tax">
          <span>{t.ratePct}%</span>
          <span>{money(t.taxablePaise)}</span>
          <span>{money(sale.interState ? t.igstPaise : t.cgstPaise)}</span>
          <span>{sale.interState ? '' : money(t.sgstPaise)}</span>
        </div>
      ))}
      <div className="receipt__rule" />
      {sale.tenders.map((t) => (
        <div key={t.id} className="receipt__kv">
          <span>{METHOD[t.method] ?? t.method}{t.reference ? ` · ${t.reference}` : ''}{t.confirmation === 'manual' ? ' (manual)' : ''}</span>
          <span>{money(t.receivedPaise ?? t.amountPaise)}</span>
        </div>
      ))}
      {cash?.changePaise ? <div className="receipt__kv"><span>Change</span><span>{money(cash.changePaise)}</span></div> : null}
      {sale.savingsPaise > 0 ? <div className="receipt__save">You saved {money(sale.savingsPaise)} on MRP</div> : null}
      {sale.loyaltyEarned ? <div className="receipt__center">Loyalty points earned: {sale.loyaltyEarned}{customer ? ` · Balance ${customer.loyaltyPoints}` : ''}</div> : null}
      <div className="receipt__rule" />
      <div className="receipt__center">Thank you! Visit again.</div>
      <div className="receipt__center receipt__meta">Goods once sold can be returned within 7 days with invoice.</div>
    </div>
  );
}

export function ReturnReceipt({ db, ret }: { db: LocalDatabase; ret: SaleReturn }) {
  const tenant = db.get('tenants', ret.tenantId);
  const store = db.get('stores', ret.storeId);
  return (
    <div className="receipt">
      <div className="receipt__center">
        <div className="receipt__store">{tenant?.name}</div>
        <div>{store?.name}</div>
        <div className="receipt__title">CREDIT NOTE / SALES RETURN</div>
      </div>
      <div className="receipt__rule" />
      <div className="receipt__kv"><span>Return</span><span>{ret.documentNo}</span></div>
      <div className="receipt__kv"><span>Against</span><span>{ret.originalDocumentNo ?? 'Without invoice'}</span></div>
      <div className="receipt__kv"><span>Date</span><span>{dateTime(ret.createdAt)}</span></div>
      <div className="receipt__rule" />
      {ret.lines.map((l, i) => (
        <div key={i} className="receipt__kv"><span>{l.qty} × {l.name}</span><span>{money(l.refundPaise)}</span></div>
      ))}
      <div className="receipt__rule" />
      <div className="receipt__kv receipt__total"><span>REFUND ({METHOD[ret.refundMethod]})</span><span>{money(ret.refundPaise)}</span></div>
    </div>
  );
}
