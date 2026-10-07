import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Customer, Sale, Tender, TenderMethod } from '@elixir/contracts';
import { changeDue, quickCashOptions, SYNC_STATE, uid } from '@elixir/domain';
import { money, rupeesToPaise } from '@elixir/format';
import { LocalCommitError, markPrinted } from '@elixir/local-store';
import { useEntity } from '@elixir/local-store/react';
import { ApprovalDialog, Badge, Button, Icon, InlineAlert, Kbd, Modal, NumericKeypad, StatusBadge, TextField, cx } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { managerVerifier, recordApproval } from '../lib/ops';
import { usePrint } from '../lib/print';
import { Receipt } from './Receipt';

type Method = Exclude<TenderMethod, 'redemption'> | 'split';
type DraftTender = Omit<Tender, 'id' | 'saleId'>;

const METHODS: Array<{ key: Method; label: string; icon: string; hot: string }> = [
  { key: 'cash', label: 'Cash', icon: 'Banknote', hot: 'C' },
  { key: 'upi', label: 'UPI', icon: 'QrCode', hot: 'U' },
  { key: 'card', label: 'Card', icon: 'CreditCard', hot: 'D' },
  { key: 'credit', label: 'Credit', icon: 'NotebookPen', hot: 'R' },
  { key: 'split', label: 'Split', icon: 'Split', hot: 'S' },
];
const LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit' };

export interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  duePaise: number;
  customer?: Customer;
  allowCredit?: boolean;
  title?: string;
  context?: ReactNode;
  onCommit: (tenders: DraftTender[], clientTransactionId: string) => Promise<Sale>;
  onDone: (sale: Sale) => void;
}

