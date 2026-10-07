import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Batch, Customer, Product, Sale } from '@elixir/contracts';
import { discountNeedsApproval, documentNumber, expiryHealth, pickBatchFefo } from '@elixir/domain';
import { daysUntil, money, monthYear, qty as fmtQty } from '@elixir/format';
import { batchesFor, completeSale, deleteHeldCart, holdCart, onHand, productByBarcode, searchProducts } from '@elixir/local-store';
import { useLive, useMeta } from '@elixir/local-store/react';
import { ApprovalDialog, Badge, BarcodeInput, Button, ConfirmDialog, EmptyState, Icon, IconButton, InlineAlert, Kbd, Modal, QuantityStepper, Segmented, TextField, useToast, cx } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { evaluateCart, useCart, type CartLine } from '../lib/cart';
import { managerVerifier, originOf, recordApproval } from '../lib/ops';
import { overlayOpen, useHotkeys } from '../lib/hotkeys';
import { usePrint } from '../lib/print';
import { PaymentModal } from '../components/PaymentModal';
import { CustomerPicker } from '../components/CustomerPicker';
import { ShortcutOverlay } from '../components/ShortcutOverlay';
import { ShiftGate } from '../components/ShiftGate';
import { Receipt } from '../components/Receipt';
import type { ApprovalAction } from '@elixir/contracts';

interface PendingApproval {
  action: string;
  approvalAction: ApprovalAction;
  requested?: string;
  allowed?: string;
  detail?: string;
  onApproved: (approverId: string, reason?: string) => void;
}

const scaleReading = () => Math.round((0.25 + Math.random() * 1.5) * 1000) / 1000;

export function BillingScreen() {
  const s = useSession();
  if (!s.shift) return <ShiftGate />;
  return <Billing />;
}

