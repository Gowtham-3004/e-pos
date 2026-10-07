import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Purchase, PurchaseLine } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, DescriptionList, EmptyState, Icon, IconButton, InlineAlert, Modal, Select, StatusBadge, TextField, Textarea, Timeline, TotalRow, useToast } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, dateTime, money, paiseToRupeesInput, rupeesToPaise, qty as fq } from '@elixir/format';
import { NotFound, PageFrame } from '../../components/common';
import { ProductPicker } from '../../components/ProductPicker';
import { addDays, today, useCloud, useLookups, userName } from '../../lib/data';
import { cancelDraftPurchase, lineNet, peekDoc, postPurchase, postPurchaseReturn, purchaseTotals, savePurchaseDraft } from '../../lib/ops';
import { useSession } from '../../lib/session';
import { isDebitNote, PAYMENT_STATUS, PURCHASE_STATUS } from './purchaseMeta';
import { METHOD_LABEL } from '../../lib/data';

export function PurchaseDoc() {
  const { id } = useParams();
  const cloud = useCloud();
  const s = useSession();
  const p = useEntity(cloud, 'purchases', id === 'new' ? undefined : id);
  if (id === 'new') return <PurchaseEntry key="new" />;
  if (!p || p.tenantId !== s.tenant.id) return <NotFound what="Purchase" back={{ label: 'Back to purchases', to: '/purchase' }} />;
  if (p.status === 'draft') return <PurchaseEntry key={p.id} draft={p} />;
  return <PurchaseView p={p} />;
}

/** Editable line: strings for inputs, numbers derived at save. */
interface EditLine {
  key: string;
  productId: string;
  name: string;
  unit: string;
  batchTracked: boolean;
  batchCode: string;
  expiryDate: string;
  qty: string;
  freeQty: string;
  cost: string;
  mrp: string;
  taxRatePct: number;
  discountPct: string;
}

function toLine(e: EditLine): PurchaseLine {
  const l = { productId: e.productId, name: e.name, batchCode: e.batchCode || undefined, expiryDate: e.expiryDate || undefined, qty: Number(e.qty) || 0, freeQty: Number(e.freeQty) || 0, costPaise: rupeesToPaise(e.cost), mrpPaise: rupeesToPaise(e.mrp), taxRatePct: e.taxRatePct, discountPct: Number(e.discountPct) || 0, netPaise: 0 };
  return { ...l, netPaise: lineNet(l) };
}

