import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DenominationCount, Shift } from '@elixir/contracts';
import { cashBreakdown, denominationTotal, emptyDenominations, varianceNeedsApproval } from '@elixir/domain';
import { dateLong, dateTime, isoDate, money, time } from '@elixir/format';
import { closeShift, LocalCommitError, openShift, type LocalDatabase } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { ApprovalDialog, Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, InlineAlert, Textarea, useToast } from '@elixir/ui';
import { landingFor, usePos, useSession } from '../lib/pos';
import { managerVerifier } from '../lib/ops';
import { usePrint } from '../lib/print';

export function ShiftScreen() {
  const s = useSession();
  const [closed, setClosed] = useState<Shift>();
  if (closed) return <ZReport shiftId={closed.id} onDone={() => setClosed(undefined)} />;
  if (!s.shift) return <DayIn />;
  return <DayOut onClosed={setClosed} />;
}

function DenominationGrid({ value, onChange }: { value: DenominationCount[]; onChange: (v: DenominationCount[]) => void }) {
  return (
    <div className="denoms">
      {value.map((d, i) => (
        <div key={d.denomination} className="denom">
          <span className="denom__face">{money(d.denomination, { whole: true })}</span>
          <span className="ex-row" style={{ gap: 4 }}>
            <span className="muted">×</span>
            <input
              className="bill__disc num"
              style={{ width: 70, height: 36, textAlign: 'center' }}
              inputMode="numeric"
              aria-label={`Count of ${money(d.denomination, { whole: true })}`}
              value={d.count || ''}
              placeholder="0"
              onChange={(e) => {
                const n = parseInt(e.target.value.replace(/\D/g, '') || '0', 10);
                onChange(value.map((x, j) => (j === i ? { ...x, count: n } : x)));
              }}
            />
          </span>
          <span className="denom__sum">{money(d.denomination * d.count)}</span>
        </div>
      ))}
    </div>
  );
}

