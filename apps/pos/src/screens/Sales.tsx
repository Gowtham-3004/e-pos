import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Sale } from '@elixir/contracts';
import { SYNC_STATE, TRANSACTION_STATUS } from '@elixir/domain';
import { dateLong, dateTime, money, qty as fmtQty, time } from '@elixir/format';
import { useLive } from '@elixir/local-store/react';
import { Badge, Button, DataTable, Drawer, EmptyState, FilterBar, SearchInput, Select, StatusBadge, Tabs, Timeline } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { businessDateOf } from '../lib/ops';
import { usePrint } from '../lib/print';
import { Receipt } from '../components/Receipt';

const METHOD_LABEL: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', credit: 'Credit', redemption: 'Points' };

export function SalesScreen() {
  const s = useSession();
  const { device } = usePos();
  const bd = businessDateOf(s);
  const [counter, setCounter] = useState<string>(s.counter?.id ?? '');
  const [method, setMethod] = useState('');
  const [sync, setSync] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string>();
  const counters = device.where('counters', (c) => c.storeId === s.store.id && c.kind === 'billing');
  const all = useLive(device, ['sales'], () => device.where('sales', (x) => x.storeId === s.store.id && x.businessDate === bd).sort((a, b) => b.committedAt.localeCompare(a.committedAt)), [s.store.id, bd]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all.filter(
      (x) =>
        (!counter || x.counterId === counter) &&
        (!method || x.tenders.some((tt) => tt.method === method)) &&
        (!sync || x.syncState === sync) &&
        (!t || x.documentNo.toLowerCase().includes(t) || (x.customerName ?? '').toLowerCase().includes(t)),
    );
  }, [all, counter, method, sync, q]);
  const total = rows.reduce((a, x) => a + x.totalPaise, 0);
  const pending = rows.filter((x) => x.syncState !== 'synced').length;
  const active = [
    counter && { key: 'c', label: `Counter ${device.get('counters', counter)?.code}`, onRemove: () => setCounter('') },
    method && { key: 'm', label: METHOD_LABEL[method], onRemove: () => setMethod('') },
    sync && { key: 's', label: `Sync: ${SYNC_STATE[sync as Sale['syncState']].label}`, onRemove: () => setSync('') },
  ].filter(Boolean) as Array<{ key: string; label: string; onRemove: () => void }>;

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Sales</div>
          <div className="pos-page__desc">{s.store.name} · business date {dateLong(bd)} · posted invoices are read-only</div>
        </div>
        <div className="ex-spacer" />
        <div className="pos-stat" style={{ minWidth: 140 }}><span className="pos-stat__k">Bills</span><span className="pos-stat__v">{rows.length}</span></div>
        <div className="pos-stat" style={{ minWidth: 160 }}><span className="pos-stat__k">Value</span><span className="pos-stat__v">{money(total)}</span></div>
        <div className="pos-stat" style={{ minWidth: 140 }}><span className="pos-stat__k">Awaiting sync</span><span className="pos-stat__v">{pending}</span></div>
      </div>
      <FilterBar active={active} onClearAll={() => { setCounter(''); setMethod(''); setSync(''); }}>
        <div style={{ width: 300 }}><SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Invoice no. or customer" /></div>
        <Select value={counter} onChange={(e) => setCounter(e.target.value)} options={[{ value: '', label: 'All counters' }, ...counters.map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` }))]} aria-label="Counter" />
        <Select value={method} onChange={(e) => setMethod(e.target.value)} options={[{ value: '', label: 'All payment methods' }, ...['cash', 'upi', 'card', 'credit'].map((m) => ({ value: m, label: METHOD_LABEL[m]! }))]} aria-label="Payment method" />
        <Select value={sync} onChange={(e) => setSync(e.target.value)} options={[{ value: '', label: 'Any sync state' }, ...(['pending', 'synced', 'failed', 'conflict'] as const).map((k) => ({ value: k, label: SYNC_STATE[k].label }))]} aria-label="Sync state" />
      </FilterBar>
      <div className="ex-card">
        <DataTable
          rows={rows}
          rowKey={(x) => x.id}
          onRowClick={(x) => setOpen(x.id)}
          selectedKey={open}
          pageSize={14}
          empty={<EmptyState icon="Receipt" title="No sales match">{all.length ? 'Clear filters to see all bills for today.' : 'Bills completed on this store today appear here.'}</EmptyState>}
          columns={[
            { key: 'documentNo', header: 'Invoice', sortable: true, render: (x) => <b className="num">{x.documentNo}</b> },
            { key: 'committedAt', header: 'Time', sortable: true, render: (x) => <span className="num">{time(x.committedAt)}</span> },
            { key: 'counter', header: 'Counter', render: (x) => device.get('counters', x.counterId)?.code },
            { key: 'customer', header: 'Customer', render: (x) => x.customerName ?? <span className="muted">Walk-in</span> },
            { key: 'items', header: 'Items', align: 'right', render: (x) => x.itemCount },
            { key: 'methods', header: 'Paid by', render: (x) => <span className="ex-row" style={{ gap: 4 }}>{[...new Set(x.tenders.map((t) => t.method))].map((m) => <Badge key={m}>{METHOD_LABEL[m]}</Badge>)}</span> },
            { key: 'status', header: 'Status', render: (x) => <StatusBadge meta={TRANSACTION_STATUS[x.status]} /> },
            { key: 'sync', header: 'Sync', render: (x) => <StatusBadge meta={SYNC_STATE[x.syncState]} /> },
            { key: 'totalPaise', header: 'Total', align: 'right', sortable: true, render: (x) => <b className="num">{money(x.totalPaise)}</b> },
          ]}
        />
      </div>
      <SaleDrawer saleId={open} onClose={() => setOpen(undefined)} />
    </div>
  );
}

export function SaleDrawer({ saleId, onClose }: { saleId?: string; onClose: () => void }) {
  const { device } = usePos();
  const s = useSession();
  const nav = useNavigate();
  const print = usePrint((x) => x.print);
  const sale = useLive(device, ['sales'], () => device.get('sales', saleId), [saleId]);
  const audits = useLive(device, ['auditEvents'], () => device.where('auditEvents', (a) => a.entityId === saleId || (!!sale && a.documentNo === sale.documentNo)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [saleId, sale?.documentNo]);
  const returns = useLive(device, ['returns'], () => device.where('returns', (r) => r.originalSaleId === saleId), [saleId]);
  const [tab, setTab] = useState<'details' | 'receipt' | 'audit'>('details');
  if (!sale) return null;
  return (
    <Drawer
      open={!!saleId}
      onClose={onClose}
      size="lg"
      title={<span className="ex-row">Invoice <span className="num">{sale.documentNo}</span></span>}
      description={`${dateTime(sale.committedAt)} · ${device.get('counters', sale.counterId)?.code} · ${device.get('users', sale.userId)?.name}`}
      footer={
        <>
          <Button icon="ScrollText" onClick={() => setTab('audit')}>View audit</Button>
          <div className="ex-spacer" />
          <Button icon="Printer" onClick={() => print(<Receipt db={device} sale={sale} copy />)}>Print</Button>
          {s.permissions.includes('pos.return') && s.family === 'retail' ? (
            <Button variant="primary" icon="Undo2" disabled={sale.lines.every((l) => l.returnedQty >= l.qty)} onClick={() => nav(`/returns?invoice=${encodeURIComponent(sale.documentNo)}`)}>Return</Button>
          ) : null}
        </>
      }
    >
      <div className="ex-stack" style={{ gap: 14 }}>
        <div className="ex-row" style={{ flexWrap: 'wrap' }}>
          <Badge tone="success" icon="FileCheck2" size="lg">POSTED</Badge>
          <StatusBadge meta={TRANSACTION_STATUS[sale.status]} size="lg" />
          <StatusBadge meta={SYNC_STATE[sale.syncState]} size="lg" />
          {sale.printed ? <Badge icon="Printer" size="lg">Printed</Badge> : <Badge tone="warning" icon="Printer" size="lg">Not printed</Badge>}
          <span className="ex-spacer" />
          <span className="muted" style={{ fontSize: 12 }}>Read-only · corrections via Return</span>
        </div>
        <Tabs value={tab} onChange={setTab} items={[{ key: 'details', label: 'Details' }, { key: 'receipt', label: 'Receipt' }, { key: 'audit', label: 'Audit', count: audits.length }]} />
        {tab === 'details' ? (
          <>
            <table className="ex-table ex-table--dense">
              <thead><tr><th>#</th><th>Item</th><th className="ex-right">Qty</th><th className="ex-right">Rate</th><th className="ex-right">Disc</th><th className="ex-right">GST</th><th className="ex-right">Net</th></tr></thead>
              <tbody>
                {sale.lines.map((l) => (
                  <tr key={l.id}>
                    <td className="muted">{l.lineNo}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        HSN {l.hsn}{l.variantLabel ? ` · ${l.variantLabel}` : ''}{l.batchCode ? ` · Batch ${l.batchCode}` : ''}{l.serials?.length ? ` · SN ${l.serials.join(', ')}` : ''}
                        {l.returnedQty ? <span style={{ color: 'var(--status-warning)' }}> · {l.returnedQty} returned</span> : null}
                      </div>
                    </td>
                    <td className="ex-right num">{fmtQty(l.qty, l.unit === 'kg')}</td>
                    <td className="ex-right num">{money(l.unitPricePaise)}</td>
                    <td className="ex-right num">{l.discountPaise ? money(l.discountPaise) : '—'}</td>
                    <td className="ex-right num">{l.taxRatePct}%</td>
                    <td className="ex-right num"><b>{money(l.netPaise)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pos-split" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="ex-card pos-card-pad">
                <div className="pos-section-title" style={{ marginBottom: 8 }}>Tenders</div>
                <div className="pos-kv">
                  {sale.tenders.map((t) => (
                    <span key={t.id} style={{ display: 'contents' }}>
                      <span>{METHOD_LABEL[t.method]}{t.reference ? ` · ${t.reference}` : ''}{t.confirmation === 'manual' ? ' (manual ref)' : ''}</span>
                      <span>{money(t.amountPaise)}</span>
                    </span>
                  ))}
                  {sale.tenders.some((t) => t.changePaise) ? (<><span>Change returned</span><span>{money(sale.tenders.reduce((a, t) => a + (t.changePaise ?? 0), 0))}</span></>) : null}
                </div>
              </div>
              <div className="ex-card pos-card-pad">
                <div className="pos-section-title" style={{ marginBottom: 8 }}>Totals</div>
                <div className="pos-kv">
                  <span>Gross</span><span>{money(sale.grossPaise)}</span>
                  {sale.lineDiscountPaise + sale.billDiscountPaise ? (<><span>Discounts</span><span>−{money(sale.lineDiscountPaise + sale.billDiscountPaise)}</span></>) : null}
                  <span>Taxable</span><span>{money(sale.taxablePaise)}</span>
                  <span>{sale.interState ? 'IGST' : 'CGST + SGST'}</span><span>{money(sale.taxPaise)}</span>
                  {sale.roundOffPaise ? (<><span>Round off</span><span>{money(sale.roundOffPaise, { signed: true })}</span></>) : null}
                  <span className="total">Total</span><span className="total">{money(sale.totalPaise)}</span>
                </div>
              </div>
            </div>
            {returns.length ? (
              <div className="ex-card pos-card-pad">
                <div className="pos-section-title" style={{ marginBottom: 8 }}>Returns against this invoice</div>
                {returns.map((r) => <div key={r.id} className="ex-row num" style={{ fontSize: 13 }}><b>{r.documentNo}</b><span className="muted">{dateTime(r.createdAt)}</span><span className="ex-spacer" />{money(r.refundPaise)}</div>)}
              </div>
            ) : null}
            <div className="muted" style={{ fontSize: 12 }}>Sync: {SYNC_STATE[sale.syncState].label}{sale.syncedAt ? ` at ${dateTime(sale.syncedAt)}` : ' — uploads automatically when cloud is reachable'}</div>
          </>
        ) : tab === 'receipt' ? (
          <div className="success__receipt"><Receipt db={device} sale={sale} /></div>
        ) : (
          <Timeline
            items={audits.map((a) => ({
              id: a.id,
              time: dateTime(a.createdAt),
              title: a.summary,
              meta: `${device.get('users', a.actorId)?.name ?? a.actorId}${a.approvedBy ? ` · approved by ${device.get('users', a.approvedBy)?.name}` : ''} · ${a.action}${a.reason ? ` · ${a.reason}` : ''}`,
              tone: (a.action.startsWith('override') ? 'warning' : 'success') as 'warning' | 'success' | 'info',
            })).concat(sale.syncedAt ? [{ id: 'sync', time: dateTime(sale.syncedAt), title: 'Synced to Elixir Cloud', meta: 'technical · idempotent upload acknowledged', tone: 'info' as const }] : [])}
          />
        )}
      </div>
    </Drawer>
  );
}
