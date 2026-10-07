import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Product, Sale, SaleReturn, TenderMethod } from '@elixir/contracts';
import { SYNC_STATE } from '@elixir/domain';
import { dateTime, money, rupeesToPaise } from '@elixir/format';
import { commitReturn, searchProducts } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { ApprovalDialog, Badge, Button, Card, CardBody, CardHeader, Checkbox, EmptyState, Icon, InlineAlert, SearchInput, Segmented, Select, StatusBadge, Switch, TextField, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { managerVerifier, originOf, recordApproval } from '../lib/ops';
import { usePrint } from '../lib/print';
import { ReturnReceipt } from '../components/Receipt';
import { ShiftGate } from '../components/ShiftGate';

const REASONS = ['Damaged / defective', 'Wrong item', 'Size / fit', 'Expired / near expiry', 'Customer changed mind', 'Billing error'];
const APPROVAL_ABOVE = 500000; // refunds above ₹5,000 need a manager (store policy)

interface RetLine { saleLineId: string; productId: string; name: string; max: number; qty: number; unitRefund: number; reason: string; restockable: boolean; batchId?: string; selected: boolean }

export function ReturnsScreen() {
  const s = useSession();
  if (!s.shift) return <ShiftGate what="returns" />;
  return <Returns />;
}

function Returns() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'invoice' | 'none'>('invoice');
  const [done, setDone] = useState<SaleReturn>();
  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Sales return</div>
          <div className="pos-page__desc">Refunds post a credit note, a stock movement and a cash movement in one local commit.</div>
        </div>
        <div className="ex-spacer" />
        <Segmented label="Return type" value={mode} onChange={(m) => { setMode(m); setDone(undefined); }} items={[{ key: 'invoice', label: 'Against invoice', icon: 'Receipt' }, { key: 'none', label: 'Without invoice', icon: 'ShieldCheck' }]} />
      </div>
      {done ? <ReturnDone ret={done} onNew={() => setDone(undefined)} /> : mode === 'invoice' ? <InvoiceReturn initial={params.get('invoice') ?? ''} onDone={setDone} /> : <NoInvoiceReturn onDone={setDone} />}
    </div>
  );
}

function ReturnDone({ ret, onNew }: { ret: SaleReturn; onNew: () => void }) {
  const { device } = usePos();
  const print = usePrint((x) => x.print);
  const live = useLive(device, ['returns'], () => device.get('returns', ret.id) ?? ret, [ret.id]);
  return (
    <Card pad style={{ maxWidth: 620 }}>
      <div className="ex-stack" style={{ alignItems: 'flex-start' }}>
        <div className="ex-row"><span className="success__icon" style={{ width: 44, height: 44 }}><Icon name="Check" size={24} /></span><div><div style={{ fontSize: 20, fontWeight: 750 }}>Return posted</div><div className="muted num">{live.documentNo}{live.originalDocumentNo ? ` · against ${live.originalDocumentNo}` : ' · without invoice'}</div></div></div>
        <div className="pos-kv" style={{ width: '100%' }}>
          <span>Refund ({live.refundMethod.toUpperCase()})</span><span>{money(live.refundPaise)}</span>
          <span>Lines</span><span>{live.lines.length}</span>
          <span>Cloud sync</span><span><StatusBadge meta={SYNC_STATE[live.syncState]} /></span>
        </div>
        {live.refundMethod === 'cash' ? <InlineAlert tone="info" icon="Banknote">Hand {money(live.refundPaise)} to the customer from the drawer. Expected cash is reduced automatically.</InlineAlert> : null}
        <div className="ex-row">
          <Button icon="Printer" onClick={() => print(<ReturnReceipt db={device} ret={live} />)}>Print credit note</Button>
          <Button variant="primary" icon="Plus" onClick={onNew}>New return</Button>
        </div>
      </div>
    </Card>
  );
}

