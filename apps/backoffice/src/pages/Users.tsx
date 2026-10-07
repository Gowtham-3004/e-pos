import { useMemo, useState } from 'react';
import type { Permission, RoleCode, User } from '@elixir/contracts';
import { ROLES, roleByCode, uid } from '@elixir/domain';
import { Avatar, Badge, Button, Card, Checkbox, ConfirmDialog, DataTable, Drawer, EmptyState, Icon, InlineAlert, KpiCard, SearchInput, Select, Tabs, TextField, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, daysUntil, number } from '@elixir/format';
import { KpiRow, PageFrame, useFirstPaint } from '../components/common';
import { includesQ, useCloud } from '../lib/data';
import { saveMaster } from '../lib/ops';
import { useSession } from '../lib/session';

const PERM_GROUPS: Array<[string, Permission[]]> = [
  ['POS', ['pos.sell', 'pos.discount.line', 'pos.discount.bill', 'pos.discount.override', 'pos.void', 'pos.return', 'pos.return.no-invoice', 'pos.price.override', 'pos.hold', 'pos.petty-cash', 'pos.credit-sale']],
  ['Shift', ['shift.open', 'shift.close', 'shift.reopen', 'shift.variance.approve']],
  ['Catalog & stock', ['catalog.view', 'catalog.edit', 'inventory.view', 'inventory.adjust', 'purchase.view', 'purchase.post']],
  ['Parties & finance', ['customers.view', 'customers.edit', 'suppliers.view', 'suppliers.edit', 'finance.view']],
  ['Reports & admin', ['dashboard.view', 'reports.view', 'reports.export', 'settings.edit', 'users.manage', 'devices.manage', 'sync.view', 'sync.resolve', 'approvals.act']],
  ['Restaurant', ['restaurant.order', 'restaurant.kot.send', 'restaurant.kot.void', 'restaurant.table.transfer', 'restaurant.bill.split', 'kds.operate']],
];
const PERM_LABEL = (p: string) => p.replace(/^pos\./, '').replace(/^restaurant\./, '').replace(/\./g, ' · ').replace(/-/g, ' ');

