import { useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { money } from '@elixir/format';
import { Button, Icon, Skeleton } from './primitives';
import { EmptyState, InlineAlert } from './feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  /** Value used for sorting (defaults to row[key]). */
  sortValue?: (row: T) => string | number | undefined;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  sortable?: boolean;
  hidden?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: ReactNode;
  empty?: ReactNode;
  pageSize?: number;
  density?: 'dense' | 'comfortable';
  selectedKey?: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: number | string;
  footer?: ReactNode;
}

/** Sortable, paginated data table with loading/empty/error states (§31). Numeric columns right-align. */
export function DataTable<T>({ columns, rows, rowKey, onRowClick, loading, error, empty, pageSize = 25, density, selectedKey, initialSort, maxHeight, footer }: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const cols = columns.filter((c) => !c.hidden);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const get = col?.sortValue ?? ((r: T) => (r as Record<string, unknown>)[sort.key] as string | number);
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      const r = va == null ? -1 : vb == null ? 1 : typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const p = Math.min(page, pages - 1);
  const visible = sorted.slice(p * pageSize, p * pageSize + pageSize);

  return (
    <div>
      <div className="ex-table-wrap ex-scroll" style={{ maxHeight }}>
        <table className={clsx('ex-table', density && `ex-table--${density}`)}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'ex-right' : c.align === 'center' ? 'ex-center' : undefined} style={{ width: c.width }} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable ? (
                    <button type="button" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.align === 'right' ? 'desc' : 'asc' }))}>
                      {c.header}
                      <Icon name={sort?.key === c.key ? (sort.dir === 'asc' ? 'ArrowUp' : 'ArrowDown') : 'ArrowUpDown'} size={12} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {cols.map((c) => (
                      <td key={c.key}><Skeleton width={c.align === 'right' ? 60 : '70%'} /></td>
                    ))}
                  </tr>
                ))
              : visible.map((r, i) => {
                  const k = rowKey(r);
                  return (
                    <tr
                      key={k}
                      className={clsx(onRowClick && 'is-clickable', selectedKey === k && 'is-selected')}
                      onClick={onRowClick ? () => onRowClick(r) : undefined}
                      onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                      tabIndex={onRowClick ? 0 : undefined}
                    >
                      {cols.map((c) => (
                        <td key={c.key} className={c.align === 'right' ? 'ex-right' : c.align === 'center' ? 'ex-center' : undefined}>
                          {c.render ? c.render(r, i) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
        {!loading && error ? <div style={{ padding: 16 }}><InlineAlert tone="danger" title="Couldn't load data">{error}</InlineAlert></div> : null}
        {!loading && !error && rows.length === 0 ? (empty ?? <EmptyState quiet title="Nothing to show" />) : null}
      </div>
      {footer}
      {rows.length > pageSize ? <Pagination page={p} pages={pages} total={rows.length} pageSize={pageSize} onPage={setPage} /> : null}
    </div>
  );
}

export function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  return (
    <div className="ex-pagination">
      <span className="num">
        {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total.toLocaleString('en-IN')}
      </span>
      <div className="ex-spacer" />
      <Button size="sm" variant="ghost" icon="ChevronLeft" disabled={page === 0} onClick={() => onPage(page - 1)}>Prev</Button>
      <span className="num">Page {page + 1} / {pages}</span>
      <Button size="sm" variant="ghost" iconRight="ChevronRight" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

export function KpiCard({ label, value, icon, delta, deltaLabel, foot, tone, onClick, loading }: { label: ReactNode; value: ReactNode; icon?: string; delta?: number; deltaLabel?: string; foot?: ReactNode; tone?: 'warning' | 'danger' | 'success'; onClick?: () => void; loading?: boolean }) {
  const toneColor = tone ? `var(--status-${tone})` : undefined;
  return (
    <div className={clsx('ex-card', onClick && 'ex-card--interactive')} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}>
      <div className="ex-kpi">
        <div className="ex-kpi__label">
          {icon ? <Icon name={icon} size={16} style={{ color: toneColor }} /> : null}
          {label}
        </div>
        <div className="ex-kpi__value" style={{ color: toneColor }}>{loading ? <Skeleton width={120} height={30} /> : value}</div>
        {delta != null ? (
          <div className={clsx('ex-kpi__delta', delta >= 0 ? 'ex-kpi__delta--up' : 'ex-kpi__delta--down')}>
            <Icon name={delta >= 0 ? 'TrendingUp' : 'TrendingDown'} size={13} />
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}% {deltaLabel ?? 'vs previous'}
          </div>
        ) : null}
        {foot ? <div className="ex-kpi__foot">{foot}</div> : null}
      </div>
    </div>
  );
}

export function DescriptionList({ items, right }: { items: Array<[ReactNode, ReactNode]>; right?: boolean }) {
  return (
    <dl className={clsx('ex-dl', right && 'ex-dl--right')}>
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Timeline({ items }: { items: Array<{ id: string; time: ReactNode; title: ReactNode; meta?: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' }> }) {
  return (
    <div className="ex-timeline">
      {items.map((it) => (
        <div key={it.id} className="ex-timeline__item">
          <div className="ex-timeline__time">{it.time}</div>
          <div className="ex-timeline__dot" style={it.tone ? { background: `var(--status-${it.tone})` } : undefined} />
          <div>
            <div className="ex-timeline__title">{it.title}</div>
            {it.meta ? <div className="ex-timeline__meta">{it.meta}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Money value with tabular numerals — always via the central formatter (§57). */
export function Money({ paise, whole, signed, className, strong }: { paise: number; whole?: boolean; signed?: boolean; className?: string; strong?: boolean }) {
  const Tag = strong ? 'strong' : 'span';
  return <Tag className={clsx('num', className)}>{money(paise, { whole, signed })}</Tag>;
}

export function TotalRow({ label, paise, grand, children }: { label: ReactNode; paise?: number; grand?: boolean; children?: ReactNode }) {
  return (
    <div className={clsx('ex-total-row', grand && 'ex-total-row--grand')}>
      <span>{label}</span>
      <b>{children ?? (paise != null ? money(paise) : '—')}</b>
    </div>
  );
}
