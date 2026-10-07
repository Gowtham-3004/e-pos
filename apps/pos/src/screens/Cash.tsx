import { useMemo, useState } from 'react';
import type { CashMovement, Customer } from '@elixir/contracts';
import { cashBreakdown } from '@elixir/domain';
import { money, rupeesToPaise, time } from '@elixir/format';
import { recordCashMovement } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { Badge, Button, Card, CardBody, CardHeader, DataTable, EmptyState, Icon, InlineAlert, Segmented, TextField, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { originOf } from '../lib/ops';
import { ShiftGate } from '../components/ShiftGate';
import { CustomerPicker } from '../components/CustomerPicker';

const TYPE_LABEL: Record<CashMovement['type'], { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; icon: string }> = {
  opening: { label: 'Opening float', tone: 'neutral', icon: 'LogIn' },
  cash_sale: { label: 'Cash sale', tone: 'success', icon: 'Receipt' },
  cash_refund: { label: 'Cash refund', tone: 'warning', icon: 'Undo2' },
  cash_receipt: { label: 'Customer collection', tone: 'info', icon: 'HandCoins' },
  petty_paid: { label: 'Petty paid out', tone: 'danger', icon: 'ArrowUpRight' },
  petty_received: { label: 'Petty received', tone: 'success', icon: 'ArrowDownLeft' },
  closing: { label: 'Closing count', tone: 'neutral', icon: 'LogOut' },
};

export function CashScreen() {
  const s = useSession();
  if (!s.shift) return <ShiftGate what="cash operations" />;
  return <Cash />;
}

function Cash() {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const [kind, setKind] = useState<'petty_paid' | 'petty_received' | 'cash_receipt'>('petty_paid');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [customer, setCustomer] = useState<Customer>();
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);
  const shift = s.shift!;
  const movements = useLive(device, ['cashMovements'], () => device.where('cashMovements', (m) => m.shiftId === shift.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [shift.id]);
  const b = useMemo(() => cashBreakdown(movements), [movements]);
  const paise = rupeesToPaise(amount || 0);
  const liveCustomer = useLive(device, ['customers'], () => device.get('customers', customer?.id), [customer?.id]);
  const overCollect = kind === 'cash_receipt' && liveCustomer ? paise > liveCustomer.outstandingPaise : false;
  const valid = paise > 0 && (kind !== 'cash_receipt' ? note.trim().length >= 3 : !!liveCustomer && !overCollect) && (kind !== 'petty_paid' || paise <= b.expected);

  const submit = async () => {
    const origin = originOf(s);
    if (!origin || !valid) return;
    setBusy(true);
    try {
      await recordCashMovement(device, { origin, type: kind, amountPaise: paise, note: kind === 'cash_receipt' ? `Collection from ${liveCustomer?.name}${note ? ` · ${note}` : ''}` : note.trim(), customerId: liveCustomer?.id });
      toast.success(kind === 'petty_paid' ? 'Petty cash paid out' : kind === 'petty_received' ? 'Petty cash received' : 'Collection recorded', money(paise));
      setAmount('');
      setNote('');
    } catch (e) {
      toast.error('Not saved', `${(e as Error).message} Drawer balance unchanged — retry.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Cash & petty</div>
          <div className="pos-page__desc">Shift {shift.code} · counter {s.counter?.code} · every movement adjusts expected drawer cash</div>
        </div>
      </div>
      <div className="pos-kpis">
        <div className="pos-stat"><span className="pos-stat__k"><Icon name="Banknote" size={14} />Expected in drawer</span><span className="pos-stat__v">{money(b.expected)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Opening</span><span className="pos-stat__v">{money(b.opening)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Cash sales</span><span className="pos-stat__v">{money(b.cashSales)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Collections</span><span className="pos-stat__v">{money(b.cashReceipts)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Petty in / out</span><span className="pos-stat__v">{money(b.pettyReceived)} / {money(b.pettyPaid)}</span></div>
        <div className="pos-stat"><span className="pos-stat__k">Refunds</span><span className="pos-stat__v">{money(b.cashRefunds)}</span></div>
      </div>
      <div className="pos-split" style={{ gridTemplateColumns: '400px minmax(0,1fr)' }}>
        <Card>
          <CardHeader title="Record cash movement" icon="Wallet" />
          <CardBody>
            <div className="ex-stack">
              <Segmented label="Movement type" value={kind} onChange={setKind} items={[{ key: 'petty_paid', label: 'Paid out' }, { key: 'petty_received', label: 'Received' }, ...(s.capabilities.includes('customers') ? [{ key: 'cash_receipt' as const, label: 'Collection' }] : [])]} />
              {kind === 'cash_receipt' ? (
                <button type="button" className="bill__cust is-set" style={{ width: '100%' }} onClick={() => setPick(true)}>
                  <Icon name="UserRound" size={18} />
                  <span className="bill__cust-main">
                    <b>{liveCustomer?.name ?? 'Select customer'}</b>
                    <span className="muted">{liveCustomer ? `Outstanding ${money(liveCustomer.outstandingPaise)}` : 'Customer with credit outstanding'}</span>
                  </span>
                </button>
              ) : null}
              <TextField size="lg" label="Amount" prefix="₹" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} className="num"
                error={kind === 'petty_paid' && paise > b.expected ? `Drawer only has ${money(b.expected)}.` : overCollect ? `More than the outstanding ${money(liveCustomer!.outstandingPaise)}.` : undefined} />
              <TextField label={kind === 'cash_receipt' ? 'Note (optional)' : 'Purpose'} required={kind !== 'cash_receipt'} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'petty_paid' ? 'e.g. Tea & snacks for staff' : kind === 'petty_received' ? 'e.g. Change float from office' : 'e.g. Part payment for Sept'} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
              <Button variant="primary" size="lg" icon="Check" disabled={!valid || !s.permissions.includes('pos.petty-cash')} loading={busy} onClick={submit}>
                Record {kind === 'petty_paid' ? 'payout' : kind === 'petty_received' ? 'receipt' : 'collection'}
              </Button>
              {!s.permissions.includes('pos.petty-cash') ? <InlineAlert tone="warning">Your role cannot record petty cash.</InlineAlert> : null}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Shift cash movements" subtitle={`${movements.length} movements`} icon="List" />
          <DataTable
            rows={movements}
            rowKey={(m) => m.id}
            pageSize={12}
            empty={<EmptyState quiet title="No cash movements yet" />}
            columns={[
              { key: 'createdAt', header: 'Time', render: (m) => <span className="num">{time(m.createdAt)}</span> },
              { key: 'type', header: 'Type', render: (m) => <Badge tone={TYPE_LABEL[m.type].tone} icon={TYPE_LABEL[m.type].icon}>{TYPE_LABEL[m.type].label}</Badge> },
              { key: 'ref', header: 'Reference / note', render: (m) => <span className="ex-truncate" style={{ maxWidth: 320, display: 'inline-block' }}>{m.reference ?? m.note ?? '—'}</span> },
              { key: 'user', header: 'By', render: (m) => device.get('users', m.userId)?.name.split(' ')[0] },
              { key: 'amountPaise', header: 'Amount', align: 'right', render: (m) => <b className="num" style={{ color: m.amountPaise < 0 ? 'var(--status-danger)' : undefined }}>{money(m.amountPaise, { signed: true })}</b> },
            ]}
          />
        </Card>
      </div>
      <CustomerPicker open={pick} onClose={() => setPick(false)} onPick={(c) => { setCustomer(c); setPick(false); }} />
    </div>
  );
}
