import { useMemo, useRef, useState } from 'react';
import type { Product } from '@elixir/contracts';
import { SearchInput } from '@elixir/ui';
import { searchProducts } from '@elixir/local-store';
import { money } from '@elixir/format';
import { useCloud } from '../lib/data';
import { useSession } from '../lib/session';

/** Type-ahead product search (name, SKU, barcode, molecule, style). Enter picks the first result. */
export function ProductPicker({ onPick, placeholder = 'Search product by name, SKU or scan barcode', exclude, autoFocus, right }: { onPick: (p: Product) => void; placeholder?: string; exclude?: string[]; autoFocus?: boolean; right?: (p: Product) => React.ReactNode }) {
  const s = useSession();
  const cloud = useCloud();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const results = useMemo(() => searchProducts(cloud, s.tenant.id, q, 16).filter((p) => !p.isService && !exclude?.includes(p.id)).slice(0, 12), [cloud, s.tenant.id, q, exclude]);
  const pick = (p: Product) => {
    onPick(p);
    setQ('');
    setOpen(false);
    setActive(0);
    ref.current?.focus();
  };
  return (
    <div className="bo-search-pop" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <SearchInput
        ref={ref}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => setOpen(true)}
        onClear={() => setQ('')}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && results[active]) { e.preventDefault(); pick(results[active]!); }
          if (e.key === 'Escape') setOpen(false);
        }}
        aria-label="Search product"
      />
      {open && q.trim() ? (
        <div className="bo-search-results" role="listbox">
          {results.length ? results.map((p, i) => (
            <button key={p.id} type="button" role="option" aria-selected={i === active} data-active={i === active} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <span style={{ minWidth: 0 }}>
                <span className="bo-cell-main" style={{ display: 'block' }}>{p.name}{p.variantAttrs ? ` · ${p.variantAttrs.color}/${p.variantAttrs.size}` : ''}</span>
                <span className="bo-cell-sub num">{p.sku} · {p.barcode}{p.molecule ? ` · ${p.molecule}` : ''}</span>
              </span>
              <span className="num muted" style={{ whiteSpace: 'nowrap' }}>{right ? right(p) : money(p.salePaise)}</span>
            </button>
          )) : <div className="muted" style={{ padding: 10, fontSize: 13 }}>No active product matches “{q}”.</div>}
        </div>
      ) : null}
    </div>
  );
}
