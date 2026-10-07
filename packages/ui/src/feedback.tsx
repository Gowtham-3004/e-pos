import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import type { Tone } from '@elixir/domain';
import { Button, Icon, IconButton } from './primitives';
import { PinInput, Textarea } from './forms';

const TONE_ICON: Record<Tone, string> = { info: 'Info', success: 'CircleCheck', warning: 'TriangleAlert', danger: 'CircleAlert', neutral: 'Info' };

export function InlineAlert({ tone = 'info', title, children, icon, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; icon?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('ex-alert', `ex-alert--${tone}`, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon ?? TONE_ICON[tone]} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div className="ex-alert__title">{title}</div> : null}
        {children ? <div className="ex-alert__body">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

/** Banner — only for conditions that change what the operator can do (§26.1, §43). */
export function Banner({ tone = 'warning', icon, children, action }: { tone?: 'warning' | 'danger' | 'info' | 'neutral'; icon?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={clsx('ex-banner', `ex-banner--${tone}`)} role="status">
      <Icon name={icon ?? TONE_ICON[tone]} size={17} />
      <div className="ex-banner__text" style={{ flex: 1 }}>{children}</div>
      {action}
    </div>
  );
}

export function EmptyState({ icon = 'Inbox', title, children, actions, quiet }: { icon?: string; title: ReactNode; children?: ReactNode; actions?: ReactNode; quiet?: boolean }) {
  return (
    <div className={clsx('ex-empty', quiet && 'ex-empty--quiet')}>
      <div className="ex-empty__icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="ex-empty__title">{title}</div>
      {children ? <div style={{ maxWidth: 420 }}>{children}</div> : null}
      {actions ? <div className="ex-row" style={{ marginTop: 6 }}>{actions}</div> : null}
    </div>
  );
}

/** Stack of open overlays — only the top-most closes on Escape. */
const overlayStack: symbol[] = [];

function useEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol('overlay');
    overlayStack.push(id);
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlayStack[overlayStack.length - 1] === id) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => {
      window.removeEventListener('keydown', h);
      const i = overlayStack.indexOf(id);
      if (i >= 0) overlayStack.splice(i, 1);
    };
  }, [onClose, enabled]);
}

function useFocusTrap(ref: React.RefObject<HTMLElement | null>, open: boolean, initialFocus?: string) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = (initialFocus ? el.querySelector<HTMLElement>(initialFocus) : null) ?? el.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button:not([aria-label="Close"])');
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const f = [...el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const a = f[0]!, z = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    el.addEventListener('keydown', onKey);
    return () => { el.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, ref, initialFocus]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Prevent closing by backdrop/Escape (e.g. while committing). */
  dismissible?: boolean;
  icon?: ReactNode;
  /** CSS selector of the element to focus when opened (e.g. '#amount'). */
  initialFocus?: string;
}

