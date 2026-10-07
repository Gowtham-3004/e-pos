import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Product, Unit, UomConversion } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, Checkbox, ConfirmDialog, DataTable, EmptyState, IconButton, InlineAlert, Select, StatusBadge, Switch, TextField, useToast } from '@elixir/ui';
import { batchesFor } from '@elixir/local-store';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, daysUntil, money, paiseToRupeesInput, rupeesToPaise, qty as fq } from '@elixir/format';
import { expiryHealth } from '@elixir/domain';
import { auditFor } from '@elixir/local-store';
import { FormSection, NotFound, PageFrame } from '../../components/common';
import { useCloud, useLookups } from '../../lib/data';
import { EXPIRY_HEALTH, onHandIn, STOCK_HEALTH, healthOf } from '../../lib/stock';
import { saveMaster } from '../../lib/ops';
import { useSession } from '../../lib/session';
import { VariantMatrix } from './StyleMatrix';

const UNITS: Unit[] = ['pcs', 'kg', 'g', 'l', 'ml', 'box', 'pack', 'm', 'bag', 'strip'];

interface FormState {
  name: string;
  localName: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  rack: string;
  hsn: string;
  taxRateId: string;
  taxInclusive: boolean;
  mrp: string;
  sale: string;
  wholesale: string;
  cost: string;
  unit: Unit;
  decimalQty: boolean;
  reorderLevel: string;
  openingStock: string;
  batchTracked: boolean;
  weighted: boolean;
  plu: string;
  styleCode: string;
  size: string;
  color: string;
  season: string;
  manufacturer: string;
  molecule: string;
  schedule: '' | 'H' | 'H1' | 'X' | 'OTC';
  prescriptionRequired: boolean;
  model: string;
  warrantyMonths: string;
  serialTracked: boolean;
  uoms: UomConversion[];
}

function toForm(p?: Product): FormState {
  return {
    name: p?.name ?? '',
    localName: p?.localName ?? '',
    sku: p?.sku ?? '',
    barcode: p?.barcode ?? '',
    categoryId: p?.categoryId ?? '',
    brandId: p?.brandId ?? '',
    rack: p?.rack ?? '',
    hsn: p?.hsn ?? '',
    taxRateId: p?.taxRateId ?? 'gst5',
    taxInclusive: p?.taxInclusive ?? true,
    mrp: p ? paiseToRupeesInput(p.mrpPaise) : '',
    sale: p ? paiseToRupeesInput(p.salePaise) : '',
    wholesale: p?.wholesalePaise ? paiseToRupeesInput(p.wholesalePaise) : '',
    cost: p ? paiseToRupeesInput(p.costPaise) : '',
    unit: p?.unit ?? 'pcs',
    decimalQty: p?.decimalQty ?? false,
    reorderLevel: String(p?.reorderLevel ?? 10),
    openingStock: '',
    batchTracked: !!p?.batchTracked,
    weighted: !!p?.weighted,
    plu: p?.plu ?? '',
    styleCode: p?.styleCode ?? '',
    size: p?.variantAttrs?.size ?? '',
    color: p?.variantAttrs?.color ?? '',
    season: p?.variantAttrs?.season ?? '',
    manufacturer: p?.manufacturer ?? '',
    molecule: p?.molecule ?? '',
    schedule: p?.schedule ?? '',
    prescriptionRequired: !!p?.prescriptionRequired,
    model: p?.model ?? '',
    warrantyMonths: p?.warrantyMonths != null ? String(p.warrantyMonths) : '',
    serialTracked: !!p?.serialTracked,
    uoms: p?.uomConversions ?? [],
  };
}

export function ProductForm() {
  const { id } = useParams();
  return <ProductFormInner key={id ?? 'new'} id={id} />;
}