export function UsersPage() {
  const s = useSession();
  const cloud = useCloud();
  const loading = useFirstPaint();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<User | 'new'>();
  const roles = useMemo(() => ROLES.filter((r) => !['platform-admin', 'support'].includes(r.code) && (s.family === 'restaurant' || !['waiter', 'kitchen'].includes(r.code))), [s.family]);
  const users = useLive(cloud, ['users'], () => cloud.where('users', (u) => u.tenantId === s.tenant.id), [s.tenant.id]);
  const rows = users.filter((u) => includesQ(q, u.name, u.username, roleByCode(u.role).name)).sort((a, b) => Number(b.active) - Number(a.active) || roles.findIndex((r) => r.code === a.role) - roles.findIndex((r) => r.code === b.role));
  const expiring = users.filter((u) => u.active && u.offlineAuthValidUntil && daysUntil(u.offlineAuthValidUntil) <= 2);

  return (
    <PageFrame title="Users & Roles" description="Staff accounts, PINs and store access. Permissions come from roles." crumbs={[{ label: 'Administration' }, { label: 'Users & Roles' }]}
      actions={tab === 'users' ? <Button variant="primary" icon="UserPlus" onClick={() => setEditing('new')}>Invite user</Button> : undefined}>
      <KpiRow>
        <KpiCard label="Active users" icon="Users" value={number(users.filter((u) => u.active).length)} foot={`${users.filter((u) => !u.active).length} deactivated`} loading={loading} />
        <KpiCard label="Roles in use" icon="ShieldCheck" value={number(new Set(users.map((u) => u.role)).size)} loading={loading} />
        <KpiCard label="Cashiers / counter staff" icon="ScanBarcode" value={number(users.filter((u) => u.active && ['cashier', 'waiter', 'kitchen'].includes(u.role)).length)} loading={loading} />
        <KpiCard label="Offline auth expiring" icon="KeyRound" tone={expiring.length ? 'warning' : undefined} value={number(expiring.length)} foot="Valid ≤ 2 days — sign in online to refresh" loading={loading} />
      </KpiRow>
      <Tabs items={[{ key: 'users', label: 'Users', count: users.length }, { key: 'roles', label: 'Roles & permissions', count: roles.length }]} value={tab} onChange={setTab} />
      {tab === 'users' ? (
        <Card className="bo-card-table">
          <div className="bo-toolbar"><SearchInput placeholder="Search name, username, role" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} /></div>
          <DataTable loading={loading} rows={rows} rowKey={(u) => u.id} onRowClick={(u) => setEditing(u)} empty={<EmptyState quiet icon="Users" title="No users match" />}
            columns={[
              { key: 'n', header: 'User', render: (u) => <div className="ex-row" style={{ gap: 10 }}><Avatar name={u.name} color={u.avatarColor} /><div><div className="bo-cell-main">{u.name}{u.id === s.user.id ? <span className="muted"> (you)</span> : null}</div><div className="bo-cell-sub">@{u.username} · {u.phone}</div></div></div> },
              { key: 'r', header: 'Role', render: (u) => <Badge icon="Shield">{roleByCode(u.role).name}</Badge> },
              { key: 's', header: 'Stores', render: (u) => (u.storeIds.length >= s.stores.length && s.stores.length > 1 ? 'All stores' : u.storeIds.map((id) => s.storeName(id)).join(', ')) },
              { key: 'pin', header: 'PIN', render: () => <span className="num muted">••••</span> },
              { key: 'off', header: 'Offline sign-in valid', render: (u) => { if (!u.offlineAuthValidUntil) return '—'; const d = daysUntil(u.offlineAuthValidUntil); return d < 0 ? <Badge tone="danger" icon="KeyRound">Expired</Badge> : <Badge tone={d <= 2 ? 'warning' : 'success'} icon="KeyRound">Until {date(u.offlineAuthValidUntil)} · {d}d</Badge>; } },
              { key: 'st', header: 'Status', render: (u) => (u.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge icon="Ban">Deactivated</Badge>) },
            ]} />
        </Card>
      ) : (
        <Card className="bo-card-table">
          <div className="ex-table-wrap ex-scroll" style={{ maxHeight: 640 }}>
            <table className="ex-table ex-table--dense bo-perm-matrix">
              <thead>
                <tr><th>Permission</th>{roles.map((r) => <th key={r.code} className="ex-center">{r.name}</th>)}</tr>
              </thead>
              <tbody>
                <tr><td><b>Discount limit without approval</b></td>{roles.map((r) => <td key={r.code} className="ex-center num"><b>{r.discountLimitPct}%</b></td>)}</tr>
                {PERM_GROUPS.filter(([g]) => g !== 'Restaurant' || s.family === 'restaurant').flatMap(([g, perms]) => [
                  <tr key={g}><td colSpan={roles.length + 1} style={{ background: 'var(--surface-secondary)', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-secondary)' }}>{g}</td></tr>,
                  ...perms.map((p) => (
                    <tr key={p}>
                      <td style={{ textTransform: 'capitalize' }}>{PERM_LABEL(p)} <span className="muted bo-mono">{p}</span></td>
                      {roles.map((r) => <td key={r.code} className="ex-center">{r.permissions.includes(p) ? <Icon name="Check" size={16} className="bo-yes" aria-label="Allowed" /> : <Icon name="Minus" size={14} className="bo-no" aria-label="Not allowed" />}</td>)}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
          <div className="bo-tfoot" style={{ justifyContent: 'flex-start' }}><span className="muted">Roles are defined by Elixir. Custom roles need the Advanced RBAC capability{s.has('advanced-rbac') ? ' (enabled — contact Elixir to configure)' : ''}.</span></div>
        </Card>
      )}
      {editing ? <UserDrawer user={editing === 'new' ? undefined : editing} roles={roles.map((r) => r.code)} existing={users} onClose={() => setEditing(undefined)} /> : null}
    </PageFrame>
  );
}

function UserDrawer({ user, roles, existing, onClose }: { user?: User; roles: RoleCode[]; existing: User[]; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [f, setF] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', role: user?.role ?? ('cashier' as RoleCode), storeIds: user?.storeIds ?? [s.stores[0]?.id ?? ''], pin: '' });
  const [e, setE] = useState<Record<string, string>>({});
  const [newPin, setNewPin] = useState<string>();
  const [deact, setDeact] = useState(false);
  const self = user?.id === s.user.id;
  const pinTaken = (pin: string) => existing.some((u) => u.id !== user?.id && u.active && u.pin === pin);
  const genPin = () => { let p = ''; do { p = String(Math.floor(1000 + Math.random() * 9000)); } while (pinTaken(p)); return p; };

  const save = async () => {
    const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = 'Enter the staff member’s name.';
    if (!f.storeIds.length) er.stores = 'Give access to at least one store.';
    if (!user) {
      if (!/^\d{4}$/.test(f.pin)) er.pin = 'PIN must be exactly 4 digits.';
      else if (pinTaken(f.pin)) er.pin = 'This PIN is already used by another user in this business. Choose a different PIN.';
    }
    if (self && f.role !== user!.role) er.role = 'You cannot change your own role.';
    setE(er);
    if (Object.keys(er).length) return;
    const u: User = { ...(user ?? { id: `u-${s.tenant.id}-${uid().slice(-6)}`, tenantId: s.tenant.id, active: true, offlineAuthValidUntil: new Date(Date.now() + 7 * 86400000).toISOString(), avatarColor: undefined }), name: f.name.trim(), username: f.name.trim().split(/\s+/)[0]!.toLowerCase(), phone: f.phone || undefined, role: f.role, storeIds: f.storeIds, pin: user ? user.pin : f.pin } as User;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'users', entity: u, summary: user ? `User ${u.name} updated (${roleByCode(u.role).name})` : `User ${u.name} invited as ${roleByCode(u.role).name}`, actorId: s.user.id, action: user ? 'user.updated' : 'user.invited', entityName: 'user', category: 'security' });
    toast.success(user ? 'User saved' : `${u.name} invited`, 'Account syncs to POS devices for offline sign-in');
    onClose();
  };
  const resetPin = async () => {
    const pin = genPin();
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'users', entity: { ...user!, pin }, summary: `PIN reset for ${user!.name}`, actorId: s.user.id, action: 'user.pin.reset', entityName: 'user', category: 'security' });
    setNewPin(pin);
  };
  const setActive = async (active: boolean, reason?: string) => {
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'users', entity: { ...user!, active }, summary: `User ${user!.name} ${active ? 'reactivated' : 'deactivated'}`, actorId: s.user.id, action: active ? 'user.reactivated' : 'user.deactivated', entityName: 'user', category: 'security', reason });
    toast.success(active ? 'User reactivated' : 'User deactivated', active ? undefined : 'Sign-in blocked on all devices after next sync');
    onClose();
  };

  return (
    <Drawer open onClose={onClose} title={user ? user.name : 'Invite user'} description={user ? `${roleByCode(user.role).name} · @${user.username}` : 'Creates a PIN login for POS and Back Office (by role).'}
      footer={<>{user && !self ? (user.active ? <Button variant="danger-outline" icon="Ban" onClick={() => setDeact(true)}>Deactivate</Button> : <Button icon="CirclePlay" onClick={() => void setActive(true)}>Reactivate</Button>) : null}<div className="ex-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Save" onClick={() => void save()}>{user ? 'Save' : 'Send invite'}</Button></>}>
      <div className="ex-stack" style={{ gap: 14 }}>
        <TextField label="Full name" required value={f.name} onChange={(x) => setF({ ...f, name: x.target.value })} error={e.name} autoFocus />
        <TextField label="Mobile" prefix="+91" value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} hint="Invite link is sent by SMS (simulated)" />
        <Select label="Role" value={f.role} onChange={(x) => setF({ ...f, role: x.target.value as RoleCode })} error={e.role} options={roles.map((r) => ({ value: r, label: `${roleByCode(r).name} · discount up to ${roleByCode(r).discountLimitPct}%` }))} disabled={self} />
        <div className="ex-field">
          <span className="ex-label">Store access<span className="req">*</span></span>
          {s.stores.map((st) => <Checkbox key={st.id} label={`${st.name} (${st.code})`} checked={f.storeIds.includes(st.id)} onChange={(x) => setF({ ...f, storeIds: x.target.checked ? [...f.storeIds, st.id] : f.storeIds.filter((i) => i !== st.id) })} />)}
          {e.stores ? <span className="ex-error">{e.stores}</span> : null}
        </div>
        {!user ? (
          <TextField label="Initial PIN" required inputMode="numeric" maxLength={4} value={f.pin} onChange={(x) => setF({ ...f, pin: x.target.value.replace(/\D/g, '').slice(0, 4) })} error={e.pin} hint="4 digits, unique within the business. The user can change it on first sign-in." suffix={<button type="button" className="bo-link" style={{ fontSize: 12 }} onClick={() => setF({ ...f, pin: genPin() })}>Generate</button>} />
        ) : (
          <div className="ex-field">
            <span className="ex-label">PIN</span>
            {newPin ? <InlineAlert tone="success" title={`New PIN: ${newPin}`}>Share it privately with {user.name}. It replaces the old PIN on all devices after sync.</InlineAlert> : <div><Button icon="KeyRound" onClick={() => void resetPin()}>Reset PIN</Button></div>}
          </div>
        )}
        {user?.offlineAuthValidUntil ? <InlineAlert tone="info" icon="KeyRound">Offline sign-in cached on devices until {date(user.offlineAuthValidUntil)}. It refreshes whenever the user signs in online.</InlineAlert> : null}
      </div>
      <ConfirmDialog open={deact} onClose={() => setDeact(false)} title={`Deactivate ${user?.name}?`} confirmLabel="Deactivate user" requireReason onConfirm={(r) => setActive(false, r)}>
        The user can no longer sign in. Their past transactions and audit history are kept.
      </ConfirmDialog>
    </Drawer>
  );
}