export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, icon, initialFocus }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open && dismissible);
  useFocusTrap(ref, open, initialFocus);
  if (!open) return null;
  return createPortal(
    <div className="ex-overlay" onMouseDown={(e) => dismissible && e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={clsx('ex-modal', `ex-modal--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        {title ? (
          <div className="ex-modal__head">
            {icon}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="ex-modal__title">{title}</div>
              {description ? <div className="ex-modal__desc">{description}</div> : null}
            </div>
            {dismissible ? <IconButton icon="X" label="Close" tip={false} onClick={onClose} size="sm" /> : null}
          </div>
        ) : null}
        <div className="ex-modal__body">{children}</div>
        {footer ? <div className="ex-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({ open, onClose, title, description, children, footer, size, side = 'right' }: Omit<ModalProps, 'size'> & { size?: 'sm' | 'lg'; side?: 'right' | 'left' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div className={clsx('ex-overlay', side === 'left' ? 'ex-overlay--drawer-left' : 'ex-overlay--drawer')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={clsx('ex-drawer', size && `ex-drawer--${size}`)} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className="ex-modal__head" style={{ borderBottom: '1px solid var(--border-default)', paddingBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ex-modal__title">{title}</div>
            {description ? <div className="ex-modal__desc">{description}</div> : null}
          </div>
          <IconButton icon="X" label="Close" tip={false} onClick={onClose} size="sm" />
        </div>
        <div className="ex-modal__body" style={{ paddingTop: 16 }}>{children}</div>
        {footer ? <div className="ex-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Sheet({ open, onClose, title, description, children, footer }: Omit<ModalProps, 'size'>) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose, open);
  useFocusTrap(ref, open);
  if (!open) return null;
  return createPortal(
    <div className="ex-overlay ex-overlay--sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="ex-sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1}>
        <div className="ex-modal__head">
          <div style={{ flex: 1 }}>
            <div className="ex-modal__title">{title}</div>
            {description ? <div className="ex-modal__desc">{description}</div> : null}
          </div>
          <IconButton icon="X" label="Close" tip={false} onClick={onClose} size="sm" />
        </div>
        <div className="ex-modal__body">{children}</div>
        {footer ? <div className="ex-modal__foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Confirmation for destructive / irreversible actions (§44). Optional typed reason. */
export function ConfirmDialog({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', tone = 'danger', requireReason, reasonLabel = 'Reason', busy }: { open: boolean; onClose: () => void; onConfirm: (reason?: string) => void | Promise<void>; title: ReactNode; children?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'primary'; requireReason?: boolean; reasonLabel?: string; busy?: boolean }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={busy} disabled={requireReason && !reason.trim()} onClick={() => onConfirm(reason.trim() || undefined)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ex-stack">
        {children ? <div className="secondary">{children}</div> : null}
        {requireReason ? <Textarea label={reasonLabel} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for audit" /> : null}
      </div>
    </Modal>
  );
}

export interface ApprovalVerifyResult {
  ok: boolean;
  approverId?: string;
  approverName?: string;
  message?: string;
}

/**
 * Manager override (§29). Transient authorization — never logs the manager in as the cashier.
 * The verify callback checks a manager PIN against cached approval authority (works offline).
 */
export function ApprovalDialog({ open, onClose, onApproved, action, requested, allowed, detail, verify, requireReason = true }: { open: boolean; onClose: () => void; onApproved: (r: { approverId: string; approverName: string; reason?: string }) => void; action: string; requested?: ReactNode; allowed?: ReactNode; detail?: ReactNode; verify: (pin: string) => ApprovalVerifyResult; requireReason?: boolean }) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => { if (open) { setPin(''); setReason(''); setErr(undefined); } }, [open]);
  const tryApprove = (p: string) => {
    if (requireReason && !reason.trim()) { setErr('Enter a reason before approval.'); setPin(''); return; }
    const r = verify(p);
    if (r.ok && r.approverId) onApproved({ approverId: r.approverId, approverName: r.approverName ?? 'Manager', reason: reason.trim() || undefined });
    else { setErr(r.message ?? 'PIN not recognised or no approval authority.'); setPin(''); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Manager approval required" icon={<span className="ex-empty__icon" style={{ width: 40, height: 40, background: 'var(--status-warning-soft)', color: 'var(--status-warning)' }}><Icon name="ShieldCheck" size={20} /></span>}>
      <div className="ex-stack" style={{ gap: 16 }}>
        <dl className="ex-dl" style={{ background: 'var(--surface-secondary)', padding: 12, borderRadius: 8, border: '1px solid var(--border-default)' }}>
          <dt>Action</dt><dd>{action}</dd>
          {requested != null ? (<><dt>Requested</dt><dd>{requested}</dd></>) : null}
          {allowed != null ? (<><dt>Allowed without approval</dt><dd>{allowed}</dd></>) : null}
        </dl>
        {detail ? <div className="secondary" style={{ fontSize: 13 }}>{detail}</div> : null}
        {requireReason ? <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setErr(undefined); }} placeholder="Recorded in audit log" /> : null}
        <div className="ex-label" style={{ justifyContent: 'center' }}>Manager PIN</div>
        <PinInput value={pin} onChange={(v) => { setPin(v); setErr(undefined); }} onComplete={tryApprove} error={!!err} autoFocus={!requireReason} />
        {err ? <InlineAlert tone="danger">{err}</InlineAlert> : <div className="ex-hint" style={{ textAlign: 'center' }}>Approves this action once. Cashier stays signed in.</div>}
      </div>
    </Modal>
  );
}

// ───────── Toasts ─────────
interface ToastItem { id: number; tone: Tone; title: ReactNode; body?: ReactNode; action?: { label: string; onClick: () => void } }
const ToastCtx = createContext<{ push: (t: Omit<ToastItem, 'id'> & { duration?: number }) => void } | null>(null);

export function ToastProvider({ children, position = 'bottom-right' }: { children: ReactNode; position?: 'bottom-right' | 'top-right' | 'top-center' }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((t: Omit<ToastItem, 'id'> & { duration?: number }) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.duration ?? 3200);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {createPortal(
        <div className={clsx('ex-toasts', `ex-toasts--${position}`)} aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={clsx('ex-toast', `ex-toast--${t.tone}`)} role="status">
              <Icon name={TONE_ICON[t.tone]} size={18} />
              <div style={{ flex: 1 }}>
                <div className="ex-toast__title">{t.title}</div>
                {t.body ? <div className="ex-toast__body">{t.body}</div> : null}
              </div>
              {t.action ? <Button size="sm" variant="ghost" onClick={t.action.onClick}>{t.action.label}</Button> : null}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  const push = ctx?.push ?? (() => undefined);
  return {
    push,
    success: (title: ReactNode, body?: ReactNode) => push({ tone: 'success', title, body }),
    error: (title: ReactNode, body?: ReactNode) => push({ tone: 'danger', title, body, duration: 5000 }),
    info: (title: ReactNode, body?: ReactNode) => push({ tone: 'info', title, body }),
    warning: (title: ReactNode, body?: ReactNode) => push({ tone: 'warning', title, body, duration: 4500 }),
  };
}

/** Simple dropdown menu. */
export function Menu({ trigger, children, align = 'right' }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  return (
    <div className="ex-menu-wrap" ref={ref}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open })}
      {open ? <div className={clsx('ex-menu', align === 'left' && 'ex-menu--left')} role="menu">{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

export function MenuItem({ icon, children, onClick, danger, disabled }: { icon?: string; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className={clsx('ex-menu__item', danger && 'ex-menu__item--danger')} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
      {icon ? <Icon name={icon} size={16} /> : null}
      {children}
    </button>
  );
}
export const MenuLabel = ({ children }: { children: ReactNode }) => <div className="ex-menu__label">{children}</div>;
export const MenuSeparator = () => <div className="ex-menu__sep" />;