function PurchaseEntry({ draft }: { draft?: Purchase }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const L = useLookups();
  const canPost = s.can('purchase.post');
  const [supplierId, setSupplierId] = useState(draft?.supplierId ?? '');
  const [invoiceNo, setInvoiceNo] = useState(draft?.supplierInvoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState(draft?.invoiceDate ?? today());
  const [storeId, setStoreId] = useState(draft?.storeId ?? (s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? ''));
  const [paid, setPaid] = useState(draft?.paidPaise ? paiseToRupeesInput(draft.paidPaise) : '');
  const [lines, setLines] = useState<EditLine[]>(() =>
    (draft?.lines ?? []).map((l) => {
      const p = L.products.get(l.productId);
      return { key: uid(), productId: l.productId, name: l.name, unit: p?.unit ?? 'pcs', batchTracked: !!p?.batchTracked, batchCode: l.batchCode ?? '', expiryDate: l.expiryDate ?? '', qty: String(l.qty), freeQty: String(l.freeQty || ''), cost: paiseToRupeesInput(l.costPaise), mrp: paiseToRupeesInput(l.mrpPaise), taxRatePct: l.taxRatePct, discountPct: l.discountPct ? String(l.discountPct) : '' };
    }),
  );
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'post'>();
  const idRef = useRef(draft?.id ?? uid('pu'));
  const supplier = L.suppliers.get(supplierId);
  const docPreview = draft?.documentNo ?? peekDoc(cloud, `PUR|pur-${storeId}`, 'PUR', L.stores.get(storeId)?.code ?? 'STR');

  const built = useMemo(() => lines.map(toLine), [lines]);
  const totals = purchaseTotals(built);
  const paidP = rupeesToPaise(paid);

  const lineErr = (e: EditLine): Partial<Record<keyof EditLine, string>> => {
    const r: Partial<Record<keyof EditLine, string>> = {};
    const qty = Number(e.qty);
    if (!(qty > 0)) r.qty = 'Qty > 0';
    if (!(rupeesToPaise(e.cost) > 0)) r.cost = 'Cost required';
    if (!(rupeesToPaise(e.mrp) > 0)) r.mrp = 'MRP required';
    else if (rupeesToPaise(e.cost) > rupeesToPaise(e.mrp)) r.cost = 'Cost above MRP';
    if (e.batchTracked && s.has('batch-expiry')) {
      if (!e.batchCode.trim()) r.batchCode = 'Batch required';
      if (!e.expiryDate) r.expiryDate = 'Expiry required';
      else if (e.expiryDate <= today()) r.expiryDate = 'Already expired';
    }
    return r;
  };
  const lineErrors = lines.map(lineErr);
  const headErr: Record<string, string> = {};
  if (!supplierId) headErr.supplier = 'Choose the supplier.';
  if (!invoiceNo.trim()) headErr.invoice = 'Enter the supplier invoice number.';
  else if (cloud.where('purchases', (p) => p.supplierId === supplierId && p.id !== idRef.current && p.status !== 'cancelled' && p.supplierInvoiceNo.trim().toLowerCase() === invoiceNo.trim().toLowerCase()).length) headErr.invoice = 'This invoice number is already recorded for this supplier.';
  if (invoiceDate > today()) headErr.date = 'Invoice date cannot be in the future.';
  if (paidP < 0 || paidP > totals.totalPaise) headErr.paid = `Paid now must be between ₹0 and ${money(totals.totalPaise)}.`;
  const postBlocked = Object.keys(headErr).length > 0 || !lines.length || lineErrors.some((x) => Object.keys(x).length);

  const build = (): Purchase => ({
    id: idRef.current, tenantId: s.tenant.id, storeId, documentNo: draft?.documentNo ?? '', supplierId, supplierInvoiceNo: invoiceNo.trim(), invoiceDate, lines: built,
    ...totals, paidPaise: paidP, status: 'draft', paymentStatus: 'unpaid', createdBy: draft?.createdBy ?? s.user.id, createdAt: draft?.createdAt ?? new Date().toISOString(),
  });

  const saveDraft = async () => {
    if (!supplierId) { setTried(true); toast.error('Choose a supplier before saving the draft'); return; }
    setBusy('draft');
    const p = await savePurchaseDraft(cloud, build(), s.user.id);
    setBusy(undefined);
    toast.success(`Draft ${p.documentNo} saved`, 'Stock and payables are not affected until you post');
    if (!draft) nav(`/purchase/${p.id}`, { replace: true });
  };

  const post = async () => {
    setBusy('post');
    const p = await postPurchase(cloud, build(), s.user.id);
    setBusy(undefined);
    setConfirm(false);
    toast.success(`Purchase ${p.documentNo} posted`, `${p.lines.length} lines received into ${s.storeName(p.storeId)} · supplier balance updated`);
    nav(`/purchase/${p.id}`, { replace: true });
  };

  const add = (pid: string) => {
    const p = L.products.get(pid)!;
    const tax = L.taxRates.get(p.taxRateId)?.ratePct ?? 0;
    setLines((ls) => [...ls, { key: uid(), productId: p.id, name: p.name, unit: p.unit, batchTracked: !!p.batchTracked, batchCode: '', expiryDate: '', qty: '', freeQty: '', cost: paiseToRupeesInput(p.costPaise), mrp: paiseToRupeesInput(p.mrpPaise), taxRatePct: tax, discountPct: '' }]);
    setTimeout(() => document.querySelector<HTMLInputElement>('.bo-doc-grid tbody tr:last-child input[data-f="qty"]')?.focus(), 30);
  };
  const upd = (key: string, patch: Partial<EditLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const showErr = (i: number, f: keyof EditLine) => (tried ? lineErrors[i]?.[f] : undefined);
  const cell = (l: EditLine, i: number, f: keyof EditLine, props: { num?: boolean; type?: string; placeholder?: string } = {}) => (
    <input data-f={f} className={props.num ? 'num' : undefined} type={props.type ?? 'text'} inputMode={props.num ? 'decimal' : undefined} placeholder={props.placeholder} aria-label={`${f} for ${l.name}`} aria-invalid={!!showErr(i, f)} title={showErr(i, f)} value={String(l[f])} onChange={(e) => upd(l.key, { [f]: e.target.value } as Partial<EditLine>)} />
  );

  return (
    <PageFrame
      crumbs={[{ label: 'Purchase', to: '/purchase' }, { label: draft ? draft.documentNo : 'New purchase' }]}
      title={draft ? <span className="num">{draft.documentNo}</span> : 'New purchase'}
      meta={<StatusBadge meta={PURCHASE_STATUS.draft} />}
      description={draft ? `Draft saved ${dateTime(draft.createdAt)} by ${userName(L, draft.createdBy)} · edits allowed until posted` : `Will be numbered ${docPreview} when saved`}
      actions={draft && canPost ? <Button variant="danger-outline" icon="Trash2" onClick={() => setCancelOpen(true)}>Cancel draft</Button> : undefined}
    >
      {!canPost ? <InlineAlert tone="info" title="Read-only">Your role can view purchases but not create or post them.</InlineAlert> : null}
      <fieldset disabled={!canPost} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="ex-stack">
        <Card>
          <CardHeader title="Supplier invoice" icon="FileText" />
          <div style={{ padding: 16 }} className="bo-doc-head">
            <Select label="Supplier" required placeholder="Choose supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} error={tried ? headErr.supplier : undefined} options={[...L.suppliers.values()].filter((x) => x.active).map((x) => ({ value: x.id, label: x.name }))} />
            <TextField label="Supplier invoice no." required value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} error={tried ? headErr.invoice : undefined} />
            <TextField label="Invoice date" type="date" required value={invoiceDate} max={today()} onChange={(e) => setInvoiceDate(e.target.value)} error={tried ? headErr.date : undefined} />
            <Select label="Receive into store" value={storeId} onChange={(e) => setStoreId(e.target.value)} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} />
            <div className="ex-field">
              <span className="ex-label">Terms</span>
              <div style={{ minHeight: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {supplier ? <><b>{supplier.payableDays} days credit</b><span className="ex-hint">Due {date(addDays(invoiceDate, supplier.payableDays))} · {supplier.gstin}</span></> : <span className="muted">Select supplier</span>}
              </div>
            </div>
          </div>
          {supplier?.licenceValidUntil && supplier.licenceValidUntil < addDays(today(), 30) ? <div style={{ padding: '0 16px 16px' }}><InlineAlert tone="warning" title="Drug licence expiring">{supplier.name}'s licence {supplier.licenceNo} is valid until {date(supplier.licenceValidUntil)}. Collect the renewed licence before further purchases.</InlineAlert></div> : null}
        </Card>

        <Card className="bo-card-table">
          <CardHeader title="Items" subtitle={`${lines.length} line(s) · net includes GST after discount`} icon="Package" />
          <div className="bo-toolbar">
            <div style={{ flex: 1, maxWidth: 560 }}>
              <ProductPicker onPick={(p) => add(p.id)} placeholder="Add item — search name, SKU or scan barcode" right={(p) => `cost ${money(p.costPaise)}`} />
            </div>
            <span className="ex-hint">Tip: press Enter to add the first match. Batch & expiry are required for batch-tracked items.</span>
          </div>
          <div className="bo-doc-grid ex-scroll" style={{ overflowX: 'auto' }}>
            <DataTable
              rows={lines.map((l, i) => ({ l, i }))}
              rowKey={({ l }) => l.key}
              pageSize={500}
              density="dense"
              empty={<EmptyState quiet icon="PackagePlus" title="No items yet">Search above to add the products on this supplier invoice.</EmptyState>}
              columns={[
                { key: 'n', header: '#', width: 32, render: ({ i }) => <span className="muted num">{i + 1}</span> },
                { key: 'p', header: 'Product', render: ({ l }) => <div style={{ minWidth: 160 }}><div className="bo-cell-main">{l.name}</div><div className="bo-cell-sub">{l.unit} · GST {l.taxRatePct}%</div></div> },
                { key: 'b', header: 'Batch', width: 110, render: ({ l, i }) => (l.batchTracked ? cell(l, i, 'batchCode', { placeholder: 'B12A' }) : <span className="muted">—</span>) },
                { key: 'e', header: 'Expiry', width: 150, render: ({ l, i }) => (l.batchTracked ? cell(l, i, 'expiryDate', { type: 'date' }) : <span className="muted">—</span>) },
                { key: 'q', header: 'Qty', align: 'right', width: 80, render: ({ l, i }) => cell(l, i, 'qty', { num: true }) },
                { key: 'f', header: 'Free', align: 'right', width: 70, render: ({ l, i }) => cell(l, i, 'freeQty', { num: true, placeholder: '0' }) },
                { key: 'c', header: 'Cost ₹', align: 'right', width: 100, render: ({ l, i }) => cell(l, i, 'cost', { num: true }) },
                { key: 'm', header: 'MRP ₹', align: 'right', width: 100, render: ({ l, i }) => cell(l, i, 'mrp', { num: true }) },
                { key: 'd', header: 'Disc %', align: 'right', width: 76, render: ({ l, i }) => cell(l, i, 'discountPct', { num: true, placeholder: '0' }) },
                { key: 't', header: 'Tax', align: 'right', render: ({ i }) => <span className="num">{money(built[i]!.netPaise - Math.round(built[i]!.qty * built[i]!.costPaise * (1 - built[i]!.discountPct / 100)))}</span> },
                { key: 'net', header: 'Net', align: 'right', render: ({ i }) => <b className="num">{money(built[i]!.netPaise)}</b> },
                { key: 'x', header: '', align: 'right', render: ({ l }) => <IconButton icon="Trash2" label={`Remove ${l.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} /> },
              ]}
            />
          </div>
          {tried && lineErrors.some((x) => Object.keys(x).length) ? (
            <div style={{ padding: '0 16px 12px' }}>
              <InlineAlert tone="danger" title="Some lines need attention">
                {lines.map((l, i) => (Object.keys(lineErrors[i]!).length ? <div key={l.key}>Line {i + 1} · {l.name}: {Object.values(lineErrors[i]!).join(', ')}</div> : null))}
              </InlineAlert>
            </div>
          ) : null}
          <div className="ex-row" style={{ alignItems: 'flex-start', borderTop: '1px solid var(--border-default)', flexWrap: 'wrap' }}>
            <div style={{ padding: 16, flex: '1 1 280px', maxWidth: 360 }}>
              <TextField label="Paid now (optional)" prefix="₹" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} error={tried ? headErr.paid : undefined} hint="Recorded as a supplier payment on posting. Leave empty to pay later from Payables." className="num" />
            </div>
            <div className="bo-doc-totals">
              <TotalRow label="Subtotal (cost × qty)" paise={totals.subtotalPaise} />
              <TotalRow label="Discount" paise={-totals.discountPaise} />
              <TotalRow label="GST" paise={totals.taxPaise} />
              <TotalRow label="Invoice total" paise={totals.totalPaise} grand />
              {paidP ? <TotalRow label="Balance payable" paise={totals.totalPaise - paidP} /> : null}
            </div>
          </div>
        </Card>
      </fieldset>

      {canPost ? (
        <div className="bo-sticky-actions">
          <span className="muted"><Icon name="Info" size={14} style={{ verticalAlign: -2 }} /> Draft = editable, no stock effect. Post = receives stock, updates payables, becomes read-only.</span>
          <div className="ex-spacer" />
          <Button icon="Save" loading={busy === 'draft'} onClick={() => void saveDraft()}>Save Draft</Button>
          <Button variant="primary" icon="FileCheck2" onClick={() => { setTried(true); if (postBlocked) toast.error('Purchase cannot be posted yet', 'Fix the highlighted fields'); else setConfirm(true); }}>Post Purchase</Button>
        </div>
      ) : null}

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} busy={busy === 'post'} tone="primary" title="Post this purchase?" confirmLabel={`Post ${money(totals.totalPaise)}`} onConfirm={post}>
        <div className="ex-stack" style={{ gap: 6 }}>
          <span>{lines.length} line(s) · {fq(built.reduce((a, l) => a + l.qty + l.freeQty, 0))} units will be received into <b>{s.storeName(storeId)}</b>.</span>
          <span>{supplier?.name} balance increases by <b>{money(totals.totalPaise - paidP)}</b>.</span>
          <span>Posted purchases are read-only. Corrections are made with a purchase return (debit note).</span>
        </div>
      </ConfirmDialog>
      <ConfirmDialog open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancel this draft?" confirmLabel="Cancel draft" requireReason onConfirm={async (r) => { await cancelDraftPurchase(cloud, draft!, s.user.id, r); toast.info('Draft cancelled'); nav('/purchase'); }}>
        The draft is kept as Cancelled for audit. Stock and payables were never affected.
      </ConfirmDialog>
    </PageFrame>
  );
}

function PurchaseView({ p }: { p: Purchase }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const [ret, setRet] = useState(false);
  const [print, setPrint] = useState(false);
  const auditRef = useRef<HTMLDivElement>(null);
  const supplier = L.suppliers.get(p.supplierId);
  const debit = isDebitNote(p);
  const related = useLive(cloud, ['purchases', 'payments', 'auditEvents'], () => ({
    returns: cloud.where('purchases', (x) => x.supplierInvoiceNo === `Return against ${p.documentNo}`),
    payments: cloud.where('payments', (x) => x.partyType === 'supplier' && x.partyId === p.supplierId && !!x.againstDocument?.split(', ').includes(p.documentNo)),
    audit: cloud.where('auditEvents', (a) => a.entityId === p.id || a.documentNo === p.documentNo).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }), [p.id]);
  const returnedQty = (pid: string) => related.returns.reduce((a, r) => a + r.lines.filter((l) => l.productId === pid).reduce((b, l) => b - l.qty, 0), 0);

  return (
    <PageFrame
      crumbs={[{ label: 'Purchase', to: '/purchase' }, { label: p.documentNo }]}
      title={<span className="num">{p.documentNo}</span>}
      meta={
        <>
          {p.status === 'posted' ? <span className="bo-posted-stamp"><Icon name="FileCheck2" size={14} /> POSTED</span> : <StatusBadge meta={PURCHASE_STATUS[p.status]} />}
          {debit ? <Badge tone="warning" icon="Undo2">Debit note</Badge> : p.status === 'posted' ? <StatusBadge meta={PAYMENT_STATUS[p.paymentStatus]} /> : null}
        </>
      }
      description={`${supplier?.name} · ${p.supplierInvoiceNo} · ${date(p.invoiceDate)} · ${s.storeName(p.storeId)}`}
      actions={
        <>
          <Button icon="ScrollText" onClick={() => auditRef.current?.scrollIntoView({ behavior: 'smooth' })}>View audit</Button>
          <Button icon="Printer" onClick={() => setPrint(true)}>Print</Button>
          {p.status === 'posted' && !debit && s.can('purchase.post') ? <Button variant="danger-outline" icon="Undo2" onClick={() => setRet(true)}>Purchase return</Button> : null}
        </>
      }
    >
      <div className="ex-hint" style={{ marginTop: -6 }}><Icon name="Lock" size={13} style={{ verticalAlign: -2 }} /> {p.status === 'cancelled' ? 'Cancelled draft — kept for audit.' : 'Posted purchase is read-only. Returns create a linked debit note with compensating stock movements.'}</div>
      <div className="bo-grid-main">
        <div className="ex-stack" style={{ gap: 16 }}>
          <Card className="bo-card-table">
            <CardHeader title="Lines" subtitle={`${p.lines.length} lines`} icon="List" />
            <DataTable
              density="dense"
              pageSize={200}
              rows={p.lines.map((l, i) => ({ l, i }))}
              rowKey={({ i }) => String(i)}
              columns={[
                { key: 'n', header: '#', render: ({ i }) => <span className="muted num">{i + 1}</span> },
                { key: 'p', header: 'Product', render: ({ l }) => <div><button type="button" className="bo-link" onClick={() => nav(`/inventory/ledger/${l.productId}`)}>{l.name}</button>{!debit && returnedQty(l.productId) ? <div className="bo-cell-sub bo-neg">Returned {fq(returnedQty(l.productId))}</div> : null}</div> },
                { key: 'b', header: 'Batch · Expiry', render: ({ l }) => (l.batchCode ? <span className="num">{l.batchCode}{l.expiryDate ? ` · ${date(l.expiryDate)}` : ''}</span> : '—') },
                { key: 'q', header: 'Qty', align: 'right', render: ({ l }) => fq(l.qty) },
                { key: 'f', header: 'Free', align: 'right', render: ({ l }) => (l.freeQty ? fq(l.freeQty) : '—') },
                { key: 'c', header: 'Cost', align: 'right', render: ({ l }) => money(l.costPaise) },
                { key: 'm', header: 'MRP', align: 'right', render: ({ l }) => money(l.mrpPaise) },
                { key: 'd', header: 'Disc', align: 'right', render: ({ l }) => (l.discountPct ? `${l.discountPct}%` : '—') },
                { key: 't', header: 'GST', align: 'right', render: ({ l }) => `${l.taxRatePct}%` },
                { key: 'net', header: 'Net', align: 'right', render: ({ l }) => <b>{money(l.netPaise)}</b> },
              ]}
            />
          </Card>
          {!debit ? (
            <Card>
              <CardHeader title="Returns & payments" icon="ArrowLeftRight" />
              {related.returns.length || related.payments.length ? (
                <DataTable
                  density="dense"
                  rows={[...related.returns.map((r) => ({ id: r.id, kind: 'Debit note', doc: r.documentNo, at: r.createdAt, amt: r.totalPaise, to: `/purchase/${r.id}` })), ...related.payments.map((x) => ({ id: x.id, kind: `Payment · ${METHOD_LABEL[x.method]}`, doc: x.documentNo, at: x.createdAt, amt: -x.amountPaise, to: undefined as string | undefined }))]}
                  rowKey={(r) => r.id}
                  onRowClick={(r) => r.to && nav(r.to)}
                  columns={[
                    { key: 'kind', header: 'Type', render: (r) => r.kind },
                    { key: 'doc', header: 'Document', render: (r) => <span className="num">{r.doc}</span> },
                    { key: 'at', header: 'Date', render: (r) => <span className="num">{dateTime(r.at)}</span> },
                    { key: 'amt', header: 'Effect on balance', align: 'right', render: (r) => money(r.amt, { signed: true }) },
                  ]}
                />
              ) : <EmptyState quiet icon="ArrowLeftRight" title="No returns or payments yet" />}
            </Card>
          ) : null}
          <div ref={auditRef}>
            <Card>
              <CardHeader title="Audit timeline" icon="ScrollText" />
              <div style={{ padding: 16 }}>
                <Timeline items={related.audit.map((a) => ({ id: a.id, time: dateTime(a.createdAt), title: a.summary, meta: `${userName(L, a.actorId)}${a.reason ? ` · ${a.reason}` : ''}`, tone: a.action.includes('posted') ? ('success' as const) : a.action.includes('return') ? ('warning' as const) : undefined }))} />
                {!related.audit.length ? <span className="muted">Created {dateTime(p.createdAt)} by {userName(L, p.createdBy)}{p.postedAt ? ` · posted ${dateTime(p.postedAt)}` : ''}.</span> : null}
              </div>
            </Card>
          </div>
        </div>
        <div className="ex-stack" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Totals" icon="Calculator" />
            <div style={{ padding: 16 }} className="ex-stack">
              <TotalRow label="Subtotal" paise={p.subtotalPaise} />
              <TotalRow label="Discount" paise={-p.discountPaise} />
              <TotalRow label="GST" paise={p.taxPaise} />
              <TotalRow label="Total" paise={p.totalPaise} grand />
              {!debit && p.status === 'posted' ? <><TotalRow label="Paid" paise={p.paidPaise} /><TotalRow label="Balance" paise={p.totalPaise - p.paidPaise} /></> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Details" icon="FileText" />
            <div style={{ padding: 16 }}>
              <DescriptionList items={[
                ['Supplier', <button key="s" type="button" className="bo-link" onClick={() => nav(`/suppliers/${p.supplierId}`)}>{supplier?.name}</button>],
                ['GSTIN', supplier?.gstin],
                ['Supplier invoice', p.supplierInvoiceNo],
                ['Invoice date', date(p.invoiceDate)],
                ['Due date', supplier && !debit ? date(addDays(p.invoiceDate, supplier.payableDays)) : '—'],
                ['Store', s.storeName(p.storeId)],
                ['Created by', userName(L, p.createdBy)],
                ['Posted', p.postedAt ? dateTime(p.postedAt) : '—'],
              ]} />
            </div>
          </Card>
        </div>
      </div>
      {ret ? <ReturnModal p={p} returnedQty={returnedQty} onClose={() => setRet(false)} /> : null}
      <Modal open={print} onClose={() => setPrint(false)} size="lg" title={`Print ${p.documentNo}`} footer={<><Button onClick={() => setPrint(false)}>Close</Button><Button variant="primary" icon="Printer" onClick={() => window.print()}>Print</Button></>}>
        <div className="bo-print">
          <div className="bo-a4">
            <div style={{ fontWeight: 800, fontSize: 16 }}>{debit ? 'DEBIT NOTE' : 'PURCHASE / GOODS RECEIPT'} · {p.documentNo}</div>
            <div>{s.tenant.legalName} · {s.storeName(p.storeId)} · GSTIN {s.tenant.gstin}</div>
            <div>Supplier: {supplier?.name} ({supplier?.gstin}) · Invoice {p.supplierInvoiceNo} · {date(p.invoiceDate)}</div>
            <table>
              <thead><tr><th>#</th><th>Item</th><th>Batch</th><th className="n">Qty</th><th className="n">Free</th><th className="n">Cost</th><th className="n">GST%</th><th className="n">Net</th></tr></thead>
              <tbody>{p.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{l.batchCode ?? ''}</td><td className="n">{l.qty}</td><td className="n">{l.freeQty}</td><td className="n">{money(l.costPaise)}</td><td className="n">{l.taxRatePct}</td><td className="n">{money(l.netPaise)}</td></tr>)}</tbody>
            </table>
            <div style={{ textAlign: 'right', marginTop: 8 }}>Taxable {money(p.subtotalPaise - p.discountPaise)} · GST {money(p.taxPaise)} · <b>Total {money(p.totalPaise)}</b></div>
          </div>
        </div>
      </Modal>
    </PageFrame>
  );
}

function ReturnModal({ p, returnedQty, onClose }: { p: Purchase; returnedQty: (pid: string) => number; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const [qty, setQty] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const max = (i: number) => p.lines[i]!.qty + p.lines[i]!.freeQty - returnedQty(p.lines[i]!.productId);
  const chosen = p.lines.map((_, i) => ({ index: i, qty: Number(qty[i] ?? 0) || 0 })).filter((x) => x.qty > 0);
  const over = chosen.find((x) => x.qty > max(x.index));
  const value = chosen.reduce((a, x) => a + lineNet({ ...p.lines[x.index]!, qty: x.qty }), 0);
  const run = async () => {
    setBusy(true);
    const doc = await postPurchaseReturn(cloud, { purchase: p, lines: chosen, reason: reason.trim(), userId: s.user.id });
    setBusy(false);
    toast.success(`Debit note ${doc.documentNo} posted`, `${money(value)} credited against ${p.documentNo}; stock reduced`);
    onClose();
    nav(`/purchase/${doc.id}`);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Purchase return against ${p.documentNo}`} description="Creates a debit note, purchase-return stock movements and reduces the supplier balance."
      footer={<><span className="muted num">Return value {money(value)}</span><div className="ex-spacer" /><Button onClick={onClose}>Cancel</Button><Button variant="danger" icon="Undo2" loading={busy} disabled={!chosen.length || !!over || !reason.trim()} onClick={() => void run()}>Post return</Button></>}>
      <div className="ex-stack">
        <div className="bo-doc-grid">
          <DataTable
            density="dense"
            pageSize={200}
            rows={p.lines.map((l, i) => ({ l, i }))}
            rowKey={({ i }) => String(i)}
            columns={[
              { key: 'p', header: 'Item', render: ({ l }) => <div><div className="bo-cell-main">{l.name}</div><div className="bo-cell-sub">{l.batchCode ?? ''}</div></div> },
              { key: 'r', header: 'Received', align: 'right', render: ({ l }) => fq(l.qty + l.freeQty) },
              { key: 'a', header: 'Returnable', align: 'right', render: ({ i }) => fq(max(i)) },
              { key: 'q', header: 'Return qty', align: 'right', width: 120, render: ({ i, l }) => <input className="num" inputMode="decimal" aria-label={`Return qty for ${l.name}`} aria-invalid={Number(qty[i] ?? 0) > max(i)} value={qty[i] ?? ''} placeholder="0" onChange={(e) => setQty({ ...qty, [i]: e.target.value })} /> },
            ]}
          />
        </div>
        {over ? <InlineAlert tone="danger">Line {over.index + 1}: you can return at most {fq(max(over.index))}.</InlineAlert> : null}
        <Textarea label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged in transit, short expiry" />
      </div>
    </Modal>
  );
}