function DayIn() {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const nav = useNavigate();
  const [denoms, setDenoms] = useState<DenominationCount[]>(emptyDenominations);
  const [busy, setBusy] = useState(false);
  const total = denominationTotal(denoms);
  const lastClosed = useLive(device, ['shifts'], () => device.where('shifts', (x) => x.counterId === s.counter?.id && x.status === 'closed').sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))[0], [s.counter?.id]);
  if (!s.permissions.includes('shift.open'))
    return <div className="pos-page"><InlineAlert tone="warning" title="Shift not open">Your role cannot open a shift. Ask a cashier or manager to complete Day-In on counter {s.counter?.code}.</InlineAlert></div>;
  const submit = async () => {
    setBusy(true);
    try {
      const sh = await openShift(device, { tenantId: s.tenant.id, storeId: s.store.id, counterId: s.counter!.id, deviceId: s.device.id, userId: s.user.id, denominations: denoms, businessDate: isoDate() });
      toast.success(`Shift ${sh.code} opened`, `Opening cash ${money(sh.openingCash)}`);
      nav(landingFor(s));
    } catch (e) {
      toast.error('Shift could not be opened', (e as Error).message + ' Nothing was saved — retry.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="pos-page" style={{ maxWidth: 980, margin: '0 auto', width: '100%' }}>
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Day-In · Open shift</div>
          <div className="pos-page__desc">Counter {s.counter?.code} · {s.user.name} · Business date {dateLong(isoDate())}</div>
        </div>
      </div>
      <div className="pos-split" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
        <Card>
          <CardHeader title="Opening cash count" subtitle="Count notes and coins in the drawer" icon="Banknote" actions={<Button size="sm" variant="ghost" onClick={() => setDenoms(emptyDenominations())}>Clear</Button>} />
          <CardBody><DenominationGrid value={denoms} onChange={setDenoms} /></CardBody>
        </Card>
        <div className="ex-stack">
          <Card pad>
            <div className="pos-section-title">Opening total</div>
            <div className="num" style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em', margin: '6px 0 12px' }}>{money(total)}</div>
            {lastClosed?.closingCash != null ? <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>Last close {lastClosed.code}: {money(lastClosed.closingCash)} on {dateTime(lastClosed.closedAt!)}</div> : null}
            <Button variant="primary" size="xl" block icon="LogIn" loading={busy} onClick={submit}>Open shift</Button>
            {total === 0 ? <div className="ex-hint" style={{ marginTop: 8 }}>Opening with zero cash is allowed — the drawer count is recorded as ₹0.</div> : null}
          </Card>
          <InlineAlert tone="info" icon="Info">Billing on this counter unlocks once the shift is open. The opening count is audited.</InlineAlert>
        </div>
      </div>
    </div>
  );
}

function shiftStats(db: LocalDatabase, shiftId: string) {
  const sales = db.where('sales', (x) => x.shiftId === shiftId);
  const returns = db.where('returns', (x) => x.shiftId === shiftId);
  const movements = db.where('cashMovements', (x) => x.shiftId === shiftId && x.type !== 'closing');
  const tenders = { cash: 0, upi: 0, card: 0, credit: 0 } as Record<string, number>;
  sales.forEach((x) => x.tenders.forEach((t) => (tenders[t.method] = (tenders[t.method] ?? 0) + t.amountPaise)));
  return {
    sales,
    returns,
    movements,
    tenders,
    breakdown: cashBreakdown(movements),
    gross: sales.reduce((a, x) => a + x.grossPaise, 0),
    discounts: sales.reduce((a, x) => a + x.lineDiscountPaise + x.billDiscountPaise, 0),
    taxes: sales.reduce((a, x) => a + x.taxPaise, 0),
    net: sales.reduce((a, x) => a + x.totalPaise, 0),
    refunds: returns.reduce((a, x) => a + x.refundPaise, 0),
  };
}

function DayOut({ onClosed }: { onClosed: (s: Shift) => void }) {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const shift = s.shift!;
  const [denoms, setDenoms] = useState<DenominationCount[]>(emptyDenominations);
  const [reason, setReason] = useState('');
  const [ask, setAsk] = useState<'approve' | 'confirm' | null>(null);
  const [busy, setBusy] = useState(false);
  const st = useLive(device, ['sales', 'returns', 'cashMovements'], () => shiftStats(device, shift.id), [shift.id]);
  const counted = denominationTotal(denoms);
  const variance = counted - st.breakdown.expected;
  const needsApproval = varianceNeedsApproval(variance);
  const canClose = s.permissions.includes('shift.close');

  const doClose = async (approvedBy?: string, approvalReason?: string) => {
    setBusy(true);
    try {
      const closed = await closeShift(device, { shiftId: shift.id, userId: s.user.id, denominations: denoms, varianceReason: (approvalReason ?? reason).trim() || undefined, approvedBy });
      toast.success(`Shift ${closed.code} closed`, `Variance ${money(closed.variance ?? 0, { signed: true })}`);
      onClosed(closed);
    } catch (e) {
      toast.error('Shift close failed', `${(e as Error).message}${e instanceof LocalCommitError ? '' : ''} The shift is still open — retry.`);
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Day-Out · Close shift {shift.code}</div>
          <div className="pos-page__desc">Counter {s.counter?.code} · opened {time(shift.openedAt)} by {device.get('users', shift.openedBy)?.name} · {st.sales.length} bills</div>
        </div>
        <div className="ex-spacer" />
        <Badge tone="success" icon="CircleDot" size="lg">Shift open</Badge>
      </div>
      <div className="pos-kpis">
        {[['Bills', String(st.sales.length)], ['Net sales', money(st.net)], ['Cash', money(st.tenders.cash ?? 0)], ['UPI', money(st.tenders.upi ?? 0)], ['Card', money(st.tenders.card ?? 0)], ['Credit', money(st.tenders.credit ?? 0)], ['Returns', money(st.refunds)]].map(([k, v]) => (
          <div key={k} className="pos-stat"><span className="pos-stat__k">{k}</span><span className="pos-stat__v">{v}</span></div>
        ))}
      </div>
      <div className="pos-split" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
        <Card>
          <CardHeader title="Closing cash count" subtitle="Count notes and coins in the drawer" icon="Banknote" />
          <CardBody><DenominationGrid value={denoms} onChange={setDenoms} /></CardBody>
        </Card>
        <div className="ex-stack">
          <Card pad>
            <div className="pos-section-title" style={{ marginBottom: 8 }}>Expected cash</div>
            <div className="pos-kv">
              <span>Opening</span><span>{money(st.breakdown.opening)}</span>
              <span>Cash sales</span><span>{money(st.breakdown.cashSales)}</span>
              <span>Cash receipts</span><span>{money(st.breakdown.cashReceipts)}</span>
              <span>Petty received</span><span>{money(st.breakdown.pettyReceived)}</span>
              <span>Petty paid</span><span>−{money(st.breakdown.pettyPaid)}</span>
              <span>Cash refunds</span><span>−{money(st.breakdown.cashRefunds)}</span>
              <span className="total">Expected</span><span className="total">{money(st.breakdown.expected)}</span>
              <span>Counted</span><span>{money(counted)}</span>
              <span style={{ fontWeight: 700 }}>Variance</span>
              <span style={{ color: variance === 0 ? 'var(--status-success)' : needsApproval ? 'var(--status-danger)' : 'var(--status-warning)' }}>{money(variance, { signed: true })}</span>
            </div>
          </Card>
          {variance !== 0 ? (
            <Card pad>
              {needsApproval ? <InlineAlert tone="warning" icon="ShieldCheck" title="Variance above ₹100 needs manager approval">Enter a reason; a manager PIN approves the close once.</InlineAlert> : null}
              <div style={{ marginTop: needsApproval ? 10 : 0 }}>
                <Textarea label="Variance reason" required={needsApproval} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Change given wrongly on bill 1043" />
              </div>
            </Card>
          ) : null}
          {!canClose ? <InlineAlert tone="warning">Your role cannot close a shift.</InlineAlert> : null}
          <Button variant="primary" size="xl" block icon="LogOut" loading={busy} disabled={!canClose || (needsApproval && !reason.trim())} onClick={() => setAsk(needsApproval ? 'approve' : 'confirm')}>
            {needsApproval ? 'Request approval & close' : 'Close shift'}
          </Button>
        </div>
      </div>
      <ConfirmDialog open={ask === 'confirm'} onClose={() => setAsk(null)} title={`Close shift ${shift.code}?`} confirmLabel="Close shift" tone="primary" busy={busy} onConfirm={() => doClose()}>
        Counted {money(counted)} against expected {money(st.breakdown.expected)} (variance {money(variance, { signed: true })}). Billing on {s.counter?.code} stops until the next Day-In.
      </ConfirmDialog>
      <ApprovalDialog
        open={ask === 'approve'}
        onClose={() => setAsk(null)}
        action={`Close shift ${shift.code} with variance`}
        requested={money(variance, { signed: true })}
        allowed="±₹100.00"
        detail={reason ? `Reason: ${reason}` : undefined}
        requireReason={false}
        verify={managerVerifier(device, s, 'shift.variance.approve')}
        onApproved={(r) => void doClose(r.approverId)}
      />
    </div>
  );
}

export function ZReport({ shiftId, onDone }: { shiftId: string; onDone?: () => void }) {
  const { device } = usePos();
  const s = useSession();
  const nav = useNavigate();
  const print = usePrint((x) => x.print);
  const shift = device.get('shifts', shiftId)!;
  const st = useMemo(() => shiftStats(device, shiftId), [device, shiftId]);
  const body = <ZBody db={device} shift={shift} st={st} />;
  return (
    <div className="pos-page" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Z-report · {shift.code}</div>
          <div className="pos-page__desc">Shift closed {shift.closedAt ? dateTime(shift.closedAt) : ''} · Counter {s.counter?.code}</div>
        </div>
        <div className="ex-spacer" />
        <Button icon="Printer" onClick={() => print(<div className="receipt">{body}</div>)}>Print</Button>
        <Button variant="primary" icon="LogIn" onClick={() => { onDone?.(); nav('/shift'); }}>Start next shift</Button>
      </div>
      <Card pad>{body}</Card>
    </div>
  );
}

function ZBody({ db, shift, st }: { db: LocalDatabase; shift: Shift; st: ReturnType<typeof shiftStats> }) {
  return (
    <div className="zreport">
      <div className="ex-stack" style={{ gap: 6 }}>
        <div className="pos-section-title">Sales</div>
        <div className="pos-kv">
          <span>Business date</span><span>{shift.businessDate}</span>
          <span>Opened / closed by</span><span>{db.get('users', shift.openedBy)?.name} / {db.get('users', shift.closedBy)?.name}</span>
          <span>Bill count</span><span>{st.sales.length}</span>
          <span>Gross</span><span>{money(st.gross)}</span>
          <span>Discounts</span><span>−{money(st.discounts)}</span>
          <span>Taxes (GST)</span><span>{money(st.taxes)}</span>
          <span className="total">Net sales</span><span className="total">{money(st.net)}</span>
        </div>
        <div className="pos-section-title" style={{ marginTop: 12 }}>Tenders</div>
        <div className="pos-kv">
          <span>Cash</span><span>{money(st.tenders.cash ?? 0)}</span>
          <span>UPI</span><span>{money(st.tenders.upi ?? 0)}</span>
          <span>Card</span><span>{money(st.tenders.card ?? 0)}</span>
          <span>Credit</span><span>{money(st.tenders.credit ?? 0)}</span>
          <span>Returns ({st.returns.length})</span><span>−{money(st.refunds)}</span>
        </div>
      </div>
      <div className="ex-stack" style={{ gap: 6 }}>
        <div className="pos-section-title">Cash movements</div>
        <div className="pos-kv">
          <span>Opening</span><span>{money(st.breakdown.opening)}</span>
          <span>Cash sales</span><span>{money(st.breakdown.cashSales)}</span>
          <span>Cash receipts</span><span>{money(st.breakdown.cashReceipts)}</span>
          <span>Petty received</span><span>{money(st.breakdown.pettyReceived)}</span>
          <span>Petty paid</span><span>−{money(st.breakdown.pettyPaid)}</span>
          <span>Cash refunds</span><span>−{money(st.breakdown.cashRefunds)}</span>
          <span className="total">Expected</span><span className="total">{money(shift.expectedCash ?? st.breakdown.expected)}</span>
          <span>Counted</span><span>{money(shift.closingCash ?? 0)}</span>
          <span>Variance</span><span>{money(shift.variance ?? 0, { signed: true })}</span>
          {shift.varianceReason ? (<><span>Reason</span><span>{shift.varianceReason}</span></>) : null}
          {shift.varianceApprovedBy ? (<><span>Approved by</span><span>{db.get('users', shift.varianceApprovedBy)?.name}</span></>) : null}
        </div>
      </div>
    </div>
  );
}
