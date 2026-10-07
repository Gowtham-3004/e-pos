import { useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Button, Card, DataTable, EmptyState, FilterBar, Page, PageHeader, SearchInput, Select, StatusBadge, type Column } from '@elixir/ui';
import { PLANS, SUBSCRIPTION_STATUS, VERTICAL_LABEL } from '@elixir/domain';
import type { SubscriptionStatus, Tenant, Vertical, PlanCode } from '@elixir/contracts';
import { useLive } from '@elixir/local-store/react';
import { date, daysUntil, money } from '@elixir/format';
import { useCloud } from '../lib/hooks';
import { addOnName, monthlyPrice, planName } from '../lib/platform';
import { GuardedButton } from '../components/common';

type Row = Tenant & { stores: number; devices: number; pendingAct: number; mrr: number };

export function Tenants() {
  const cloud = useCloud();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const vertical = sp.get('vertical') ?? '';
  const plan = sp.get('plan') ?? '';
  const status = sp.get('status') ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const rows = useLive(
    cloud,
    ['tenants', 'stores', 'devices'],
    () => {
      const stores = cloud.all('stores'), devices = cloud.all('devices');
      const s = q.trim().toLowerCase();
      return cloud
        .all('tenants')
        .filter((t) => (!vertical || t.vertical === vertical) && (!plan || t.plan === plan) && (!status || t.subscriptionStatus === status))
        .filter((t) => !s || [t.name, t.legalName, t.city, t.gstin ?? '', t.contactName].some((x) => x.toLowerCase().includes(s)))
        .map<Row>((t) => ({
          ...t,
          stores: stores.filter((x) => x.tenantId === t.id).length,
          devices: devices.filter((d) => d.tenantId === t.id && d.status !== 'revoked' && d.status !== 'pending-activation').length,
          pendingAct: devices.filter((d) => d.tenantId === t.id && d.status === 'pending-activation').length,
          mrr: monthlyPrice(t),
        }));
    },
    [q, vertical, plan, status],
  );
  const total = useLive(cloud, ['tenants'], () => cloud.all('tenants').length);

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Tenant',
      sortable: true,
      render: (t) => (
        <div className="pa-cell-2">
          <b>{t.name}</b>
          <span className="muted">{t.legalName}</span>
        </div>
      ),
    },
    { key: 'vertical', header: 'Vertical', sortable: true, sortValue: (t) => VERTICAL_LABEL[t.vertical], render: (t) => VERTICAL_LABEL[t.vertical] },
    { key: 'plan', header: 'Plan', sortable: true, sortValue: (t) => PLANS.findIndex((p) => p.code === t.plan), render: (t) => planName(t.plan) },
    {
      key: 'addOns',
      header: 'Add-ons',
      render: (t) =>
        t.addOns.length ? (
          <div className="pa-chips">
            {t.addOns.map((a) => (
              <Badge key={a} outline>{addOnName(a)}</Badge>
            ))}
          </div>
        ) : (
          <span className="muted">—</span>
        ),
    },
    { key: 'status', header: 'Status', sortable: true, sortValue: (t) => t.subscriptionStatus, render: (t) => <StatusBadge meta={SUBSCRIPTION_STATUS[t.subscriptionStatus]} /> },
    { key: 'stores', header: 'Stores', align: 'right', sortable: true, render: (t) => <span className="num">{t.stores}</span> },
    {
      key: 'devices',
      header: 'Devices',
      align: 'right',
      sortable: true,
      render: (t) => (
        <span className="num">
          {t.devices}
          {t.pendingAct ? <span className="pa-tone-info" title={`${t.pendingAct} awaiting activation`}> (+{t.pendingAct})</span> : null}
        </span>
      ),
    },
    { key: 'mrr', header: 'Monthly', align: 'right', sortable: true, render: (t) => <span className="num">{money(t.mrr, { whole: true })}</span> },
    { key: 'city', header: 'City', sortable: true },
    {
      key: 'renewsOn',
      header: 'Renews on',
      align: 'right',
      sortable: true,
      render: (t) => {
        const d = daysUntil(t.renewsOn);
        return (
          <span className={`num${d < 0 ? ' pa-tone-danger' : d <= 7 ? ' pa-tone-warning' : ''}`} title={d < 0 ? `${-d} days overdue` : `in ${d} days`}>
            {date(t.renewsOn)}
          </span>
        );
      },
    },
  ];

  const active = [
    vertical && { key: 'vertical', label: `Vertical: ${VERTICAL_LABEL[vertical as Vertical]}`, onRemove: () => set('vertical', '') },
    plan && { key: 'plan', label: `Plan: ${planName(plan as PlanCode)}`, onRemove: () => set('plan', '') },
    status && { key: 'status', label: `Status: ${SUBSCRIPTION_STATUS[status as SubscriptionStatus].label}`, onRemove: () => set('status', '') },
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;

  return (
    <Page>
      <PageHeader
        title="Tenants"
        description={`${total} tenants · subscriptions, capabilities, stores and devices`}
        actions={<GuardedButton action="tenant.onboard" variant="primary" icon="Rocket" onClick={() => nav('/onboarding')}>Onboard tenant</GuardedButton>}
      />
      <FilterBar active={active} onClearAll={() => setSp(q ? { q } : {}, { replace: true })}>
        <SearchInput placeholder="Search name, legal name, GSTIN, city, contact" value={q} onChange={(e) => set('q', e.target.value)} onClear={() => set('q', '')} wrapClassName="pa-filter-search" aria-label="Search tenants" />
        <Select aria-label="Vertical" value={vertical} onChange={(e) => set('vertical', e.target.value)} placeholder="All verticals" options={Object.entries(VERTICAL_LABEL).map(([value, label]) => ({ value, label }))} />
        <Select aria-label="Plan" value={plan} onChange={(e) => set('plan', e.target.value)} placeholder="All plans" options={PLANS.map((p) => ({ value: p.code, label: p.name }))} />
        <Select aria-label="Status" value={status} onChange={(e) => set('status', e.target.value)} placeholder="All statuses" options={Object.entries(SUBSCRIPTION_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
      </FilterBar>
      <Card className="pa-nowrap">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(t) => t.id}
          onRowClick={(t) => nav(`/tenants/${t.id}`)}
          initialSort={{ key: 'name', dir: 'asc' }}
          pageSize={20}
          empty={
            <EmptyState icon="SearchX" title="No tenants match these filters" actions={<Button onClick={() => setSp({}, { replace: true })}>Clear filters</Button>}>
              Try a different search or remove a filter.
            </EmptyState>
          }
        />
      </Card>
    </Page>
  );
}
