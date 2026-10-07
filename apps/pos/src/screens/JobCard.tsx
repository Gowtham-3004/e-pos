import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Customer, JobCard, JobCardLine, JobCardStatus, Product, Sale } from '@elixir/contracts';
import { isJobCardOpen, JOB_CARD_FLOW, JOB_CARD_STATUS } from '@elixir/domain';
import { dateTime, money, paiseToRupeesInput, rupeesToPaise } from '@elixir/format';
import {
  addJobCardLine, billJobCard, jobCardTotals, LocalCommitError, onHand, openJobCard, removeJobCardLine, searchProducts, setJobCardStatus, updateJobCard, type JobCardActor,
} from '@elixir/local-store';
import { useEntity, useLive } from '@elixir/local-store/react';
import {
  Badge, Button, ConfirmDialog, EmptyState, Icon, IconButton, InlineAlert, Modal, SearchInput, Select, StatusBadge, TextField, Textarea, Timeline, useToast,
} from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { originOf } from '../lib/ops';
import { usePrint } from '../lib/print';
import { CustomerPicker } from '../components/CustomerPicker';
import { PaymentModal } from '../components/PaymentModal';
import { SerialPicker } from '../components/SerialPicker';
import { JobCardSlip } from '../components/JobCardSlip';

function useActor(): JobCardActor | undefined {
  const s = useSession();
  if (!s.counter) return undefined;
  return { tenantId: s.tenant.id, storeId: s.store.id, counterId: s.counter.id, deviceId: s.device.id, userId: s.user.id, shiftId: s.shift?.id };
}

const errMsg = (e: unknown) => (e instanceof LocalCommitError || e instanceof Error ? e.message : String(e));

function useTechnicians() {
  const s = useSession();
  const { device } = usePos();
  return useMemo(
    () => device.where('users', (u) => u.tenantId === s.tenant.id && u.active && u.storeIds.includes(s.store.id) && u.role !== 'accountant').map((u) => ({ value: u.id, label: u.name })),
    [device, s.tenant.id, s.store.id],
  );
}

export function JobCardScreen() {
  const { jobId } = useParams();
  return jobId === 'new' || !jobId ? <JobCardIntake /> : <JobCardDetail id={jobId} />;
}

// ───────────────────────── Intake ─────────────────────────

