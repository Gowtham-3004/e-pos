import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Product } from '@elixir/contracts';
import { Badge, Button, Card, DataTable, EmptyState, FilterChip, InlineAlert, KpiCard, Modal, SearchInput, Segmented, Select, StatusBadge, Textarea, useToast, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, number, qty as fq } from '@elixir/format';
import { uid } from '@elixir/domain';
import { ExportMenu, KpiRow, PageFrame, ScopeHint, useFirstPaint } from '../../components/common';
import { includesQ, useCloud, useLookups, useTenantProducts } from '../../lib/data';
import { healthOf, onHandIn, STOCK_HEALTH } from '../../lib/stock';
import { downloadTable, parseCsv, rupees } from '../../lib/csv';
import { saveMaster } from '../../lib/ops';
import { rupeesToPaise } from '@elixir/format';
import { useSession } from '../../lib/session';

type Row = Product & { stock: number; health: ReturnType<typeof healthOf> };

export function ProductsList() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const products = useTenantProducts();
  const loading = useFirstPaint();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [brand, setBrand] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | ''>('active');
  const [health, setHealth] = useState(params.get('health') ?? '');
  const [attr, setAttr] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const view = (params.get('view') as 'products' | 'styles') ?? 'products';
  const v = s.tenant.vertical;
  const canEdit = s.can('catalog.edit');

  const rows: Row[] = useLive(cloud, ['stockMovements', 'products'], () => products.map((p) => {
    const stock = onHandIn(cloud, s.scope, p.id);
    return { ...p, stock, health: healthOf(stock, p.reorderLevel) };
  }), [products, s.scope.join(',')]);

  const attrOptions = useMemo(() => {
    if (v === 'grocery') return [{ value: 'weighted', label: 'Weighted / PLU' }, { value: 'batch', label: 'Batch tracked' }];
    if (v === 'pharmacy') return [{ value: 'rx', label: 'Prescription (Rx)' }, { value: 'H', label: 'Schedule H' }, { value: 'H1', label: 'Schedule H1' }, { value: 'OTC', label: 'OTC' }];
    if (v === 'electronics') return [{ value: 'serial', label: 'Serial / IMEI tracked' }, { value: 'warranty', label: 'With warranty' }];
    if (v === 'fashion') return [...new Set(products.map((p) => p.variantAttrs?.season).filter(Boolean))].map((x) => ({ value: `season:${x}`, label: `Season · ${x}` })).concat([...new Set(products.map((p) => p.variantAttrs?.size).filter(Boolean))].map((x) => ({ value: `size:${x}`, label: `Size · ${x}` })));
    return [];
  }, [v, products]);

  const matchAttr = (p: Product) => {
    if (!attr) return true;
    if (attr === 'weighted') return !!p.weighted;
    if (attr === 'batch') return !!p.batchTracked;
    if (attr === 'rx') return !!p.prescriptionRequired;
    if (['H', 'H1', 'OTC', 'X'].includes(attr)) return p.schedule === attr;
    if (attr === 'serial') return !!p.serialTracked;
    if (attr === 'warranty') return (p.warrantyMonths ?? 0) > 0;
    if (attr.startsWith('season:')) return p.variantAttrs?.season === attr.slice(7);
    if (attr.startsWith('size:')) return p.variantAttrs?.size === attr.slice(5);
    return true;
  };

  const filtered = useMemo(
    () => rows.filter((p) => (!cat || p.categoryId === cat) && (!brand || p.brandId === brand) && (!status || (status === 'active' ? p.active : !p.active)) && (!health || (health === 'low' ? p.health !== 'ok' : p.health === health)) && matchAttr(p) && includesQ(q, p.name, p.sku, p.barcode, p.plu, p.molecule, p.manufacturer, p.model, p.styleCode, p.variantAttrs?.color)).sort((a, b) => a.name.localeCompare(b.name)),
    [rows, cat, brand, status, health, attr, q], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const styles = useMemo(() => {
    if (v !== 'fashion') return [];
    const m = new Map<string, { style: string; name: string; variants: number; stock: number; colors: Set<string>; sizes: Set<string>; mrp: number; category: string; low: number }>();
    filtered.forEach((p) => {
      if (!p.styleCode) return;
      const c = m.get(p.styleCode) ?? { style: p.styleCode, name: p.name, variants: 0, stock: 0, colors: new Set(), sizes: new Set(), mrp: p.mrpPaise, category: L.categories.get(p.categoryId)?.name ?? '', low: 0 };
      c.variants++;
      c.stock += p.stock;
      if (p.health !== 'ok') c.low++;
      if (p.variantAttrs?.color) c.colors.add(p.variantAttrs.color);
      if (p.variantAttrs?.size) c.sizes.add(p.variantAttrs.size);
      m.set(p.styleCode, c);
    });
    return [...m.values()];
  }, [filtered, v, L.categories]);

  const cols: Column<Row>[] = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      render: (p) => (
        <div style={{ minWidth: 200 }}>
          <div className="bo-cell-main">{p.name}{p.variantAttrs ? <span className="muted"> · {p.variantAttrs.color} / {p.variantAttrs.size}</span> : null}</div>
          <div className="bo-cell-sub">
            <span className="num">{p.sku}</span>
            {p.weighted ? <> · PLU {p.plu}</> : null}
            {p.molecule ? <> · {p.molecule}</> : null}
            {p.model ? <> · {p.model}</> : null}
          </div>
        </div>
      ),
    },
    { key: 'barcode', header: 'Barcode', render: (p) => <span className="num muted">{p.barcode}</span> },
    { key: 'category', header: 'Category', sortValue: (p) => L.categories.get(p.categoryId)?.name, sortable: true, render: (p) => L.categories.get(p.categoryId)?.name ?? '—' },
    {
      key: 'tags',
      header: 'Attributes',
      render: (p) => (
        <div className="ex-row" style={{ gap: 4, flexWrap: 'wrap' }}>
          {p.batchTracked ? <Badge>Batch</Badge> : null}
          {p.weighted ? <Badge>Weighed</Badge> : null}
          {p.prescriptionRequired ? <Badge tone="warning">Rx {p.schedule}</Badge> : p.schedule ? <Badge>{p.schedule}</Badge> : null}
          {p.serialTracked ? <Badge tone="info">Serial</Badge> : null}
          {p.warrantyMonths ? <Badge>{p.warrantyMonths}m warranty</Badge> : null}
          {p.variantAttrs?.season ? <Badge>{p.variantAttrs.season}</Badge> : null}
        </div>
      ),
    },
    { key: 'mrpPaise', header: 'MRP', align: 'right', sortable: true, render: (p) => money(p.mrpPaise) },
    { key: 'salePaise', header: 'Sale price', align: 'right', sortable: true, render: (p) => <b>{money(p.salePaise)}</b> },
    { key: 'stock', header: 'Stock', align: 'right', sortable: true, render: (p) => <span className={p.stock <= 0 ? 'bo-neg' : undefined}>{fq(p.stock, p.decimalQty)} <span className="muted">{p.unit}</span></span> },
    { key: 'health', header: 'Stock health', render: (p) => <StatusBadge meta={STOCK_HEALTH[p.health]} /> },
    { key: 'active', header: 'Status', render: (p) => (p.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge icon="CirclePause">Inactive</Badge>) },
  ];

  const active = [
    cat && { k: 'cat', l: `Category: ${L.categories.get(cat)?.name}`, c: () => setCat('') },
    brand && { k: 'brand', l: `Brand: ${L.brands.get(brand)?.name}`, c: () => setBrand('') },
    status && { k: 'status', l: status === 'active' ? 'Active only' : 'Inactive only', c: () => setStatus('') },
    health && { k: 'health', l: health === 'low' ? 'Low or out of stock' : STOCK_HEALTH[health as 'ok'].label, c: () => setHealth('') },
    attr && { k: 'attr', l: attrOptions.find((o) => o.value === attr)?.label ?? attr, c: () => setAttr('') },
    q && { k: 'q', l: `Search: “${q}”`, c: () => setQ('') },
  ].filter(Boolean) as Array<{ k: string; l: string; c: () => void }>;

  const doExport = (kind: 'csv' | 'xls') =>
    downloadTable('products', ['SKU', 'Barcode', 'Name', 'Category', 'Brand', 'HSN', 'MRP', 'Sale price', 'Cost', 'Unit', 'Stock', 'Reorder level', 'Status'], filtered.map((p) => [p.sku, p.barcode, p.name, L.categories.get(p.categoryId)?.name, L.brands.get(p.brandId ?? '')?.name, p.hsn, rupees(p.mrpPaise), rupees(p.salePaise), rupees(p.costPaise), p.unit, p.stock, p.reorderLevel, p.active ? 'Active' : 'Inactive']), kind);

  if (!loading && products.length === 0) {
    return (
      <PageFrame title="Products" crumbs={[{ label: 'Catalog' }, { label: 'Products' }]}>
        <Card>
          <EmptyState icon="Package" title="No products yet" actions={canEdit ? <><Button variant="primary" icon="Plus" onClick={() => nav('/products/new')}>Add Product</Button><Button icon="Upload" onClick={() => setImportOpen(true)}>Bulk Import</Button></> : undefined}>
            Add your first product or import your catalog from a spreadsheet. Products sync to every POS counter automatically.
          </EmptyState>
        </Card>
        <BulkImport open={importOpen} onClose={() => setImportOpen(false)} />
      </PageFrame>
    );
  }

  return (
    <PageFrame
      title="Products"
      description={<>Catalog master — changes publish to all POS devices on next sync · <ScopeHint /></>}
      crumbs={[{ label: 'Catalog' }, { label: 'Products' }]}
      actions={
        <>
          {s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} /> : null}
          {canEdit ? <Button icon="Upload" onClick={() => setImportOpen(true)}>Bulk Import</Button> : null}
          {canEdit ? <Button variant="primary" icon="Plus" onClick={() => nav('/products/new')}>Add Product</Button> : null}
        </>
      }
    >
      <KpiRow>
        <KpiCard label="Active products" icon="Package" value={number(rows.filter((p) => p.active).length)} foot={`${rows.filter((p) => !p.active).length} inactive`} loading={loading} />
        <KpiCard label="Low stock" icon="TriangleAlert" tone="warning" value={number(rows.filter((p) => p.active && p.health === 'low').length)} onClick={() => setHealth('low')} loading={loading} />
        <KpiCard label="Out of stock" icon="CircleX" tone="danger" value={number(rows.filter((p) => p.active && p.health === 'out').length)} onClick={() => setHealth('out')} loading={loading} />
        <KpiCard label="Stock value (cost)" icon="IndianRupee" value={money(rows.reduce((a, p) => a + Math.max(0, p.stock) * p.costPaise, 0), { whole: true })} loading={loading} />
      </KpiRow>
      <Card className="bo-card-table">
        <div className="bo-toolbar">
          {v === 'fashion' ? <Segmented label="View" items={[{ key: 'products', label: 'Variants' }, { key: 'styles', label: 'Styles' }]} value={view} onChange={(k) => setParams((p) => { p.set('view', k); return p; })} /> : null}
          <SearchInput placeholder={v === 'pharmacy' ? 'Search name, molecule, SKU, barcode' : v === 'fashion' ? 'Search name, style, colour, SKU' : 'Search name, SKU, barcode, PLU'} value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <Select size="sm" aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'All categories' }, ...[...L.categories.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ value: c.id, label: c.name }))]} />
          {L.brands.size ? <Select size="sm" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} options={[{ value: '', label: 'All brands' }, ...[...L.brands.values()].map((c) => ({ value: c.id, label: c.name }))]} /> : null}
          <Select size="sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as 'active' | '')} options={[{ value: '', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
          <Select size="sm" aria-label="Stock health" value={health} onChange={(e) => setHealth(e.target.value)} options={[{ value: '', label: 'Any stock' }, { value: 'ok', label: 'In stock' }, { value: 'low', label: 'Low or out' }, { value: 'out', label: 'Out of stock' }]} />
          {attrOptions.length ? <Select size="sm" aria-label="Attribute" value={attr} onChange={(e) => setAttr(e.target.value)} options={[{ value: '', label: 'Any attribute' }, ...attrOptions]} /> : null}
        </div>
        {active.length ? (
          <div className="bo-toolbar-chips">
            {active.map((a) => <FilterChip key={a.k} label={a.l} onRemove={a.c} />)}
            <button type="button" className="ex-btn ex-btn--ghost ex-btn--sm" onClick={() => active.forEach((a) => a.c())}>Clear all</button>
          </div>
        ) : null}
        {view === 'styles' && v === 'fashion' ? (
          <DataTable
            rows={styles}
            rowKey={(r) => r.style}
            loading={loading}
            onRowClick={(r) => nav(`/products/styles/${r.style}`)}
            columns={[
              { key: 'style', header: 'Style', sortable: true, render: (r) => <div><div className="bo-cell-main">{r.name}</div><div className="bo-cell-sub num">{r.style}</div></div> },
              { key: 'category', header: 'Category', render: (r) => r.category },
              { key: 'colors', header: 'Colours', render: (r) => [...r.colors].join(', ') },
              { key: 'sizes', header: 'Sizes', render: (r) => [...r.sizes].join(' · ') },
              { key: 'variants', header: 'Variants', align: 'right', render: (r) => r.variants },
              { key: 'mrp', header: 'MRP', align: 'right', render: (r) => money(r.mrp) },
              { key: 'stock', header: 'Stock', align: 'right', sortable: true, render: (r) => number(r.stock) },
              { key: 'low', header: 'Low variants', align: 'right', render: (r) => (r.low ? <Badge tone="warning">{r.low}</Badge> : <span className="muted">0</span>) },
            ]}
          />
        ) : (
          <DataTable
            columns={cols}
            rows={filtered}
            rowKey={(r) => r.id}
            loading={loading}
            onRowClick={(r) => nav(`/products/${r.id}`)}
            empty={<EmptyState quiet icon="SearchX" title="No products match these filters" actions={<Button size="sm" onClick={() => active.forEach((a) => a.c())}>Clear filters</Button>} />}
          />
        )}
      </Card>
      <BulkImport open={importOpen} onClose={() => setImportOpen(false)} />
    </PageFrame>
  );
}

