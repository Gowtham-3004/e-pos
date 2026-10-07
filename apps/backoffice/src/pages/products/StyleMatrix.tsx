import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, CardHeader, KpiCard } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, number } from '@elixir/format';
import { KpiRow, NotFound, PageFrame, ScopeHint } from '../../components/common';
import { useCloud, useLookups, useTenantProducts } from '../../lib/data';
import { onHandIn } from '../../lib/stock';
import { useSession } from '../../lib/session';

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '28', '30', '32', '34', '36', '38', '40', '42', '6', '7', '8', '9', '10', '11', 'Free'];

/** Size × colour stock grid for a style (fashion variants). */
export function VariantMatrix({ styleCode, highlightId }: { styleCode: string; highlightId?: string }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const products = useTenantProducts();
  const variants = useMemo(() => products.filter((p) => p.styleCode === styleCode), [products, styleCode]);
  const grid = useLive(cloud, ['stockMovements'], () => new Map(variants.map((p) => [p.id, onHandIn(cloud, s.scope, p.id)])), [variants, s.scope.join(',')]);
  const sizes = [...new Set(variants.map((p) => p.variantAttrs?.size ?? '—'))].sort((a, b) => (SIZE_ORDER.indexOf(a) + 1 || 99) - (SIZE_ORDER.indexOf(b) + 1 || 99));
  const colors = [...new Set(variants.map((p) => p.variantAttrs?.color ?? '—'))];
  return (
    <div className="ex-scroll" style={{ overflowX: 'auto' }}>
      <table className="bo-matrix">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Colour \ Size</th>
            {sizes.map((z) => <th key={z}>{z}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {colors.map((c) => {
            const row = sizes.map((z) => variants.find((p) => (p.variantAttrs?.color ?? '—') === c && (p.variantAttrs?.size ?? '—') === z));
            const total = row.reduce((a, p) => a + (p ? grid.get(p.id) ?? 0 : 0), 0);
            return (
              <tr key={c}>
                <th>{c}</th>
                {row.map((p, i) => {
                  if (!p) return <td key={i} className="is-none" title="No variant">—</td>;
                  const q = grid.get(p.id) ?? 0;
                  const cls = q <= 0 ? 'is-out' : q <= p.reorderLevel ? 'is-low' : '';
                  return (
                    <td key={i} className={cls} style={p.id === highlightId ? { outline: '2px solid var(--action-primary)', outlineOffset: -2 } : undefined} onClick={() => nav(`/products/${p.id}`)} title={`${p.sku} · ${q <= 0 ? 'Out of stock' : q <= p.reorderLevel ? 'Low stock' : 'In stock'}`}>
                      {number(q)}
                      <span className="bo-matrix__sub">{q <= 0 ? 'Out' : q <= p.reorderLevel ? 'Low' : p.active ? '' : 'Inactive'}</span>
                    </td>
                  );
                })}
                <td style={{ cursor: 'default', background: 'var(--surface-secondary)' }}>{number(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function StyleMatrixPage() {
  const { style } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const L = useLookups();
  const products = useTenantProducts();
  const variants = products.filter((p) => p.styleCode === style);
  const stock = useLive(cloud, ['stockMovements'], () => variants.reduce((a, p) => a + onHandIn(cloud, s.scope, p.id), 0), [variants.length, s.scope.join(',')]);
  const sold30 = useLive(cloud, ['sales'], () => {
    const ids = new Set(variants.map((v) => v.id));
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    let q = 0;
    cloud.all('sales').forEach((x) => x.tenantId === s.tenant.id && x.businessDate >= from && s.scope.includes(x.storeId) && x.lines.forEach((l) => ids.has(l.productId) && (q += l.qty)));
    return q;
  }, [variants.length, s.scope.join(',')]);
  if (!variants.length || !style) return <NotFound what="Style" back={{ label: 'Back to products', to: '/products?view=styles' }} />;
  const first = variants[0]!;
  return (
    <PageFrame
      crumbs={[{ label: 'Products', to: '/products?view=styles' }, { label: style }]}
      title={first.name}
      meta={<Badge>{style}</Badge>}
      description={<>{L.categories.get(first.categoryId)?.name} · {L.brands.get(first.brandId ?? '')?.name} · {first.variantAttrs?.season} · <ScopeHint /></>}
    >
      <KpiRow>
        <KpiCard label="Variants" icon="Shirt" value={number(variants.length)} foot={`${new Set(variants.map((v) => v.variantAttrs?.color)).size} colours × ${new Set(variants.map((v) => v.variantAttrs?.size)).size} sizes`} />
        <KpiCard label="Units on hand" icon="Boxes" value={number(stock)} />
        <KpiCard label="Sold · 30 days" icon="TrendingUp" value={number(sold30)} />
        <KpiCard label="MRP" icon="IndianRupee" value={money(first.mrpPaise)} foot={`HSN ${first.hsn}`} />
      </KpiRow>
      <Card>
        <CardHeader title="Stock by size × colour" subtitle="Click a cell to open that variant. Amber = at/below reorder level, red = out of stock." icon="Grid3x3" />
        <div style={{ padding: 16 }}><VariantMatrix styleCode={style} /></div>
      </Card>
    </PageFrame>
  );
}