function JobCardIntake() {
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const actor = useActor();
  const techs = useTechnicians();
  const print = usePrint((x) => x.print);
  const [picker, setPicker] = useState(false);
  const [customer, setCustomer] = useState<Customer>();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [imei, setImei] = useState('');
  const [color, setColor] = useState('');
  const [accessories, setAccessories] = useState('');
  const [condition, setCondition] = useState('');
  const [passcode, setPasscode] = useState('');
  const [problem, setProblem] = useState('');
  const [estimate, setEstimate] = useState('');
  const [advance, setAdvance] = useState('');
  const [tech, setTech] = useState('');
  const [promised, setPromised] = useState(() => toLocalInput(Date.now() + 2 * 86400000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const ok = name.trim() && /^[+0-9 ]{10,15}$/.test(phone.trim()) && brand.trim() && model.trim() && problem.trim();

  const save = async (andPrint: boolean) => {
    if (!actor || !ok) return;
    setBusy(true);
    setError(undefined);
    try {
      const card = await openJobCard(device, {
        actor, customerId: customer?.id, customerName: name, customerPhone: phone,
        device: { brand: brand.trim(), model: model.trim(), imeiOrSerial: imei.trim() || undefined, color: color.trim() || undefined, accessories: accessories.split(',').map((a) => a.trim()).filter(Boolean), condition: condition.trim() || undefined, passcodeNote: passcode.trim() || undefined },
        problem, estimatePaise: estimate ? rupeesToPaise(estimate) : undefined, advancePaise: advance ? rupeesToPaise(advance) : undefined, technicianId: tech || undefined,
        promisedAt: promised ? new Date(promised).toISOString() : undefined,
      });
      toast.success('Job card created', card.jobNo);
      if (andPrint) print(<JobCardSlip db={device} card={card} />);
      nav(`/jobcards/${card.id}`, { replace: true });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (!actor) return <EmptyState icon="MonitorX" title="Job cards need a billing counter">This device is not bound to a billing counter.</EmptyState>;

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <IconButton icon="ArrowLeft" label="Back to job cards" onClick={() => nav('/jobcards')} />
        <div>
          <div className="pos-page__title">New job card</div>
          <div className="pos-page__desc">Record the device, what the customer reports, and what was handed over.</div>
        </div>
      </div>
      <div className="pos-split">
        <div className="ex-stack">
          <div className="ex-card pos-card-pad ex-stack">
            <div className="ex-row"><div className="pos-section-title">Customer</div><div className="ex-spacer" /><Button size="sm" icon="UserSearch" onClick={() => setPicker(true)}>Find customer</Button></div>
            <div className="ex-row" style={{ alignItems: 'flex-start' }}>
              <TextField label="Name" required value={name} onChange={(e) => { setName(e.target.value); setCustomer(undefined); }} wrapClassName="ex-spacer" />
              <TextField label="Phone" required value={phone} onChange={(e) => { setPhone(e.target.value); setCustomer(undefined); }} inputMode="tel" wrapClassName="ex-spacer" />
            </div>
            {customer ? <Badge tone="info" icon="UserCheck">Linked to customer account · {customer.name}</Badge> : null}
          </div>
          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Device</div>
            <div className="ex-row" style={{ alignItems: 'flex-start' }}>
              <TextField label="Brand" required placeholder="Samsung" value={brand} onChange={(e) => setBrand(e.target.value)} wrapClassName="ex-spacer" />
              <TextField label="Model" required placeholder="Galaxy S26" value={model} onChange={(e) => setModel(e.target.value)} wrapClassName="ex-spacer" />
            </div>
            <div className="ex-row" style={{ alignItems: 'flex-start' }}>
              <TextField label="IMEI / Serial no." icon="ScanLine" value={imei} onChange={(e) => setImei(e.target.value)} wrapClassName="ex-spacer" />
              <TextField label="Colour" value={color} onChange={(e) => setColor(e.target.value)} wrapClassName="ex-spacer" />
            </div>
            <TextField label="Accessories received" hint="Comma separated — e.g. Charger, Back cover, SIM tray" value={accessories} onChange={(e) => setAccessories(e.target.value)} />
            <TextField label="Physical condition" placeholder="Scratches on frame, cracked back glass…" value={condition} onChange={(e) => setCondition(e.target.value)} />
            <TextField label="Passcode / pattern note" hint="Only if the customer agrees to share it for testing" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
          </div>
          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Problem</div>
            <Textarea label="Reported problem" required rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="What does the customer say is wrong?" />
          </div>
        </div>
        <div className="ex-stack">
          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Workshop</div>
            <Select label="Technician" placeholder="Assign later" options={techs} value={tech} onChange={(e) => setTech(e.target.value)} />
            <TextField label="Promised by" type="datetime-local" value={promised} onChange={(e) => setPromised(e.target.value)} />
            <TextField label="Estimate" prefix="₹" inputMode="decimal" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
            <TextField label="Advance received" prefix="₹" inputMode="decimal" hint="Noted on the job sheet; collect it in the final bill." value={advance} onChange={(e) => setAdvance(e.target.value)} />
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            <Button variant="primary" size="lg" block icon="Printer" loading={busy} disabled={!ok} onClick={() => void save(true)}>Create & print job sheet</Button>
            <Button block disabled={!ok || busy} onClick={() => void save(false)}>Create without printing</Button>
          </div>
        </div>
      </div>
      <CustomerPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(c) => {
          setPicker(false);
          setCustomer(c);
          if (c) {
            setName(c.name);
            setPhone(c.phone);
          }
        }}
      />
    </div>
  );
}

// ───────────────────────── Detail ─────────────────────────

function JobCardDetail({ id }: { id: string }) {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const actor = useActor();
  const techs = useTechnicians();
  const print = usePrint((x) => x.print);
  const card = useEntity(device, 'jobCards', id);
  const totals = useLive(device, ['jobCards', 'products', 'customers'], () => (card ? jobCardTotals(device, card) : undefined), [card]);
  const [cancel, setCancel] = useState(false);
  const [pay, setPay] = useState(false);
  const [diag, setDiag] = useState<string>();

  if (!card) return <EmptyState icon="SearchX" title="Job card not found" actions={<Button onClick={() => nav('/jobcards')}>All job cards</Button>}>It may belong to another store.</EmptyState>;
  if (!actor) return <EmptyState icon="MonitorX" title="Job cards need a billing counter">This device is not bound to a billing counter.</EmptyState>;

  const open = isJobCardOpen(card.status);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error('Could not update job card', errMsg(e));
    }
  };
  const move = (to: JobCardStatus, note?: string) => run(() => setJobCardStatus(device, card.id, to, actor, note), `${card.jobNo.split('/').pop()} → ${JOB_CARD_STATUS[to].label}`);
  const next = JOB_CARD_FLOW[card.status].filter((x) => x !== 'delivered' && x !== 'cancelled');
  const customer = device.get('customers', card.customerId);
  const services = card.lines.filter((l) => l.kind === 'service');
  const parts = card.lines.filter((l) => l.kind === 'part');
  const sale = card.saleId ? device.get('sales', card.saleId) : undefined;

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <IconButton icon="ArrowLeft" label="Back to job cards" onClick={() => nav('/jobcards')} />
        <div>
          <div className="pos-page__title ex-row">{card.jobNo} <StatusBadge meta={JOB_CARD_STATUS[card.status]} /></div>
          <div className="pos-page__desc">{card.device.brand} {card.device.model} · {card.customerName} · {card.customerPhone} · opened {dateTime(card.openedAt)}</div>
        </div>
        <div className="ex-spacer" />
        <Button icon="Printer" onClick={() => print(<JobCardSlip db={device} card={card} />)}>Print job sheet</Button>
      </div>

      <div className="pos-split">
        <div className="ex-stack">
          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Device & problem</div>
            <div className="pos-kv">
              <span>Device</span><span>{card.device.brand} {card.device.model}{card.device.color ? ` · ${card.device.color}` : ''}</span>
              <span>IMEI / Serial</span><span className="num">{card.device.imeiOrSerial ?? '—'}</span>
              <span>Accessories</span><span>{card.device.accessories?.length ? card.device.accessories.join(', ') : 'None'}</span>
              <span>Condition</span><span>{card.device.condition ?? '—'}</span>
              {card.device.passcodeNote ? (<><span>Passcode note</span><span>{card.device.passcodeNote}</span></>) : null}
            </div>
            <InlineAlert tone="neutral" icon="MessageSquareWarning" title="Reported problem">{card.problem}</InlineAlert>
            {open ? (
              <div className="ex-stack">
                <Textarea label="Diagnosis / technician notes" rows={2} value={diag ?? card.diagnosis ?? ''} onChange={(e) => setDiag(e.target.value)} />
                {diag !== undefined && diag !== (card.diagnosis ?? '') ? (
                  <div className="ex-row"><div className="ex-spacer" /><Button size="sm" onClick={() => setDiag(undefined)}>Discard</Button><Button size="sm" variant="primary" icon="Save" onClick={() => void run(() => updateJobCard(device, card.id, { diagnosis: diag.trim() || undefined }, actor), 'Diagnosis saved').then(() => setDiag(undefined))}>Save diagnosis</Button></div>
                ) : null}
              </div>
            ) : card.diagnosis ? <InlineAlert tone="info" icon="Stethoscope" title="Diagnosis">{card.diagnosis}</InlineAlert> : null}
          </div>

          <LinesCard title="Services (labour)" kind="service" card={card} lines={services} actor={actor} editable={open} />
          <LinesCard title="Spare parts" kind="part" card={card} lines={parts} actor={actor} editable={open} />
        </div>

        <div className="ex-stack">
          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Workflow</div>
            {open ? (
              <>
                <Select
                  label="Technician"
                  placeholder="Unassigned"
                  options={techs}
                  value={card.technicianId ?? ''}
                  onChange={(e) => void run(() => updateJobCard(device, card.id, { technicianId: e.target.value || undefined }, actor), 'Technician assigned')}
                />
                <div className="ex-row" style={{ flexWrap: 'wrap' }}>
                  {next.map((to) => (
                    <Button key={to} icon={JOB_CARD_STATUS[to].icon} variant={to === 'ready' ? 'success' : 'secondary'} onClick={() => void move(to)}>
                      {to === 'in-progress' && card.status === 'ready' ? 'Reopen work' : JOB_CARD_STATUS[to].label}
                    </Button>
                  ))}
                </div>
                {card.status === 'ready' ? (
                  <Button variant="primary" size="xl" block icon="ReceiptIndianRupee" disabled={!totals?.totalPaise} onClick={() => setPay(true)}>
                    Bill & deliver {totals ? money(totals.totalPaise) : ''}
                  </Button>
                ) : (
                  <InlineAlert tone="info" icon="Info">Mark the job <b>Ready for Pickup</b> once the repair is done, then bill and deliver.</InlineAlert>
                )}
                {!s.shift && card.status === 'ready' ? <InlineAlert tone="warning" icon="Clock">Open a shift on this counter to collect payment.</InlineAlert> : null}
                {JOB_CARD_FLOW[card.status].includes('cancelled') ? <Button variant="danger-outline" icon="CircleX" onClick={() => setCancel(true)}>Cancel job</Button> : null}
              </>
            ) : card.status === 'delivered' ? (
              <InlineAlert tone="success" icon="CircleCheck" title="Delivered" action={sale ? <Button size="sm" onClick={() => nav('/sales')}>View sales</Button> : undefined}>
                Billed on {sale?.documentNo ?? card.saleDocumentNo} · {sale ? money(sale.totalPaise) : ''}
              </InlineAlert>
            ) : (
              <InlineAlert tone="danger" icon="CircleX" title="Cancelled">{card.statusHistory[card.statusHistory.length - 1]?.note ?? 'Job cancelled.'}</InlineAlert>
            )}
          </div>

          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">Bill</div>
            <div className="pos-kv">
              <span>Services</span><span>{money(sum(services))}</span>
              <span>Parts</span><span>{money(sum(parts))}</span>
              <span>Taxable value</span><span>{money(totals?.taxablePaise ?? 0)}</span>
              <span>GST</span><span>{money(totals?.taxPaise ?? 0)}</span>
              {totals?.roundOffPaise ? (<><span>Round off</span><span>{money(totals.roundOffPaise)}</span></>) : null}
              <span className="total">Total</span><span className="total">{money(totals?.totalPaise ?? 0)}</span>
              {card.estimatePaise ? (<><span className="muted">Estimate given</span><span className="muted">{money(card.estimatePaise)}</span></>) : null}
              {card.advancePaise ? (<><span className="muted">Advance noted</span><span className="muted">{money(card.advancePaise)}</span></>) : null}
            </div>
            {card.estimatePaise && totals && totals.totalPaise > card.estimatePaise * 1.1 && open ? (
              <InlineAlert tone="warning" icon="TriangleAlert">Bill is over the estimate by {money(totals.totalPaise - card.estimatePaise)}. Get the customer's approval before proceeding.</InlineAlert>
            ) : null}
            {totals?.errors.length ? <InlineAlert tone="danger">{totals.errors[0]!.message}</InlineAlert> : null}
          </div>

          <div className="ex-card pos-card-pad ex-stack">
            <div className="pos-section-title">History</div>
            <Timeline
              items={[...card.statusHistory].reverse().map((h, i) => ({
                id: `${h.status}-${i}`,
                time: dateTime(h.at),
                title: JOB_CARD_STATUS[h.status].label,
                meta: [device.get('users', h.userId)?.name, h.note].filter(Boolean).join(' · '),
                tone: JOB_CARD_STATUS[h.status].tone === 'neutral' ? undefined : (JOB_CARD_STATUS[h.status].tone as 'success' | 'warning' | 'danger' | 'info'),
              }))}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog open={cancel} onClose={() => setCancel(false)} title={`Cancel ${card.jobNo}?`} confirmLabel="Cancel job" requireReason reasonLabel="Reason (e.g. customer declined estimate)" onConfirm={async (reason) => { await move('cancelled', reason); setCancel(false); }}>
        The device is returned unrepaired. Nothing is billed and no parts are deducted from stock.
      </ConfirmDialog>
      <PaymentModal
        open={pay}
        onClose={() => setPay(false)}
        duePaise={totals?.totalPaise ?? 0}
        customer={customer}
        allowCredit={s.permissions.includes('pos.credit-sale')}
        title="Bill & deliver"
        context={`${card.jobNo} · ${card.device.brand} ${card.device.model} · ${card.customerName}${card.advancePaise ? ` · advance ${money(card.advancePaise)} noted` : ''}`}
        onCommit={(tenders, clientTransactionId): Promise<Sale> => {
          const origin = originOf(s);
          if (!origin) return Promise.reject(new Error('Open a shift before billing.'));
          return billJobCard(device, { clientTransactionId, jobCardId: card.id, origin, tenders, billDiscountPct: 0 });
        }}
        onDone={() => {
          setPay(false);
          toast.success('Device delivered', card.jobNo);
        }}
      />
    </div>
  );
}

