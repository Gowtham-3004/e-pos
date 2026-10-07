import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Product } from '@elixir/contracts';
import { Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, IconButton, InlineAlert, Select, TextField, Textarea, useToast } from '@elixir/ui';
import { batchesFor } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { date, qty as fq } from '@elixir/format';
import { NotAvailable, PageFrame } from '../../components/common';
import { ProductPicker } from '../../components/ProductPicker';
import { useCloud } from '../../lib/data';
import { onHandIn } from '../../lib/stock';
import { postTransfer } from '../../lib/ops';
import { useSession } from '../../lib/session';

interface Line { product: Product; batchId: string; qty: string }

export function TransferPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const [from, setFrom] = useState(s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? '');
  const [to, setTo] = useState(s.stores.find((x) => x.id !== from)?.id ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState('');
  const [ref, setRef] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  useLive(cloud, ['stockMovements'], () => 0);

  if (!s.has('multi-store') || s.stores.length < 2) return <NotAvailable module="Stock transfer" />;

  const avail = (l: Line) => onHandIn(cloud, [from], l.product.id, l.batchId || undefined);
  const lineError = (l: Line): string | undefined => {
    const n = Number(l.qty);
    if (!(n > 0)) return 'Enter quantity';
    if (l.product.batchTracked && batchesFor(cloud, l.product.id).length && !l.batchId) return 'Choose batch';
    if (n > avail(l)) return `Only ${fq(avail(l))} available`;
    return undefined;
  };
  const errs = lines.map(lineError);
  const formErr = from === to ? 'From and To stores must be different.' : !lines.length ? 'Add at least one product.' : errs.some(Boolean) ? 'Fix the highlighted lines.' : undefined;

  const run = async () => {
    setBusy(true);
    const r = await postTransfer(cloud, { tenantId: s.tenant.id, fromStoreId: from, toStoreId: to, lines: lines.map((l) => ({ productId: l.product.id, batchId: l.batchId || undefined, qty: Number(l.qty) })), note: [ref && `Ref ${ref}`, note].filter(Boolean).join(' · ') || undefined, userId: s.user.id });
    setBusy(false);
    toast.success(`Transfer ${r.docNo} posted`, `${lines.length} line(s) moved ${s.storeName(from)} → ${s.storeName(to)}`);
    nav('/inventory?tab=transfers');
  };

  return (
    <PageFrame crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: 'Transfer' }]} title="Stock transfer" description="Posts a paired transfer-out (source) and transfer-in (destination) movement for each line." maxWidth={1200}>
      <Card>
        <CardHeader title="Route" icon="ArrowRightLeft" />
        <div style={{ padding: 16 }} className="bo-form-grid bo-form-grid--3">
          <Select label="From store" value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
          <Select label="To store" value={to} onChange={(e) => setTo(e.target.value)} error={from === to ? 'Choose a different destination store.' : undefined} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
          <TextField label="Reference / vehicle" placeholder="Optional" value={ref} onChange={(e) => setRef(e.target.value)} />
        </div>
      </Card>
      <Card className="bo-card-table">
        <CardHeader title="Items" subtitle={`${lines.length} line(s)`} icon="Package" />
        <div className="bo-toolbar">
          <div style={{ flex: 1, maxWidth: 520 }}>
            <ProductPicker exclude={lines.filter((l) => !l.product.batchTracked).map((l) => l.product.id)} onPick={(p) => setLines([...lines, { product: p, batchId: '', qty: '' }])} right={(p) => `${fq(onHandIn(cloud, [from], p.id))} at source`} />
          </div>
        </div>
        <div className="bo-doc-grid">
          <DataTable
            rows={lines.map((l, i) => ({ l, i }))}
            rowKey={({ l, i }) => `${l.product.id}-${i}`}
            pageSize={200}
            empty={<EmptyState quiet icon="PackagePlus" title="No items yet">Search above to add products to transfer.</EmptyState>}
            columns={[
              { key: 'p', header: 'Product', render: ({ l }) => <div><div className="bo-cell-main">{l.product.name}</div><div className="bo-cell-sub num">{l.product.sku}</div></div> },
              { key: 'b', header: 'Batch', width: 240, render: ({ l, i }) => (l.product.batchTracked ? (
                <select aria-label="Batch" value={l.batchId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, batchId: e.target.value } : x)))}>
                  <option value="">Choose batch</option>
                  {batchesFor(cloud, l.product.id).map((b) => <option key={b.id} value={b.id}>{b.code} · {date(b.expiryDate)} · {fq(onHandIn(cloud, [from], l.product.id, b.id))}</option>)}
                </select>
              ) : <span className="muted">—</span>) },
              { key: 'a', header: 'Available', align: 'right', render: ({ l }) => fq(avail(l), l.product.decimalQty) },
              { key: 'q', header: 'Transfer qty', align: 'right', width: 140, render: ({ l, i }) => <input className="num" inputMode="decimal" aria-label="Quantity" aria-invalid={tried && !!errs[i]} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /> },
              { key: 'e', header: '', render: ({ i }) => (tried && errs[i] ? <span className="ex-error">{errs[i]}</span> : null) },
              { key: 'x', header: '', align: 'right', render: ({ i }) => <IconButton icon="Trash2" label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))} /> },
            ]}
          />
        </div>
      </Card>
      <Textarea label="Note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for transfer (recorded in audit)" />
      {tried && formErr ? <InlineAlert tone="danger">{formErr}</InlineAlert> : null}
      <div className="bo-sticky-actions">
        <span className="muted">{lines.length} line(s) · {fq(lines.reduce((a, l) => a + (Number(l.qty) || 0), 0))} units</span>
        <div className="ex-spacer" />
        <Button onClick={() => nav('/inventory')}>Cancel</Button>
        <Button variant="primary" icon="Send" onClick={() => { setTried(true); if (!formErr) setConfirm(true); }}>Post transfer</Button>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} busy={busy} tone="primary" title="Post stock transfer?" confirmLabel="Post transfer" onConfirm={run}>
        {lines.length} line(s) from <b>{s.storeName(from)}</b> to <b>{s.storeName(to)}</b>. Stock decreases at the source and increases at the destination immediately. This can only be reversed by a new transfer.
      </ConfirmDialog>
    </PageFrame>
  );
}
