import { useState } from 'react';
import type { Brand, Category } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Button, Card, DataTable, EmptyState, Modal, Tabs, TextField, useToast, IconButton } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { number } from '@elixir/format';
import { PageFrame, useFirstPaint } from '../components/common';
import { useCloud } from '../lib/data';
import { saveMaster } from '../lib/ops';
import { useSession } from '../lib/session';

const PALETTE = ['#e8590c', '#2b8a3e', '#1971c2', '#ae3ec9', '#c2255c', '#0c8599', '#5f3dc4', '#e67700', '#495057'];

export function Categories() {
  const s = useSession();
  const cloud = useCloud();
  const loading = useFirstPaint();
  const isRest = s.family === 'restaurant';
  const [tab, setTab] = useState<'categories' | 'brands'>('categories');
  const [editCat, setEditCat] = useState<Category | 'new'>();
  const [editBrand, setEditBrand] = useState<Brand | 'new'>();
  const canEdit = s.can('catalog.edit');
  const data = useLive(cloud, ['categories', 'brands', 'products', 'menuItems'], () => {
    const cats = cloud.where('categories', (c) => c.tenantId === s.tenant.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const brands = cloud.where('brands', (c) => c.tenantId === s.tenant.id).sort((a, b) => a.name.localeCompare(b.name));
    const items = isRest ? cloud.where('menuItems', (m) => m.tenantId === s.tenant.id) : cloud.where('products', (p) => p.tenantId === s.tenant.id);
    const catCount = new Map<string, number>();
    items.forEach((i) => catCount.set(i.categoryId, (catCount.get(i.categoryId) ?? 0) + 1));
    const brandCount = new Map<string, number>();
    if (!isRest) cloud.where('products', (p) => p.tenantId === s.tenant.id).forEach((p) => p.brandId && brandCount.set(p.brandId, (brandCount.get(p.brandId) ?? 0) + 1));
    return { cats, brands, catCount, brandCount };
  }, [s.tenant.id, isRest]);

  const move = async (c: Category, dir: -1 | 1) => {
    const i = data.cats.findIndex((x) => x.id === c.id);
    const other = data.cats[i + dir];
    if (!other) return;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'categories', entity: { ...c, sortOrder: other.sortOrder }, summary: `Category ${c.name} reordered`, actorId: s.user.id, action: 'category.reordered', entityName: 'category' });
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'categories', entity: { ...other, sortOrder: c.sortOrder }, summary: `Category ${other.name} reordered`, actorId: s.user.id, action: 'category.reordered', entityName: 'category' });
  };

  return (
    <PageFrame
      title={isRest ? 'Menu categories' : 'Categories & brands'}
      description="Category order controls the POS category chips and menu sequence."
      crumbs={[{ label: 'Catalog' }, { label: 'Categories' }]}
      actions={canEdit ? <Button variant="primary" icon="Plus" onClick={() => (tab === 'categories' ? setEditCat('new') : setEditBrand('new'))}>{tab === 'categories' ? 'Add category' : 'Add brand'}</Button> : undefined}
    >
      {!isRest ? <Tabs items={[{ key: 'categories', label: 'Categories', count: data.cats.length }, { key: 'brands', label: 'Brands', count: data.brands.length }]} value={tab} onChange={setTab} /> : null}
      <Card className="bo-card-table">
        {tab === 'categories' ? (
          <DataTable
            loading={loading}
            rows={data.cats}
            rowKey={(c) => c.id}
            onRowClick={canEdit ? (c) => setEditCat(c) : undefined}
            empty={<EmptyState icon="Tags" title="No categories yet" actions={canEdit ? <Button variant="primary" onClick={() => setEditCat('new')}>Add category</Button> : undefined}>Categories group items on the POS and in reports.</EmptyState>}
            columns={[
              { key: 'order', header: 'Order', width: 90, render: (c) => (
                <div className="ex-row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <IconButton size="sm" icon="ChevronUp" label={`Move ${c.name} up`} disabled={!canEdit || data.cats[0]?.id === c.id} onClick={() => void move(c, -1)} />
                  <IconButton size="sm" icon="ChevronDown" label={`Move ${c.name} down`} disabled={!canEdit || data.cats[data.cats.length - 1]?.id === c.id} onClick={() => void move(c, 1)} />
                </div>
              ) },
              { key: 'name', header: 'Category', render: (c) => <span className="bo-cell-main"><span className="bo-swatch" style={{ background: c.color }} />{c.name}</span> },
              { key: 'count', header: isRest ? 'Menu items' : 'Products', align: 'right', render: (c) => number(data.catCount.get(c.id) ?? 0) },
            ]}
          />
        ) : (
          <DataTable
            loading={loading}
            rows={data.brands}
            rowKey={(b) => b.id}
            onRowClick={canEdit ? (b) => setEditBrand(b) : undefined}
            empty={<EmptyState quiet icon="Tag" title="No brands">Brands are optional and help filtering and reports.</EmptyState>}
            columns={[
              { key: 'name', header: 'Brand', render: (b) => <span className="bo-cell-main">{b.name}</span> },
              { key: 'count', header: 'Products', align: 'right', render: (b) => number(data.brandCount.get(b.id) ?? 0) },
            ]}
          />
        )}
      </Card>
      {editCat ? <CategoryModal cat={editCat === 'new' ? undefined : editCat} nextOrder={data.cats.length} existing={data.cats} onClose={() => setEditCat(undefined)} /> : null}
      {editBrand ? <BrandModal brand={editBrand === 'new' ? undefined : editBrand} existing={data.brands} onClose={() => setEditBrand(undefined)} /> : null}
    </PageFrame>
  );
}

