import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Product, StockAdjustment } from '@elixir/contracts';
import { ApprovalDialog, Badge, Button, Card, CardHeader, ConfirmDialog, IconButton, InlineAlert, Segmented, Select, TextField, Textarea, useToast } from '@elixir/ui';
import { batchesFor } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { date, money, qty as fq } from '@elixir/format';
import { roleByCode } from '@elixir/domain';
import { FormSection, PageFrame } from '../../components/common';
import { ProductPicker } from '../../components/ProductPicker';
import { useCloud } from '../../lib/data';
import { onHandIn } from '../../lib/stock';
import { ADJ_REASON_LABEL, postAdjustment } from '../../lib/ops';
import { useSession } from '../../lib/session';

export function AdjustPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [store, setStore] = useState(params.get('store') ?? (s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? ''));
  const [product, setProduct] = useState<Product | undefined>(() => cloud.get('products', params.get('product') ?? undefined));
  const [batchId, setBatchId] = useState(params.get('batch') ?? '');
  const [dir, setDir] = useState<'out' | 'in'>('out');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState<StockAdjustment['reason'] | ''>((params.get('reason') as StockAdjustment['reason']) ?? '');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [approval, setApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const canApprove = s.can('approvals.act');

  const batches = product?.batchTracked ? batchesFor(cloud, product.id) : [];
  const onHand = useLive(cloud, ['stockMovements'], () => (product ? onHandIn(cloud, [store], product.id, batchId || undefined) : 0), [product?.id, store, batchId]);
  const n = Number(qty);
  const signed = dir === 'out' ? -n : n;
  const after = Math.round((onHand + (isFinite(signed) ? signed : 0)) * 1000) / 1000;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!product) e.product = 'Choose the product to adjust.';
    if (!(n > 0)) e.qty = 'Enter a quantity greater than zero.';
    else if (product && !product.decimalQty && !Number.isInteger(n)) e.qty = `${product.name} is counted in whole ${product.unit}.`;
    if (product?.batchTracked && batches.length && !batchId) e.batch = 'Choose the batch being adjusted (stock is tracked per batch).';
    if (!reason) e.reason = 'Choose a reason — it is recorded in the audit log.';
    if (dir === 'out' && after < 0) e.qty = `Only ${fq(onHand)} on hand${batchId ? ' in this batch' : ''}. Reduce the quantity or choose another batch.`;
    if (!note.trim()) e.note = 'Add an approval note explaining the adjustment.';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const commit = async (approvedBy?: string) => {
    if (!product || !reason) return;
    setBusy(true);
    const adj = await postAdjustment(cloud, { tenantId: s.tenant.id, storeId: store, productId: product.id, batchId: batchId || undefined, qty: signed, reason, note: note.trim(), userId: s.user.id, approvedBy });
    setBusy(false);
    setConfirm(false);
    setApproval(false);
    toast.success(`Adjustment ${adj.documentNo} posted`, `${product.name} ${signed > 0 ? '+' : ''}${fq(signed)} · stock movement and audit recorded`);
    nav(`/inventory/ledger/${product.id}?store=${store}`);
  };

  const submit = () => {
    if (!validate()) return;
    if (dir === 'out' && !canApprove) setApproval(true);
    else setConfirm(true);
  };

  return (
    <PageFrame crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: 'Stock adjustment' }]} title="Stock adjustment" description="Creates an adjustment document, a stock movement and an audit event. Stock is never edited directly." maxWidth={1100}>
      <div className="bo-form-layout">
        <div className="ex-stack" style={{ gap: 16 }}>
          <FormSection title="What are you adjusting?" icon="Package">
            <Select label="Store" value={store} onChange={(e) => setStore(e.target.value)} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
            <div className="ex-field">
              <span className="ex-label">Product<span className="req">*</span></span>
              {product ? (
                <div className="ex-row" style={{ justifyContent: 'space-between', border: '1px solid var(--border-default)', borderRadius: 8, padding: '6px 10px', minHeight: 40 }}>
                  <span><b>{product.name}</b> <span className="muted num">{product.sku}</span></span>
                  <IconButton size="sm" icon="X" label="Change product" onClick={() => { setProduct(undefined); setBatchId(''); }} />
                </div>
              ) : (
                <ProductPicker onPick={(p) => { setProduct(p); setBatchId(''); setErrors({}); }} autoFocus right={(p) => `${fq(onHandIn(cloud, [store], p.id))} ${p.unit}`} />
              )}
              {errors.product ? <span className="ex-error" role="alert">{errors.product}</span> : null}
            </div>
            {product?.batchTracked && batches.length ? (
              <Select label="Batch" required placeholder="Choose batch" value={batchId} onChange={(e) => setBatchId(e.target.value)} error={errors.batch} options={batches.map((b) => ({ value: b.id, label: `${b.code} · exp ${date(b.expiryDate)} · ${fq(onHandIn(cloud, [store], product.id, b.id))} on hand` }))} />
            ) : null}
          </FormSection>
          <FormSection title="Adjustment" icon="SlidersHorizontal">
            <div className="ex-field">
              <span className="ex-label">Direction</span>
              <Segmented label="Direction" items={[{ key: 'out', label: 'Decrease stock', icon: 'Minus' }, { key: 'in', label: 'Increase stock', icon: 'Plus' }]} value={dir} onChange={setDir} />
            </div>
            <TextField label="Quantity" required inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} error={errors.qty} suffix={product?.unit} className="num" />
            <Select label="Reason" required placeholder="Choose reason" value={reason} onChange={(e) => setReason(e.target.value as StockAdjustment['reason'])} error={errors.reason} options={(Object.keys(ADJ_REASON_LABEL) as StockAdjustment['reason'][]).map((k) => ({ value: k, label: ADJ_REASON_LABEL[k] }))} />
            <div className="bo-span-2">
              <Textarea label="Approval note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} placeholder="e.g. 6 packs found torn during shelf audit, photos attached to ticket" />
            </div>
          </FormSection>
        </div>
        <aside className="bo-form-aside">
          <Card>
            <CardHeader title="Effect" />
            <div style={{ padding: 16 }} className="ex-stack">
              <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">On hand now</span><span className="num">{product ? `${fq(onHand)} ${product.unit}` : '—'}</span></div>
              <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">Change</span><b className={`num ${signed < 0 ? 'bo-neg' : 'bo-pos'}`}>{n > 0 ? `${signed > 0 ? '+' : '−'}${fq(n)}` : '—'}</b></div>
              <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">After</span><b className={`num ${after < 0 ? 'bo-neg' : ''}`}>{product && n > 0 ? `${fq(after)} ${product.unit}` : '—'}</b></div>
              {product && n > 0 ? <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="muted">Value at cost</span><span className="num">{money(Math.round(signed * product.costPaise), { signed: true })}</span></div> : null}
              {dir === 'out' && !canApprove ? <Badge tone="warning" icon="ShieldCheck">Needs manager PIN</Badge> : null}
            </div>
          </Card>
          <Button variant={dir === 'out' ? 'danger' : 'primary'} icon="Check" block loading={busy} onClick={submit}>Post adjustment</Button>
          <Button block onClick={() => nav(-1)}>Cancel</Button>
          <InlineAlert tone="info">Posted adjustments can't be edited. To correct one, post an opposite adjustment.</InlineAlert>
        </aside>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} busy={busy} tone={dir === 'out' ? 'danger' : 'primary'} confirmLabel={dir === 'out' ? `Decrease by ${fq(n)}` : `Increase by ${fq(n)}`} title={`${dir === 'out' ? 'Decrease' : 'Increase'} stock of ${product?.name}?`} onConfirm={() => commit(canApprove ? s.user.id : undefined)}>
        {s.storeName(store)} · {reason ? ADJ_REASON_LABEL[reason] : ''} · on hand {fq(onHand)} → {fq(after)} {product?.unit}. This posts an immutable stock movement and audit event.
      </ConfirmDialog>
      <ApprovalDialog
        open={approval}
        onClose={() => setApproval(false)}
        action={`Stock decrease · ${product?.name}`}
        requested={`−${fq(n)} ${product?.unit ?? ''} (${reason ? ADJ_REASON_LABEL[reason] : ''})`}
        requireReason={false}
        detail={note}
        verify={(pin) => {
          const m = cloud.where('users', (u) => u.tenantId === s.tenant.id && u.active && u.pin === pin && roleByCode(u.role).permissions.includes('approvals.act'))[0];
          return m ? { ok: true, approverId: m.id, approverName: m.name } : { ok: false, message: 'PIN not recognised or no approval authority.' };
        }}
        onApproved={(r) => void commit(r.approverId)}
      />
    </PageFrame>
  );
}
