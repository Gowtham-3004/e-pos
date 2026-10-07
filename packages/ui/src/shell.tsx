import { type ReactNode } from 'react';
import clsx from 'clsx';
import type { NavItem } from '@elixir/domain';
import { CONNECTIVITY } from '@elixir/domain';
import type { SyncStatusSnapshot } from '@elixir/contracts';
import { relative } from '@elixir/format';
import { Icon } from './primitives';
import { ElixirLogo } from './brand';

export interface AppShellProps {
  product: string;
  nav: NavItem[];
  activePath: string;
  onNavigate: (path: string) => void;
  header: ReactNode;
  banner?: ReactNode;
  sidebarFooter?: ReactNode;
  compact?: boolean;
  hideSidebar?: boolean;
  badges?: Record<string, number | undefined>;
  children: ReactNode;
}

function isActive(item: NavItem, path: string) {
  if (item.path === '/') return path === '/';
  return path === item.path || path.startsWith(item.path + '/');
}

/** Desktop shell (§9): capability-composed sidebar + context header + workspace. */
export function AppShell({ product, nav, activePath, onNavigate, header, banner, sidebarFooter, compact, hideSidebar, badges, children }: AppShellProps) {
  const groups: Array<[string | undefined, NavItem[]]> = [];
  nav.forEach((n) => {
    const last = groups[groups.length - 1];
    if (last && last[0] === n.group) last[1].push(n);
    else groups.push([n.group, [n]]);
  });
  return (
    <div className={clsx('ex-shell', compact && 'ex-shell--compact', hideSidebar && 'ex-shell--nosidebar')}>
      {!hideSidebar ? (
        <aside className="ex-sidebar" aria-label="Main navigation">
          <div className="ex-sidebar__brand">
            <ElixirLogo product={product} />
          </div>
          <nav className="ex-sidebar__nav">
            {groups.map(([g, items], gi) => (
              <div key={gi} style={{ display: 'contents' }}>
                {g ? <div className="ex-sidebar__group">{g}</div> : null}
                {items.map((n) => (
                  <a
                    key={n.key}
                    href={n.path}
                    className="ex-nav-item"
                    aria-current={isActive(n, activePath) ? 'page' : undefined}
                    title={n.label}
                    onClick={(e) => {
                      e.preventDefault();
                      onNavigate(n.path);
                    }}
                  >
                    <Icon name={n.icon} />
                    <span>{n.label}</span>
                    {badges?.[n.key] ? <em className="ex-nav-badge" style={{ fontStyle: 'normal' }}>{badges[n.key]}</em> : null}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          {sidebarFooter ? <div className="ex-sidebar__foot">{sidebarFooter}</div> : null}
        </aside>
      ) : null}
      <header className="ex-header">{header}</header>
      <main className="ex-main" style={{ display: 'flex', flexDirection: 'column' }}>
        {banner}
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, breadcrumb, actions, meta }: { title: ReactNode; description?: ReactNode; breadcrumb?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="ex-stack" style={{ gap: 6 }}>
      {breadcrumb}
      <div className="ex-page-head">
        <div style={{ minWidth: 0 }}>
          <div className="ex-row" style={{ gap: 10 }}>
            <h1 className="ex-page-head__title">{title}</h1>
            {meta}
          </div>
          {description ? <p className="ex-page-head__desc">{description}</p> : null}
        </div>
        <div className="ex-spacer" />
        {actions ? <div className="ex-row" style={{ flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
    </div>
  );
}

export function Page({ children, dense, className, maxWidth }: { children: ReactNode; dense?: boolean; className?: string; maxWidth?: number }) {
  return <div className={clsx('ex-page', dense && 'ex-page--dense', className)} style={maxWidth ? { maxWidth } : undefined}>{children}</div>;
}

/** Header context strip: Store · Counter · User · Shift (§27). Never ambiguous. */
export function ContextStrip({ items }: { items: Array<{ label: string; value: ReactNode; icon?: string } | false | undefined | null> }) {
  return (
    <div className="ex-context">
      {items.filter(Boolean).map((it, i) => {
        const x = it as { label: string; value: ReactNode };
        return (
          <div key={i} className="ex-context__item">
            <span className="ex-context__k">{x.label}</span>
            <span className="ex-context__v">{x.value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Connectivity / sync pill: colour + icon + text (§26.1). Local success ≠ cloud sync. */
export function SyncIndicator({ status, onClick, compact }: { status?: SyncStatusSnapshot; onClick?: () => void; compact?: boolean }) {
  if (!status) return null;
  const meta = CONNECTIVITY[status.connectivity];
  const label = status.connectivity === 'syncing' ? `Syncing ${status.pending}` : status.connectivity === 'offline' ? 'Offline' : meta.label;
  const title =
    status.connectivity === 'offline'
      ? `Offline — billing is available. ${status.pending} changes waiting to sync. Last sync ${relative(status.lastSuccessAt)}.`
      : status.connectivity === 'attention'
        ? `${status.quarantined} item(s) need attention`
        : `Last sync ${relative(status.lastSuccessAt)}`;
  return (
    <button type="button" className={clsx('ex-sync', `ex-sync--${status.connectivity}`)} onClick={onClick} title={title} aria-label={title}>
      <Icon name={meta.icon} size={15} className={status.connectivity === 'syncing' ? 'ex-spin' : undefined} />
      {!compact ? <span>{label}</span> : null}
      {status.connectivity === 'offline' && status.pending > 0 ? <span className="ex-sync__count num">· {status.pending} queued</span> : null}
    </button>
  );
}