function ProductFormInner({ id }: { id?: string }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const L = useLookups();
  const existing = useEntity(cloud, 'products', id);
  const isNew = !id;
  const [f, setF] = useState<FormState>(() => toForm(existing));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDeact, setConfirmDeact] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const canEdit = s.can('catalog.edit');
  const v = s.tenant.vertical;
  const has = s.has;

  const stockByStore = useLive(cloud, ['stockMovements'], () => (existing ? s.stores.map((st) => ({ store: st, qty: onHandIn(cloud, [st.id], existing.id) })) : []), [existing?.id]);
  const batches = useLive(cloud, ['batches', 'stockMovements'], () => (existing ? batchesFor(cloud, existing.id).map((b) => ({ ...b, qty: onHandIn(cloud, s.scope, existing.id, b.id) })) : []), [existing?.id, s.scope.join(',')]);
  const serials = useLive(cloud, ['serials'], () => (existing ? cloud.where('serials', (x) => x.productId === existing.id) : []), [existing?.id]);

  if (!isNew && (!existing || existing.tenantId !== s.tenant.id)) return <NotFound what="Product" back={{ label: 'Back to products', to: '/products' }} />;

  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => {
    setF((x) => ({ ...x, [k]: val }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const mrpP = rupeesToPaise(f.mrp);
  const saleP = rupeesToPaise(f.sale);
  const costP = rupeesToPaise(f.cost);
  const marginPct = saleP ? ((saleP - costP) / saleP) * 100 : 0;
  const liveSaleError = f.mrp && f.sale && saleP > mrpP ? `Selling price cannot exceed MRP ${money(mrpP)}.` : undefined;

  const validate = () => {
    const e: Partial<Record<keyof FormState, string>> = {};
    const others = [...L.products.values()].filter((p) => p.id !== existing?.id);
    if (!f.name.trim()) e.name = 'Enter the product name as it should appear on the bill.';
    if (!f.sku.trim()) e.sku = 'Enter a SKU / item code.';
    else if (others.some((p) => p.sku.toLowerCase() === f.sku.trim().toLowerCase())) e.sku = 'This SKU is already used by another product. Use a unique code.';
    if (!f.barcode.trim()) e.barcode = 'Enter or generate a barcode so the item can be scanned.';
    else if (others.some((p) => p.barcode === f.barcode.trim())) e.barcode = `Barcode already assigned to “${others.find((p) => p.barcode === f.barcode.trim())!.name}”.`;
    if (!f.categoryId) e.categoryId = 'Choose a category.';
    if (!/^\d{4,8}$/.test(f.hsn.trim())) e.hsn = 'HSN must be 4–8 digits (e.g. 0401).';
    if (!(mrpP > 0)) e.mrp = 'Enter the MRP printed on the pack.';
    if (!(saleP > 0)) e.sale = 'Enter a selling price.';
    else if (saleP > mrpP) e.sale = `Selling price cannot exceed MRP ${money(mrpP)}.`;
    if (f.wholesale && rupeesToPaise(f.wholesale) > mrpP) e.wholesale = `Wholesale price cannot exceed MRP ${money(mrpP)}.`;
    if (!(costP >= 0) || f.cost === '') e.cost = 'Enter the purchase cost (used for margin and stock value).';
    if (!/^\d+$/.test(f.reorderLevel)) e.reorderLevel = 'Reorder level must be a whole number.';
    if (f.openingStock && !(Number(f.openingStock) >= 0)) e.openingStock = 'Opening stock must be zero or more.';
    if (f.weighted && !/^\d{4,5}$/.test(f.plu)) e.plu = 'Weighed items need a 4–5 digit PLU for the scale.';
    if (v === 'fashion' && has('variants') && f.styleCode && (!f.size || !f.color)) {
      if (!f.size) e.size = 'Size is required for a style variant.';
      if (!f.color) e.color = 'Colour is required for a style variant.';
    }
    if (v === 'pharmacy' && !f.schedule) e.schedule = 'Choose the drug schedule (OTC if none).';
    return e;
  };

  const save = async () => {
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      setTimeout(() => formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(), 0);
      toast.error('Check the highlighted fields', `${Object.keys(e).length} field(s) need attention`);
      return;
    }
    setBusy(true);
    const p: Product = {
      ...(existing ?? { id: `p-${s.tenant.id}-${uid().slice(-8)}`, tenantId: s.tenant.id, active: true }),
      name: f.name.trim(),
      localName: f.localName.trim() || undefined,
      sku: f.sku.trim(),
      barcode: f.barcode.trim(),
      categoryId: f.categoryId,
      brandId: f.brandId || undefined,
      rack: f.rack || undefined,
      hsn: f.hsn.trim(),
      taxRateId: f.taxRateId,
      taxInclusive: f.taxInclusive,
      mrpPaise: mrpP,
      salePaise: saleP,
      wholesalePaise: f.wholesale ? rupeesToPaise(f.wholesale) : undefined,
      costPaise: costP,
      unit: f.unit,
      decimalQty: f.decimalQty || f.weighted,
      reorderLevel: Number(f.reorderLevel),
      batchTracked: f.batchTracked || undefined,
      weighted: f.weighted || undefined,
      plu: f.weighted ? f.plu : undefined,
      styleCode: f.styleCode || undefined,
      variantAttrs: f.size || f.color || f.season ? { size: f.size || undefined, color: f.color || undefined, season: f.season || undefined } : undefined,
      manufacturer: f.manufacturer || undefined,
      molecule: f.molecule || undefined,
      schedule: f.schedule || undefined,
      prescriptionRequired: f.prescriptionRequired || undefined,
      model: f.model || undefined,
      warrantyMonths: f.warrantyMonths ? Number(f.warrantyMonths) : undefined,
      serialTracked: f.serialTracked || undefined,
      uomConversions: f.uoms.length ? f.uoms : undefined,
    } as Product;
    const priceChanged = existing && (existing.salePaise !== p.salePaise || existing.mrpPaise !== p.mrpPaise);
    await saveMaster(cloud, {
      tenantId: s.tenant.id,
      collection: 'products',
      entity: p,
      summary: isNew ? `Product ${p.name} created` : priceChanged ? `Price change ${p.name}: ${money(existing!.salePaise)} → ${money(p.salePaise)} (MRP ${money(p.mrpPaise)})` : `Product ${p.name} updated`,
      actorId: s.user.id,
      action: isNew ? 'product.created' : priceChanged ? 'product.price.changed' : 'product.updated',
      entityName: 'product',
      before: existing,
    });
    if (isNew && Number(f.openingStock) > 0 && s.stores[0]) {
      const storeId = s.storeId !== 'all' ? s.storeId : s.stores[0].id;
      await cloud.commit([
        { collection: 'stockMovements', put: [{ id: uid('mv'), tenantId: s.tenant.id, storeId, productId: p.id, type: 'opening', qty: Number(f.openingStock), sourceType: 'opening', sourceId: p.id, userId: s.user.id, createdAt: new Date().toISOString() }] },
        { collection: 'auditEvents', put: [auditFor({ tenantId: s.tenant.id, storeId, actorId: s.user.id, action: 'stock.opening', entity: 'product', entityId: p.id, summary: `Opening stock ${f.openingStock} ${p.unit} for ${p.name}` })] },
      ]);
    }
    setBusy(false);
    toast.success(isNew ? 'Product created' : 'Product saved', 'Published to POS devices — counters pick it up on next sync');
    if (isNew) nav(`/products/${p.id}`, { replace: true });
  };

  const setActive = async (active: boolean, reason?: string) => {
    if (!existing) return;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'products', entity: { ...existing, active }, summary: `Product ${existing.name} ${active ? 'reactivated' : 'deactivated'}`, actorId: s.user.id, action: active ? 'product.reactivated' : 'product.deactivated', entityName: 'product', before: existing, reason });
    setConfirmDeact(false);
    toast.success(active ? 'Product reactivated' : 'Product deactivated', active ? 'Available for billing again' : 'Hidden from POS search; history is kept');
  };

  const totalStock = stockByStore.reduce((a, x) => a + x.qty, 0);
  const err = (k: keyof FormState) => errors[k];
  const gen = () => set('barcode', `890${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 10)}`);

  return (
    <PageFrame
      crumbs={[{ label: 'Products', to: '/products' }, { label: isNew ? 'New product' : existing!.name }]}
      title={isNew ? 'New product' : existing!.name}
      meta={!isNew ? (existing!.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge icon="CirclePause">Inactive</Badge>) : undefined}
      description={isNew ? 'Create a catalog item. It syncs to every POS counter.' : <span className="num">{existing!.sku} · {existing!.barcode}</span>}
      actions={
        !isNew && canEdit ? (
          <>
            {existing!.styleCode ? <Button icon="Grid3x3" onClick={() => nav(`/products/styles/${existing!.styleCode}`)}>Style matrix</Button> : null}
            {s.has('inventory') ? <Button icon="History" onClick={() => nav(`/inventory/ledger/${existing!.id}`)}>Stock ledger</Button> : null}
            {existing!.active ? <Button variant="danger-outline" icon="CirclePause" onClick={() => setConfirmDeact(true)}>Deactivate</Button> : <Button icon="CirclePlay" onClick={() => void setActive(true)}>Reactivate</Button>}
          </>
        ) : undefined
      }
    >
      {!canEdit ? <InlineAlert tone="info" title="Read-only">Your role can view the catalog but not edit it.</InlineAlert> : null}
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="bo-form-layout">
            <div className="ex-stack" style={{ gap: 16 }}>
              <FormSection title="Basic" icon="Package">
                <div className="bo-span-2"><TextField name="name" label="Product name" required value={f.name} onChange={(e) => set('name', e.target.value)} error={err('name')} /></div>
                <TextField name="localName" label="Local name" hint="Shown on Tamil/regional receipts" value={f.localName} onChange={(e) => set('localName', e.target.value)} />
                <TextField name="sku" label="SKU / item code" required value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} error={err('sku')} />
                <Select name="unit" label="Base unit" value={f.unit} onChange={(e) => set('unit', e.target.value as Unit)} options={UNITS.map((u) => ({ value: u, label: u }))} />
                <div className="ex-field" style={{ justifyContent: 'flex-end' }}>
                  <Checkbox label="Allow decimal quantity (loose / weighed)" checked={f.decimalQty || f.weighted} disabled={f.weighted} onChange={(e) => set('decimalQty', e.target.checked)} />
                </div>
              </FormSection>

              <FormSection title="Classification" icon="Tags">
                <Select name="categoryId" label="Category" required placeholder="Choose category" value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} error={err('categoryId')} options={[...L.categories.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ value: c.id, label: c.name }))} />
                <Select name="brandId" label={v === 'pharmacy' ? 'Brand (optional)' : 'Brand'} placeholder="No brand" value={f.brandId} onChange={(e) => set('brandId', e.target.value)} options={[...L.brands.values()].map((b) => ({ value: b.id, label: b.name }))} />
                <TextField name="rack" label="Rack / shelf" hint="Helps pickers and stock takes" value={f.rack} onChange={(e) => set('rack', e.target.value.toUpperCase())} />
              </FormSection>

              <FormSection title="Barcode" icon="Barcode">
                <TextField name="barcode" label="Primary barcode (EAN/UPC)" required value={f.barcode} onChange={(e) => set('barcode', e.target.value.trim())} error={err('barcode')} suffix={canEdit ? <button type="button" className="bo-link" onClick={gen} style={{ fontSize: 12 }}>Generate</button> : undefined} />
                <div className="ex-field">
                  <span className="ex-label">Scan check</span>
                  <span className="ex-hint">{f.barcode.length === 13 ? 'EAN-13 length ✓' : f.barcode ? `${f.barcode.length} digits — scanners accept any code, EAN-13 recommended` : 'Scanned at POS to add the item instantly.'}</span>
                </div>
              </FormSection>

              <FormSection title="Tax & Pricing" icon="IndianRupee" subtitle="Prices are tax-inclusive as printed (Indian retail norm)">
                <TextField name="hsn" label="HSN code" required value={f.hsn} onChange={(e) => set('hsn', e.target.value.replace(/\D/g, ''))} error={err('hsn')} inputMode="numeric" />
                <Select name="taxRateId" label="GST rate" value={f.taxRateId} onChange={(e) => set('taxRateId', e.target.value)} options={[...L.taxRates.values()].map((t) => ({ value: t.id, label: t.name }))} />
                <TextField name="mrp" label="MRP" required prefix="₹" inputMode="decimal" value={f.mrp} onChange={(e) => set('mrp', e.target.value)} error={err('mrp')} className="num" />
                <TextField name="sale" label="Selling price" required prefix="₹" inputMode="decimal" value={f.sale} onChange={(e) => set('sale', e.target.value)} error={err('sale') ?? liveSaleError} hint={saleP && mrpP && saleP < mrpP ? `Customer saves ${money(mrpP - saleP)} vs MRP` : undefined} className="num" />
                <TextField name="cost" label="Purchase cost" required prefix="₹" inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} error={err('cost')} hint={saleP && f.cost ? `Margin ${marginPct.toFixed(1)}% on selling price${costP > saleP ? ' — selling below cost' : ''}` : undefined} className="num" />
                <TextField name="wholesale" label="Wholesale price" prefix="₹" inputMode="decimal" value={f.wholesale} onChange={(e) => set('wholesale', e.target.value)} error={err('wholesale')} hint="Optional — used for wholesale price mode" className="num" />
                <div className="ex-field bo-span-2">
                  <Checkbox label="Prices include GST" checked={f.taxInclusive} onChange={(e) => set('taxInclusive', e.target.checked)} />
                </div>
              </FormSection>

              <FormSection title="Inventory" icon="Boxes">
                <TextField name="reorderLevel" label="Reorder level" inputMode="numeric" value={f.reorderLevel} onChange={(e) => set('reorderLevel', e.target.value)} error={err('reorderLevel')} hint="Low-stock alert when on hand falls to this level" />
                {isNew ? (
                  <TextField name="openingStock" label="Opening stock" inputMode="decimal" value={f.openingStock} onChange={(e) => set('openingStock', e.target.value)} error={err('openingStock')} hint={`Posted as an Opening movement in ${s.storeId !== 'all' ? s.storeName(s.storeId) : s.stores[0]?.name}`} />
                ) : (
                  <div className="bo-span-2">
                    <DataTable
                      density="dense"
                      rows={stockByStore}
                      rowKey={(r) => r.store.id}
                      columns={[
                        { key: 'store', header: 'Store', render: (r) => r.store.name },
                        { key: 'qty', header: 'On hand', align: 'right', render: (r) => `${fq(r.qty, existing!.decimalQty)} ${existing!.unit}` },
                        { key: 'h', header: 'Health', render: (r) => <StatusBadge meta={STOCK_HEALTH[healthOf(r.qty, existing!.reorderLevel)]} /> },
                      ]}
                      footer={<div className="bo-tfoot"><span>Total <b>{fq(totalStock, existing!.decimalQty)} {existing!.unit}</b></span><span className="muted">Stock changes only via purchases, sales, adjustments and transfers</span></div>}
                    />
                  </div>
                )}
              </FormSection>

              {has('batch-expiry') ? (
                <FormSection title="Batch & Expiry" icon="CalendarClock" cols={1}>
                  <Switch label="Track batches and expiry for this product (FEFO at POS)" checked={f.batchTracked} onChange={(val) => set('batchTracked', val)} />
                  {!isNew && f.batchTracked ? (
                    batches.length ? (
                      <DataTable
                        density="dense"
                        rows={batches}
                        rowKey={(b) => b.id}
                        columns={[
                          { key: 'code', header: 'Batch', render: (b) => <span className="bo-cell-main num">{b.code}</span> },
                          { key: 'mfg', header: 'Mfg', render: (b) => (b.mfgDate ? date(b.mfgDate) : '—') },
                          { key: 'exp', header: 'Expiry', render: (b) => <span className="num">{date(b.expiryDate)} <span className="muted">({daysUntil(b.expiryDate)}d)</span></span> },
                          { key: 'h', header: 'Status', render: (b) => <StatusBadge meta={EXPIRY_HEALTH[expiryHealth(b.expiryDate, 60)]} /> },
                          { key: 'mrp', header: 'MRP', align: 'right', render: (b) => money(b.mrpPaise) },
                          { key: 'qty', header: 'On hand', align: 'right', render: (b) => fq(b.qty) },
                        ]}
                      />
                    ) : (
                      <EmptyState quiet icon="CalendarClock" title="No batches yet">Batches are created when a purchase with batch number and expiry is posted.</EmptyState>
                    )
                  ) : null}
                </FormSection>
              ) : null}

              {has('multi-uom') ? (
                <FormSection title="Units" icon="Ruler" cols={1} actions={canEdit ? <Button size="sm" icon="Plus" onClick={() => set('uoms', [...f.uoms, { unit: 'box', factor: 12, pricePaise: saleP * 12 }])}>Add unit</Button> : undefined}>
                  {f.uoms.length ? f.uoms.map((u, i) => (
                    <div key={i} className="bo-form-grid bo-form-grid--3" style={{ alignItems: 'end' }}>
                      <Select label="Unit" value={u.unit} onChange={(e) => set('uoms', f.uoms.map((x, j) => (j === i ? { ...x, unit: e.target.value as Unit } : x)))} options={UNITS.map((x) => ({ value: x, label: x }))} />
                      <TextField label={`Contains (${f.unit})`} inputMode="numeric" value={String(u.factor)} onChange={(e) => set('uoms', f.uoms.map((x, j) => (j === i ? { ...x, factor: Number(e.target.value) || 1 } : x)))} />
                      <div className="ex-row" style={{ alignItems: 'end' }}>
                        <TextField label="Price" prefix="₹" value={paiseToRupeesInput(u.pricePaise)} onChange={(e) => set('uoms', f.uoms.map((x, j) => (j === i ? { ...x, pricePaise: rupeesToPaise(e.target.value) } : x)))} />
                        <IconButton icon="Trash2" label="Remove unit" onClick={() => set('uoms', f.uoms.filter((_, j) => j !== i))} />
                      </div>
                    </div>
                  )) : <span className="muted">Sold in {f.unit} only. Add a box/pack unit to sell in multiples.</span>}
                </FormSection>
              ) : null}

              {v === 'grocery' ? (
                <FormSection title="Vertical attributes · Grocery" icon="Weight">
                  <div className="ex-field bo-span-2"><Switch label="Weighed / loose item (sold by weight via scale)" checked={f.weighted} onChange={(val) => set('weighted', val)} /></div>
                  {f.weighted ? <TextField name="plu" label="Scale PLU" required inputMode="numeric" value={f.plu} onChange={(e) => set('plu', e.target.value.replace(/\D/g, ''))} error={err('plu')} hint="Scale barcode = 2 + PLU + weight" /> : null}
                </FormSection>
              ) : null}

              {v === 'fashion' ? (
                <FormSection title="Vertical attributes · Fashion" icon="Shirt" cols={2}>
                  <TextField name="styleCode" label="Style code" hint="Variants of a style share this code" value={f.styleCode} onChange={(e) => set('styleCode', e.target.value.toUpperCase())} />
                  <TextField name="season" label="Season" value={f.season} onChange={(e) => set('season', e.target.value)} />
                  <TextField name="color" label="Colour" value={f.color} onChange={(e) => set('color', e.target.value)} error={err('color')} />
                  <TextField name="size" label="Size" value={f.size} onChange={(e) => set('size', e.target.value.toUpperCase())} error={err('size')} />
                  {!isNew && existing!.styleCode ? (
                    <div className="bo-span-all">
                      <div className="ex-label" style={{ marginBottom: 6 }}>Variant matrix · {existing!.styleCode} (stock, current store scope)</div>
                      <VariantMatrix styleCode={existing!.styleCode} highlightId={existing!.id} />
                    </div>
                  ) : null}
                </FormSection>
              ) : null}

              {v === 'pharmacy' ? (
                <FormSection title="Vertical attributes · Pharmacy" icon="Pill">
                  <TextField name="manufacturer" label="Manufacturer" value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
                  <TextField name="molecule" label="Molecule / composition" hint="Searchable at POS for substitutes" value={f.molecule} onChange={(e) => set('molecule', e.target.value)} />
                  <Select name="schedule" label="Drug schedule" required placeholder="Choose schedule" value={f.schedule} onChange={(e) => { const sc = e.target.value as FormState['schedule']; set('schedule', sc); set('prescriptionRequired', sc === 'H' || sc === 'H1' || sc === 'X'); }} error={err('schedule')} options={[{ value: 'OTC', label: 'OTC (no prescription)' }, { value: 'H', label: 'Schedule H' }, { value: 'H1', label: 'Schedule H1' }, { value: 'X', label: 'Schedule X' }]} />
                  <div className="ex-field" style={{ justifyContent: 'flex-end' }}>
                    <Checkbox label="Prescription required at POS (Rx)" checked={f.prescriptionRequired} onChange={(e) => set('prescriptionRequired', e.target.checked)} />
                  </div>
                </FormSection>
              ) : null}

              {v === 'electronics' ? (
                <FormSection title="Vertical attributes · Electronics" icon="Smartphone">
                  <TextField name="model" label="Model number" value={f.model} onChange={(e) => set('model', e.target.value)} />
                  {has('warranty') ? <TextField name="warrantyMonths" label="Warranty (months)" inputMode="numeric" value={f.warrantyMonths} onChange={(e) => set('warrantyMonths', e.target.value.replace(/\D/g, ''))} /> : null}
                  {has('serial-tracking') ? <div className="ex-field bo-span-2"><Switch label="Serial / IMEI tracked (scan serial at sale)" checked={f.serialTracked} onChange={(val) => set('serialTracked', val)} /></div> : null}
                  {!isNew && f.serialTracked ? (
                    <div className="bo-span-all">
                      <DataTable
                        density="dense"
                        rows={serials}
                        rowKey={(x) => x.id}
                        empty={<EmptyState quiet title="No serials registered" />}
                        columns={[
                          { key: 'serial', header: 'Serial / IMEI', render: (x) => <span className="num bo-cell-main">{x.serial}</span> },
                          { key: 'status', header: 'Status', render: (x) => <Badge tone={x.status === 'in-stock' ? 'success' : x.status === 'sold' ? 'neutral' : 'warning'} icon={x.status === 'in-stock' ? 'PackageCheck' : x.status === 'sold' ? 'Receipt' : 'Undo2'}>{x.status === 'in-stock' ? 'In stock' : x.status === 'sold' ? 'Sold' : 'Returned'}</Badge> },
                          { key: 'sale', header: 'Invoice', render: (x) => (x.saleId ? <button type="button" className="bo-link" onClick={() => nav(`/sales/${x.saleId}`)}>{cloud.get('sales', x.saleId)?.documentNo ?? 'View'}</button> : '—') },
                        ]}
                      />
                    </div>
                  ) : null}
                </FormSection>
              ) : null}
            </div>

            <aside className="bo-form-aside">
              <Card>
                <CardHeader title="Summary" />
                <div style={{ padding: 16 }} className="ex-stack">
                  <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">MRP</span><span className="num">{mrpP ? money(mrpP) : '—'}</span></div>
                  <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">Selling</span><b className="num">{saleP ? money(saleP) : '—'}</b></div>
                  <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">Margin</span><span className={`num ${marginPct < 0 ? 'bo-neg' : ''}`}>{saleP && f.cost ? `${marginPct.toFixed(1)}%` : '—'}</span></div>
                  <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">GST</span><span>{L.taxRates.get(f.taxRateId)?.name}</span></div>
                  {!isNew ? <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">On hand</span><span className="num">{fq(totalStock, existing!.decimalQty)} {existing!.unit}</span></div> : null}
                </div>
              </Card>
              {canEdit ? (
                <div className="ex-stack" style={{ gap: 8 }}>
                  <Button type="submit" variant="primary" icon="Save" block loading={busy}>{isNew ? 'Create product' : 'Save changes'}</Button>
                  <Button block onClick={() => nav('/products')}>Cancel</Button>
                  <span className="ex-hint">Saved changes publish to POS devices through the cloud change feed.</span>
                </div>
              ) : null}
            </aside>
          </div>
        </fieldset>
      </form>
      <ConfirmDialog open={confirmDeact} onClose={() => setConfirmDeact(false)} title={`Deactivate ${existing?.name}?`} confirmLabel="Deactivate product" requireReason onConfirm={(r) => setActive(false, r)}>
        The product is hidden from POS search and new purchases. Sales history, stock ledger and reports are kept. You can reactivate it later.
      </ConfirmDialog>
    </PageFrame>
  );
}
