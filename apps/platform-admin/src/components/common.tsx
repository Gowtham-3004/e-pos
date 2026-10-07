import type { ReactNode } from 'react';
import type { Capability } from '@elixir/contracts';
import { Badge, Button, EmptyState, Icon, InlineAlert, Page, type ButtonProps } from '@elixir/ui';
import { useNavigate } from 'react-router-dom';
import { capLabel } from '../lib/platform';
import { useAccess, type PlatformAction } from '../lib/access';

/** Explicit permission message (§67) — tells the user which permission is missing and what to do. */
export function PermissionNote({ action, children }: { action: PlatformAction; children?: ReactNode }) {
  const { why } = useAccess();
  const msg = why(action);
  if (!msg) return null;
  return (
    <InlineAlert tone="neutral" icon="Lock" title="View only">
      {children ? <>{children} </> : null}
      {msg}
    </InlineAlert>
  );
}

/** Button that is disabled with an explanation when the role lacks the action. */
export function GuardedButton({ action, children, title, ...rest }: ButtonProps & { action: PlatformAction }) {
  const { can, why } = useAccess();
  const allowed = can(action);
  return (
    <Button {...rest} disabled={!allowed || rest.disabled} title={allowed ? title : why(action)} aria-disabled={!allowed || undefined} icon={allowed ? rest.icon : 'Lock'}>
      {children}
    </Button>
  );
}

export function RestrictedPage({ action, title }: { action: PlatformAction; title: string }) {
  const { why } = useAccess();
  const nav = useNavigate();
  return (
    <Page>
      <EmptyState icon="Lock" title={`${title} is restricted`} actions={<Button onClick={() => nav('/')} icon="LayoutDashboard">Back to Overview</Button>}>
        {why(action)}
      </EmptyState>
    </Page>
  );
}

export function NotFound({ what = 'Page', back = '/', backLabel = 'Back to Overview' }: { what?: string; back?: string; backLabel?: string }) {
  const nav = useNavigate();
  return (
    <Page>
      <EmptyState icon="SearchX" title={`${what} not found`} actions={<Button onClick={() => nav(back)} icon="ArrowLeft">{backLabel}</Button>}>
        It may have been removed, or the link is out of date.
      </EmptyState>
    </Page>
  );
}

export function CapChip({ cap, tone, strike }: { cap: Capability; tone?: 'success' | 'danger' | 'info' | 'warning'; strike?: boolean }) {
  return (
    <Badge tone={tone} className={strike ? 'pa-strike' : undefined} title={cap}>
      {tone === 'success' ? <Icon name="Plus" size={11} /> : tone === 'danger' ? <Icon name="Minus" size={11} /> : null}
      {capLabel(cap)}
    </Badge>
  );
}

export function SectionTitle({ children, actions, sub }: { children: ReactNode; actions?: ReactNode; sub?: ReactNode }) {
  return (
    <div className="pa-section-title">
      <div>
        <h2>{children}</h2>
        {sub ? <p className="muted">{sub}</p> : null}
      </div>
      <div className="ex-spacer" />
      {actions}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="pa-mono">{children}</span>;
}

/** Small "N" count with tone, right-aligned numerals. */
export function Count({ n, tone }: { n: number; tone?: 'warning' | 'danger' }) {
  return <span className={`num${n > 0 && tone ? ` pa-tone-${tone}` : n === 0 ? ' muted' : ''}`}>{n.toLocaleString('en-IN')}</span>;
}
