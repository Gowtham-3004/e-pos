import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { icons, Loader2, type LucideProps } from 'lucide-react';
import clsx from 'clsx';
import type { StatusMeta, Tone } from '@elixir/domain';
import { initials } from '@elixir/format';

export { clsx as cx };

/** Icon by lucide name (status/nav metadata stores names as strings). */
export function Icon({ name, size = 18, ...rest }: { name: string } & LucideProps) {
  const C = (icons as Record<string, React.ComponentType<LucideProps>>)[name] ?? icons.Circle;
  return <C size={size} strokeWidth={1.75} aria-hidden {...rest} />;
}

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline' | 'success' | 'subtle';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  block?: boolean;
  /** Keyboard shortcut hint, e.g. "F7" */
  shortcut?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, block, shortcut, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 15 : size === 'xl' ? 20 : 17;
  return (
    <button
      ref={ref}
      type={type}
      className={clsx('ex-btn', `ex-btn--${variant}`, `ex-btn--${size}`, block && 'ex-btn--block', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="ex-spin" aria-hidden /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
});

/** Icon-only button — label is mandatory (aria-label + tooltip, §8). */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, 'children' | 'icon'> & { icon: string; label: string; tip?: boolean }>(function IconButton(
  { icon, label, tip = true, variant = 'ghost', size = 'md', className, ...rest },
  ref,
) {
  return (
    <Button ref={ref} variant={variant} size={size} className={clsx('ex-btn--icon', className)} aria-label={label} data-tip={tip ? label : undefined} icon={icon} {...rest} />
  );
});

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="ex-kbd">{children}</kbd>;
}

export function Badge({ tone = 'neutral', icon, dot, size, solid, outline, children, className, ...rest }: { tone?: Tone; icon?: string; dot?: boolean; size?: 'lg'; solid?: boolean; outline?: boolean; children: ReactNode } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={clsx('ex-badge', tone !== 'neutral' && `ex-badge--${tone}`, size && `ex-badge--${size}`, solid && 'ex-badge--solid', outline && 'ex-badge--outline', className)} {...rest}>
      {dot ? <span className="ex-dot" /> : icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/** Status = colour + icon + text, never colour alone (UX-07). */
export function StatusBadge({ meta, size, label }: { meta: StatusMeta; size?: 'lg'; label?: string }) {
  return (
    <Badge tone={meta.tone} icon={meta.icon} size={size}>
      {label ?? meta.label}
    </Badge>
  );
}

export function Card({ pad, flat, interactive, className, children, ...rest }: { pad?: boolean; flat?: boolean; interactive?: boolean } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx('ex-card', pad && 'ex-card--pad', flat && 'ex-card--flat', interactive && 'ex-card--interactive', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, actions, children }: { title: ReactNode; subtitle?: ReactNode; icon?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ex-card__head">
      {icon ? <Icon name={icon} size={18} className="muted" /> : null}
      <div style={{ minWidth: 0 }}>
        <div className="ex-card__title">{title}</div>
        {subtitle ? <div className="ex-card__sub">{subtitle}</div> : null}
      </div>
      {children}
      <div className="ex-spacer" />
      {actions}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('ex-card__body', className)} {...rest} />;
}
export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={clsx('ex-card__foot', className)} {...rest} />;
}

export function Avatar({ name, color, size }: { name: string; color?: string; size?: 'lg' | 'xl' }) {
  return (
    <span className={clsx('ex-avatar', size && `ex-avatar--${size}`)} style={color ? { background: color } : undefined} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Spinner({ size = 18, label = 'Loading' }: { size?: number; label?: string }) {
  return <Loader2 size={size} className="ex-spin muted" aria-label={label} role="status" />;
}

export function Skeleton({ width = '100%', height = 14, radius, style }: { width?: number | string; height?: number | string; radius?: number; style?: React.CSSProperties }) {
  return <div className="ex-skeleton" style={{ width, height, borderRadius: radius, ...style }} aria-hidden />;
}

export function Divider() {
  return <hr className="ex-divider" />;
}

export function Progress({ value, tone, label }: { value: number; tone?: 'success' | 'warning' | 'danger'; label?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx('ex-progress', tone && `ex-progress--${tone}`)} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="ex-progress__bar" style={{ width: `${v}%` }} />
    </div>
  );
}

/** Indian veg / non-veg / egg marker: shape + colour (+ sr text). */
export function FoodMark({ type }: { type: 'veg' | 'non-veg' | 'egg' }) {
  const label = type === 'veg' ? 'Vegetarian' : type === 'egg' ? 'Contains egg' : 'Non-vegetarian';
  return (
    <span className={`ex-food ex-food--${type}`} title={label}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
