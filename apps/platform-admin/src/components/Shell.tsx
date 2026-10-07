import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell, Avatar, Badge, Drawer, Icon, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, StatusBadge, applyTheme, getThemePref, cx } from '@elixir/ui';
import { DEVICE_STATUS, PLATFORM_NAV, SUBSCRIPTION_STATUS, VERTICAL_LABEL, composeNav } from '@elixir/domain';
import { useLive } from '@elixir/local-store/react';
import { useCloud } from '../lib/hooks';
import { useCurrentSession, useSession } from '../lib/session';
import { DEVICE_KIND_LABEL } from '../lib/platform';

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const nav = useNavigate();
  const cloud = useCloud();
  const session = useCurrentSession();
  const [mobileNav, setMobileNav] = useState(false);
  const items = useMemo(() => composeNav(PLATFORM_NAV, { capabilities: [], permissions: session.permissions, family: 'retail' }), [session.permissions]);
  const badges = useLive(cloud, ['syncConflicts', 'tickets', 'devices'], () => ({
    sync: cloud.where('syncConflicts', (c) => c.state === 'open').length || undefined,
    support: cloud.where('tickets', (t) => t.status !== 'resolved' && (t.priority === 'urgent' || t.priority === 'high')).length || undefined,
    devices: cloud.where('devices', (d) => d.status === 'pending-activation').length || undefined,
  }));
  useEffect(() => setMobileNav(false), [loc.pathname]);

  return (
    <>
      <AppShell
        product="Platform"
        nav={items}
        activePath={loc.pathname}
        onNavigate={nav}
        badges={badges}
        header={<Header onMenu={() => setMobileNav(true)} />}
        sidebarFooter={
          <div className="pa-sidebar-foot">
            <Icon name="ShieldCheck" size={14} />
            <span>All platform actions are audited</span>
          </div>
        }
      >
        {children}
      </AppShell>
      <Drawer open={mobileNav} onClose={() => setMobileNav(false)} side="left" size="sm" title="Elixir Platform">
        <nav className="pa-mobile-nav">
          {items.map((i) => (
            <button key={i.key} type="button" className="ex-nav-item" aria-current={(i.path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(i.path)) ? 'page' : undefined} onClick={() => nav(i.path)}>
              <Icon name={i.icon} />
              <span>{i.label}</span>
            </button>
          ))}
        </nav>
      </Drawer>
    </>
  );
}

function Header({ onMenu }: { onMenu: () => void }) {
  const session = useCurrentSession();
  const signOut = useSession((s) => s.signOut);
  const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : getThemePref() === 'dark' ? 'dark' : 'light'));
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    setTheme(next);
  };
  return (
    <>
      <IconButton icon="Menu" label="Open navigation" className="pa-mobile-only" onClick={onMenu} />
      <Badge tone="warning" icon="FlaskConical" className="pa-env">
        <span className="pa-hide-sm">Prototype · </span>Simulated Cloud
      </Badge>
      <GlobalSearch />
      <div className="ex-spacer" />
      <IconButton icon={theme === 'dark' ? 'Sun' : 'Moon'} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme} />
      <Menu
        trigger={(p) => (
          <button type="button" className="pa-user" {...p} aria-label={`Account menu for ${session.name}`}>
            <Avatar name={session.name} />
            <span className="pa-user__text pa-hide-sm">
              <b>{session.name}</b>
              <span className="muted">{session.roleName}</span>
            </span>
            <Icon name="ChevronDown" size={15} className="muted" />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>
              {session.name} · {session.roleName}
            </MenuLabel>
            <div className="pa-menu-perms">
              {session.permissions.map((p) => (
                <code key={p}>{p}</code>
              ))}
            </div>
            <MenuSeparator />
            <MenuItem
              icon="LogOut"
              onClick={() => {
                close();
                signOut();
              }}
            >
              Sign out
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}

/** Header search across tenants and devices. */
function GlobalSearch() {
  const cloud = useCloud();
  const nav = useNavigate();
  const { can } = { can: useCurrentSession().permissions.includes('platform.tenants') };
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const results = useLive(
    cloud,
    ['tenants', 'devices'],
    () => {
      const s = q.trim().toLowerCase();
      if (s.length < 2) return [];
      const tenants = cloud
        .where('tenants', (t) => [t.name, t.legalName, t.city, t.gstin ?? '', t.id].some((x) => x.toLowerCase().includes(s)))
        .slice(0, 5)
        .map((t) => ({ key: t.id, kind: 'Tenant', title: t.name, sub: `${VERTICAL_LABEL[t.vertical]} · ${t.city}`, meta: SUBSCRIPTION_STATUS[t.subscriptionStatus], to: `/tenants/${t.id}` }));
      const tn = new Map(cloud.all('tenants').map((t) => [t.id, t.name]));
      const devices = cloud
        .where('devices', (d) => [d.code, d.name, d.id, tn.get(d.tenantId) ?? ''].some((x) => x.toLowerCase().includes(s)))
        .slice(0, 6)
        .map((d) => ({ key: d.id, kind: 'Device', title: `${d.code} · ${d.name}`, sub: `${tn.get(d.tenantId) ?? d.tenantId} · ${DEVICE_KIND_LABEL[d.kind]}`, meta: DEVICE_STATUS[d.status], to: `/devices/${d.id}` }));
      return [...tenants, ...devices];
    },
    [q],
  );
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => setActive(0), [q]);
  const go = (to: string) => {
    nav(to);
    setOpen(false);
    setQ('');
  };
  return (
    <div className="pa-search" ref={ref}>
      <div className="ex-input-wrap">
        <Icon name="Search" size={16} />
        <input
          className="ex-input"
          type="search"
          placeholder="Search tenants, devices, GSTIN…"
          aria-label="Search tenants and devices"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter' && results[active]) go(results[active]!.to);
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>
      {open && q.trim().length >= 2 ? (
        <div className="pa-search__pop" role="listbox">
          {results.length === 0 ? (
            <div className="pa-search__empty muted">No tenants or devices match “{q}”.</div>
          ) : (
            results.map((r, i) => (
              <button key={r.kind + r.key} type="button" role="option" aria-selected={i === active} className={cx('pa-search__item', i === active && 'is-active')} onMouseEnter={() => setActive(i)} onClick={() => go(r.to)}>
                <Icon name={r.kind === 'Tenant' ? 'Building2' : 'MonitorSmartphone'} size={16} className="muted" />
                <span className="ex-truncate" style={{ flex: 1 }}>
                  <b>{r.title}</b>
                  <span className="muted"> · {r.sub}</span>
                </span>
                <StatusBadge meta={r.meta} />
              </button>
            ))
          )}
          {!can ? <div className="pa-search__empty muted">Tenant pages open read-only for your role.</div> : null}
        </div>
      ) : null}
    </div>
  );
}
