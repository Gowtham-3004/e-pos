import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardBody, FilterBar, InlineAlert, Page, PageHeader, SearchInput, Segmented, Select, TextField, Button } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { number, isoDate } from '@elixir/format';
import { useCloud, useLookups } from '../lib/hooks';
import { AUDIT_CATEGORY } from '../lib/platform';
import { AuditView } from '../components/AuditView';

export function AuditLog() {
  const cloud = useCloud();
  const lk = useLookups();
  const [sp, setSp] = useSearchParams();
  const get = (k: string) => sp.get(k) ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const category = get('category'), tenant = get('tenant'), actor = get('actor'), action = get('action'), from = get('from'), to = get('to'), q = get('q');
  const mode = (get('view') || 'table') as 'table' | 'timeline';
  const events = useLive(cloud, ['auditEvents'], () => cloud.all('auditEvents'));
  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return events
      .filter((a) => (!category || a.category === category) && (!tenant || a.tenantId === tenant) && (!actor || a.actorId === actor) && (!action || a.action.startsWith(action)))
      .filter((a) => (!from || a.createdAt.slice(0, 10) >= from) && (!to || a.createdAt.slice(0, 10) <= to))
      .filter((a) => !s || `${a.summary} ${a.action} ${a.documentNo ?? ''} ${a.reason ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [events, category, tenant, actor, action, from, to, q]);
  const actors = useMemo(() => [...new Set(events.map((e) => e.actorId))].map((id) => ({ value: id, label: lk.users.get(id)?.name ?? id })).sort((a, b) => a.label.localeCompare(b.label)), [events, lk]);
  const actions = useMemo(() => [...new Set(events.map((e) => e.action.split('.')[0]!))].sort().map((a) => ({ value: a, label: `${a}.*` })), [events]);
  const active = [
    category && { key: 'category', label: `Category: ${AUDIT_CATEGORY[category as 'security'].label}`, onRemove: () => set('category', '') },
    tenant && { key: 'tenant', label: `Tenant: ${lk.tenantName(tenant)}`, onRemove: () => set('tenant', '') },
    actor && { key: 'actor', label: `Actor: ${lk.userName(actor)}`, onRemove: () => set('actor', '') },
    action && { key: 'action', label: `Action: ${action}.*`, onRemove: () => set('action', '') },
    (from || to) && { key: 'date', label: `Date: ${from || '…'} → ${to || '…'}`, onRemove: () => { const n = new URLSearchParams(sp); n.delete('from'); n.delete('to'); setSp(n, { replace: true }); } },
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;
  const counts = { security: filtered.filter((e) => e.category === 'security').length, business: filtered.filter((e) => e.category === 'business').length, technical: filtered.filter((e) => e.category === 'technical').length };

  return (
    <Page>
      <PageHeader
        title="Audit Log"
        description={`${number(filtered.length)} of ${number(events.length)} events · ${counts.security} security · ${counts.business} business · ${counts.technical} technical`}
        actions={<Segmented value={mode} onChange={(v) => set('view', v === 'table' ? '' : v)} label="View" items={[{ key: 'table', label: 'Table', icon: 'Table' }, { key: 'timeline', label: 'Timeline', icon: 'ListTree' }]} />}
      />
      <InlineAlert tone="neutral" icon="Lock">Audit events are append-only. They cannot be edited or deleted from any console, including this one.</InlineAlert>
      <FilterBar active={active} onClearAll={() => setSp(mode === 'timeline' ? { view: 'timeline' } : {}, { replace: true })}>
        <SearchInput placeholder="Search summary, document, reason" value={q} onChange={(e) => set('q', e.target.value)} onClear={() => set('q', '')} wrapClassName="pa-filter-search" aria-label="Search audit" />
        <Select aria-label="Category" value={category} onChange={(e) => set('category', e.target.value)} placeholder="All categories" options={Object.entries(AUDIT_CATEGORY).map(([value, m]) => ({ value, label: m.label }))} />
        <Select aria-label="Tenant" value={tenant} onChange={(e) => set('tenant', e.target.value)} placeholder="All tenants" options={[...lk.tenants.values()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ value: t.id, label: t.name }))} />
        <Select aria-label="Actor" value={actor} onChange={(e) => set('actor', e.target.value)} placeholder="All actors" options={actors} />
        <Select aria-label="Action" value={action} onChange={(e) => set('action', e.target.value)} placeholder="All actions" options={actions} />
        <TextField type="date" aria-label="From date" value={from} max={to || isoDate()} onChange={(e) => set('from', e.target.value)} />
        <TextField type="date" aria-label="To date" value={to} min={from} onChange={(e) => set('to', e.target.value)} />
        <Button size="sm" variant="ghost" onClick={() => { set('from', isoDate(Date.now() - 86400000)); }}>Last 24h</Button>
      </FilterBar>
      <Card>
        <CardBody>
          <AuditView events={filtered} mode={mode} pageSize={30} />
        </CardBody>
      </Card>
    </Page>
  );
}
