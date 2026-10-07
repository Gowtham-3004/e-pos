import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ADD_ONS, CAPABILITY_LABEL, PLANS, SUBSCRIPTION_STATUS, VERTICAL_CAPABILITIES, VERTICAL_LABEL, documentNumber, planByCode } from '@elixir/domain';
import type { Capability } from '@elixir/contracts';
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, DescriptionList, Icon, InlineAlert, Segmented, Select, StatusBadge, Switch, Tabs, TextField, Textarea, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, money, number } from '@elixir/format';
import { FormSection, PageFrame } from '../components/common';
import { useCloud } from '../lib/data';
import { saveSettings, type TenantSettings } from '../lib/ops';
import { useSettings } from '../lib/settings';
import { useSession } from '../lib/session';

type Tab = 'subscription' | 'profile' | 'invoice' | 'tax' | 'printer' | 'offline';

export function SettingsPage() {
  const s = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'subscription';
  return (
    <PageFrame title="Settings" description="Business configuration. Changes publish to POS devices as a new config version." crumbs={[{ label: 'Administration' }, { label: 'Settings' }]}>
      <Tabs items={[{ key: 'subscription', label: 'Subscription', icon: 'Layers' }, { key: 'profile', label: 'Business profile', icon: 'Building2' }, { key: 'invoice', label: 'Invoice', icon: 'FileText' }, { key: 'tax', label: 'Tax rates', icon: 'Percent' }, { key: 'printer', label: 'Receipt & printer', icon: 'Printer' }, { key: 'offline', label: 'Offline policy', icon: 'WifiOff' }]} value={tab} onChange={(k) => setParams({ tab: k })} />
      {tab === 'subscription' ? <Subscription /> : <SettingsForm key={`${tab}-${s.tenant.id}`} tab={tab} />}
    </PageFrame>
  );
}