function Billing() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const print = usePrint((x) => x.print);
  const cart = useCart();
  const caps = s.capabilities;
  const has = (c: string) => caps.includes(c as never);
  const scanRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(-1);
  const [notFound, setNotFound] = useState<string>();
  const [dropdown, setDropdown] = useState(false);
  const [modal, setModal] = useState<null | 'customer' | 'discount' | 'resume' | 'reset' | 'shortcuts' | 'pay'>(null);
  const [serialFor, setSerialFor] = useState<{ product: Product; lineKey?: string }>();
  const [rxFor, setRxFor] = useState<{ product: Product; batchId?: string }>();
  const [approval, setApproval] = useState<PendingApproval>();
  const [flash, setFlash] = useState<string>();

  // Live re-evaluation when stock/products/prices change (pulled master changes apply instantly).
  const customer = useLive(device, ['customers'], () => device.get('customers', cart.customerId), [cart.customerId]);
  const view = useLive(device, ['products', 'stockMovements', 'batches', 'taxRates'], () => evaluateCart(device, s, cart.lines, cart.billDiscountPct, customer, cart.priceMode), [cart.lines, cart.billDiscountPct, customer, cart.priceMode, s.store.id]);
  const results = useLive(device, ['products'], () => (query.trim().length >= 2 ? searchProducts(device, s.tenant.id, query, 12) : []), [query]);
  const held = useLive(device, ['heldCarts'], () => device.where('heldCarts', (h) => h.counterId === s.counter?.id).sort((a, b) => b.heldAt.localeCompare(a.heldAt)), [s.counter?.id]);
  const seqs = useMeta<Record<string, number>>(device, 'sequences');
  const nextInvoice = documentNumber('INV', `${s.store.code}-${s.counter?.code}`, (seqs?.[`INV|${s.counter?.id}`] ?? 1000) + 1);

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), []);
  const anyOverlay = modal !== null || !!serialFor || !!rxFor || !!approval;
  useEffect(() => {
    if (!anyOverlay) focusScan();
  }, [anyOverlay, focusScan]);

  // Scanner-first: printable keys typed while focus is elsewhere (menus, buttons) go to the scan field.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (anyOverlay || overlayOpen() || e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || '+-=?'.includes(e.key)) return;
      const a = document.activeElement as HTMLElement | null;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return;
      scanRef.current?.focus();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [anyOverlay]);

  const pulse = (key: string) => {
    setFlash(key);
    setTimeout(() => setFlash((f) => (f === key ? undefined : f)), 500);
  };

  // ── Adding products ──
  const addProduct = (p: Product, opts: { batchId?: string; rx?: CartLine['rx']; serial?: string } = {}) => {
    setQuery('');
    setDropdown(false);
    setNotFound(undefined);
    setHi(-1);
    if (p.serialTracked && has('serial-tracking') && !opts.serial) {
      setSerialFor({ product: p });
      return;
    }
    let batchId = opts.batchId;
    if (p.batchTracked && has('batch-expiry') && !batchId) {
      const batches = batchesFor(device, p.id);
      const pick = pickBatchFefo(batches, (b) => onHand(device, s.store.id, p.id, b));
      if (!pick) {
        const live = batches.filter((b) => expiryHealth(b.expiryDate) !== 'expired');
        if (!live.length) {
          toast.error('Cannot sell — all batches expired', `${p.name}: every batch on record is past expiry. Remove from shelf.`);
          focusScan();
          return;
        }
        batchId = live[0]!.id;
      } else batchId = pick.id;
    }
    if (p.prescriptionRequired && has('prescription') && !opts.rx) {
      const existing = cart.lines.find((l) => l.productId === p.id && l.rx);
      if (existing) opts.rx = existing.rx;
      else {
        setRxFor({ product: p, batchId });
        return;
      }
    }
    if (opts.serial) {
      const existing = cart.lines.find((l) => l.productId === p.id && l.serials?.length);
      if (existing) {
        if (existing.serials!.includes(opts.serial)) return;
        cart.update(existing.key, { serials: [...existing.serials!, opts.serial], qty: existing.qty + 1 });
        pulse(existing.key);
        toast.success(`${p.name}`, `Serial ${opts.serial} added`);
        focusScan();
        return;
      }
    }
    const weighed = p.weighted && has('weighted-items');
    const q = weighed ? (has('scale') ? scaleReading() : 1) : 1;
    cart.add({ productId: p.id, qty: q, batchId, rx: opts.rx, serials: opts.serial ? [opts.serial] : undefined }, !weighed);
    const st = useCart.getState();
    const added = st.lines[st.selected];
    if (added) pulse(added.key);
    if (weighed && has('scale')) toast.info(`Scale reading ${fmtQty(q, true)} kg`, p.name);
    focusScan();
  };

  const onScan = (code: string) => {
    if (dropdown && hi >= 0 && results[hi]) return addProduct(results[hi]);
    const exact = productByBarcode(device, s.tenant.id, code);
    if (exact) return addProduct(exact);
    if (results.length) {
      setDropdown(true);
      setHi(0);
      return;
    }
    setNotFound(code);
    setQuery('');
  };

  // ── Line operations ──
  const sel = cart.selected >= 0 ? cart.lines[cart.selected] : undefined;
  const setQty = (l: CartLine, q: number) => {
    const p = device.get('products', l.productId);
    if (p?.serialTracked && has('serial-tracking')) {
      if (q > l.qty) setSerialFor({ product: p, lineKey: l.key });
      else if (q < l.qty) cart.update(l.key, { qty: q, serials: l.serials?.slice(0, q) });
      if (q <= 0) cart.remove(l.key);
      return;
    }
    if (q <= 0) cart.remove(l.key);
    else cart.update(l.key, { qty: q });
  };

  const requestLineDiscount = (l: CartLine, pct: number) => {
    const clean = Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
    if (!s.permissions.includes('pos.discount.line')) {
      toast.warning('Line discount not permitted for your role');
      return;
    }
    if (discountNeedsApproval(clean, s.role.discountLimitPct)) {
      setApproval({
        action: `Line discount on ${device.get('products', l.productId)?.name}`,
        approvalAction: 'discount',
        requested: `${clean}%`,
        allowed: `${s.role.discountLimitPct}%`,
        onApproved: (approverId, reason) => {
          cart.update(l.key, { lineDiscountPct: clean });
          cart.setApprovedBy(approverId);
          void recordApproval(device, s, { action: 'discount', summary: `Line discount ${clean}%`, approverId, reason, requestedValue: clean, allowedValue: s.role.discountLimitPct });
        },
      });
      return;
    }
    cart.update(l.key, { lineDiscountPct: clean });
  };

  const requestBillDiscount = (pct: number) => {
    const clean = Math.max(0, Math.min(100, pct));
    if (discountNeedsApproval(clean, s.role.discountLimitPct)) {
      setModal(null);
      setApproval({
        action: 'Bill discount',
        approvalAction: 'discount',
        requested: `${clean}%`,
        allowed: `${s.role.discountLimitPct}%`,
        detail: `Bill value ${money(view.totals.grossPaise)}`,
        onApproved: (approverId, reason) => {
          cart.setBillDiscount(clean, approverId);
          void recordApproval(device, s, { action: 'discount', summary: `Bill discount ${clean}%`, approverId, reason, requestedValue: clean, allowedValue: s.role.discountLimitPct });
        },
      });
      return;
    }
    cart.setBillDiscount(clean);
    setModal(null);
  };

  const requestNegativeStock = (l: CartLine, name: string, stock: number) =>
    setApproval({
      action: `Sell beyond stock · ${name}`,
      approvalAction: 'negative-stock',
      requested: `${l.qty}`,
      allowed: `${Math.max(0, stock)} on hand`,
      detail: 'Negative stock is blocked by store policy. Approving records an override against this line.',
      onApproved: (approverId, reason) => {
        cart.update(l.key, { negativeApprovedBy: approverId });
        void recordApproval(device, s, { action: 'negative-stock', summary: `Negative stock override · ${name}`, approverId, reason });
      },
    });

  // ── Bill operations ──
  const hold = async () => {
    if (!cart.lines.length) return toast.info('Nothing to hold', 'Scan items first.');
    const label = `${customer?.name ?? 'Walk-in'} · ${view.totals.itemCount} item${view.totals.itemCount === 1 ? '' : 's'} · ${money(view.totals.totalPaise)}`;
    await holdCart(device, { label, counterId: s.counter!.id, userId: s.user.id, customerId: cart.customerId, lines: cart.lines.map(({ key: _k, ...l }) => l), billDiscountPct: cart.billDiscountPct });
    cart.clear();
    toast.success('Bill held', label);
    focusScan();
  };

  const resume = async (id: string) => {
    const h = device.get('heldCarts', id);
    if (!h) return;
    if (cart.lines.length) await hold();
    cart.load(h);
    await deleteHeldCart(device, h.id);
    setModal(null);
    toast.success('Bill resumed', h.label);
  };

  const process = () => {
    if (!cart.lines.length) return toast.info('Cart is empty', 'Scan a barcode or search a product to start.');
    if (view.blocking.length) return toast.error('Fix the bill before payment', view.blocking[0]);
    setModal('pay');
  };

  const lastSale = useLive(device, ['sales'], () => device.where('sales', (x) => x.counterId === s.counter?.id).sort((a, b) => b.committedAt.localeCompare(a.committedAt))[0], [s.counter?.id]);

  useHotkeys(
    {
      F1: () => (lastSale ? print(<Receipt db={device} sale={lastSale} copy />) : toast.info('No previous receipt on this counter')),
      F2: () => nav('/sales'),
      F3: () => nav('/returns'),
      F4: () => void hold(),
      F5: () => cart.lines.length && setModal('reset'),
      F6: () => (held.length ? setModal('resume') : toast.info('No held bills on this counter')),
      F7: process,
      F8: () => setModal('customer'),
      F9: () => (s.permissions.includes('pos.discount.bill') ? setModal('discount') : toast.warning('Bill discount not permitted for your role')),
      '+': () => sel && setQty(sel, Math.round((sel.qty + 1) * 1000) / 1000),
      '=': () => sel && setQty(sel, Math.round((sel.qty + 1) * 1000) / 1000),
      '-': () => sel && setQty(sel, Math.round((sel.qty - 1) * 1000) / 1000),
      ArrowUp: () => (dropdown ? setHi((h) => Math.max(0, h - 1)) : cart.select(Math.max(0, cart.selected - 1))),
      ArrowDown: () => (dropdown ? setHi((h) => Math.min(results.length - 1, h + 1)) : cart.select(Math.min(cart.lines.length - 1, cart.selected + 1))),
      Delete: () => sel && cart.remove(sel.key),
      '?': () => setModal('shortcuts'),
      Escape: () => { setDropdown(false); setNotFound(undefined); setQuery(''); },
    },
    modal !== 'pay',
  );

  const showBatch = has('batch-expiry') && cart.lines.some((l) => device.get('products', l.productId)?.batchTracked);
  const showUnit = has('multi-uom');
  const pg = customer?.priceGroupId ? device.get('priceGroups', customer.priceGroupId) : undefined;
  const t = view.totals;
  const cgst = t.lines.reduce((a, l) => a + l.cgstPaise, 0);
  const sgst = t.lines.reduce((a, l) => a + l.sgstPaise, 0);
  const igst = t.lines.reduce((a, l) => a + l.igstPaise, 0);
  const allowCredit = !!customer && customer.creditLimitPaise > 0 && s.permissions.includes('pos.credit-sale') && (has('credit-sales') || has('receivables'));

  return (
    <div className="bill">
      <div className="bill__main">
        <div className="bill__top">
          <button type="button" className={cx('bill__cust', customer && 'is-set')} onClick={() => setModal('customer')} aria-label="Select customer (F8)">
            <Icon name={customer ? 'UserRoundCheck' : 'UserRound'} size={18} />
            <span className="bill__cust-main">
              <b className="ex-truncate">{customer?.name ?? 'Walk-in customer'}</b>
              <span className="muted ex-truncate">{customer ? `${customer.phone}${pg ? ` · ${pg.name}` : ''} · ${customer.loyaltyPoints} pts` : 'Add customer for loyalty / credit'}</span>
            </span>
            <Kbd>F8</Kbd>
          </button>
          {has('price-groups') ? (
            <Segmented label="Price mode" value={cart.priceMode} onChange={(m) => cart.setPriceMode(m)} items={[{ key: 'retail', label: 'Retail' }, { key: 'wholesale', label: 'Wholesale' }]} />
          ) : null}
          <div className="bill__scan">
            <BarcodeInput
              ref={scanRef}
              data-scanner="true"
              autoFocus
              value={query}
              onChange={(v) => { setQuery(v); setNotFound(undefined); setDropdown(v.trim().length >= 2); setHi(-1); }}
              onScan={onScan}
              placeholder={s.tenant.vertical === 'pharmacy' ? 'Scan barcode or search medicine / molecule…' : s.tenant.vertical === 'fashion' ? 'Scan barcode or search style, colour, size…' : 'Scan barcode, PLU or search products…'}
              aria-label="Scan barcode or search products"
            />
            {dropdown && results.length > 0 ? (
              <SearchResults results={results} hi={hi} onHover={setHi} onPick={(p) => addProduct(p)} />
            ) : null}
            {dropdown && query.trim().length >= 2 && results.length === 0 ? (
              <div className="bill__dropdown"><div className="muted" style={{ padding: 14 }}>No products match “{query}”.</div></div>
            ) : null}
          </div>
        </div>
        {notFound ? (
          <InlineAlert tone="warning" icon="ScanBarcode" className="bill__notfound" action={<Button size="sm" icon="Search" onClick={() => { setQuery(notFound); setDropdown(true); setNotFound(undefined); focusScan(); }}>Search Product</Button>}>
            Barcode not found <b className="num">{notFound}</b>. Check the code or search by name.
          </InlineAlert>
        ) : null}

        <div className="bill__grid ex-scroll">
          {cart.lines.length === 0 ? (
            <EmptyState icon="ScanBarcode" title="Ready to bill">
              Scan a barcode or type a product name. Press <Kbd>?</Kbd> for shortcuts.
              {held.length ? <div style={{ marginTop: 8 }}><Button size="sm" icon="CirclePlay" onClick={() => setModal('resume')}>Resume held bill ({held.length})</Button></div> : null}
            </EmptyState>
          ) : (
            <table className="bill__table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>#</th>
                  <th>Product</th>
                  {showBatch ? <th className="col-batch">Batch</th> : null}
                  {showUnit ? <th style={{ width: 80 }}>Unit</th> : null}
                  <th className="col-qty">Qty</th>
                  <th className="r" style={{ width: 90 }}>Rate</th>
                  <th className="r" style={{ width: 74 }}>Disc %</th>
                  <th className="r col-tax" style={{ width: 56 }}>Tax</th>
                  <th className="r" style={{ width: 104 }}>Net</th>
                  <th style={{ width: 40 }}><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r, i) => (
                  <LineRow
                    key={r.line.key}
                    index={i}
                    row={r}
                    selected={cart.selected === i}
                    flash={flash === r.line.key}
                    showBatch={showBatch}
                    showUnit={showUnit}
                    weighCap={has('scale')}
                    onSelect={() => cart.select(i)}
                    onQty={(q) => setQty(r.line, q)}
                    onBatch={(b) => cart.update(r.line.key, { batchId: b })}
                    onUnit={(u) => cart.update(r.line.key, { unit: u as CartLine['unit'] })}
                    onDisc={(pct) => requestLineDiscount(r.line, pct)}
                    onRemove={() => { cart.remove(r.line.key); focusScan(); }}
                    onWeigh={() => { const q = scaleReading(); cart.update(r.line.key, { qty: q }); toast.info(`Scale reading ${fmtQty(q, true)} kg`); }}
                    onSerials={() => r.product && setSerialFor({ product: r.product, lineKey: r.line.key })}
                    onOverride={() => r.product && requestNegativeStock(r.line, r.product.name, r.stock)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="bill__keys" aria-label="Shortcuts">
          {[['F4', 'Hold'], ['F6', 'Resume'], ['F8', 'Customer'], ['F9', 'Discount'], ['F5', 'Reset'], ['F1', 'Reprint'], ['F3', 'Return'], ['?', 'All keys']].map(([k, v]) => (
            <span key={k}><Kbd>{k}</Kbd> {v}</span>
          ))}
          <span className="ex-spacer" />
          <span className="muted num">Next {nextInvoice}</span>
        </div>
      </div>

      <aside className="bill__side" aria-label="Bill summary">
        {customer ? (
          <div className="bill__custcard">
            <div className="ex-row"><b className="ex-truncate">{customer.name}</b>{customer.tier ? <Badge tone="info" icon="Award">{customer.tier}</Badge> : null}<span className="ex-spacer" /><IconButton icon="X" size="sm" label="Remove customer" onClick={() => cart.setCustomer(undefined)} /></div>
            <div className="bill__custgrid">
              <span className="muted">Price group</span><span>{pg?.name ?? 'Retail'}</span>
              <span className="muted">Loyalty</span><span className="num">{customer.loyaltyPoints} pts</span>
              {customer.creditLimitPaise > 0 ? (<><span className="muted">Credit</span><span className="num">{money(customer.outstandingPaise)} / {money(customer.creditLimitPaise)}</span></>) : null}
            </div>
          </div>
        ) : null}
        <div className="bill__totals">
          <div className="bill__trow"><span>Items</span><b className="num">{t.itemCount} · {cart.lines.length} line{cart.lines.length === 1 ? '' : 's'}</b></div>
          <div className="bill__trow"><span>Gross</span><b className="num">{money(t.grossPaise)}</b></div>
          {t.lineDiscountPaise > 0 ? <div className="bill__trow"><span>Line discounts</span><b className="num">−{money(t.lineDiscountPaise)}</b></div> : null}
          {t.billDiscountPaise > 0 ? <div className="bill__trow"><span>Bill discount ({cart.billDiscountPct}%)</span><b className="num">−{money(t.billDiscountPaise)}</b></div> : null}
          <div className="bill__trow"><span>Taxable value</span><b className="num">{money(t.taxablePaise)}</b></div>
          {igst > 0 ? <div className="bill__trow"><span>IGST</span><b className="num">{money(igst)}</b></div> : (
            <div className="bill__trow"><span>CGST + SGST</span><b className="num">{money(cgst)} + {money(sgst)}</b></div>
          )}
          {t.roundOffPaise ? <div className="bill__trow"><span>Round off</span><b className="num">{money(t.roundOffPaise, { signed: true })}</b></div> : null}
          {t.savingsPaise > 0 ? <div className="bill__trow bill__save"><span><Icon name="BadgePercent" size={14} /> Savings on MRP</span><b className="num">{money(t.savingsPaise)}</b></div> : null}
        </div>
        <div className="bill__grand">
          <span>TOTAL</span>
          <b className="num">{money(t.totalPaise)}</b>
        </div>
        {view.blocking.length ? <InlineAlert tone="danger" title="Fix before payment">{view.blocking[0]}{view.blocking.length > 1 ? ` (+${view.blocking.length - 1} more)` : ''}</InlineAlert> : null}
        <div className="bill__actions">
          <Button size="lg" icon="CirclePause" shortcut="F4" onClick={() => void hold()} disabled={!s.permissions.includes('pos.hold')}>Hold</Button>
          <Button size="lg" icon="CirclePlay" shortcut="F6" onClick={() => setModal('resume')} disabled={!held.length}>Resume{held.length ? ` (${held.length})` : ''}</Button>
          <Button size="lg" icon="Percent" shortcut="F9" onClick={() => setModal('discount')} disabled={!s.permissions.includes('pos.discount.bill') || !cart.lines.length} style={{ gridColumn: 'span 2' }}>
            Bill discount{cart.billDiscountPct ? ` · ${cart.billDiscountPct}%` : ''}
          </Button>
        </div>
        <Button variant="primary" size="xl" block className="bill__process" iconRight="ArrowRight" shortcut="F7" onClick={process} disabled={!cart.lines.length}>
          PROCESS ORDER
        </Button>
      </aside>

      {/* ── Dialogs ── */}
      <CustomerPicker open={modal === 'customer'} onClose={() => setModal(null)} onPick={(c?: Customer) => { cart.setCustomer(c?.id); setModal(null); }} />
      <BillDiscountDialog open={modal === 'discount'} current={cart.billDiscountPct} limit={s.role.discountLimitPct} onClose={() => setModal(null)} onApply={requestBillDiscount} />
      <Modal open={modal === 'resume'} onClose={() => setModal(null)} title="Resume held bill" description={`Held on counter ${s.counter?.code}. The current bill is held automatically.`}>
        <div className="pos-list">
          {held.map((h, i) => (
            <button key={h.id} type="button" className="pos-list__row" autoFocus={i === 0} onClick={() => void resume(h.id)}>
              <Icon name="CirclePause" size={18} />
              <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                <b className="ex-truncate" style={{ display: 'block' }}>{h.label}</b>
                <span className="muted" style={{ fontSize: 12 }}>{h.lines.length} lines · held {new Date(h.heldAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} by {device.get('users', h.userId)?.name}</span>
              </div>
              <Icon name="ChevronRight" size={16} />
            </button>
          ))}
          {!held.length ? <EmptyState quiet title="No held bills" /> : null}
        </div>
      </Modal>
      <ConfirmDialog open={modal === 'reset'} onClose={() => setModal(null)} title="Reset this bill?" confirmLabel="Reset bill" onConfirm={() => { cart.clear(); setModal(null); }}>
        All {cart.lines.length} lines and discounts will be cleared. Nothing has been saved for this bill yet.
      </ConfirmDialog>
      <ShortcutOverlay open={modal === 'shortcuts'} onClose={() => setModal(null)} />
      {serialFor ? (
        <SerialPicker
          product={serialFor.product}
          taken={cart.lines.flatMap((l) => l.serials ?? [])}
          onClose={() => setSerialFor(undefined)}
          onPick={(serial) => {
            const p = serialFor.product;
            setSerialFor(undefined);
            addProduct(p, { serial });
          }}
        />
      ) : null}
      {rxFor ? (
        <RxDialog
          product={rxFor.product}
          onClose={() => setRxFor(undefined)}
          onConfirm={(rx) => {
            const { product, batchId } = rxFor;
            setRxFor(undefined);
            addProduct(product, { batchId, rx });
          }}
        />
      ) : null}
      <ApprovalDialog
        open={!!approval}
        onClose={() => setApproval(undefined)}
        action={approval?.action ?? ''}
        requested={approval?.requested}
        allowed={approval?.allowed}
        detail={approval?.detail}
        verify={managerVerifier(device, s)}
        onApproved={(r) => {
          approval?.onApproved(r.approverId, r.reason);
          toast.success('Approved once', `${approval?.action} · by ${r.approverName}`);
          setApproval(undefined);
        }}
      />
      <PaymentModal
        open={modal === 'pay'}
        onClose={() => setModal(null)}
        duePaise={t.totalPaise}
        customer={customer}
        allowCredit={allowCredit}
        title="Payment"
        context={`${t.itemCount} items · ${customer?.name ?? 'Walk-in'} · ${s.counter?.code}`}
        onCommit={(tenders, clientTransactionId): Promise<Sale> => {
          const origin = originOf(s);
          if (!origin) return Promise.reject(new Error('Open a shift before billing.'));
          const approvedBy = cart.approvedBy ?? cart.lines.find((l) => l.negativeApprovedBy)?.negativeApprovedBy;
          return completeSale(device, {
            clientTransactionId,
            origin,
            lines: cart.lines.map(({ key: _k, rx, negativeApprovedBy: _n, ...l }) => ({ ...l, note: rx ? `Rx ${rx.doctor} · ${rx.ref}` : l.note })),
            billDiscountPct: cart.billDiscountPct,
            tenders,
            customerId: cart.customerId,
            approvedBy,
            priceMode: cart.priceMode,
          });
        }}
        onDone={() => {
          cart.clear();
          setModal(null);
          focusScan();
        }}
      />
    </div>
  );
}

// ───────────────────────── Search results (vertical-aware, §23) ─────────────────────────
function SearchResults({ results, hi, onHover, onPick }: { results: Product[]; hi: number; onHover: (i: number) => void; onPick: (p: Product) => void }) {
  const { device } = usePos();
  const s = useSession();
  return (
    <div className="bill__dropdown" role="listbox" aria-label="Product search results">
      {results.map((p, i) => {
        const stock = onHand(device, s.store.id, p.id);
        const batch = p.batchTracked ? pickBatchFefo(batchesFor(device, p.id), (b) => onHand(device, s.store.id, p.id, b)) : undefined;
        return (
          <button key={p.id} type="button" role="option" aria-selected={i === hi} className={cx('bill__opt', i === hi && 'is-hi')} onMouseEnter={() => onHover(i)} onMouseDown={(e) => { e.preventDefault(); onPick(p); }}>
            <div className="bill__opt-main">
              <div className="ex-row" style={{ gap: 6 }}>
                <b className="ex-truncate">{p.name}</b>
                {p.schedule && p.schedule !== 'OTC' ? <Badge tone="danger" icon="FileText">Sch {p.schedule}</Badge> : null}
                {p.prescriptionRequired ? <Badge tone="warning">Rx</Badge> : null}
                {p.serialTracked ? <Badge tone="info" icon="Hash">Serial</Badge> : null}
              </div>
              <div className="bill__opt-sub">
                <OptAttrs p={p} batch={batch} vertical={s.tenant.vertical} />
                <span className={cx('num', stock <= 0 ? 'neg' : stock <= p.reorderLevel ? 'warn' : '')}>Stock {fmtQty(stock, p.decimalQty)}</span>
              </div>
            </div>
            <div className="bill__opt-price num">
              {money(p.salePaise)}{p.weighted ? <span className="muted">/kg</span> : null}
              {p.mrpPaise > p.salePaise ? <s className="muted">{money(p.mrpPaise)}</s> : null}
            </div>
          </button>
        );
      })}
      <div className="bill__dropdown-foot"><Kbd>↑</Kbd><Kbd>↓</Kbd> select · <Kbd>Enter</Kbd> add · <Kbd>Esc</Kbd> close</div>
    </div>
  );
}

function OptAttrs({ p, batch, vertical }: { p: Product; batch?: Batch; vertical: string }) {
  const bits: string[] = [];
  if (vertical === 'pharmacy') {
    if (p.molecule) bits.push(p.molecule);
    if (batch) bits.push(`Batch ${batch.code} · Exp ${monthYear(batch.expiryDate)}`);
    if (p.rack) bits.push(`Rack ${p.rack}`);
  } else if (vertical === 'fashion') {
    if (p.variantAttrs?.color) bits.push(p.variantAttrs.color);
    if (p.variantAttrs?.size) bits.push(`Size ${p.variantAttrs.size}`);
    bits.push(p.sku);
  } else if (vertical === 'electronics') {
    if (p.model) bits.push(`Model ${p.model}`);
    if (p.warrantyMonths) bits.push(`${p.warrantyMonths}m warranty`);
  } else {
    if (p.weighted) bits.push(`PLU ${p.plu} · weighed`);
    if (batch) bits.push(`Exp ${monthYear(batch.expiryDate)}`);
    bits.push(p.barcode);
  }
  return <span className="ex-truncate">{bits.join(' · ')}</span>;
}

// ───────────────────────── Grid row ─────────────────────────
function LineRow(props: {
  index: number;
  row: ReturnType<typeof evaluateCart>['rows'][number];
  selected: boolean;
  flash: boolean;
  showBatch: boolean;
  showUnit: boolean;
  weighCap: boolean;
  onSelect: () => void;
  onQty: (q: number) => void;
  onBatch: (b: string) => void;
  onUnit: (u: string) => void;
  onDisc: (pct: number) => void;
  onRemove: () => void;
  onWeigh: () => void;
  onSerials: () => void;
  onOverride: () => void;
}) {
  const { device } = usePos();
  const s = useSession();
  const { row, index } = props;
  const p = row.product;
  const l = row.line;
  const priced = row.priced;
  const [disc, setDisc] = useState(String(l.lineDiscountPct ?? 0));
  useEffect(() => setDisc(String(l.lineDiscountPct ?? 0)), [l.lineDiscountPct]);
  const batches = p?.batchTracked ? batchesFor(device, p.id) : [];
  const batch = batches.find((b) => b.id === l.batchId);
  const exp = batch ? expiryHealth(batch.expiryDate, 60) : undefined;
  const weighted = !!p?.weighted && s.capabilities.includes('weighted-items');
  const sub: string[] = [];
  if (priced?.variantLabel) sub.push(priced.variantLabel);
  if (p?.sku && s.tenant.vertical === 'fashion') sub.push(p.sku);
  if (l.serials?.length) sub.push(`SN ${l.serials.join(', ')}`);
  if (p?.warrantyMonths && s.capabilities.includes('warranty')) sub.push(`${p.warrantyMonths}m warranty`);
  if (l.rx) sub.push(`Rx · ${l.rx.doctor} · ${l.rx.ref}`);
  if (!sub.length && p) sub.push(p.barcode);
  return (
    <>
      <tr className={cx(props.selected && 'is-sel', props.flash && 'is-flash', (row.error || row.stockShort) && 'is-err')} onClick={props.onSelect}>
        <td className="muted num">{index + 1}</td>
        <td>
          <div className="bill__pname ex-truncate">{p?.name ?? l.productId}</div>
          <div className="bill__psub ex-truncate">{sub.join(' · ')}</div>
        </td>
        {props.showBatch ? (
          <td>
            {p?.batchTracked ? (
              <div className="ex-stack" style={{ gap: 2 }}>
                <select className="ex-select ex-select--sm bill__batch" value={l.batchId ?? ''} onChange={(e) => props.onBatch(e.target.value)} aria-label="Batch">
                  {batches.map((b) => {
                    const h = expiryHealth(b.expiryDate);
                    return (
                      <option key={b.id} value={b.id} disabled={h === 'expired'}>
                        {b.code} · {monthYear(b.expiryDate)} · {onHand(device, s.store.id, b.productId, b.id)} {h === 'expired' ? '(expired)' : ''}
                      </option>
                    );
                  })}
                </select>
                {exp === 'near' && batch ? <Badge tone="warning" icon="CalendarClock">Expires in {daysUntil(batch.expiryDate)}d</Badge> : exp === 'expired' ? <Badge tone="danger" icon="CalendarX">Expired</Badge> : null}
              </div>
            ) : <span className="muted">—</span>}
          </td>
        ) : null}
        {props.showUnit ? (
          <td>
            {p?.uomConversions?.length ? (
              <select className="ex-select ex-select--sm" value={l.unit ?? p.unit} onChange={(e) => props.onUnit(e.target.value)} aria-label="Unit">
                <option value={p.unit}>{p.unit}</option>
                {p.uomConversions.map((u) => <option key={u.unit} value={u.unit}>{u.unit} ({u.factor})</option>)}
              </select>
            ) : <span className="muted">{p?.unit}</span>}
          </td>
        ) : null}
        <td>
          <div className="bill__qty">
            <QuantityStepper size="sm" value={l.qty} decimal={weighted} step={weighted ? 0.1 : 1} min={0} onChange={props.onQty} label={`Quantity of ${p?.name}`} />
            {weighted ? <span className="muted" style={{ fontSize: 12 }}>kg</span> : null}
            {weighted && props.weighCap ? <Button size="sm" variant="ghost" icon="Scale" onClick={(e) => { e.stopPropagation(); props.onWeigh(); }} aria-label="Weigh on scale"><span className="bill__btnlabel">Weigh</span></Button> : null}
            {p?.serialTracked ? <Button size="sm" variant="ghost" icon="Hash" onClick={(e) => { e.stopPropagation(); props.onSerials(); }} aria-label="Pick serial"><span className="bill__btnlabel">Serial</span></Button> : null}
          </div>
          <div className={cx('bill__stock num', row.stockShort && 'neg')}>Stock {fmtQty(row.stock, p?.decimalQty)}</div>
        </td>
        <td className="r num">{priced ? money(priced.unitPricePaise) : '—'}{priced && priced.mrpPaise > priced.unitPricePaise ? <div className="bill__mrp">MRP {money(priced.mrpPaise)}</div> : null}</td>
        <td className="r">
          <input
            className="bill__disc num"
            inputMode="decimal"
            aria-label={`Discount percent for ${p?.name}`}
            value={disc}
            onChange={(e) => setDisc(e.target.value.replace(/[^0-9.]/g, ''))}
            onBlur={() => Number(disc || 0) !== (l.lineDiscountPct ?? 0) && props.onDisc(Number(disc || 0))}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            disabled={!s.permissions.includes('pos.discount.line')}
          />
        </td>
        <td className="r num muted col-tax">{priced ? `${priced.taxRatePct}%` : '—'}</td>
        <td className="r num"><b>{priced ? money(priced.netPaise) : '—'}</b>{priced ? <div className="bill__mrp col-tax-inline">GST {priced.taxRatePct}%</div> : null}</td>
        <td><IconButton icon="Trash2" size="sm" label={`Remove ${p?.name}`} onClick={(e) => { e.stopPropagation(); props.onRemove(); }} /></td>
      </tr>
      {row.error || row.stockShort ? (
        <tr className="bill__errrow">
          <td />
          <td colSpan={20}>
            <span className="bill__err"><Icon name="CircleAlert" size={14} /> {row.error ?? `Only ${Math.max(0, row.stock)} in stock — negative stock is blocked.`}</span>
            {!row.error && row.stockShort ? <Button size="sm" variant="ghost" icon="ShieldCheck" onClick={props.onOverride}>Manager override</Button> : null}
            {row.error && p?.serialTracked ? <Button size="sm" variant="ghost" icon="Hash" onClick={props.onSerials}>Pick serial</Button> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ───────────────────────── Dialogs ─────────────────────────
function BillDiscountDialog({ open, current, limit, onClose, onApply }: { open: boolean; current: number; limit: number; onClose: () => void; onApply: (pct: number) => void }) {
  const [v, setV] = useState(String(current || ''));
  useEffect(() => { if (open) setV(current ? String(current) : ''); }, [open, current]);
  const n = Number(v || 0);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Bill discount" description={`Your limit without approval: ${limit}%`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onApply(n)} disabled={n < 0 || n > 100}>{n > limit ? 'Request approval' : 'Apply'}</Button></>}>
      <div className="ex-stack">
        <TextField autoFocus size="lg" label="Discount %" suffix="%" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && onApply(n)} className="num" />
        <div className="ex-row" style={{ flexWrap: 'wrap' }}>
          {[0, 2, 5, 10, 15, 20].map((x) => <button key={x} type="button" className="ex-chip" aria-pressed={n === x} onClick={() => setV(String(x))}>{x === 0 ? 'None' : `${x}%`}</button>)}
        </div>
        {n > limit ? <InlineAlert tone="warning" icon="ShieldCheck">Above your {limit}% limit — a manager PIN is needed to apply {n}%.</InlineAlert> : null}
      </div>
    </Modal>
  );
}

function SerialPicker({ product, taken, onClose, onPick }: { product: Product; taken: string[]; onClose: () => void; onPick: (serial: string) => void }) {
  const { device } = usePos();
  const [q, setQ] = useState('');
  const serials = useMemo(() => device.where('serials', (x) => x.productId === product.id && x.status === 'in-stock' && !taken.includes(x.serial)), [device, product.id, taken]);
  const list = serials.filter((x) => x.serial.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} size="sm" title={`Select serial / IMEI`} description={`${product.name}${product.model ? ` · ${product.model}` : ''}${product.warrantyMonths ? ` · ${product.warrantyMonths} months warranty` : ''}`}>
      <div className="ex-stack">
        <TextField autoFocus icon="ScanLine" placeholder="Scan or type serial / IMEI" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0].serial); }} />
        <div className="pos-list" style={{ maxHeight: 300 }}>
          {list.map((x) => (
            <button key={x.id} type="button" className="pos-list__row" onClick={() => onPick(x.serial)}>
              <Icon name="Hash" size={16} />
              <span className="num" style={{ flex: 1, textAlign: 'left' }}>{x.serial}</span>
              <Badge tone="success" icon="PackageCheck">In stock</Badge>
            </button>
          ))}
          {!list.length ? <EmptyState quiet title="No in-stock serials">{serials.length ? 'No serial matches your search.' : 'All units of this product are sold or allocated.'}</EmptyState> : null}
        </div>
      </div>
    </Modal>
  );
}

function RxDialog({ product, onClose, onConfirm }: { product: Product; onClose: () => void; onConfirm: (rx: { doctor: string; ref: string }) => void }) {
  const [doctor, setDoctor] = useState('');
  const [ref, setRef] = useState('');
  const [seen, setSeen] = useState(false);
  const ok = doctor.trim().length >= 3 && ref.trim().length >= 2 && seen;
  return (
    <Modal open onClose={onClose} size="sm" title="Prescription required" description={`${product.name} · Schedule ${product.schedule} · ${product.molecule ?? ''}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="FileCheck2" disabled={!ok} onClick={() => onConfirm({ doctor: doctor.trim(), ref: ref.trim() })}>Confirm & add</Button></>}>
      <div className="ex-stack">
        <InlineAlert tone="warning" icon="FileText">Schedule {product.schedule} medicine. Verify a valid prescription before dispensing. Details are recorded on the bill.</InlineAlert>
        <TextField autoFocus label="Doctor name" required value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Dr. R. Kumar" />
        <TextField label="Prescription ref / Reg. no." required value={ref} onChange={(e) => setRef(e.target.value)} placeholder="RX-2041" onKeyDown={(e) => e.key === 'Enter' && ok && onConfirm({ doctor: doctor.trim(), ref: ref.trim() })} />
        <label className="ex-check"><input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} /> <span>I have seen the original prescription</span></label>
      </div>
    </Modal>
  );
}
