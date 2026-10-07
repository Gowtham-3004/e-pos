import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Breadcrumb, Button, Card, CardBody, CardFooter, CardHeader, ConfirmDialog, DataTable, DescriptionList, EmptyState, Icon, InlineAlert, KpiCard,
  Modal, Page, PageHeader, Segmented, StatusBadge, Switch, Tabs, TextField, useToast, type Column,
} from '@elixir/ui';
import { DEVICE_STATUS, PLANS, SUBSCRIPTION_STATUS, VERTICAL_LABEL, roleByCode } from '@elixir/domain';
import type { AddOnCode, Capability, PlanCode, SubscriptionStatus, Tenant, User } from '@elixir/contracts';
import { useEntity, useLive, useNow } from '@elixir/local-store/react';
import { date, dateLong, daysUntil, isoDate, money, number, relative, dateTime } from '@elixir/format';
import { useActor, useCloud, useLookups } from '../lib/hooks';
import { useAccess } from '../lib/access';
import {
  addOnsFor, ageLabel, capLabel, capabilitiesForFamily, capabilityBreakdown, capabilityDiff, isDestructiveLoss, monthlyPrice, planName, secondsSince, CONFLICT_STATE,
} from '../lib/platform';
import { saveSubscription, setSubscriptionStatus } from '../lib/mutations';
import { CapabilityPreview, FormulaBanner } from '../components/CapabilityPreview';
import { GuardedButton, Mono, NotFound, PermissionNote } from '../components/common';
import { deviceColumns } from '../components/deviceColumns';
import { AuditView } from '../components/AuditView';

type TabKey = 'overview' | 'subscription' | 'stores' | 'devices' | 'users' | 'sync' | 'audit';

export function TenantDetail() {
  const { id } = useParams();
  const cloud = useCloud();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const tenant = useEntity(cloud, 'tenants', id);
  const { can } = useAccess();
  const tab = (sp.get('tab') as TabKey) || 'overview';
  const counts = useLive(cloud, ['stores', 'devices', 'users', 'syncConflicts'], () => ({
    stores: cloud.where('stores', (s) => s.tenantId === id).length,
    devices: cloud.where('devices', (d) => d.tenantId === id).length,
    users: cloud.where('users', (u) => u.tenantId === id).length,
    conflicts: cloud.where('syncConflicts', (c) => c.tenantId === id && c.state === 'open').length,
  }), [id]);

  if (!tenant) return <NotFound what="Tenant" back="/tenants" backLabel="Back to tenants" />;

  const setTab = (k: TabKey) => setSp(k === 'overview' ? {} : { tab: k }, { replace: true });
  const renewIn = daysUntil(tenant.renewsOn);

  return (
    <Page>
      <PageHeader
        breadcrumb={<Breadcrumb items={[can('tenant.view') ? { label: 'Tenants', onClick: () => nav('/tenants') } : { label: 'Tenants' }, { label: tenant.name }]} />}
        title={tenant.name}
        meta={<StatusBadge meta={SUBSCRIPTION_STATUS[tenant.subscriptionStatus]} size="lg" />}
        description={
          <span>
            {VERTICAL_LABEL[tenant.vertical]} · {planName(tenant.plan)} · {tenant.city} · config <span className="num">v{tenant.configVersion}</span> ·{' '}
            <span className={renewIn < 0 ? 'pa-tone-danger' : renewIn <= 7 ? 'pa-tone-warning' : undefined}>
              {renewIn < 0 ? `renewal overdue ${-renewIn}d` : `renews ${date(tenant.renewsOn)}`}
            </span>
          </span>
        }
        actions={
          <>
            <Button icon="MonitorSmartphone" onClick={() => nav(`/devices?tenant=${tenant.id}`)}>Devices</Button>
            <Button icon="LifeBuoy" onClick={() => nav(`/support?tenant=${tenant.id}`)}>Tickets</Button>
          </>
        }
      />
      {!can('tenant.view') && tab !== 'subscription' ? <PermissionNote action="tenant.plan.change">You are viewing this tenant in read-only mode.</PermissionNote> : null}
      {tenant.subscriptionStatus === 'suspended' ? (
        <InlineAlert tone="danger" icon="Ban" title="Tenant suspended">
          Devices keep historic read access only. Sales already committed on devices are retained and still sync. Reactivate from Subscription &amp; Capabilities.
        </InlineAlert>
      ) : tenant.subscriptionStatus === 'grace' ? (
        <InlineAlert tone="warning" icon="Hourglass" title="Grace period">
          Renewal is {Math.abs(renewIn)} days overdue. The tenant operates normally; decide whether to reactivate or suspend.
        </InlineAlert>
      ) : null}
      <Tabs<TabKey>
        value={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview', icon: 'Building2' },
          { key: 'subscription', label: 'Subscription & Capabilities', icon: 'Layers' },
          { key: 'stores', label: 'Stores & counters', icon: 'Store', count: counts.stores },
          { key: 'devices', label: 'Devices', icon: 'MonitorSmartphone', count: counts.devices },
          { key: 'users', label: 'Users', icon: 'Users', count: counts.users },
          { key: 'sync', label: 'Sync health', icon: 'RefreshCw', count: counts.conflicts || undefined },
          { key: 'audit', label: 'Audit', icon: 'ScrollText' },
        ]}
      />
      {tab === 'overview' ? <OverviewTab tenant={tenant} /> : null}
      {tab === 'subscription' ? <SubscriptionTab key={tenant.id} tenant={tenant} /> : null}
      {tab === 'stores' ? <StoresTab tenant={tenant} /> : null}
      {tab === 'devices' ? <DevicesTab tenant={tenant} /> : null}
      {tab === 'users' ? <UsersTab tenant={tenant} /> : null}
      {tab === 'sync' ? <SyncTab tenant={tenant} /> : null}
      {tab === 'audit' ? <AuditTab tenant={tenant} /> : null}
    </Page>
  );
}