function Subscription() {
  const s = useSession();
  const plan = planByCode(s.tenant.plan);
  const all = Object.keys(CAPABILITY_LABEL) as Capability[];
  const relevant = all.filter((c) => (s.family === 'restaurant' ? c !== 'pos.billing' : !c.startsWith('restaurant.')));
  const off = relevant.filter((c) => !s.capabilities.includes(c));
  const addOns = ADD_ONS.filter((a) => a.families.includes(s.family));
  const source = (c: Capability) => (VERTICAL_CAPABILITIES[s.tenant.vertical].includes(c) ? 'Vertical' : plan.capabilities.includes(c) ? 'Plan' : s.tenant.addOns.some((a) => ADD_ONS.find((x) => x.code === a)?.capabilities.includes(c)) ? 'Add-on' : s.tenant.capabilityOverrides?.includes(c) ? 'Override' : 'Core');
  return (
    <div className="ex-stack" style={{ gap: 16 }}>
      <div className="bo-grid-main">
        <Card>
          <CardHeader title="Your subscription" icon="Layers" actions={<StatusBadge meta={SUBSCRIPTION_STATUS[s.tenant.subscriptionStatus]} />} />
          <div style={{ padding: 16 }} className="ex-stack">
            <div className="bo-stats">
              <div className="bo-stat"><span className="bo-stat__k">Vertical</span><span className="bo-stat__v" style={{ fontSize: 18 }}>{VERTICAL_LABEL[s.tenant.vertical]}</span></div>
              <div className="bo-stat"><span className="bo-stat__k">Plan</span><span className="bo-stat__v" style={{ fontSize: 18 }}>{plan.name}</span></div>
              <div className="bo-stat"><span className="bo-stat__k">Counters</span><span className="bo-stat__v" style={{ fontSize: 18 }}>up to {plan.maxCounters}</span></div>
              <div className="bo-stat"><span className="bo-stat__k">Renews</span><span className="bo-stat__v" style={{ fontSize: 18 }}>{date(s.tenant.renewsOn)}</span></div>
            </div>
            <div className="secondary" style={{ fontSize: 13 }}>{plan.description}</div>
            <div className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="ex-label" style={{ margin: 0 }}>Add-ons:</span>
              {s.tenant.addOns.length ? s.tenant.addOns.map((a) => <Badge key={a} tone="info" icon="Puzzle">{ADD_ONS.find((x) => x.code === a)?.name}</Badge>) : <span className="muted">None</span>}
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Change plan or add-ons" icon="LifeBuoy" />
          <div style={{ padding: 16 }} className="ex-stack">
            <span className="secondary" style={{ fontSize: 13 }}>Plans and add-ons are managed by Elixir. New capabilities appear in Back Office and on POS automatically after the change.</span>
            <Button variant="primary" icon="Phone" onClick={() => window.open('mailto:accounts@elixir.example?subject=Plan%20change%20for%20' + encodeURIComponent(s.tenant.name))}>Contact Elixir to change plan</Button>
            <span className="ex-hint">Support: +91 44 4000 1234 · Mon–Sat 9am–9pm</span>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Enabled capabilities" subtitle={`${s.capabilities.length} enabled — Core + Vertical + Plan + Add-ons`} icon="CircleCheck" />
        <div style={{ padding: 16 }} className="bo-cap-list">
          {s.capabilities.filter((c) => CAPABILITY_LABEL[c]).map((c) => <div key={c} className="bo-cap bo-cap--on"><Icon name="CircleCheck" size={16} /><span>{CAPABILITY_LABEL[c]}</span><span className="muted" style={{ fontSize: 11 }}>· {source(c)}</span></div>)}
        </div>
      </Card>
      <div className="bo-grid-2">
        <Card>
          <CardHeader title="Available add-ons" icon="Puzzle" />
          <div style={{ padding: 16 }} className="ex-stack">
            {addOns.map((a) => {
              const has = s.tenant.addOns.includes(a.code) || a.capabilities.every((c) => s.capabilities.includes(c));
              return (
                <div key={a.code} className={`bo-cap ${has ? 'bo-cap--on' : 'bo-cap--off'}`} style={{ alignItems: 'flex-start' }}>
                  <Icon name={has ? 'CircleCheck' : 'Circle'} size={16} />
                  <div style={{ flex: 1 }}><b style={{ color: 'var(--text-primary)' }}>{a.name}</b><div className="muted" style={{ fontSize: 12 }}>{a.description}</div></div>
                  <span className="num muted">{has ? 'Included' : `${money(a.monthlyPricePaise, { whole: true })}/mo`}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardHeader title="Not on your plan" subtitle="These modules are hidden from navigation" icon="Circle" />
          <div style={{ padding: 16 }} className="bo-cap-list">
            {off.map((c) => <div key={c} className="bo-cap bo-cap--off"><Icon name="Circle" size={16} /><span>{CAPABILITY_LABEL[c]}</span></div>)}
          </div>
        </Card>
      </div>
      <Card className="bo-card-table">
        <CardHeader title="Plans" icon="Layers" />
        <DataTable density="dense" rows={PLANS} rowKey={(p) => p.code} columns={[
          { key: 'n', header: 'Plan', render: (p) => <span className="bo-cell-main">{p.name}{p.code === s.tenant.plan ? <> <Badge tone="success">Current</Badge></> : null}</span> },
          { key: 'd', header: 'Includes', render: (p) => <span className="secondary">{p.description}</span> },
          { key: 'c', header: 'Counters', align: 'right', render: (p) => p.maxCounters },
          { key: 'p', header: 'Price / month', align: 'right', render: (p) => money(p.monthlyPricePaise, { whole: true }) },
        ]} />
      </Card>
    </div>
  );
}

function SettingsForm({ tab }: { tab: Exclude<Tab, 'subscription'> }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const saved = useSettings();
  const [f, setF] = useState<TenantSettings>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const savedKey = JSON.stringify(saved);
  useEffect(() => setF(JSON.parse(savedKey) as TenantSettings), [savedKey]);
  const dirty = JSON.stringify(f) !== savedKey;
  const set = <K extends keyof TenantSettings>(k: K, v: TenantSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const taxUse = useLive(cloud, ['products', 'taxRates'], () => cloud.all('taxRates').map((t) => ({ t, products: cloud.where('products', (p) => p.tenantId === s.tenant.id && p.taxRateId === t.id).length })), [s.tenant.id]);
  const sampleCounter = `${s.stores[0]?.code ?? 'ANN'}-C02`;
  const preview = documentNumber('INV', sampleCounter, 1284).replace(/^INV/, f.invoicePrefix || 'INV');

  const save = async () => {
    const e: Record<string, string> = {};
    if (tab === 'profile') {
      if (!f.businessName.trim()) e.businessName = 'Enter the trading name.';
      if (f.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin)) e.gstin = 'GSTIN must be 15 characters, e.g. 33AABCA1234F1Z5.';
    }
    if (tab === 'invoice' && !/^[A-Z]{2,5}$/.test(f.invoicePrefix)) e.invoicePrefix = 'Use 2–5 capital letters, e.g. INV.';
    if (tab === 'offline') {
      if (!(f.offlineGraceDays >= 1 && f.offlineGraceDays <= 30)) e.offlineGraceDays = 'Grace period must be 1–30 days.';
      if (!(f.staleConfigHours >= 1 && f.staleConfigHours <= 168)) e.staleConfigHours = 'Threshold must be 1–168 hours.';
    }
    if (tab === 'printer' && !(f.copies >= 1 && f.copies <= 3)) e.copies = 'Copies must be 1–3.';
    setErrors(e);
    if (Object.keys(e).length) return;
    await saveSettings(cloud, s.tenant.id, f, s.user.id, { profile: 'Business profile', invoice: 'Invoice', tax: 'Tax', printer: 'Receipt & printer', offline: 'Offline policy' }[tab]);
    toast.success('Settings saved', 'Devices receive the new configuration on next sync');
  };

  const canEdit = s.can('settings.edit');
  const footer = canEdit && tab !== 'tax' ? (
    <div className="bo-sticky-actions">
      <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      <div className="ex-spacer" />
      <Button disabled={!dirty} onClick={() => setF(saved)}>Discard</Button>
      <Button variant="primary" icon="Save" disabled={!dirty} onClick={() => void save()}>Save settings</Button>
    </div>
  ) : null;

  return (
    <div className="ex-stack" style={{ gap: 16, maxWidth: 1000 }}>
      {tab === 'profile' ? (
        <FormSection title="Business profile" icon="Building2" subtitle="Printed on invoices and used for GST place of supply">
          <TextField label="Trading name" required value={f.businessName} onChange={(e) => set('businessName', e.target.value)} error={errors.businessName} />
          <TextField label="Legal name" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} />
          <TextField label="GSTIN" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} error={errors.gstin} hint={`State code ${f.gstin.slice(0, 2) || s.tenant.stateCode}`} />
          <TextField label="Phone" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          <div className="bo-span-2"><Textarea label="Registered address" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
          <TextField label="Accounts email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </FormSection>
      ) : null}
      {tab === 'invoice' ? (
        <>
          <FormSection title="Invoice numbering" icon="Hash" subtitle="Counter-scoped series keep offline counters collision-free (ADR-014)">
            <TextField label="Prefix" value={f.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase())} error={errors.invoicePrefix} />
            <div className="ex-field">
              <span className="ex-label">Format preview</span>
              <div className="bo-code num" style={{ fontSize: 18, letterSpacing: '.04em', padding: 10 }}>{preview}</div>
              <span className="ex-hint">PREFIX / financial year / store-counter / 6-digit sequence. Resets every April.</span>
            </div>
          </FormSection>
          <FormSection title="Invoice content" icon="FileText" cols={1}>
            <Textarea label="Footer text" rows={3} value={f.invoiceFooter} onChange={(e) => set('invoiceFooter', e.target.value)} hint={`${f.invoiceFooter.length}/200 characters`} maxLength={200} />
            <Checkbox label="Show “You saved ₹…” vs MRP on receipts" checked={f.showSavings} onChange={(e) => set('showSavings', e.target.checked)} />
          </FormSection>
        </>
      ) : null}
      {tab === 'tax' ? (
        <Card className="bo-card-table">
          <CardHeader title="GST rates" subtitle="Managed by Elixir per GST notifications. Assign rates to products in the catalog." icon="Percent" />
          <DataTable rows={taxUse} rowKey={(r) => r.t.id} columns={[
            { key: 'n', header: 'Rate', render: (r) => <span className="bo-cell-main">{r.t.name}</span> },
            { key: 'r', header: 'GST %', align: 'right', render: (r) => `${r.t.ratePct}%` },
            { key: 'c', header: 'CGST + SGST (intra-state)', align: 'right', render: (r) => `${r.t.ratePct / 2}% + ${r.t.ratePct / 2}%` },
            { key: 'i', header: 'IGST (inter-state)', align: 'right', render: (r) => `${r.t.ratePct}%` },
            { key: 'cess', header: 'Cess', align: 'right', render: (r) => (r.t.cessPct ? `${r.t.cessPct}%` : '—') },
            { key: 'p', header: s.family === 'restaurant' ? 'Items' : 'Products', align: 'right', render: (r) => number(r.products) },
          ]} />
          <div className="bo-tfoot" style={{ justifyContent: 'flex-start' }}><span className="muted">Business state code {s.tenant.stateCode}. Sales to customers with a different GST state are taxed as IGST automatically.</span></div>
        </Card>
      ) : null}
      {tab === 'printer' ? (
        <FormSection title="Receipt & printer" icon="Printer">
          <div className="ex-field"><span className="ex-label">Paper</span><Segmented label="Paper" items={[{ key: '58mm', label: '58 mm' }, { key: '80mm', label: '80 mm' }, { key: 'A4', label: 'A4' }]} value={f.paperWidth} onChange={(k) => set('paperWidth', k)} /></div>
          <TextField label="Copies per bill" inputMode="numeric" value={String(f.copies)} onChange={(e) => set('copies', Number(e.target.value.replace(/\D/g, '')) || 0)} error={errors.copies} />
          <Switch label="Print automatically after payment" checked={f.autoPrint} onChange={(v) => set('autoPrint', v)} />
          <Switch label="Print logo on receipt" checked={f.printLogo} onChange={(v) => set('printLogo', v)} />
          <div className="bo-span-2"><InlineAlert tone="info">Printer hardware is configured on each counter (Counters & Devices). If printing fails, the sale is still saved and the cashier can reprint.</InlineAlert></div>
        </FormSection>
      ) : null}
      {tab === 'offline' ? (
        <FormSection title="Offline policy" icon="WifiOff" subtitle="How POS behaves when the internet or Elixir Cloud is unreachable">
          <TextField label="Offline sign-in grace" suffix="days" inputMode="numeric" value={String(f.offlineGraceDays)} onChange={(e) => set('offlineGraceDays', Number(e.target.value.replace(/\D/g, '')) || 0)} error={errors.offlineGraceDays} hint="Users can sign in with cached PIN for this long without going online" />
          <TextField label="Stale configuration warning after" suffix="hours" inputMode="numeric" value={String(f.staleConfigHours)} onChange={(e) => set('staleConfigHours', Number(e.target.value.replace(/\D/g, '')) || 0)} error={errors.staleConfigHours} hint="POS shows an inline warning when prices may be outdated" />
          <div className="ex-field bo-span-2">
            <span className="ex-label">Negative stock</span>
            <Segmented label="Negative stock policy" items={[{ key: 'warn', label: 'Warn and allow sale' }, { key: 'block', label: 'Block sale' }]} value={f.negativeStock} onChange={(k) => set('negativeStock', k)} />
            <span className="ex-hint">{f.negativeStock === 'block' ? 'Sales that would drop stock below zero need manager approval. Offline sales that break this rule raise a sync conflict.' : 'Cashier sees a warning; the sale continues and appears in the stock exceptions report.'}</span>
          </div>
          <Select label="Card/UPI when offline" value="manual" onChange={() => undefined} options={[{ value: 'manual', label: 'Allow with manual reference (FR-OFF-012)' }]} hint="Provider confirmation is reconciled after reconnect" />
        </FormSection>
      ) : null}
      {!canEdit ? <InlineAlert tone="info">Only owners can change settings.</InlineAlert> : null}
      <DescriptionList items={[['Config version', `v${s.tenant.configVersion}`], ['Applies to', `${s.stores.length} store(s)`]]} />
      {footer}
    </div>
  );
}
