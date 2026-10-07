import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Icon } from './primitives';

export interface TabItem<K extends string = string> { key: K; label: ReactNode; count?: number; icon?: string }

export function Tabs<K extends string>({ items, value, onChange, className }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; className?: string }) {
  return (
    <div className={clsx('ex-tabs', className)} role="tablist">
      {items.map((t) => (
        <button key={t.key} role="tab" type="button" aria-selected={t.key === value} className="ex-tab" onClick={() => onChange(t.key)}>
          {t.icon ? <Icon name={t.icon} size={16} /> : null}
          {t.label}
          {t.count != null ? <span className="ex-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented<K extends string>({ items, value, onChange, size, label }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; size?: 'lg'; label?: string }) {
  return (
    <div className={clsx('ex-segmented', size && `ex-segmented--${size}`)} role="group" aria-label={label}>
      {items.map((t) => (
        <button key={t.key} type="button" aria-pressed={t.key === value} onClick={() => onChange(t.key)}>
          {t.icon ? <Icon name={t.icon} size={15} /> : null}
          {t.label}
          {t.count != null ? <span className="muted">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Horizontal, scrollable category chips (§13). */
export function CategoryChips<K extends string>({ items, value, onChange, size, label = 'Categories' }: { items: TabItem<K>[]; value: K; onChange: (k: K) => void; size?: 'lg'; label?: string }) {
  return (
    <div className="ex-chips" role="group" aria-label={label}>
      {items.map((c) => (
        <button key={c.key} type="button" className={clsx('ex-chip', size && 'ex-chip--lg')} aria-pressed={c.key === value} onClick={() => onChange(c.key)}>
          {c.icon ? <Icon name={c.icon} size={15} /> : null}
          {c.label}
          {c.count != null ? <span className="ex-count">{c.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Breadcrumb({ items }: { items: Array<{ label: string; href?: string; onClick?: () => void }> }) {
  return (
    <nav className="ex-breadcrumb" aria-label="Breadcrumb">
      {items.map((it, i) => (
        <span key={i} className="ex-row" style={{ gap: 6 }}>
          {i > 0 ? <Icon name="ChevronRight" size={13} /> : null}
          {it.href || it.onClick ? (
            <a href={it.href ?? '#'} onClick={(e) => { if (it.onClick) { e.preventDefault(); it.onClick(); } }}>{it.label}</a>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function FilterChip({ label, onRemove }: { label: ReactNode; onRemove: () => void }) {
  return (
    <span className="ex-filter-chip">
      {label}
      <button type="button" aria-label="Remove filter" onClick={onRemove}><Icon name="X" size={12} /></button>
    </span>
  );
}

export function FilterBar({ children, active, onClearAll }: { children: ReactNode; active?: Array<{ key: string; label: ReactNode; onRemove: () => void }>; onClearAll?: () => void }) {
  return (
    <div className="ex-stack" style={{ gap: 8 }}>
      <div className="ex-filterbar">{children}</div>
      {active?.length ? (
        <div className="ex-row" style={{ flexWrap: 'wrap' }}>
          {active.map((a) => <FilterChip key={a.key} label={a.label} onRemove={a.onRemove} />)}
          {onClearAll ? <button type="button" className="ex-btn ex-btn--ghost ex-btn--sm" onClick={onClearAll}>Clear all</button> : null}
        </div>
      ) : null}
    </div>
  );
}