function RefundPreview({ refund, restock, damaged, loyalty, approval, method, setMethod, methods, onCommit, busy, disabled }: { refund: number; restock: number; damaged: number; loyalty: number; approval: boolean; method: TenderMethod; setMethod: (m: TenderMethod) => void; methods: TenderMethod[]; onCommit: () => void; busy: boolean; disabled: boolean }) {
  return (
    <Card>
      <CardHeader title="Refund preview" icon="Calculator" />
      <CardBody>
        <div className="ex-stack">
          <Select label="Refund method" value={method} onChange={(e) => setMethod(e.target.value as TenderMethod)} options={methods.map((m) => ({ value: m, label: m === 'credit' ? 'Credit note to customer account' : m.toUpperCase() }))} />
          <div className="pos-kv">
            <span>Stock back to shelf</span><span>{restock} unit{restock === 1 ? '' : 's'}</span>
            <span>Damaged (not sellable)</span><span>{damaged} unit{damaged === 1 ? '' : 's'}</span>
            <span>Loyalty reversed</span><span>{loyalty ? `−${loyalty} pts` : '—'}</span>
            <span>Manager approval</span><span>{approval ? 'Required' : 'Not required'}</span>
            <span className="total">Refund</span><span className="total">{money(refund)}</span>
          </div>
          <Button variant="primary" size="lg" block icon={approval ? 'ShieldCheck' : 'Undo2'} disabled={disabled} loading={busy} onClick={onCommit}>{approval ? 'Approve & post return' : 'Post return'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function InvoiceReturn({ initial, onDone }: { initial: string; onDone: (r: SaleReturn) => void }) {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const [q, setQ] = useState(initial);
  const [sale, setSale] = useState<Sale>();
  const [lines, setLines] = useState<RetLine[]>([]);
  const [method, setMethod] = useState<TenderMethod>('cash');
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const results = useLive(device, ['sales'], () => {
    const t = q.trim().toLowerCase();
    const list = device.where('sales', (x) => x.tenantId === s.tenant.id && x.storeId === s.store.id && x.kind === 'retail');
    const f = t ? list.filter((x) => x.documentNo.toLowerCase().includes(t) || (x.customerName ?? '').toLowerCase().includes(t)) : list;
    return f.sort((a, b) => b.committedAt.localeCompare(a.committedAt)).slice(0, 12);
  }, [q]);

  const pick = (x: Sale) => {
    setSale(x);
    setLines(x.lines.map((l) => ({ saleLineId: l.id, productId: l.productId, name: l.name, max: Math.max(0, l.qty - l.returnedQty), qty: Math.max(0, l.qty - l.returnedQty), unitRefund: Math.round(l.netPaise / l.qty), reason: REASONS[0]!, restockable: true, batchId: l.batchId, selected: false })));
    setMethod(x.tenders[0]?.method === 'credit' ? 'credit' : 'cash');
  };
  useEffect(() => {
    if (initial) {
      const x = device.where('sales', (y) => y.documentNo === initial)[0];
      if (x) pick(x);
    }
  }, [initial]); // eslint-disable-line react-hooks/exhaustive-deps

  const chosen = lines.filter((l) => l.selected && l.qty > 0);
  const refund = chosen.reduce((a, l) => a + Math.round(l.unitRefund * l.qty), 0);
  const restock = chosen.filter((l) => l.restockable).reduce((a, l) => a + l.qty, 0);
  const damaged = chosen.filter((l) => !l.restockable).reduce((a, l) => a + l.qty, 0);
  const needsApproval = refund > APPROVAL_ABOVE;
  const loyalty = sale?.customerId ? Math.floor(refund / 10000) : 0;

  const post = async (approvedBy?: string) => {
    const origin = originOf(s);
    if (!origin || !sale) return;
    setBusy(true);
    try {
      const r = await commitReturn(device, { origin, originalSaleId: sale.id, lines: chosen.map((l) => ({ saleLineId: l.saleLineId, productId: l.productId, name: l.name, qty: l.qty, refundPaise: Math.round(l.unitRefund * l.qty), restockable: l.restockable, reason: l.reason, batchId: l.batchId })), refundMethod: method, approvedBy });
      toast.success('Return posted', `${r.documentNo} · refund ${money(r.refundPaise)}`);
      onDone(r);
    } catch (e) {
      toast.error('Return not saved', `${(e as Error).message} Nothing was posted — retry.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-split">
      <div className="ex-stack">
        <Card>
          <CardHeader title="Find original invoice" icon="Search" subtitle="Invoice number or customer name" />
          <CardBody>
            <div className="ex-stack">
              <SearchInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} placeholder="e.g. 001266 or Lakshmi" />
              {!sale ? (
                <div className="pos-list">
                  {results.map((x) => (
                    <button key={x.id} type="button" className="pos-list__row" onClick={() => pick(x)}>
                      <Icon name="Receipt" size={16} />
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <b className="num">{x.documentNo}</b>
                        <div className="muted" style={{ fontSize: 12 }}>{dateTime(x.committedAt)} · {x.customerName ?? 'Walk-in'} · {x.itemCount} items</div>
                      </div>
                      {x.status === 'returned' ? <Badge tone="warning" icon="Undo2">Partly returned</Badge> : null}
                      <b className="num">{money(x.totalPaise)}</b>
                    </button>
                  ))}
                  {!results.length ? <EmptyState quiet title="No invoice found">Check the number, or use “Without invoice” (manager approval).</EmptyState> : null}
                </div>
              ) : (
                <div className="ex-row" style={{ padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: 8 }}>
                  <Icon name="Receipt" size={16} />
                  <b className="num">{sale.documentNo}</b>
                  <span className="muted">{dateTime(sale.committedAt)} · {sale.customerName ?? 'Walk-in'} · {money(sale.totalPaise)}</span>
                  <span className="ex-spacer" />
                  <Button size="sm" variant="ghost" onClick={() => { setSale(undefined); setLines([]); }}>Change</Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
        {sale ? (
          <Card>
            <CardHeader title="Select items to return" subtitle="Quantity cannot exceed sold minus already returned" icon="ListChecks" />
            <table className="ex-table ret-lines">
              <thead><tr><th></th><th>Item</th><th className="ex-right">Returnable</th><th className="ex-right">Qty</th><th>Reason</th><th>Restockable</th><th className="ex-right">Refund</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.saleLineId} style={l.max === 0 ? { opacity: 0.5 } : undefined}>
                    <td><Checkbox label={<span className="sr-only">Select {l.name}</span>} checked={l.selected} disabled={l.max === 0} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, selected: e.target.checked } : x)))} /></td>
                    <td><b>{l.name}</b>{l.max === 0 ? <div className="muted" style={{ fontSize: 12 }}>Already fully returned</div> : null}</td>
                    <td className="ex-right num">{l.max}</td>
                    <td className="ex-right"><input className="bill__disc num" style={{ width: 64 }} aria-label={`Return qty ${l.name}`} value={l.qty} disabled={!l.selected} onChange={(e) => { const n = Math.min(l.max, Math.max(0, Number(e.target.value.replace(/[^0-9.]/g, '') || 0))); setLines(lines.map((x, j) => (j === i ? { ...x, qty: n } : x))); }} /></td>
                    <td><select className="ex-select ex-select--sm" value={l.reason} disabled={!l.selected} aria-label="Reason" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></td>
                    <td><Switch checked={l.restockable} disabled={!l.selected} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, restockable: v } : x)))} label={l.restockable ? 'Yes' : 'Damaged'} /></td>
                    <td className="ex-right num">{l.selected ? money(Math.round(l.unitRefund * l.qty)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
      {sale ? (
        <RefundPreview refund={refund} restock={restock} damaged={damaged} loyalty={loyalty} approval={needsApproval} method={method} setMethod={setMethod} methods={sale.customerId ? ['cash', 'upi', 'card', 'credit'] : ['cash', 'upi', 'card']} busy={busy} disabled={!chosen.length} onCommit={() => (needsApproval ? setAsk(true) : void post())} />
      ) : (
        <InlineAlert tone="info" icon="Info" title="How returns work">Pick the invoice, tick the items and quantities, choose reason and whether the item goes back to the shelf. Refunds above {money(APPROVAL_ABOVE)} need a manager PIN.</InlineAlert>
      )}
      <ApprovalDialog open={ask} onClose={() => setAsk(false)} action={`Return against ${sale?.documentNo}`} requested={money(refund)} allowed={money(APPROVAL_ABOVE)} verify={managerVerifier(device, s)} onApproved={(r) => { setAsk(false); void recordApproval(device, s, { action: 'void', summary: `Return refund ${money(refund)} on ${sale?.documentNo}`, approverId: r.approverId, reason: r.reason, amountPaise: refund }); void post(r.approverId); }} />
    </div>
  );
}

function NoInvoiceReturn({ onDone }: { onDone: (r: SaleReturn) => void }) {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [product, setProduct] = useState<Product>();
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState(REASONS[0]!);
  const [restockable, setRestockable] = useState(true);
  const [method, setMethod] = useState<TenderMethod>('cash');
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const results = useMemo(() => (q.trim().length >= 2 ? searchProducts(device, s.tenant.id, q, 8) : []), [device, s.tenant.id, q]);
  const n = Number(qty || 0);
  const unit = rupeesToPaise(price || 0);
  const refund = Math.round(n * unit);

  const post = async (approvedBy: string) => {
    const origin = originOf(s);
    if (!origin || !product) return;
    setBusy(true);
    try {
      const r = await commitReturn(device, { origin, lines: [{ productId: product.id, name: product.name, qty: n, refundPaise: refund, restockable, reason }], refundMethod: method, approvedBy });
      toast.success('Return posted', r.documentNo);
      onDone(r);
    } catch (e) {
      toast.error('Return not saved', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-split">
      <Card>
        <CardHeader title="Return without invoice" icon="ShieldCheck" subtitle="Always needs a manager PIN — the approval is audited" />
        <CardBody>
          <div className="ex-stack">
            {!product ? (
              <>
                <SearchInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Scan or search the returned product" />
                <div className="pos-list">
                  {results.map((p) => (
                    <button key={p.id} type="button" className="pos-list__row" onClick={() => { setProduct(p); setPrice((p.salePaise / 100).toFixed(2)); }}>
                      <Icon name="Package" size={16} /><span style={{ flex: 1, textAlign: 'left' }}><b>{p.name}</b><div className="muted" style={{ fontSize: 12 }}>{p.barcode}</div></span><span className="num">{money(p.salePaise)}</span>
                    </button>
                  ))}
                  {q.trim().length >= 2 && !results.length ? <EmptyState quiet title="No product found" /> : null}
                </div>
              </>
            ) : (
              <>
                <div className="ex-row" style={{ padding: '8px 12px', border: '1px solid var(--border-default)', borderRadius: 8 }}><Icon name="Package" size={16} /><b>{product.name}</b><span className="ex-spacer" /><Button size="sm" variant="ghost" onClick={() => setProduct(undefined)}>Change</Button></div>
                <div className="ex-row" style={{ alignItems: 'flex-start' }}>
                  <TextField label="Quantity" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))} />
                  <TextField label="Refund per unit" prefix="₹" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} hint={`Current price ${money(product.salePaise)}`} error={unit > product.mrpPaise ? `Cannot exceed MRP ${money(product.mrpPaise)}.` : undefined} />
                </div>
                <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS.map((r) => ({ value: r, label: r }))} />
                <Switch checked={restockable} onChange={setRestockable} label={restockable ? 'Restockable — goes back to shelf' : 'Damaged — not sellable'} />
              </>
            )}
          </div>
        </CardBody>
      </Card>
      {product ? (
        <RefundPreview refund={refund} restock={restockable ? n : 0} damaged={restockable ? 0 : n} loyalty={0} approval method={method} setMethod={setMethod} methods={['cash', 'upi', 'card']} busy={busy} disabled={!(n > 0) || unit <= 0 || unit > product.mrpPaise} onCommit={() => setAsk(true)} />
      ) : <InlineAlert tone="warning" icon="ShieldCheck">Returns without an invoice are a fraud risk. A manager must approve each one with their PIN.</InlineAlert>}
      <ApprovalDialog open={ask} onClose={() => setAsk(false)} action="Return without invoice" requested={`${n} × ${product?.name ?? ''} · ${money(refund)}`} verify={managerVerifier(device, s, 'pos.return.no-invoice')} onApproved={(r) => { setAsk(false); void recordApproval(device, s, { action: 'return-no-invoice', summary: `Return without invoice · ${product?.name}`, approverId: r.approverId, reason: r.reason, amountPaise: refund }); void post(r.approverId); }} />
    </div>
  );
}
