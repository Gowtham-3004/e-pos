import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, DescriptionList, Icon, InlineAlert, Page, PageHeader, QuantityStepper, Select, StatusBadge, TextField, Textarea, useToast } from '@elixir/ui';
import { BACKOFFICE_NAV, DEVICE_STATUS, PLANS, POS_NAV, VERTICAL_CAPABILITIES, VERTICAL_LABEL, composeNav, familyOf, resolveCapabilities, roleByCode } from '@elixir/domain';
import type { Device, Tenant, Vertical } from '@elixir/contracts';
import { date, money } from '@elixir/format';
import { useActor, useCloud } from '../lib/hooks';
import { GSTIN_RE, STATE_CODES, VERTICAL_INFO, activationCode, addOnName, addOnsFor, capLabel, monthlyPrice } from '../lib/platform';
import { onboardTenant, type OnboardDraft } from '../lib/mutations';
import { CapabilityPreview, FormulaBanner } from '../components/CapabilityPreview';

const STEPS = ['Business', 'Vertical', 'Plan', 'Add-ons', 'First store', 'Counters', 'Review'] as const;
type Errors = Partial<Record<keyof OnboardDraft, string>>;

const EMPTY: OnboardDraft = {
  name: '', legalName: '', gstin: '', contactName: '', contactPhone: '', city: '', stateCode: '33',
  vertical: 'general', plan: 'pro', addOns: [],
  storeCode: '', storeName: '', storeAddress: '', storeCity: '', storeStateCode: '33',
  counters: 2, ownerName: '', ownerPin: '', trial: true,
};

function validate(step: number, d: OnboardDraft, existingNames: string[]): Errors {
  const e: Errors = {};
  if (step === 0) {
    if (d.name.trim().length < 2) e.name = 'Enter the trading name customers see on receipts.';
    else if (existingNames.includes(d.name.trim().toLowerCase())) e.name = `A tenant named “${d.name.trim()}” already exists. Use a distinct trading name.`;
    if (d.legalName.trim().length < 2) e.legalName = 'Enter the registered legal name used on tax invoices.';
    if (d.gstin.trim()) {
      const g = d.gstin.trim().toUpperCase();
      if (!GSTIN_RE.test(g)) e.gstin = 'GSTIN must be 15 characters: 2-digit state code, 10-character PAN, entity number, “Z”, checksum (e.g. 33AABCA1234F1Z5).';
      else if (g.slice(0, 2) !== d.stateCode) e.gstin = `GSTIN starts with state ${g.slice(0, 2)} but the business state is ${d.stateCode}. Correct the state or the GSTIN.`;
    }
    if (d.contactName.trim().length < 2) e.contactName = 'Enter the primary contact person.';
    if (!/^\+?[0-9 ]{10,15}$/.test(d.contactPhone.trim())) e.contactPhone = 'Enter a 10-digit mobile number, optionally with +91.';
    if (d.city.trim().length < 2) e.city = 'Enter the city.';
  }
  if (step === 4) {
    if (!/^[A-Za-z0-9]{2,6}$/.test(d.storeCode.trim())) e.storeCode = 'Store code is 2–6 letters or digits, e.g. ANN. It prefixes document numbers.';
    if (d.storeName.trim().length < 2) e.storeName = 'Enter the store name.';
    if (d.storeAddress.trim().length < 8) e.storeAddress = 'Enter the full address printed on invoices.';
  }
  if (step === 5) {
    const max = PLANS.find((p) => p.code === d.plan)!.maxCounters;
    if (d.counters < 1) e.counters = 'At least one counter is required.';
    if (d.counters > max) e.counters = `${PLANS.find((p) => p.code === d.plan)!.name} allows up to ${max} counter(s). Reduce counters or go back and choose a larger plan.`;
    if (!/^\d{4}$/.test(d.ownerPin)) e.ownerPin = 'Owner PIN must be exactly 4 digits.';
    else if (/^(\d)\1{3}$/.test(d.ownerPin) || d.ownerPin === '1234') e.ownerPin = 'Choose a PIN that is not a repeated digit or 1234.';
  }
  return e;
}

