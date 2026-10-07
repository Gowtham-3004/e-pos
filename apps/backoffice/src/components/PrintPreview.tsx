import { useState } from 'react';
import type { Sale, Store, Tenant } from '@elixir/contracts';
import { Button, Modal, Segmented, useToast } from '@elixir/ui';
import { dateTime, money, qty as fq } from '@elixir/format';
import { METHOD_LABEL } from '../lib/data';

/** Receipt (80mm) / A4 tax invoice preview. Reprint is marked DUPLICATE. */
export function InvoicePrint({ open, onClose, sale, tenant, store, cashier, footer }: { open: boolean; onClose: () => void; sale: Sale; tenant: Tenant; store?: Store; cashier: string; footer?: string }) {
  const [mode, setMode] = useState<'receipt' | 'a4'>('receipt');
  const toast = useToast();
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Print ${sale.documentNo}`}
      description="Reprints are marked DUPLICATE. The posted invoice itself is not changed."
      footer={
        <>
          <Segmented label="Format" items={[{ key: 'receipt', label: 'Receipt 80mm' }, { key: 'a4', label: 'A4 tax invoice' }]} value={mode} onChange={setMode} />
          <div className="ex-spacer" />
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" icon="Printer" onClick={() => { toast.success('Print initiated', `${sale.documentNo} sent to browser print`); window.print(); }}>Print</Button>
        </>
      }
    >
      <div className="bo-print">
        {mode === 'receipt' ? (
          <div className="bo-receipt">
            <div style={{ textAlign: 'center', fontWeight: 700 }}>{tenant.name}</div>
            <div style={{ textAlign: 'center' }}>{store?.address}</div>
            <div style={{ textAlign: 'center' }}>GSTIN {tenant.gstin}</div>
            <div style={{ textAlign: 'center', fontWeight: 700, marginTop: 4 }}>TAX INVOICE · DUPLICATE</div>
            <hr />
            <div className="r"><span>{sale.documentNo}</span></div>
            <div className="r"><span>{dateTime(sale.committedAt)}</span><span>{cashier}</span></div>
            {sale.customerName ? <div>Customer: {sale.customerName}</div> : null}
            <hr />
            {sale.lines.map((l) => (
              <div key={l.id}>
                <div>{l.name}{l.variantLabel ? ` (${l.variantLabel})` : ''}</div>
                <div className="r"><span>{fq(l.qty, l.unit !== 'pcs')} × {money(l.unitPricePaise)}</span><span>{money(l.netPaise)}</span></div>
              </div>
            ))}
            <hr />
            <div className="r"><span>Taxable</span><span>{money(sale.taxablePaise)}</span></div>
            <div className="r"><span>GST</span><span>{money(sale.taxPaise)}</span></div>
            {sale.roundOffPaise ? <div className="r"><span>Round off</span><span>{money(sale.roundOffPaise)}</span></div> : null}
            <div className="r" style={{ fontWeight: 700, fontSize: 13 }}><span>TOTAL</span><span>{money(sale.totalPaise)}</span></div>
            {sale.tenders.map((t) => <div key={t.id} className="r"><span>{METHOD_LABEL[t.method]}</span><span>{money(t.amountPaise)}</span></div>)}
            {sale.savingsPaise ? <div style={{ textAlign: 'center', marginTop: 4 }}>You saved {money(sale.savingsPaise)}</div> : null}
            <hr />
            <div style={{ textAlign: 'center' }}>{footer ?? 'Thank you! Visit again.'}</div>
          </div>
        ) : (
          <div className="bo-a4">
            <div className="ex-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18 }}>{tenant.legalName}</div>
                <div>{store?.address}</div>
                <div>GSTIN: {tenant.gstin} · State code {store?.stateCode}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>TAX INVOICE</div>
                <div>Duplicate for recipient</div>
                <div>No. {sale.documentNo}</div>
                <div>Date {dateTime(sale.committedAt)}</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>Bill to: <b>{sale.customerName ?? 'Walk-in customer'}</b>{sale.interState ? ' · Inter-state supply (IGST)' : ''}</div>
            <table>
              <thead><tr><th>#</th><th>Description</th><th>HSN</th><th className="n">Qty</th><th className="n">Rate</th><th className="n">Taxable</th><th className="n">GST %</th><th className="n">Tax</th><th className="n">Amount</th></tr></thead>
              <tbody>
                {sale.lines.map((l) => (
                  <tr key={l.id}><td>{l.lineNo}</td><td>{l.name}{l.batchCode ? ` · Batch ${l.batchCode}` : ''}</td><td>{l.hsn}</td><td className="n">{fq(l.qty, l.unit !== 'pcs')}</td><td className="n">{money(l.unitPricePaise)}</td><td className="n">{money(l.taxablePaise)}</td><td className="n">{l.taxRatePct}</td><td className="n">{money(l.cgstPaise + l.sgstPaise + l.igstPaise)}</td><td className="n">{money(l.netPaise)}</td></tr>
                ))}
              </tbody>
            </table>
            <table>
              <thead><tr><th>GST rate</th><th className="n">Taxable</th><th className="n">CGST</th><th className="n">SGST</th><th className="n">IGST</th></tr></thead>
              <tbody>{sale.taxSummary.map((t) => <tr key={t.ratePct}><td>{t.ratePct}%</td><td className="n">{money(t.taxablePaise)}</td><td className="n">{money(t.cgstPaise)}</td><td className="n">{money(t.sgstPaise)}</td><td className="n">{money(t.igstPaise)}</td></tr>)}</tbody>
            </table>
            <div style={{ textAlign: 'right', marginTop: 10, fontSize: 14 }}>Round off {money(sale.roundOffPaise)} · <b>Total {money(sale.totalPaise)}</b></div>
            <div style={{ marginTop: 18 }} className="muted">{footer}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
