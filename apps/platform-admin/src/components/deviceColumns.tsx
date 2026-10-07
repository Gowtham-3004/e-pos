import type { Device, Tenant } from '@elixir/contracts';
import { Badge, StatusBadge, type Column } from '@elixir/ui';
import { DEVICE_STATUS } from '@elixir/domain';
import { relative } from '@elixir/format';
import { DEVICE_KIND_LABEL, deviceOutdated } from '../lib/platform';
import type { useLookups } from '../lib/hooks';

type Lookups = ReturnType<typeof useLookups>;

export function deviceColumns(lk: Lookups, now: number, opts: { tenant?: boolean; compact?: boolean } = {}): Column<Device>[] {
  const tenantOf = (d: Device): Tenant | undefined => lk.tenants.get(d.tenantId);
  return [
    {
      key: 'code',
      header: 'Device',
      sortable: true,
      render: (d) => (
        <div className="pa-cell-2">
          <b className="pa-mono">{d.code}</b>
          <span className="muted ex-truncate" style={{ maxWidth: 220 }}>{d.name}</span>
        </div>
      ),
    },
    { key: 'tenant', header: 'Tenant', hidden: !opts.tenant, sortable: true, sortValue: (d) => lk.tenantName(d.tenantId), render: (d) => lk.tenantName(d.tenantId) },
    {
      key: 'store',
      header: 'Store · Counter',
      sortable: true,
      sortValue: (d) => lk.storeName(d.storeId),
      render: (d) => (
        <span>
          {lk.storeName(d.storeId)} <span className="muted">· {d.counterId ? lk.counterCode(d.counterId) : 'Unassigned'}</span>
        </span>
      ),
    },
    { key: 'kind', header: 'Kind', sortable: true, render: (d) => DEVICE_KIND_LABEL[d.kind] },
    { key: 'status', header: 'Status', sortable: true, render: (d) => <StatusBadge meta={DEVICE_STATUS[d.status]} /> },
    {
      key: 'appVersion',
      header: 'App',
      sortable: true,
      render: (d) => {
        const o = deviceOutdated(d, tenantOf(d));
        return (
          <span className="num">
            {d.appVersion}
            {o.app ? <Badge tone="warning" className="pa-inline-badge" title="Older than the current release">old</Badge> : null}
          </span>
        );
      },
    },
    {
      key: 'configVersion',
      header: 'Config',
      align: 'right',
      sortable: true,
      hidden: opts.compact,
      render: (d) => {
        const t = tenantOf(d);
        const o = deviceOutdated(d, t);
        return (
          <span className={`num${o.config ? ' pa-tone-warning' : ''}`} title={o.config ? `Tenant is on config v${t?.configVersion}; device will pull on next sync` : undefined}>
            v{d.configVersion}
            {o.config ? ` → v${t?.configVersion}` : ''}
          </span>
        );
      },
    },
    { key: 'lastSeenAt', header: 'Last seen', align: 'right', sortable: true, render: (d) => <span className="num" title={d.lastSeenAt}>{d.status === 'pending-activation' ? '—' : relative(d.lastSeenAt, now)}</span> },
    { key: 'lastSyncAt', header: 'Last sync', align: 'right', sortable: true, hidden: opts.compact, render: (d) => <span className="num">{relative(d.lastSyncAt, now)}</span> },
    { key: 'pendingSync', header: 'Pending', align: 'right', sortable: true, render: (d) => <span className={`num${d.pendingSync >= 10 ? ' pa-tone-warning' : d.pendingSync === 0 ? ' muted' : ''}`}>{d.pendingSync}</span> },
    { key: 'failedSync', header: 'Failed', align: 'right', sortable: true, render: (d) => <span className={`num${d.failedSync ? ' pa-tone-danger' : ' muted'}`}>{d.failedSync}</span> },
    { key: 'os', header: 'OS', sortable: true, hidden: opts.compact, render: (d) => <span className="muted">{d.os}</span> },
  ];
}