export function Onboarding() {
  const cloud = useCloud();
  const actor = useActor();
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [maxStep, setMaxStep] = useState(0);
  const [d, setD] = useState<OnboardDraft>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ tenant: Tenant; devices: Device[] }>();
  const formRef = useRef<HTMLDivElement>(null);
  const family = familyOf(d.vertical);
  const existingNames = useMemo(() => cloud.all('tenants').map((t) => t.name.toLowerCase()), [cloud]);
  const set = <K extends keyof OnboardDraft>(k: K, v: OnboardDraft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const go = (to: number) => {
    if (to > step) {
      for (let s = step; s < to; s++) {
        const e = validate(s, d, existingNames);
        if (Object.keys(e).length) {
          setStep(s);
          setErrors(e);
          requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
          return;
        }
      }
    }
    setErrors({});
    setStep(to);
    setMaxStep((m) => Math.max(m, to));
    if (to === 4 && !d.storeCity) setD((x) => ({ ...x, storeCity: x.city, storeStateCode: x.stateCode }));
    if (to === 5 && !d.ownerName) setD((x) => ({ ...x, ownerName: x.contactName }));
    window.scrollTo?.(0, 0);
  };

  const create = async () => {
    for (let s = 0; s < 6; s++) {
      const e = validate(s, d, existingNames);
      if (Object.keys(e).length) return go(s + 1);
    }
    setBusy(true);
    try {
      const r = await onboardTenant(cloud, actor, { ...d, gstin: d.gstin.trim().toUpperCase() });
      setDone({ tenant: r.tenant, devices: r.devices });
      toast.success(`${r.tenant.name} onboarded`, `${r.devices.length} device(s) awaiting activation.`);
    } catch (e) {
      toast.error('Onboarding failed — nothing was created', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Success tenant={done.tenant} devices={done.devices} onAnother={() => { setDone(undefined); setD(EMPTY); setStep(0); setMaxStep(0); }} onOpen={() => nav(`/tenants/${done.tenant.id}`)} />;

  const draftTenant = { vertical: d.vertical, plan: d.plan, addOns: d.addOns, subscriptionStatus: d.trial ? ('trial' as const) : ('active' as const) };
  const price = monthlyPrice(d);

  return (
    <Page maxWidth={1240}>
      <PageHeader title="Onboard tenant" description="Business → vertical → plan → add-ons → first store → counters & devices → review. Inputs are kept when you move between steps." />
      <ol className="pa-steps" aria-label="Onboarding progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'is-current' : i < step || i <= maxStep ? 'is-done' : undefined} aria-current={i === step ? 'step' : undefined}>
            <button type="button" disabled={i > maxStep + 1 || busy} onClick={() => go(i)}>
              <span className="pa-steps__n">{i < step ? <Icon name="Check" size={13} /> : i + 1}</span>
              <span className="pa-steps__label">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="pa-wizard">
        <div ref={formRef} className="pa-wizard__main">
          {step === 0 ? (
            <Card>
              <CardHeader title="Business details" subtitle="Legal identity used on tax invoices" icon="Building2" />
              <CardBody className="pa-form-grid">
                <TextField label="Trading name" required value={d.name} error={errors.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Annapoorna Stores" autoFocus />
                <TextField label="Legal name" required value={d.legalName} error={errors.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="e.g. Annapoorna Retail Pvt Ltd" />
                <TextField label="GSTIN" value={d.gstin} error={errors.gstin} hint="Optional for composition / unregistered businesses" onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="33AABCA1234F1Z5" maxLength={15} className="pa-mono" />
                <Select label="State (GST code)" required value={d.stateCode} onChange={(e) => set('stateCode', e.target.value)} options={STATE_CODES} />
                <TextField label="Contact person" required value={d.contactName} error={errors.contactName} onChange={(e) => set('contactName', e.target.value)} />
                <TextField label="Contact phone" required value={d.contactPhone} error={errors.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+91 98400 12345" inputMode="tel" />
                <TextField label="City" required value={d.city} error={errors.city} onChange={(e) => set('city', e.target.value)} />
              </CardBody>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card>
              <CardHeader title="Vertical" subtitle="Determines product family, data model extensions and screens. It cannot be changed after onboarding." icon="Shapes" />
              <CardBody>
                <div className="pa-vert-grid" role="radiogroup" aria-label="Vertical">
                  {(Object.keys(VERTICAL_LABEL) as Vertical[]).map((v) => (
                    <button key={v} type="button" role="radio" aria-checked={d.vertical === v} className={`pa-select-card${d.vertical === v ? ' is-selected' : ''}`} onClick={() => setD((x) => ({ ...x, vertical: v, addOns: x.addOns.filter((a) => addOnsFor(familyOf(v)).some((o) => o.code === a)) }))}>
                      <span className="pa-select-card__head">
                        <Icon name={VERTICAL_INFO[v].icon} size={18} />
                        <b>{VERTICAL_LABEL[v]}</b>
                        {familyOf(v) === 'restaurant' ? <Badge tone="info">Restaurant family</Badge> : null}
                        {d.vertical === v ? <Icon name="CircleCheck" size={18} className="pa-select-card__check" /> : null}
                      </span>
                      <span className="muted">{VERTICAL_INFO[v].description}</span>
                      <span className="pa-chips">
                        {VERTICAL_CAPABILITIES[v].filter((c) => c !== 'purchase' && c !== 'suppliers' && c !== 'inventory').map((c) => (
                          <span key={c} className="pa-cap">{capLabel(c)}</span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </CardBody>
            </Card>
          ) : null}

          {step === 2 ? (
            <Card>
              <CardHeader title="Plan" icon="Layers" />
              <CardBody className="ex-stack">
                <div className="pa-plan-grid" role="radiogroup" aria-label="Plan">
                  {PLANS.map((p) => {
                    const caps = p.capabilities.filter((c) => (family === 'retail' ? !c.startsWith('restaurant.') : true));
                    return (
                      <button key={p.code} type="button" role="radio" aria-checked={d.plan === p.code} className={`pa-select-card${d.plan === p.code ? ' is-selected' : ''}`} onClick={() => setD((x) => ({ ...x, plan: p.code, counters: Math.min(x.counters, p.maxCounters) }))}>
                        <span className="pa-select-card__head">
                          <b>{p.name}</b>
                          {d.plan === p.code ? <Icon name="CircleCheck" size={18} className="pa-select-card__check" /> : null}
                        </span>
                        <span className="pa-price"><b className="num">{money(p.monthlyPricePaise, { whole: true })}</b><span className="muted">/month</span></span>
                        <span className="muted">{p.description}</span>
                        <span className="pa-kv"><Icon name="Monitor" size={14} /> Up to <b className="num">{p.maxCounters}</b> counter{p.maxCounters > 1 ? 's' : ''}</span>
                        <span className="pa-chips">
                          {caps.length ? caps.map((c) => <span key={c} className="pa-cap">{capLabel(c)}</span>) : <span className="muted">Core + vertical capabilities only (offline, single counter)</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Checkbox label="Start as a 14-day trial (billing begins on conversion)" checked={d.trial} onChange={(e) => set('trial', e.target.checked)} />
              </CardBody>
            </Card>
          ) : null}

          {step === 3 ? (
            <Card>
              <CardHeader title="Add-ons" subtitle={`Showing add-ons available for the ${family} family`} icon="Puzzle" />
              <div className="pa-addon-list">
                {addOnsFor(family).map((a) => {
                  const included = a.capabilities.every((c) => resolveCapabilities({ ...draftTenant, addOns: [], subscriptionStatus: 'active' }).includes(c));
                  const on = d.addOns.includes(a.code);
                  return (
                    <label key={a.code} className={`pa-addon-row is-clickable${on ? ' is-on' : ''}`}>
                      <input type="checkbox" checked={on} onChange={() => set('addOns', on ? d.addOns.filter((x) => x !== a.code) : [...d.addOns, a.code])} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{a.name}</b> {included ? <Badge tone="info">Already included in plan</Badge> : null}
                        <div className="muted">{a.description}</div>
                      </div>
                      <span className="num">{money(a.monthlyPricePaise, { whole: true })}<span className="muted">/mo</span></span>
                    </label>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {step === 4 ? (
            <Card>
              <CardHeader title="First store" subtitle="More stores can be added later from Back Office (multi-store capability)" icon="Store" />
              <CardBody className="pa-form-grid">
                <TextField label="Store code" required value={d.storeCode} error={errors.storeCode} hint="Prefixes counters and document numbers" onChange={(e) => set('storeCode', e.target.value.toUpperCase())} maxLength={6} className="pa-mono" placeholder="ANN" autoFocus />
                <TextField label="Store name" required value={d.storeName} error={errors.storeName} onChange={(e) => set('storeName', e.target.value)} placeholder="Anna Nagar" />
                <div className="pa-span-2">
                  <Textarea label="Address" required value={d.storeAddress} error={errors.storeAddress} onChange={(e) => set('storeAddress', e.target.value)} rows={2} />
                </div>
                <TextField label="City" value={d.storeCity} onChange={(e) => set('storeCity', e.target.value)} />
                <Select label="State (GST code)" value={d.storeStateCode} onChange={(e) => set('storeStateCode', e.target.value)} options={STATE_CODES} hint={d.storeStateCode !== d.stateCode ? 'Different from the registered state — sales here will be inter-state (IGST) unless a separate GSTIN is added.' : undefined} />
              </CardBody>
            </Card>
          ) : null}

          {step === 5 ? (
            <Card>
              <CardHeader title="Counters & device activation" icon="MonitorSmartphone" />
              <CardBody className="ex-stack">
                <div className="pa-form-grid">
                  <div className="ex-field">
                    <span className="ex-label">Billing counters</span>
                    <QuantityStepper value={d.counters} min={1} max={20} onChange={(v) => set('counters', v)} label="Billing counters" />
                    {errors.counters ? <span className="ex-error" role="alert"><Icon name="CircleAlert" size={13} />{errors.counters}</span> : <span className="ex-hint">Plan allows up to {PLANS.find((p) => p.code === d.plan)!.maxCounters}</span>}
                  </div>
                  <div />
                  <TextField label="Owner name" value={d.ownerName} onChange={(e) => set('ownerName', e.target.value)} hint="First user, role Owner" />
                  <TextField label="Owner PIN" required value={d.ownerPin} error={errors.ownerPin} onChange={(e) => set('ownerPin', e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete="new-password" hint="4 digits · shared with the owner out-of-band" />
                </div>
                <div>
                  <div className="ex-label">Device activation codes</div>
                  <p className="muted" style={{ marginBottom: 8 }}>One POS device per counter is registered as <b>Pending activation</b>. Enter the code on the device's first-run screen, then confirm it in Device Registry.</p>
                  <table className="ex-table ex-table--dense">
                    <thead><tr><th>Counter</th><th>Device</th><th>Status</th><th>Activation code</th></tr></thead>
                    <tbody>
                      {Array.from({ length: Math.max(1, d.counters) }, (_, i) => {
                        return (
                          <tr key={i}>
                            <td className="pa-mono">C{String(i + 1).padStart(2, '0')}</td>
                            <td className="pa-mono">POS-{String(i + 1).padStart(2, '0')}</td>
                            <td><StatusBadge meta={DEVICE_STATUS['pending-activation']} /></td>
                            <td className="muted">Issued on create</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {step === 6 ? <Review d={d} /> : null}

          <div className="pa-wizard__nav">
            <Button icon="ArrowLeft" disabled={step === 0 || busy} onClick={() => go(step - 1)}>Back</Button>
            <div className="ex-spacer" />
            <span className="muted pa-hide-sm">Step {step + 1} of {STEPS.length}</span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" iconRight="ArrowRight" onClick={() => go(step + 1)}>Continue to {STEPS[step + 1]}</Button>
            ) : (
              <Button variant="primary" icon="Rocket" loading={busy} onClick={create}>Create tenant</Button>
            )}
          </div>
        </div>
        <aside className="pa-wizard__side">
          <Card>
            <CardHeader title="Summary" icon="ClipboardList" />
            <CardBody>
              <DescriptionList
                items={[
                  ['Tenant', d.name || <span className="muted">—</span>],
                  ['Vertical', VERTICAL_LABEL[d.vertical]],
                  ['Plan', `${PLANS.find((p) => p.code === d.plan)!.name}${d.trial ? ' (trial)' : ''}`],
                  ['Add-ons', d.addOns.length ? d.addOns.map(addOnName).join(', ') : 'None'],
                  ['Store', d.storeCode ? `${d.storeCode} · ${d.storeName}` : '—'],
                  ['Counters', <span className="num">{d.counters}</span>],
                ]}
              />
              <div className="pa-side-price">
                <span className="muted">Monthly</span>
                <b className="num">{money(price)}</b>
              </div>
              <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {resolveCapabilities(draftTenant).length} effective capabilities
              </div>
            </CardBody>
          </Card>
        </aside>
      </div>
    </Page>
  );
}

function Review({ d }: { d: OnboardDraft }) {
  const family = familyOf(d.vertical);
  const caps = resolveCapabilities({ vertical: d.vertical, plan: d.plan, addOns: d.addOns, subscriptionStatus: 'active' });
  const owner = roleByCode('owner');
  const bo = composeNav(BACKOFFICE_NAV, { capabilities: caps, permissions: owner.permissions, family });
  const pos = composeNav(POS_NAV, { capabilities: caps, permissions: owner.permissions, family });
  const boOn = caps.includes('backoffice-web');
  return (
    <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
      <Card>
        <CardHeader title="Review" subtitle="Check everything before creating — this writes the tenant, company, store, counters, devices, owner user and an audit event" icon="ClipboardCheck" />
        <CardBody className="pa-review-grid">
          <DescriptionList items={[['Trading name', d.name], ['Legal name', d.legalName], ['GSTIN', d.gstin || 'Not registered'], ['Contact', `${d.contactName} · ${d.contactPhone}`], ['City / state', `${d.city} · ${d.stateCode}`]]} />
          <DescriptionList items={[['Vertical', VERTICAL_LABEL[d.vertical]], ['Plan', `${PLANS.find((p) => p.code === d.plan)!.name}${d.trial ? ' — 14-day trial' : ''}`], ['Add-ons', d.addOns.length ? d.addOns.map(addOnName).join(', ') : 'None'], ['First store', `${d.storeCode} · ${d.storeName}`], ['Counters', `${d.counters} billing · ${d.counters} POS device(s) pending activation`], ['Owner', d.ownerName || d.contactName]]} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Effective capabilities" icon="Layers" />
        <CardBody className="ex-stack">
          <FormulaBanner compact />
          <CapabilityPreview after={{ vertical: d.vertical, plan: d.plan, addOns: d.addOns, subscriptionStatus: 'active' }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="What the owner will see" subtitle="Navigation composed from capabilities + Owner permissions — unavailable modules are removed, not disabled" icon="PanelLeft" />
        <CardBody className="pa-nav-preview">
          <NavPreview title="Elixir POS" items={pos} />
          {boOn ? <NavPreview title="Back Office (web)" items={bo} /> : (
            <div className="pa-navprev">
              <div className="pa-navprev__title">Back Office (web)</div>
              <InlineAlert tone="neutral" icon="Info">Not included — Web Back Office needs Pro or Business. Masters are managed on the POS desktop.</InlineAlert>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function NavPreview({ title, items }: { title: string; items: ReturnType<typeof composeNav> }) {
  let group: string | undefined;
  return (
    <div className="pa-navprev">
      <div className="pa-navprev__title">{title} <span className="muted num">· {items.length} items</span></div>
      <div className="pa-navprev__list">
        {items.map((i) => {
          const head = i.group && i.group !== group ? i.group : undefined;
          group = i.group;
          return (
            <div key={i.key}>
              {head ? <div className="pa-navprev__group">{head}</div> : null}
              <div className="pa-navprev__item"><Icon name={i.icon} size={15} />{i.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Success({ tenant, devices, onAnother, onOpen }: { tenant: Tenant; devices: Device[]; onAnother: () => void; onOpen: () => void }) {
  const nav = useNavigate();
  return (
    <Page maxWidth={900}>
      <Card>
        <CardBody className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
          <div className="ex-row" style={{ gap: 14 }}>
            <span className="pa-modal-icon pa-soft--success"><Icon name="CircleCheck" size={22} /></span>
            <div>
              <h1 style={{ fontSize: 'var(--fs-xl)' }}>{tenant.name} is onboarded</h1>
              <p className="muted">Config v{tenant.configVersion} published · subscription {tenant.subscriptionStatus === 'trial' ? 'trial' : 'active'} until {date(tenant.renewsOn)} · audit recorded</p>
            </div>
          </div>
          <div>
            <div className="ex-label">Activation codes — share with the store</div>
            <table className="ex-table ex-table--dense">
              <thead><tr><th>Device</th><th>Name</th><th>Status</th><th>Activation code</th></tr></thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="is-clickable" onClick={() => nav(`/devices/${d.id}`)}>
                    <td className="pa-mono"><b>{d.code}</b></td>
                    <td>{d.name}</td>
                    <td><StatusBadge meta={DEVICE_STATUS[d.status]} /></td>
                    <td><span className="pa-code">{activationCode(d.id)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            <Button variant="primary" icon="Building2" onClick={onOpen}>Open tenant</Button>
            <Button icon="MonitorSmartphone" onClick={() => nav(`/devices?tenant=${tenant.id}`)}>Activate devices</Button>
            <Button variant="ghost" icon="Plus" onClick={onAnother}>Onboard another</Button>
          </div>
        </CardBody>
      </Card>
    </Page>
  );
}