function CategoryModal({ cat, nextOrder, existing, onClose }: { cat?: Category; nextOrder: number; existing: Category[]; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [name, setName] = useState(cat?.name ?? '');
  const [color, setColor] = useState(cat?.color ?? PALETTE[nextOrder % PALETTE.length]!);
  const [err, setErr] = useState<string>();
  const save = async () => {
    if (!name.trim()) return setErr('Enter a category name.');
    if (existing.some((c) => c.id !== cat?.id && c.name.toLowerCase() === name.trim().toLowerCase())) return setErr('A category with this name already exists.');
    const entity: Category = { ...(cat ?? { id: `cat-${s.tenant.id}-${uid().slice(-6)}`, tenantId: s.tenant.id, sortOrder: nextOrder }), name: name.trim(), color };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'categories', entity, summary: `Category ${entity.name} ${cat ? 'updated' : 'created'}`, actorId: s.user.id, action: cat ? 'category.updated' : 'category.created', entityName: 'category', before: cat });
    toast.success('Category saved');
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={cat ? 'Edit category' : 'New category'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <div className="ex-stack">
        <TextField label="Name" required autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} error={err} />
        <div className="ex-field">
          <span className="ex-label">Chip colour</span>
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            {PALETTE.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 6, background: c, border: c === color ? '3px solid var(--text-primary)' : '1px solid var(--border-strong)', cursor: 'pointer' }} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function BrandModal({ brand, existing, onClose }: { brand?: Brand; existing: Brand[]; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [name, setName] = useState(brand?.name ?? '');
  const [err, setErr] = useState<string>();
  const save = async () => {
    if (!name.trim()) return setErr('Enter a brand name.');
    if (existing.some((c) => c.id !== brand?.id && c.name.toLowerCase() === name.trim().toLowerCase())) return setErr('This brand already exists.');
    const entity: Brand = { ...(brand ?? { id: `br-${s.tenant.id}-${uid().slice(-6)}`, tenantId: s.tenant.id }), name: name.trim() };
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'brands', entity, summary: `Brand ${entity.name} ${brand ? 'updated' : 'created'}`, actorId: s.user.id, action: brand ? 'brand.updated' : 'brand.created', entityName: 'brand', before: brand });
    toast.success('Brand saved');
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={brand ? 'Edit brand' : 'New brand'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <TextField label="Brand name" required autoFocus value={name} onChange={(e) => { setName(e.target.value); setErr(undefined); }} error={err} />
    </Modal>
  );
}
