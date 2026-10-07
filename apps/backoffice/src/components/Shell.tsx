import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BACKOFFICE_NAV, composeNav, VERTICAL_LABEL, planByCode, SUBSCRIPTION_STATUS } from '@elixir/domain';
import { AppShell, Avatar, Badge, Button, ConfirmDialog, Drawer, EmptyState, Icon, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, StatusBadge, applyTheme, getThemePref, useToast, type ThemePref } from '@elixir/ui';
import { decideApproval } from '@elixir/local-store';
import { useLive, useNow } from '@elixir/local-store/react';
import { dateLong, money, relative } from '@elixir/format';
import type { ApprovalRequest } from '@elixir/contracts';
import { useCloud } from '../lib/data';
import { ALL_STORES, useSession } from '../lib/session';

const APPROVAL_LABEL: Record<ApprovalRequest['action'], string> = {
  discount: 'Discount',
  void: 'Void',
  'return-no-invoice': 'Return without invoice',
  'price-override': 'Price override',
  'negative-stock': 'Negative stock',
  'shift-reopen': 'Shift reopen',
  'shift-variance': 'Shift variance',
  'credit-limit': 'Credit limit',
  'kot-void': 'KOT void',
  'stock-adjustment': 'Stock adjustment',
};

export function Shell({ children }: { children: ReactNode }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const loc = useLocation();
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  useNow(30000);

  const items = useMemo(() => composeNav(BACKOFFICE_NAV, { capabilities: s.capabilities, permissions: s.permissions, family: s.family }), [s.capabilities, s.permissions, s.family]);

  const pending = useLive(cloud, ['approvals'], () => cloud.where('approvals', (a) => a.tenantId === s.tenant.id && a.status === 'pending' && s.scope.includes(a.storeId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [s.tenant.id, s.scope.join(',')]);
  const deviceSync = useLive(
    cloud,
    ['devices'],
    () => {
      const ds = cloud.where('devices', (d) => d.tenantId === s.tenant.id && s.scope.includes(d.storeId) && d.status !== 'revoked' && d.status !== 'pending-activation');
      const last = ds.map((d) => d.lastSyncAt).filter(Boolean).sort().pop();
      const behind = ds.filter((d) => d.status === 'offline' || d.status === 'attention' || d.pendingSync > 0).length;
      return { last, behind, total: ds.length };
    },
    [s.tenant.id, s.scope.join(',')],
  );

  const plan = planByCode(s.tenant.plan);
  const go = (p: string) => {
    setMobileNav(false);
    nav(p);
  };

  const header = (
    <div className="bo-header">
      <IconButton className="bo-only-mobile" icon="Menu" label="Open navigation" onClick={() => setMobileNav(true)} />
      <div className="bo-header__tenant">
        <div className="bo-header__name ex-truncate">{s.tenant.name}</div>
        <div className="bo-header__badges">
          <Badge>{VERTICAL_LABEL[s.tenant.vertical]}</Badge>
          <Badge tone="info" icon="Layers">{plan.name}</Badge>
          {s.tenant.subscriptionStatus !== 'active' ? <StatusBadge meta={SUBSCRIPTION_STATUS[s.tenant.subscriptionStatus]} /> : null}
        </div>
      </div>
      {s.stores.length > 1 || s.multiStore ? (
        <label className="bo-store-switch" title="Store scope">
          <Icon name="Store" size={16} />
          <span className="sr-only">Store</span>
          <select value={s.storeId} onChange={(e) => s.setStore(e.target.value)} aria-label="Store scope">
            {s.multiStore ? <option value={ALL_STORES}>All stores ({s.stores.length})</option> : null}
            {s.stores.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name} · {st.code}
              </option>
            ))}
          </select>
          <Icon name="ChevronDown" size={14} />
        </label>
      ) : (
        <span className="bo-store-static"><Icon name="Store" size={16} /> {s.stores[0]?.name}</span>
      )}
      <div className="bo-header__date bo-hide-tablet">
        <span className="ex-context__k">Business date</span>
        <span className="ex-context__v num">{dateLong(new Date())}</span>
      </div>
      <div className="ex-spacer" />
      <button type="button" className="bo-cloud" onClick={() => s.can('devices.manage') && s.has('device-management') && nav('/devices')} title={`Elixir Cloud connected · Last device sync ${relative(deviceSync.last)}${deviceSync.behind ? ` · ${deviceSync.behind} device(s) with outstanding sync` : ''}`}>
        <Icon name="CloudCheck" size={15} />
        <span className="bo-cloud__label">Connected</span>
        <span className="bo-cloud__sub bo-hide-tablet">Last device sync {relative(deviceSync.last)}</span>
        {deviceSync.behind ? <span className="bo-cloud__warn"><Icon name="TriangleAlert" size={13} /> {deviceSync.behind}</span> : null}
      </button>
      <button type="button" className="bo-bell" aria-label={`Approvals, ${pending.length} pending`} onClick={() => setApprovalsOpen(true)}>
        <Icon name="Bell" size={18} />
        {pending.length ? <span className="bo-bell__count num">{pending.length}</span> : null}
      </button>
      <UserMenu />
    </div>
  );

  return (
    <>
      <AppShell
        product="Back Office"
        nav={items}
        activePath={loc.pathname}
        onNavigate={go}
        header={header}
        badges={{ dashboard: pending.length || undefined }}
        sidebarFooter={
          <div className="bo-side-foot">
            <Icon name="Layers" size={15} />
            <span className="ex-truncate">{plan.name} plan{s.tenant.addOns.length ? ` + ${s.tenant.addOns.length} add-on${s.tenant.addOns.length > 1 ? 's' : ''}` : ''}</span>
          </div>
        }
      >
        {children}
      </AppShell>
      <ApprovalsDrawer open={approvalsOpen} onClose={() => setApprovalsOpen(false)} items={pending} />
      <Drawer open={mobileNav} onClose={() => setMobileNav(false)} title={s.tenant.name} side="left" size="sm">
        <nav className="bo-mobile-nav" aria-label="Main navigation">
          {items.map((n, i) => (
            <div key={n.key}>
              {n.group && n.group !== items[i - 1]?.group ? <div className="ex-sidebar__group">{n.group}</div> : null}
              <a href={n.path} className="ex-nav-item" aria-current={(n.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.path)) ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(n.path); }}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
              </a>
            </div>
          ))}
        </nav>
      </Drawer>
    </>
  );
}