const SAMPLE = `name,sku,barcode,category,hsn,gst,mrp,sale,cost,unit,reorder
Organic Jaggery 1kg,NEW-0001,8901234500017,Staples,1701,5,95,89,70,pcs,10
Cold Pressed Groundnut Oil 1L,NEW-0002,8901234500024,Staples,1508,5,320,299,240,pcs,8
Masala Peanuts 200g,NEW-0003,8901234500031,Snacks,2008,12,60,65,40,pcs,12`;

function BulkImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const L = useLookups();
  const toast = useToast();
  const [text, setText] = useState(SAMPLE);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => {
    const rows = parseCsv(text);
    const [head, ...body] = rows;
    const idx = (k: string) => head?.findIndex((h) => h.trim().toLowerCase() === k) ?? -1;
    const existing = new Set([...L.products.values()].flatMap((p) => [p.sku.toLowerCase(), p.barcode]));
    return body.map((r, i) => {
      const g = (k: string) => (idx(k) >= 0 ? (r[idx(k)] ?? '').trim() : '');
      const errors: string[] = [];
      const mrp = rupeesToPaise(g('mrp'));
      const sale = rupeesToPaise(g('sale'));
      const cat = [...L.categories.values()].find((c) => c.name.toLowerCase() === g('category').toLowerCase());
      if (!g('name')) errors.push('Name is required');
      if (!g('sku')) errors.push('SKU is required');
      if (existing.has(g('sku').toLowerCase()) || existing.has(g('barcode'))) errors.push('SKU/barcode already exists');
      if (!cat) errors.push(`Unknown category “${g('category')}”`);
      if (sale > mrp) errors.push(`Selling price cannot exceed MRP ${money(mrp)}`);
      if (!['0', '5', '12', '18', '28'].includes(g('gst'))) errors.push('GST must be 0/5/12/18/28');
      return { line: i + 2, name: g('name'), sku: g('sku'), barcode: g('barcode'), category: cat, hsn: g('hsn'), gst: g('gst'), mrp, sale, cost: rupeesToPaise(g('cost')), unit: (g('unit') || 'pcs') as Product['unit'], reorder: Number(g('reorder')) || 10, errors };
    });
  }, [text, L.products, L.categories]);
  const valid = parsed.filter((r) => !r.errors.length);

  const run = async () => {
    setBusy(true);
    for (const r of valid) {
      const p: Product = { id: `p-${s.tenant.id}-${uid().slice(-8)}`, tenantId: s.tenant.id, sku: r.sku, barcode: r.barcode || r.sku, name: r.name, categoryId: r.category!.id, hsn: r.hsn, taxRateId: `gst${r.gst}`, taxInclusive: true, mrpPaise: r.mrp, salePaise: r.sale, costPaise: r.cost, unit: r.unit, decimalQty: false, active: true, reorderLevel: r.reorder };
      await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'products', entity: p, summary: `Product ${p.name} imported`, actorId: s.user.id, action: 'product.created', entityName: 'product' });
    }
    setBusy(false);
    toast.success(`${valid.length} product(s) imported`, 'Published to POS devices on next sync');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Bulk import products" description="Paste CSV with a header row. Rows are validated before anything is created."
      footer={<><span className="muted" style={{ fontSize: 13 }}>{valid.length} valid · {parsed.length - valid.length} with errors</span><div className="ex-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Upload" loading={busy} disabled={!valid.length} onClick={() => void run()}>Import {valid.length} product(s)</Button></>}>
      <div className="ex-stack">
        <Textarea label="CSV data" rows={6} value={text} onChange={(e) => setText(e.target.value)} hint="Columns: name, sku, barcode, category, hsn, gst, mrp, sale, cost, unit, reorder" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
        {parsed.some((r) => r.errors.length) ? <InlineAlert tone="warning" title="Some rows will be skipped">Fix the highlighted rows in your sheet and paste again, or import only the valid rows.</InlineAlert> : null}
        <DataTable
          density="dense"
          rows={parsed}
          rowKey={(r) => String(r.line)}
          columns={[
            { key: 'line', header: 'Row', render: (r) => <span className="muted num">{r.line}</span> },
            { key: 'name', header: 'Name', render: (r) => r.name || '—' },
            { key: 'sku', header: 'SKU', render: (r) => <span className="num">{r.sku}</span> },
            { key: 'cat', header: 'Category', render: (r) => r.category?.name ?? '—' },
            { key: 'mrp', header: 'MRP', align: 'right', render: (r) => money(r.mrp) },
            { key: 'sale', header: 'Sale', align: 'right', render: (r) => money(r.sale) },
            { key: 'st', header: 'Check', render: (r) => (r.errors.length ? <Badge tone="danger" icon="CircleAlert">{r.errors[0]}</Badge> : <Badge tone="success" icon="CircleCheck">Ready</Badge>) },
          ]}
        />
      </div>
    </Modal>
  );
}