/** Focused payment mode (§24) + success screen (§25). Local commit = success; sync is separate. */
export function PaymentModal(p: PaymentModalProps) {
  const { device, engine } = usePos();
  const s = useSession();
  const [clientTx, setClientTx] = useState('');
  const [phase, setPhase] = useState<'tender' | 'committing' | 'success' | 'error'>('tender');
  const [method, setMethod] = useState<Method>('cash');
  const [splitMethod, setSplitMethod] = useState<Exclude<Method, 'split'>>('cash');
  const [entry, setEntry] = useState('');
  const [ref, setRef] = useState('');
  const [splits, setSplits] = useState<DraftTender[]>([]);
  const [error, setError] = useState<{ title: string; message: string; code?: string }>();
  const [sale, setSale] = useState<Sale>();
  const [printState, setPrintState] = useState<'printing' | 'printed' | 'failed'>('printing');
  const [creditApproval, setCreditApproval] = useState<string>();
  const [askCredit, setAskCredit] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const online = engine?.canReachCloud() ?? true;
  const print = usePrint((x) => x.print);

  useEffect(() => {
    if (p.open) {
      setClientTx(uid('sa')); // stable id → retries & double-clicks never create two sales
      setPhase('tender');
      setMethod('cash');
      setEntry('');
      setRef('');
      setSplits([]);
      setError(undefined);
      setSale(undefined);
      setCreditApproval(undefined);
      // Modal focus-trap focuses the first button; the amount field should own the keyboard.
      const t = setTimeout(() => amountRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [p.open]);

  const due = p.duePaise;
  const splitPaid = splits.reduce((a, t) => a + t.amountPaise, 0);
  const remaining = Math.max(0, due - splitPaid);
  const entryPaise = entry ? rupeesToPaise(entry) : 0;
  const quick = useMemo(() => quickCashOptions(method === 'split' ? remaining : due), [due, remaining, method]);
  const activeMethod = method === 'split' ? splitMethod : method;
  const isDigital = activeMethod === 'upi' || activeMethod === 'card';
  const creditAllowed = !!p.allowCredit && !!p.customer;
  const creditAvailable = p.customer ? Math.max(0, p.customer.creditLimitPaise - p.customer.outstandingPaise) : 0;

  const buildTender = (m: Exclude<Method, 'split'>, amount: number, received?: number): DraftTender => {
    if (m === 'cash') {
      const rec = Math.max(received ?? amount, amount);
      return { method: 'cash', amountPaise: amount, receivedPaise: rec, changePaise: changeDue(rec, amount), confirmation: 'n/a' };
    }
    if (m === 'credit') return { method: 'credit', amountPaise: amount, confirmation: 'n/a', reference: p.customer?.name };
    if (online) return { method: m, amountPaise: amount, confirmation: 'provider', reference: ref.trim() || `${m.toUpperCase()}-${Math.floor(100000 + Math.random() * 899999)}` };
    return { method: m, amountPaise: amount, confirmation: 'manual', reference: ref.trim() };
  };

  const creditNeeded = (amount: number) => creditAllowed && amount > creditAvailable && !creditApproval;

  // Tenders for completion + whether completion is allowed.
  const plan = useMemo((): { tenders: DraftTender[]; ok: boolean; reason?: string } => {
    if (method === 'split') return { tenders: splits, ok: splits.length > 0 && remaining === 0, reason: remaining > 0 ? `${money(remaining)} remaining` : undefined };
    if (method === 'cash') {
      const rec = entryPaise || due;
      if (rec < due) return { tenders: [], ok: false, reason: `Received is ${money(due - rec)} short` };
      return { tenders: [buildTender('cash', due, rec)], ok: true };
    }
    if (method === 'credit') {
      if (!creditAllowed) return { tenders: [], ok: false, reason: 'Select a customer with a credit account' };
      return { tenders: [buildTender('credit', due)], ok: !creditNeeded(due), reason: creditNeeded(due) ? 'Credit limit exceeded — manager approval needed' : undefined };
    }
    if (!online && !ref.trim()) return { tenders: [], ok: false, reason: 'Enter the terminal / UPI reference' };
    return { tenders: [buildTender(method, due)], ok: true };
  }, [method, splits, remaining, entryPaise, due, ref, online, creditApproval, creditAllowed]); // eslint-disable-line react-hooks/exhaustive-deps

  const addSplit = () => {
    if (remaining <= 0) return;
    const amt = entryPaise || remaining;
    if (splitMethod === 'cash') {
      const take = Math.min(amt, remaining);
      setSplits((xs) => [...xs, buildTender('cash', take, amt)]);
    } else {
      if (amt > remaining) return;
      if (isDigital && !online && !ref.trim()) return;
      if (splitMethod === 'credit' && (!creditAllowed || creditNeeded(amt))) {
        if (creditAllowed) setAskCredit(true);
        return;
      }
      setSplits((xs) => [...xs, buildTender(splitMethod, amt)]);
    }
    setEntry('');
    setRef('');
    amountRef.current?.focus();
  };

  const commit = async () => {
    if (phase === 'committing' || !plan.ok) return;
    setPhase('committing');
    setError(undefined);
    try {
      const done = await p.onCommit(plan.tenders, clientTx);
      setSale(done);
      setPhase('success');
      setPrintState('printing');
      try {
        await markPrinted(device, done.id);
        setPrintState('printed');
      } catch {
        setPrintState('failed');
      }
    } catch (e) {
      const err = e as Error;
      const code = e instanceof LocalCommitError ? e.code : undefined;
      setError({
        code,
        title: code === 'NO_SHIFT' ? 'No open shift' : code === 'TENDER_MISMATCH' ? 'Payment does not match the bill' : code === 'VALIDATION' ? 'Bill needs correction' : 'Sale could not be saved',
        message: err.message,
      });
      setPhase('error');
    }
  };

  const retryPrint = async () => {
    if (!sale) return;
    setPrintState('printing');
    try {
      await markPrinted(device, sale.id);
      setPrintState('printed');
    } catch {
      setPrintState('failed');
    }
  };

  const onKey = (e: KeyboardEvent) => {
    if (askCredit || e.defaultPrevented) return;
    if (phase === 'success') {
      if (e.key === 'Enter') {
        e.preventDefault();
        sale && p.onDone(sale);
      }
      return;
    }
    if (phase !== 'tender' && phase !== 'error') return;
    const t = e.target as HTMLElement;
    const inText = t.tagName === 'INPUT' && (t as HTMLInputElement).name === 'reference';
    if (!inText && !e.ctrlKey && !e.metaKey && e.key.length === 1) {
      const m = METHODS.find((x) => x.hot.toLowerCase() === e.key.toLowerCase());
      if (m && (m.key !== 'credit' || creditAllowed)) {
        e.preventDefault();
        setMethod(m.key);
        setEntry('');
        setTimeout(() => amountRef.current?.focus(), 0);
        return;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (method === 'split' && remaining > 0) addSplit();
      else void commit();
    }
  };

  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  useEffect(() => {
    if (!p.open) return;
    const h = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [p.open]);

  const keypad = (k: string) => {
    if (k === 'back') setEntry((x) => x.slice(0, -1));
    else if (k === 'clear') setEntry('');
    else if (k === '.') setEntry((x) => (x.includes('.') ? x : (x || '0') + '.'));
    else setEntry((x) => (x.includes('.') && x.split('.')[1]!.length >= 2 ? x : x + k));
  };

  return (
    <Modal open={p.open} onClose={() => (phase === 'success' && sale ? p.onDone(sale) : phase !== 'committing' && p.onClose())} size="xl" dismissible={phase !== 'committing'} title={phase === 'success' ? undefined : p.title ?? 'Payment'} description={phase === 'success' ? undefined : p.context}>
      <div className="pay">
        {phase === 'success' && sale ? (
          <SuccessView sale={sale} printState={printState} onRetryPrint={retryPrint} onPrint={() => print(<Receipt db={device} sale={device.get('sales', sale.id) ?? sale} copy />)} onDone={() => p.onDone(sale)} />
        ) : (
          <div className="pay__grid">
            <div className="pay__left">
              <div className="pay__due">
                <span className="pay__due-k">{method === 'split' ? 'Remaining' : 'Amount due'}</span>
                <span className="pay__due-v num">{money(method === 'split' ? remaining : due)}</span>
                {method === 'split' ? <span className="muted num">of {money(due)}</span> : null}
              </div>
              <div className="pay__methods" role="radiogroup" aria-label="Payment method">
                {METHODS.filter((m) => m.key !== 'credit' || creditAllowed).map((m) => (
                  <button key={m.key} type="button" role="radio" aria-checked={method === m.key} className={cx('pay__method', method === m.key && 'is-on')} onClick={() => { setMethod(m.key); setEntry(''); setTimeout(() => amountRef.current?.focus(), 0); }}>
                    <Icon name={m.icon} size={20} />
                    <span>{m.label}</span>
                    <Kbd>{m.hot}</Kbd>
                  </button>
                ))}
              </div>

              {method === 'split' ? (
                <div className="ex-stack" style={{ gap: 8 }}>
                  <div className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {(['cash', 'upi', 'card', 'credit'] as const).filter((m) => m !== 'credit' || creditAllowed).map((m) => (
                      <button key={m} type="button" className="ex-chip" aria-pressed={splitMethod === m} onClick={() => setSplitMethod(m)}>{LABEL[m]}</button>
                    ))}
                  </div>
                  <div className="pay__splits">
                    {splits.length === 0 ? <div className="muted" style={{ padding: '10px 12px' }}>No tenders yet. Enter an amount and add it.</div> : null}
                    {splits.map((t, i) => (
                      <div key={i} className="pay__split">
                        <Badge tone="info">{LABEL[t.method]}</Badge>
                        <span className="muted ex-truncate">{t.reference ?? (t.changePaise ? `Received ${money(t.receivedPaise ?? 0)} · change ${money(t.changePaise)}` : '')}{t.confirmation === 'manual' ? ' · manual' : ''}</span>
                        <span className="ex-spacer" />
                        <b className="num">{money(t.amountPaise)}</b>
                        <Button size="sm" variant="ghost" icon="X" aria-label="Remove tender" onClick={() => setSplits((xs) => xs.filter((_, j) => j !== i))} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {activeMethod === 'cash' || method === 'split' ? (
                <TextField
                  ref={amountRef}
                  autoFocus
                  size="xl"
                  label={method === 'split' ? `${LABEL[splitMethod]} amount` : 'Cash received'}
                  prefix="₹"
                  inputMode="decimal"
                  value={entry}
                  placeholder={method === 'split' ? (remaining / 100).toFixed(2) : `${(due / 100).toFixed(2)} (exact)`}
                  onChange={(e) => setEntry(e.target.value.replace(/[^0-9.]/g, ''))}
                  className="num"
                />
              ) : null}

              {isDigital ? (
                online ? (
                  <InlineAlert tone="info" icon={activeMethod === 'upi' ? 'QrCode' : 'CreditCard'} title={activeMethod === 'upi' ? 'Show UPI QR to customer' : 'Collect on card terminal'}>
                    Provider confirmation is automatic when online. Reference is recorded on the invoice.
                  </InlineAlert>
                ) : (
                  <div className="ex-stack" style={{ gap: 8 }}>
                    <InlineAlert tone="warning" icon="WifiOff" title="Provider confirmation unavailable offline">
                      Confirm the payment on the terminal / customer's phone, then record the reference. It is saved as a manual confirmation.
                    </InlineAlert>
                    <TextField name="reference" label="Manual reference (RRN / UPI txn id)" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 412233" autoFocus={method !== 'split'} />
                  </div>
                )
              ) : null}

              {activeMethod === 'credit' ? (
                p.customer ? (
                  <InlineAlert tone={creditNeeded(method === 'split' ? entryPaise || remaining : due) ? 'warning' : 'info'} icon="NotebookPen" title={`Credit to ${p.customer.name}`}>
                    Limit {money(p.customer.creditLimitPaise)} · Outstanding {money(p.customer.outstandingPaise)} · Available {money(creditAvailable)}
                    {creditApproval ? ' · Limit override approved' : ''}
                  </InlineAlert>
                ) : null
              ) : null}
              {method === 'credit' && creditNeeded(due) ? <Button icon="ShieldCheck" onClick={() => setAskCredit(true)}>Request credit limit override</Button> : null}

              {error ? (
                <InlineAlert tone="danger" title={error.title}>
                  <div><b>What happened:</b> {error.message}</div>
                  <div><b>Was it saved?</b> No. Nothing was saved and the cart is unchanged.</div>
                  <div><b>What to do:</b> {error.code === 'NO_SHIFT' ? 'Open a shift, then process the order again.' : error.code === 'VALIDATION' ? 'Go back to the cart and fix the highlighted lines.' : 'Retry. If it fails again, call the store manager — the bill stays on screen.'}</div>
                </InlineAlert>
              ) : null}
            </div>

            <div className="pay__right">
              {activeMethod === 'cash' || method === 'split' ? (
                <>
                  <div className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {quick.map((q) => (
                      <button key={q} type="button" className="pay__quick num" onClick={() => setEntry((q / 100).toFixed(0))}>{money(q, { whole: true })}</button>
                    ))}
                  </div>
                  <NumericKeypad onKey={keypad} compact />
                </>
              ) : (
                <div className="pay__digital">
                  <Icon name={activeMethod === 'upi' ? 'QrCode' : activeMethod === 'card' ? 'CreditCard' : 'NotebookPen'} size={64} />
                  <div className="num" style={{ fontSize: 28, fontWeight: 750 }}>{money(due)}</div>
                  <div className="muted">{activeMethod === 'credit' ? 'Added to customer account' : online ? 'Waiting for customer' : 'Manual confirmation'}</div>
                </div>
              )}
              <div className="pay__summary">
                {method === 'cash' ? (
                  <div className="pay__change">
                    <span>Change due</span>
                    <b className="num">{money(changeDue(entryPaise || due, due))}</b>
                  </div>
                ) : null}
                {method === 'split' && remaining > 0 ? (
                  <Button size="lg" block icon="Plus" onClick={addSplit} disabled={splitMethod !== 'cash' && (entryPaise || remaining) > remaining}>
                    Add {LABEL[splitMethod]} {money(Math.min(entryPaise || remaining, splitMethod === 'cash' ? remaining : entryPaise || remaining))}
                  </Button>
                ) : null}
                <Button variant="primary" size="xl" block icon="CircleCheck" shortcut="Enter" loading={phase === 'committing'} disabled={!plan.ok} onClick={commit}>
                  {phase === 'error' ? 'Retry payment' : 'Complete payment'}
                </Button>
                {plan.reason ? <div className="ex-hint" style={{ textAlign: 'center' }}>{plan.reason}</div> : <div className="ex-hint" style={{ textAlign: 'center' }}>Saved on this counter first. Cloud sync runs separately.</div>}
              </div>
            </div>
          </div>
        )}
      </div>
      <ApprovalDialog
        open={askCredit}
        onClose={() => setAskCredit(false)}
        action="Credit sale above limit"
        requested={money(method === 'split' ? entryPaise || remaining : due)}
        allowed={money(creditAvailable)}
        verify={managerVerifier(device, s)}
        onApproved={(r) => {
          setCreditApproval(r.approverId);
          setAskCredit(false);
          void recordApproval(device, s, { action: 'credit-limit', summary: `Credit limit override for ${p.customer?.name}`, approverId: r.approverId, reason: r.reason, amountPaise: due });
        }}
      />
    </Modal>
  );
}

function SuccessView({ sale, printState, onRetryPrint, onPrint, onDone }: { sale: Sale; printState: 'printing' | 'printed' | 'failed'; onRetryPrint: () => void; onPrint: () => void; onDone: () => void }) {
  const { device } = usePos();
  const live = useEntity(device, 'sales', sale.id) ?? sale;
  const change = live.tenders.reduce((a, t) => a + (t.changePaise ?? 0), 0);
  const doneRef = useRef<HTMLButtonElement>(null);
  useEffect(() => doneRef.current?.focus(), []);
  return (
    <div className="success">
      <div className="success__main">
        <div className="success__icon"><Icon name="Check" size={36} /></div>
        <h2 className="success__title">Sale completed</h2>
        <div className="muted num">Invoice {live.documentNo}</div>
        <div className="success__total num">{money(live.totalPaise)}</div>
        {change > 0 ? (
          <div className="success__change">
            <span>Change to return</span>
            <b className="num">{money(change)}</b>
          </div>
        ) : null}
        <div className="success__rows">
          <div className="success__row">
            <span className="muted">Receipt</span>
            {printState === 'printed' ? <Badge tone="success" icon="Printer">Printed</Badge> : printState === 'printing' ? <Badge tone="info" icon="LoaderCircle">Printing…</Badge> : <Badge tone="warning" icon="PrinterCheck">Printer unavailable</Badge>}
          </div>
          <div className="success__row">
            <span className="muted">Cloud sync</span>
            <StatusBadge meta={SYNC_STATE[live.syncState]} />
          </div>
          {live.loyaltyEarned ? (
            <div className="success__row"><span className="muted">Loyalty earned</span><b className="num">{live.loyaltyEarned} pts</b></div>
          ) : null}
        </div>
        {printState === 'failed' ? (
          <InlineAlert tone="warning" title="Sale completed. Printer unavailable." action={<Button size="sm" icon="RotateCw" onClick={onRetryPrint}>Retry</Button>}>
            Invoice {live.documentNo} is saved. Retry printing or hand over a duplicate later from Sales.
          </InlineAlert>
        ) : null}
        {live.syncState !== 'synced' ? <div className="ex-hint">Pending sync is normal — it uploads automatically when the cloud is reachable.</div> : null}
        <div className="ex-row" style={{ marginTop: 8, width: '100%' }}>
          <Button size="lg" icon="Printer" onClick={onPrint}>Print again</Button>
          <Button ref={doneRef} variant="primary" size="lg" icon="Plus" shortcut="Enter" style={{ flex: 1 }} onClick={onDone}>New sale</Button>
        </div>
      </div>
      <div className="success__receipt ex-scroll">
        <Receipt db={device} sale={live} />
      </div>
    </div>
  );
}