const sum = (lines: JobCardLine[]) => lines.reduce((a, l) => a + l.unitPricePaise * l.qty, 0);

// ───────────────────────── Services / parts ─────────────────────────

function LinesCard({ title, kind, card, lines, actor, editable }: { title: string; kind: JobCardLine['kind']; card: JobCard; lines: JobCardLine[]; actor: JobCardActor; editable: boolean }) {
  const s = useSession();
  const { device } = usePos();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [serialFor, setSerialFor] = useState<Product>();
  const [quote, setQuote] = useState<Product>();
  const [price, setPrice] = useState('');
  const results = useLive(device, ['products', 'stockMovements'], () => (q.trim().length >= 2 ? searchProducts(device, s.tenant.id, q, 30).filter((p) => (kind === 'service' ? !!p.isService : !p.isService)).slice(0, 8) : []), [q, kind]);
  const taken = card.lines.flatMap((l) => l.serials ?? []);

  const add = async (p: Product, extra: { serials?: string[]; unitPricePaise?: number } = {}) => {
    try {
      await addJobCardLine(device, card.id, { productId: p.id, qty: 1, ...extra }, actor);
      toast.success(`${kind === 'service' ? 'Service' : 'Part'} added`, p.name);
      setQ('');
    } catch (e) {
      toast.error('Could not add', errMsg(e));
    }
  };
  const pick = (p: Product) => {
    if (kind === 'service') {
      setQuote(p);
      setPrice(paiseToRupeesInput(p.salePaise));
    } else if (p.serialTracked) setSerialFor(p);
    else void add(p);
  };

  return (
    <div className="ex-card pos-card-pad ex-stack">
      <div className="ex-row"><div className="pos-section-title">{title}</div><div className="ex-spacer" /><span className="num muted">{money(sum(lines))}</span></div>
      {lines.length ? (
        <div className="pos-list">
          {lines.map((l) => (
            <div key={l.id} className="pos-list__row" style={{ cursor: 'default' }}>
              <Icon name={kind === 'service' ? 'Wrench' : 'Cpu'} size={16} />
              <span style={{ flex: 1, textAlign: 'left' }}>
                <b>{l.name}</b>
                <span className="muted">{l.serials?.length ? ` · SN ${l.serials.join(', ')}` : ''}{l.technicianId ? ` · ${device.get('users', l.technicianId)?.name ?? ''}` : ''}</span>
              </span>
              <span className="num">{l.qty} × {money(l.unitPricePaise)}</span>
              {editable ? <IconButton icon="Trash2" size="sm" variant="ghost" label={`Remove ${l.name}`} onClick={() => void removeJobCardLine(device, card.id, l.id, actor).catch((e) => toast.error('Could not remove', errMsg(e)))} /> : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="muted">{kind === 'service' ? 'No labour added yet.' : 'No parts used yet.'}</div>
      )}
      {editable ? (
        <div className="ex-stack">
          <SearchInput placeholder={kind === 'service' ? 'Add service — e.g. screen, battery, flash' : 'Add spare part — name, model or barcode'} value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pick(results[0]); }} />
          {results.length ? (
            <div className="pos-list" style={{ maxHeight: 260 }}>
              {results.map((p) => {
                const stock = p.isService ? undefined : onHand(device, s.store.id, p.id);
                return (
                  <button key={p.id} type="button" className="pos-list__row" onClick={() => pick(p)}>
                    <Icon name={p.isService ? 'Wrench' : 'Cpu'} size={16} />
                    <span style={{ flex: 1, textAlign: 'left' }}>{p.name}{p.model ? <span className="muted"> · {p.model}</span> : null}</span>
                    {stock !== undefined ? <Badge tone={stock > 0 ? 'success' : 'danger'}>{stock > 0 ? `${stock} in stock` : 'Out of stock'}</Badge> : null}
                    <span className="num">{money(p.salePaise)}</span>
                  </button>
                );
              })}
            </div>
          ) : q.trim().length >= 2 ? <div className="muted">No {kind === 'service' ? 'services' : 'parts'} match “{q}”.</div> : null}
        </div>
      ) : null}
      {serialFor ? (
        <SerialPicker product={serialFor} taken={taken} onClose={() => setSerialFor(undefined)} onPick={(serial) => { const p = serialFor; setSerialFor(undefined); void add(p, { serials: [serial] }); }} />
      ) : null}
      <Modal
        open={!!quote}
        onClose={() => setQuote(undefined)}
        size="sm"
        title="Quote labour"
        description={quote ? `${quote.name} · list price ${money(quote.salePaise)} incl. GST` : undefined}
        footer={<><Button onClick={() => setQuote(undefined)}>Cancel</Button><Button variant="primary" icon="Plus" disabled={!(rupeesToPaise(price || '0') > 0)} onClick={() => { const p = quote!; setQuote(undefined); void add(p, { unitPricePaise: rupeesToPaise(price) }); }}>Add service</Button></>}
      >
        <TextField autoFocus label="Charge (incl. GST)" prefix="₹" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} hint="Labour is quoted per job; adjust for complexity." />
      </Modal>
    </div>
  );
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`;
}