function UserMenu() {
  const s = useSession();
  const [theme, setTheme] = useState<ThemePref>(getThemePref());
  const set = (t: ThemePref) => {
    applyTheme(t);
    setTheme(t);
  };
  return (
    <Menu
      trigger={(p) => (
        <button type="button" className="bo-usermenu" aria-label="User menu" {...p}>
          <Avatar name={s.user.name} color={s.user.avatarColor} />
          <span className="bo-usermenu__txt bo-hide-tablet">
            <span className="bo-usermenu__name">{s.user.name}</span>
            <span className="bo-usermenu__role">{s.role.name}</span>
          </span>
          <Icon name="ChevronDown" size={14} />
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>{s.user.name} · {s.role.name}</MenuLabel>
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          {(['light', 'dark', 'system'] as ThemePref[]).map((t) => (
            <MenuItem key={t} icon={theme === t ? 'Check' : t === 'light' ? 'Sun' : t === 'dark' ? 'Moon' : 'Monitor'} onClick={() => { set(t); close(); }}>
              {t === 'light' ? 'Light' : t === 'dark' ? 'Dark' : 'System'}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem icon="ArrowLeftRight" onClick={() => { close(); s.signOut(); }}>Switch business</MenuItem>
          <MenuItem icon="LogOut" danger onClick={() => { close(); s.signOut(); }}>Sign out</MenuItem>
        </>
      )}
    </Menu>
  );
}

function ApprovalsDrawer({ open, onClose, items }: { open: boolean; onClose: () => void; items: ApprovalRequest[] }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [rejecting, setRejecting] = useState<ApprovalRequest>();
  const [busy, setBusy] = useState<string>();
  const canAct = s.can('approvals.act');
  const approve = async (a: ApprovalRequest) => {
    setBusy(a.id);
    await decideApproval(cloud, a.id, 'approved', s.user.id);
    setBusy(undefined);
    toast.success('Approved', a.summary);
  };
  return (
    <>
      <Drawer open={open} onClose={onClose} title="Pending approvals" description={`${items.length} request${items.length === 1 ? '' : 's'} from POS counters`}>
        {items.length === 0 ? (
          <EmptyState quiet icon="CheckCheck" title="No pending approvals">Requests from cashiers that exceed their limits appear here.</EmptyState>
        ) : (
          <div className="ex-stack">
            {!canAct ? <div className="ex-hint">Your role can view but not decide approvals.</div> : null}
            {items.map((a) => (
              <div key={a.id} className="bo-approval">
                <div className="ex-row" style={{ justifyContent: 'space-between' }}>
                  <Badge tone="warning" icon="ShieldAlert">{APPROVAL_LABEL[a.action]}</Badge>
                  <span className="muted num" style={{ fontSize: 12 }}>{relative(a.createdAt)}</span>
                </div>
                <div style={{ fontWeight: 650, marginTop: 6 }}>{a.summary}</div>
                <div className="secondary" style={{ fontSize: 13 }}>{a.detail}</div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {cloud.get('users', a.requestedBy)?.name ?? a.requestedBy} · {s.storeName(a.storeId)}
                  {a.counterId ? ` · ${cloud.get('counters', a.counterId)?.code ?? ''}` : ''}
                  {a.amountPaise != null ? <> · <span className="num">{money(a.amountPaise)}</span></> : null}
                  {a.requestedValue != null ? ` · requested ${a.requestedValue}% (limit ${a.allowedValue}%)` : ''}
                </div>
                {canAct ? (
                  <div className="ex-row" style={{ marginTop: 10 }}>
                    <Button size="sm" variant="primary" icon="Check" loading={busy === a.id} onClick={() => void approve(a)}>Approve</Button>
                    <Button size="sm" variant="danger-outline" icon="X" onClick={() => setRejecting(a)}>Reject</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(undefined)}
        title="Reject request?"
        confirmLabel="Reject request"
        requireReason
        reasonLabel="Reason (shown to cashier)"
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await decideApproval(cloud, rejecting.id, 'rejected', s.user.id, reason);
          toast.info('Request rejected', rejecting.summary);
          setRejecting(undefined);
        }}
      >
        {rejecting?.summary}
      </ConfirmDialog>
    </>
  );
}