// ───────── Overview ─────────

function OverviewTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const stats = useLive(cloud, ['devices', 'stores', 'sales'], () => {
    const devices = cloud.where('devices', (d) => d.tenantId === tenant.id);
    return {
      active: devices.filter((d) => d.status === 'active').length,
      total: devices.filter((d) => d.status !== 'revoked').length,
      pending: devices.reduce((s, d) => s + d.pendingSync, 0),
      sales: cloud.where('sales', (s) => s.tenantId === tenant.id).length,
    };
  }, [tenant.id]);
  const caps = capabilityBreakdown(tenant).effective.length;
  return (
    <div className="pa-grid-2-1">
      <Card>
        <CardHeader title="Business profile" icon="Building2" />
        <CardBody>
          <DescriptionList
            items={[
              ['Trading name', tenant.name],
              ['Legal name', tenant.legalName],
              ['GSTIN', tenant.gstin ? <Mono>{tenant.gstin}</Mono> : <span className="muted">Not registered</span>],
              ['State code', <span className="num">{tenant.stateCode}</span>],
              ['Contact', `${tenant.contactName} · ${tenant.contactPhone}`],
              ['City', tenant.city],
              ['Product family', <Badge outline>{tenant.family === 'restaurant' ? 'Restaurant' : 'Retail'}</Badge>],
              ['Vertical', VERTICAL_LABEL[tenant.vertical]],
              ['Created', dateLong(tenant.createdAt)],
              ['Tenant ID', <Mono>{tenant.id}</Mono>],
            ]}
          />
        </CardBody>
      </Card>
      <div className="ex-stack">
        <KpiCard label="Monthly subscription" icon="IndianRupee" value={<span className="num">{money(monthlyPrice(tenant))}</span>} foot={`${planName(tenant.plan)}${tenant.addOns.length ? ` + ${tenant.addOns.length} add-on(s)` : ''}`} />
        <KpiCard label="Devices active" icon="MonitorCheck" value={<span className="num">{stats.active} / {stats.total}</span>} foot={`${number(stats.pending)} events pending sync`} />
        <KpiCard label="Effective capabilities" icon="Layers" value={<span className="num">{caps}</span>} foot={`Config v${tenant.configVersion} · ${number(stats.sales)} sales in cloud`} />
      </div>
    </div>
  );
}

