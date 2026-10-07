import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Breadcrumb, Button, Card, CardBody, CardHeader, EmptyState, Icon, Menu, MenuItem, Page, PageHeader, Segmented, Select } from '@elixir/ui';
import { presetRange, type DateRange, type RangePreset } from '../lib/data';
import { useSession, ALL_STORES } from '../lib/session';

/** Breadcrumb with router navigation. */
export function Crumbs({ items }: { items: Array<{ label: string; to?: string }> }) {
  const nav = useNavigate();
  return <Breadcrumb items={items.map((i) => ({ label: i.label, onClick: i.to ? () => nav(i.to!) : undefined }))} />;
}

/** Standard page scaffold: breadcrumb · title + primary action · body (§30). */
export function PageFrame({ title, description, crumbs, actions, meta, children, maxWidth }: { title: ReactNode; description?: ReactNode; crumbs?: Array<{ label: string; to?: string }>; actions?: ReactNode; meta?: ReactNode; children: ReactNode; maxWidth?: number }) {
  return (
    <Page maxWidth={maxWidth}>
      <PageHeader title={title} description={description} breadcrumb={crumbs ? <Crumbs items={crumbs} /> : undefined} actions={actions} meta={meta} />
      {children}
    </Page>
  );
}

/** Brief skeleton on first paint so tables keep their structure while projections compute. */
export function useFirstPaint(ms = 220): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

export function KpiRow({ children, cols }: { children: ReactNode; cols?: number }) {
  return (
    <div className="bo-kpis" style={cols ? ({ ['--bo-kpi-cols' as string]: cols } as React.CSSProperties) : undefined}>
      {children}
    </div>
  );
}

/** Form section card with 2-column grid body (§33). */
export function FormSection({ title, subtitle, icon, children, actions, cols = 2 }: { title: ReactNode; subtitle?: ReactNode; icon?: string; children: ReactNode; actions?: ReactNode; cols?: 1 | 2 | 3 }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} icon={icon} actions={actions} />
      <CardBody>
        <div className={`bo-form-grid bo-form-grid--${cols}`}>{children}</div>
      </CardBody>
    </Card>
  );
}

const PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'month', label: 'This month' },
];

export function DateRangeControl({ value, onChange }: { value: DateRange & { preset: RangePreset }; onChange: (v: DateRange & { preset: RangePreset }) => void }) {
  return (
    <div className="bo-daterange">
      <Segmented
        label="Date range"
        items={PRESETS.map((p) => ({ key: p.key, label: p.label }))}
        value={value.preset === 'custom' ? ('' as RangePreset) : value.preset}
        onChange={(k) => onChange({ ...presetRange(k), preset: k })}
      />
      <div className="bo-daterange__custom">
        <input type="date" aria-label="From date" className="ex-input bo-date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value.to, preset: 'custom' })} />
        <span className="muted">–</span>
        <input type="date" aria-label="To date" className="ex-input bo-date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ from: value.from, to: e.target.value, preset: 'custom' })} />
      </div>
    </div>
  );
}

export function useRange(preset: RangePreset = '7d') {
  return useState<DateRange & { preset: RangePreset }>(() => ({ ...presetRange(preset), preset }));
}

/** Store filter limited to the header scope; returns '' for all stores in scope. */
export function StoreFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const s = useSession();
  if (s.scope.length <= 1) return null;
  return <Select size="sm" aria-label="Store" value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: '', label: 'All stores' }, ...s.stores.filter((x) => s.scope.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))]} />;
}

export function ExportMenu({ onCsv, onXls, onPrint, disabled }: { onCsv: () => void; onXls?: () => void; onPrint?: () => void; disabled?: boolean }) {
  return (
    <Menu
      trigger={(p) => (
        <Button icon="Download" iconRight="ChevronDown" disabled={disabled} {...p}>
          Export
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon="FileSpreadsheet" onClick={() => { close(); onXls?.(); }}>Export Excel (.xls)</MenuItem>
          <MenuItem icon="FileText" onClick={() => { close(); onCsv(); }}>Export CSV</MenuItem>
          {onPrint ? <MenuItem icon="Printer" onClick={() => { close(); onPrint(); }}>Print</MenuItem> : null}
        </>
      )}
    </Menu>
  );
}

/** Explicit "not on your plan" state for direct URLs to disabled capabilities (FR-CAP-007). */
export function NotAvailable({ module }: { module: string }) {
  const nav = useNavigate();
  const s = useSession();
  return (
    <Page>
      <Card>
        <EmptyState
          icon="Lock"
          title={`${module} is not available on your plan`}
          actions={
            <>
              <Button variant="primary" icon="LayoutDashboard" onClick={() => nav('/')}>Go to dashboard</Button>
              {s.can('settings.edit') ? <Button icon="Layers" onClick={() => nav('/settings')}>View subscription</Button> : null}
            </>
          }
        >
          {s.tenant.name} is on the <b>{s.tenant.plan}</b> plan ({s.tenant.vertical}). This module needs a capability your subscription doesn't include. Contact Elixir to change plan or add an add-on.
        </EmptyState>
      </Card>
    </Page>
  );
}

export function NoAccess({ module }: { module: string }) {
  const nav = useNavigate();
  const s = useSession();
  return (
    <Page>
      <Card>
        <EmptyState icon="ShieldOff" title={`You don't have access to ${module}`} actions={<Button variant="primary" onClick={() => nav('/')}>Go to dashboard</Button>}>
          Your role ({s.role.name}) doesn't include this permission. Ask the business owner to update your role.
        </EmptyState>
      </Card>
    </Page>
  );
}

export function NotFound({ what, back }: { what: string; back?: { label: string; to: string } }) {
  const nav = useNavigate();
  return (
    <Page>
      <Card>
        <EmptyState icon="SearchX" title={`${what} not found`} actions={back ? <Button onClick={() => nav(back.to)} icon="ArrowLeft">{back.label}</Button> : undefined}>
          It may belong to another business or store, or the link is out of date.
        </EmptyState>
      </Card>
    </Page>
  );
}

/** Small label: value pair inline. */
export function Stat({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="bo-stat">
      <span className="bo-stat__k">{label}</span>
      <span className="bo-stat__v">{children}</span>
    </div>
  );
}

export function ScopeHint() {
  const s = useSession();
  return (
    <span className="bo-scope">
      <Icon name="Store" size={14} />
      {s.storeId === ALL_STORES ? `All stores (${s.scope.length})` : s.storeName(s.storeId)}
    </span>
  );
}