// ───────── Subscription & capabilities ─────────

function SubscriptionTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const { can } = useAccess();
  const editable = can('tenant.plan.change');
  const [plan, setPlan] = useState<PlanCode>(tenant.plan);
  const [addOns, setAddOns] = useState<AddOnCode[]>(tenant.addOns);
  const [overrides, setOverrides] = useState<Capability[]>(tenant.capabilityOverrides ?? []);
  const [restrictions, setRestrictions] = useState<Capability[]>(tenant.capabilityRestrictions ?? []);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const draft = { ...tenant, plan, addOns, capabilityOverrides: overrides, capabilityRestrictions: restrictions };
  const diff = capabilityDiff(tenant, draft);
  const dirty =
    plan !== tenant.plan ||
    addOns.slice().sort().join() !== tenant.addOns.slice().sort().join() ||
    overrides.slice().sort().join() !== (tenant.capabilityOverrides ?? []).slice().sort().join() ||
    restrictions.slice().sort().join() !== (tenant.capabilityRestrictions ?? []).slice().sort().join();
  const reset = () => {
    setPlan(tenant.plan);
    setAddOns(tenant.addOns);
    setOverrides(tenant.capabilityOverrides ?? []);
    setRestrictions(tenant.capabilityRestrictions ?? []);
  };
  // Re-baseline when someone else publishes a newer config, unless we hold local edits.
  useEffect(() => {
    if (!dirty) reset();
  }, [tenant.configVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const layersOnly = capabilityBreakdown({ ...draft, capabilityOverrides: [], capabilityRestrictions: [], subscriptionStatus: 'active' }).effective;
  const familyCaps = capabilitiesForFamily(tenant.family);
  const grantable = familyCaps.filter((c) => !layersOnly.includes(c));
  const restrictable = layersOnly;
  const destructive = isDestructiveLoss(diff.lost);
  const counters = useLive(cloud, ['counters', 'stores'], () => {
    const storeIds = new Set(cloud.where('stores', (s) => s.tenantId === tenant.id).map((s) => s.id));
    return cloud.where('counters', (c) => storeIds.has(c.storeId) && c.kind === 'billing').length;
  }, [tenant.id]);
  const maxCounters = PLANS.find((p) => p.code === plan)!.maxCounters;
  const priceBefore = monthlyPrice(tenant), priceAfter = monthlyPrice(draft);

  const save = async (reason?: string) => {
    setBusy(true);
    try {
      const after = await saveSubscription(cloud, actor, tenant, { plan, addOns, capabilityOverrides: overrides, capabilityRestrictions: restrictions }, reason);
      toast.success('Subscription saved', `Config v${after.configVersion} published — devices pick it up on next sync.`);
      setConfirm(false);
    } catch (e) {
      toast.error('Could not save subscription', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  return (
    <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
      <FormulaBanner />
      <PermissionNote action="tenant.plan.change">Plan, add-ons and overrides are read-only for you.</PermissionNote>
      <div className="pa-grid-sub">
        <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
          <Card>
            <CardHeader title="Vertical & plan" icon="Layers" />
            <CardBody className="ex-stack">
              <div className="pa-readonly-field">
                <span className="ex-label">Vertical</span>
                <div className="ex-row">
                  <b>{VERTICAL_LABEL[tenant.vertical]}</b>
                  <Badge icon="Lock">Locked after onboarding</Badge>
                </div>
                <span className="ex-hint">Changing vertical changes data model extensions (batches, variants, serials). It requires a migration project, not a toggle.</span>
              </div>
              <div role="radiogroup" aria-label="Plan" className="pa-plan-pick">
                {PLANS.map((p) => (
                  <label key={p.code} className={`pa-plan-opt${plan === p.code ? ' is-selected' : ''}${!editable ? ' is-disabled' : ''}`}>
                    <input type="radio" name="plan" value={p.code} checked={plan === p.code} disabled={!editable} onChange={() => setPlan(p.code)} />
                    <span className="pa-plan-opt__main">
                      <b>{p.name}</b>
                      <span className="muted">Up to {p.maxCounters} counter{p.maxCounters > 1 ? 's' : ''}</span>
                    </span>
                    <span className="num pa-plan-opt__price">{money(p.monthlyPricePaise, { whole: true })}<span className="muted">/mo</span></span>
                    {tenant.plan === p.code ? <Badge tone="info">Current</Badge> : null}
                  </label>
                ))}
              </div>
              {counters > maxCounters ? (
                <InlineAlert tone="warning" title="Counter limit exceeded">
                  {planName(plan)} allows {maxCounters} counter(s); this tenant has {counters}. Extra counters stay readable but cannot open new shifts until the plan is upgraded or counters are deactivated.
                </InlineAlert>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Add-ons" subtitle={`Available for ${tenant.family === 'restaurant' ? 'restaurant' : 'retail'} tenants`} icon="Puzzle" />
            <div className="pa-addon-list">
              {addOnsFor(tenant.family).map((a) => {
                const included = a.capabilities.every((c) => capabilityBreakdown({ ...draft, addOns: [], capabilityOverrides: [], capabilityRestrictions: [], subscriptionStatus: 'active' }).effective.includes(c));
                return (
                  <div key={a.code} className="pa-addon-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b>{a.name}</b> {included ? (addOns.includes(a.code) ? <Badge tone="warning" icon="TriangleAlert">Included in plan — add-on is redundant</Badge> : <Badge tone="info">Included in plan</Badge>) : null}
                      <div className="muted">{a.description}</div>
                    </div>
                    <span className="num">{money(a.monthlyPricePaise, { whole: true })}<span className="muted">/mo</span></span>
                    <Switch label={<span className="sr-only">{a.name}</span>} checked={addOns.includes(a.code)} disabled={!editable} onChange={() => setAddOns((xs) => toggle(xs, a.code))} />
                  </div>
                );
              })}
            </div>
          </Card>
          <Card>
            <CardHeader title="Overrides & restrictions" subtitle="Support grants beyond the plan, or explicit removals" icon="SlidersHorizontal" />
            <CardBody className="ex-stack">
              <div>
                <div className="ex-label">Grant override</div>
                <div className="pa-chips">
                  {grantable.length ? grantable.map((c) => (
                    <button key={c} type="button" className="ex-chip pa-chip-sm" aria-pressed={overrides.includes(c)} disabled={!editable} onClick={() => setOverrides((xs) => toggle(xs, c))}>
                      {overrides.includes(c) ? <Icon name="Check" size={13} /> : <Icon name="Plus" size={13} />}
                      {capLabel(c)}
                    </button>
                  )) : <span className="muted">Every capability is already granted by the layers above.</span>}
                </div>
              </div>
              <div>
                <div className="ex-label">Restrict</div>
                <div className="pa-chips">
                  {restrictable.map((c) => (
                    <button key={c} type="button" className="ex-chip pa-chip-sm pa-chip-restrict" aria-pressed={restrictions.includes(c)} disabled={!editable} onClick={() => setRestrictions((xs) => toggle(xs, c))}>
                      {restrictions.includes(c) ? <Icon name="Ban" size={13} /> : null}
                      {capLabel(c)}
                    </button>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
        <div className="pa-sticky">
          <Card>
            <CardHeader title="Effective capability preview" subtitle={dirty ? 'Unsaved changes — compared with current' : 'Current configuration'} icon="Eye" />
            <CardBody>
              <CapabilityPreview after={draft} before={dirty ? tenant : undefined} />
            </CardBody>
            <CardFooter className="pa-save-foot">
              <div className="pa-price-change">
                <span className="muted">Monthly</span>
                {priceAfter !== priceBefore ? (
                  <>
                    <span className="num pa-strike muted">{money(priceBefore)}</span>
                    <Icon name="ArrowRight" size={14} />
                  </>
                ) : null}
                <b className="num">{money(priceAfter)}</b>
              </div>
              <div className="ex-spacer" />
              <Button variant="ghost" disabled={!dirty || busy} onClick={reset}>Discard</Button>
              <GuardedButton action="tenant.plan.change" variant="primary" icon="Save" disabled={!dirty} onClick={() => setConfirm(true)}>Review &amp; save</GuardedButton>
            </CardFooter>
          </Card>
        </div>
      </div>
      <StatusCard tenant={tenant} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={save}
        busy={busy}
        title={`Apply subscription change to ${tenant.name}?`}
        confirmLabel={`Publish config v${tenant.configVersion + 1}`}
        tone={destructive ? 'danger' : 'primary'}
        requireReason={destructive}
        reasonLabel="Reason (capabilities in use will be removed)"
      >
        <div className="ex-stack" style={{ gap: 12 }}>
          <DiffList title="Gained" tone="success" caps={diff.gained} />
          <DiffList title="Lost" tone="danger" caps={diff.lost} />
          {!diff.gained.length && !diff.lost.length ? <span>No change to effective capabilities{priceAfter !== priceBefore ? '; price changes only' : ''}.</span> : null}
          <span>
            Monthly price {money(priceBefore)} → <b>{money(priceAfter)}</b>. Devices pull the new configuration on next sync; offline devices keep their last config until they reconnect.
          </span>
          {destructive ? <InlineAlert tone="warning">Removing capabilities such as {diff.lost.filter((c) => isDestructiveLoss([c])).map(capLabel).join(', ')} hides those modules for every user of this tenant. Existing data is retained.</InlineAlert> : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}

function DiffList({ title, tone, caps }: { title: string; tone: 'success' | 'danger'; caps: Capability[] }) {
  if (!caps.length) return null;
  return (
    <div>
      <div className={`ex-label pa-tone-${tone}`}>{title} ({caps.length})</div>
      <div className="pa-chips">
        {caps.map((c) => (
          <span key={c} className={`pa-cap ${tone === 'success' ? 'pa-cap--gained' : 'pa-cap--lost'}`}>
            <Icon name={tone === 'success' ? 'Plus' : 'Minus'} size={11} />
            {capLabel(c)}
          </span>
        ))}
      </div>
    </div>
  );
}

type StatusAction = { to: SubscriptionStatus; label: string; icon: string; tone: 'danger' | 'primary'; reason: boolean; days?: number; body: string };

function StatusCard({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const actor = useActor();
  const toast = useToast();
  const [pending, setPending] = useState<StatusAction>();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const s = tenant.subscriptionStatus;
  const actions: StatusAction[] = [
    { to: 'trial', label: 'Start trial', icon: 'FlaskConical', tone: 'primary', reason: false, days: 14, body: 'Starts a 14-day trial. All plan capabilities stay available; billing starts at conversion.' },
    { to: 'grace', label: 'Move to grace', icon: 'Hourglass', tone: 'primary', reason: true, body: 'Marks renewal as overdue. The tenant keeps operating normally; reminders are sent and the console flags it for follow-up.' },
    { to: 'active', label: 'Reactivate', icon: 'CircleCheck', tone: 'primary', reason: s === 'suspended', days: 30, body: 'Restores plan capabilities and renews for 30 days. Devices regain operating capabilities on their next config pull.' },
    { to: 'suspended', label: 'Suspend', icon: 'Ban', tone: 'danger', reason: true, body: 'Security revocation path: devices drop to historic read-only access on next config pull. No committed sale is deleted; pending device events still sync.' },
  ].filter((a) => a.to !== s && !(a.to === 'trial' && s !== 'active' && s !== 'cancelled')) as StatusAction[];

  const open = (a: StatusAction) => {
    setPending(a);
    setTyped('');
    setReason('');
  };
  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await setSubscriptionStatus(cloud, actor, tenant, pending.to, { reason: reason.trim() || undefined, renewsOn: pending.days ? isoDate(Date.now() + pending.days * 86400000) : undefined });
      toast.success(`${tenant.name}: ${SUBSCRIPTION_STATUS[pending.to].label}`, `Config v${tenant.configVersion + 1} published and audited.`);
      setPending(undefined);
    } catch (e) {
      toast.error('Status change failed', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needsTyped = pending?.to === 'suspended';
  const ready = (!pending?.reason || reason.trim().length >= 5) && (!needsTyped || typed.trim() === tenant.name);
  return (
    <Card>
      <CardHeader title="Subscription status" icon="BadgeCheck" subtitle="Lifecycle changes are security events and are published to devices" />
      <CardBody>
        <div className="pa-status-row">
          <div className="ex-stack" style={{ gap: 4, alignItems: 'flex-start' }}>
            <StatusBadge meta={SUBSCRIPTION_STATUS[s]} size="lg" />
            <span className="muted">
              {s === 'trial' ? 'Trial ends' : 'Renews'} {date(tenant.renewsOn)} ({daysUntil(tenant.renewsOn) < 0 ? `${-daysUntil(tenant.renewsOn)}d overdue` : `in ${daysUntil(tenant.renewsOn)}d`})
            </span>
          </div>
          <div className="ex-spacer" />
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            {actions.map((a) => (
              <GuardedButton key={a.to} action="tenant.status.change" icon={a.icon} variant={a.tone === 'danger' ? 'danger-outline' : 'secondary'} onClick={() => open(a)}>
                {a.label}
              </GuardedButton>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <PermissionNote action="tenant.status.change" />
        </div>
      </CardBody>
      <Modal
        open={!!pending}
        onClose={() => !busy && setPending(undefined)}
        size="sm"
        dismissible={!busy}
        title={pending ? `${pending.label} — ${tenant.name}` : ''}
        icon={pending?.tone === 'danger' ? <span className="pa-modal-icon pa-soft--danger"><Icon name="ShieldAlert" size={20} /></span> : undefined}
        footer={
          <>
            <Button onClick={() => setPending(undefined)} disabled={busy}>Cancel</Button>
            <Button variant={pending?.tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={!ready} onClick={run}>
              {pending?.label}
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="ex-stack">
            <p className="secondary">{pending.body}</p>
            <DescriptionList items={[['Current', <StatusBadge meta={SUBSCRIPTION_STATUS[s]} />], ['New', <StatusBadge meta={SUBSCRIPTION_STATUS[pending.to]} />], ['Config', `v${tenant.configVersion} → v${tenant.configVersion + 1}`]]} />
            {pending.reason ? <TextField label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the security audit" hint="At least 5 characters" /> : null}
            {needsTyped ? <TextField label={<>Type <b>{tenant.name}</b> to confirm</>} required value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /> : null}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

// ───────── Stores & counters ─────────

function StoresTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const nav = useNavigate();
  const data = useLive(cloud, ['stores', 'counters', 'devices', 'edgeNodes'], () =>
    cloud.where('stores', (s) => s.tenantId === tenant.id).map((s) => ({
      store: s,
      edge: cloud.where('edgeNodes', (e) => e.storeId === s.id)[0],
      counters: cloud.where('counters', (c) => c.storeId === s.id).map((c) => ({ counter: c, devices: cloud.where('devices', (d) => d.counterId === c.id && d.status !== 'revoked') })),
    })),
  [tenant.id]);
  if (!data.length) return <EmptyState icon="Store" title="No stores yet">This tenant has no stores. Stores are created during onboarding or from the tenant's Back Office.</EmptyState>;
  return (
    <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
      {data.map(({ store, counters, edge }) => (
        <Card key={store.id}>
          <CardHeader
            title={<span>{store.name} <span className="muted pa-mono">{store.code}</span></span>}
            subtitle={`${store.address} · state ${store.stateCode} · ${store.phone}`}
            icon="Store"
            actions={store.edgeEnabled ? <Badge tone={edge?.status === 'healthy' ? 'success' : 'warning'} icon="Router">Store Edge{edge ? ` · ${edge.status}` : ''}</Badge> : <Badge>No Store Edge</Badge>}
          />
          <table className="ex-table ex-table--dense">
            <thead>
              <tr><th>Counter</th><th>Name</th><th>Kind</th><th>Assigned device</th><th>Device status</th><th className="ex-right">Pending</th></tr>
            </thead>
            <tbody>
              {counters.map(({ counter, devices }) => (
                <tr key={counter.id} className={devices[0] ? 'is-clickable' : undefined} onClick={devices[0] ? () => nav(`/devices/${devices[0]!.id}`) : undefined}>
                  <td><b className="pa-mono">{counter.code}</b></td>
                  <td>{counter.name}</td>
                  <td className="muted">{counter.kind}</td>
                  <td>{devices.length ? devices.map((d) => <span key={d.id} className="pa-mono">{d.code} </span>) : <span className="muted">No device</span>}</td>
                  <td>{devices[0] ? <StatusBadge meta={DEVICE_STATUS[devices[0].status]} /> : <span className="muted">—</span>}</td>
                  <td className="ex-right num">{devices.reduce((s, d) => s + d.pendingSync, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function DevicesTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const nav = useNavigate();
  const lk = useLookups();
  const now = useNow(30000);
  const rows = useLive(cloud, ['devices'], () => cloud.where('devices', (d) => d.tenantId === tenant.id), [tenant.id]);
  return (
    <Card>
      <DataTable columns={deviceColumns(lk, now, { compact: true })} rows={rows} rowKey={(d) => d.id} onRowClick={(d) => nav(`/devices/${d.id}`)} initialSort={{ key: 'code', dir: 'asc' }} empty={<EmptyState quiet icon="MonitorSmartphone" title="No devices registered" />} />
    </Card>
  );
}

function UsersTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const lk = useLookups();
  const rows = useLive(cloud, ['users'], () => cloud.where('users', (u) => u.tenantId === tenant.id), [tenant.id]);
  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', sortable: true, render: (u) => <b>{u.name}</b> },
    { key: 'username', header: 'Username', render: (u) => <Mono>{u.username}</Mono> },
    { key: 'role', header: 'Role', sortable: true, render: (u) => roleByCode(u.role)?.name ?? u.role },
    { key: 'stores', header: 'Stores', render: (u) => u.storeIds.map((s) => lk.storeName(s)).join(', ') || '—' },
    { key: 'phone', header: 'Phone', render: (u) => <span className="num">{u.phone ?? '—'}</span> },
    { key: 'offline', header: 'Offline sign-in valid', align: 'right', render: (u) => <span className="num">{u.offlineAuthValidUntil ? date(u.offlineAuthValidUntil) : '—'}</span> },
    { key: 'active', header: 'Status', render: (u) => (u.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge icon="CircleX">Inactive</Badge>) },
  ];
  return (
    <div className="ex-stack">
      <InlineAlert tone="info" icon="Info">Users are managed by the tenant in Back Office (Users &amp; Roles). Platform staff see this list read-only; PINs are never displayed.</InlineAlert>
      <Card>
        <DataTable columns={columns} rows={rows} rowKey={(u) => u.id} initialSort={{ key: 'role', dir: 'asc' }} empty={<EmptyState quiet icon="Users" title="No users" />} />
      </Card>
    </div>
  );
}

function SyncTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const nav = useNavigate();
  const lk = useLookups();
  const now = useNow(15000);
  const d = useLive(cloud, ['devices', 'syncConflicts', 'inbox', 'changefeed'], () => {
    const devices = cloud.where('devices', (x) => x.tenantId === tenant.id && x.status !== 'revoked' && x.status !== 'pending-activation');
    const ids = new Set(devices.map((x) => x.id));
    return {
      devices: devices.slice().sort((a, b) => b.pendingSync - a.pendingSync),
      pending: devices.reduce((s, x) => s + x.pendingSync, 0),
      failed: devices.reduce((s, x) => s + x.failedSync, 0),
      oldest: devices.filter((x) => x.pendingSync).reduce((m, x) => Math.max(m, secondsSince(x.lastSyncAt, now)), 0),
      inbox: cloud.where('inbox', (i) => ids.has(i.deviceId)).length,
      conflicts: cloud.where('syncConflicts', (c) => c.tenantId === tenant.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      feed: cloud.where('changefeed', (c) => c.tenantId === tenant.id).sort((a, b) => b.seq - a.seq).slice(0, 8),
    };
  }, [tenant.id, now]);
  return (
    <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
      <div className="pa-kpis pa-kpis--4">
        <KpiCard label="Pending events" icon="CloudUpload" value={<span className="num">{number(d.pending)}</span>} foot={`oldest ${ageLabel(d.oldest)}`} />
        <KpiCard label="Failed / quarantined" icon="TriangleAlert" tone={d.failed ? 'warning' : undefined} value={<span className="num">{d.failed}</span>} />
        <KpiCard label="Open conflicts" icon="GitMerge" tone={d.conflicts.some((c) => c.state === 'open') ? 'danger' : 'success'} value={<span className="num">{d.conflicts.filter((c) => c.state === 'open').length}</span>} />
        <KpiCard label="Cloud inbox (accepted)" icon="Inbox" value={<span className="num">{number(d.inbox)}</span>} foot="events acknowledged this session" />
      </div>
      <div className="pa-grid-2">
        <Card>
          <CardHeader title="Device sync health" icon="MonitorSmartphone" />
          <table className="ex-table ex-table--dense">
            <thead><tr><th>Device</th><th>Status</th><th className="ex-right">Pending</th><th className="ex-right">Failed</th><th className="ex-right">Last sync</th></tr></thead>
            <tbody>
              {d.devices.map((x) => (
                <tr key={x.id} className="is-clickable" onClick={() => nav(`/devices/${x.id}`)}>
                  <td><b className="pa-mono">{x.code}</b> <span className="muted">{lk.storeName(x.storeId)}</span></td>
                  <td><StatusBadge meta={DEVICE_STATUS[x.status]} /></td>
                  <td className="ex-right num">{x.pendingSync}</td>
                  <td className="ex-right num">{x.failedSync}</td>
                  <td className="ex-right num">{relative(x.lastSyncAt, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.devices.length ? <EmptyState quiet title="No activated devices" /> : null}
        </Card>
        <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
          <Card>
            <CardHeader title="Conflicts & quarantine" icon="GitMerge" actions={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => nav('/sync')}>Sync diagnostics</Button>} />
            {d.conflicts.length ? (
              <ul className="pa-mini-list">
                {d.conflicts.map((c) => (
                  <li key={c.id} className="is-clickable" onClick={() => nav(`/sync?conflict=${c.id}`)}>
                    <StatusBadge meta={CONFLICT_STATE[c.state]} />
                    <span className="ex-truncate"><Mono>{c.reasonCode}</Mono> {c.documentNo ?? c.entity}</span>
                    <span className="muted num">{relative(c.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState quiet icon="CircleCheck" title="No conflicts" />}
          </Card>
          <Card>
            <CardHeader title="Config published to devices" subtitle="Change feed entries for this tenant" icon="Radio" />
            {d.feed.length ? (
              <ul className="pa-mini-list">
                {d.feed.map((f) => (
                  <li key={f.id}>
                    <span className="num muted">#{f.seq}</span>
                    <span className="ex-truncate">{f.summary}</span>
                    <span className="muted num">{relative(f.createdAt, now)}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState quiet icon="Radio" title="No config changes published yet">Saving subscription changes appends to the change feed.</EmptyState>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function AuditTab({ tenant }: { tenant: Tenant }) {
  const cloud = useCloud();
  const [mode, setMode] = useState<'timeline' | 'table'>('timeline');
  const [cat, setCat] = useState<'all' | 'security' | 'business' | 'technical'>('all');
  const events = useLive(cloud, ['auditEvents'], () => cloud.where('auditEvents', (a) => a.tenantId === tenant.id && (cat === 'all' || a.category === cat)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [tenant.id, cat]);
  const counts = useMemo(() => events.length, [events]);
  return (
    <Card>
      <CardHeader
        title="Tenant audit"
        subtitle={`${number(counts)} events · ${dateTime(Date.now())}`}
        icon="ScrollText"
        actions={
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            <Segmented value={cat} onChange={setCat} label="Category" items={[{ key: 'all', label: 'All' }, { key: 'security', label: 'Security' }, { key: 'business', label: 'Business' }, { key: 'technical', label: 'Technical' }]} />
            <Segmented value={mode} onChange={setMode} label="View" items={[{ key: 'timeline', label: 'Timeline', icon: 'ListTree' }, { key: 'table', label: 'Table', icon: 'Table' }]} />
          </div>
        }
      />
      <CardBody>
        <AuditView events={events} mode={mode} showTenant={false} />
      </CardBody>
    </Card>
  );
}
