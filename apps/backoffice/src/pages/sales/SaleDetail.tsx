import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SYNC_STATE, TRANSACTION_STATUS } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, DataTable, DescriptionList, EmptyState, Icon, StatusBadge, Timeline, TotalRow, type Column } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import { date, dateTime, money, qty as fq } from '@elixir/format';
import type { SaleLine } from '@elixir/contracts';
import { NotFound, PageFrame } from '../../components/common';
import { InvoicePrint } from '../../components/PrintPreview';
import { METHOD_LABEL, useCloud, useLookups, userName } from '../../lib/data';
import { useSession } from '../../lib/session';
import { useSettings } from '../../lib/settings';

export function SaleDetail() {
  const { id } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const settings = useSettings();
  const sale = useEntity(cloud, 'sales', id);
  const [print, setPrint] = useState(false);
  const auditRef = useRef<HTMLDivElement>(null);
  const audit = useLive(cloud, ['auditEvents'], () => (sale ? cloud.where('auditEvents', (a) => a.entityId === sale.id || (!!a.documentNo && a.documentNo === sale.documentNo)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []), [sale?.id]);
  const returns = useLive(cloud, ['returns'], () => (sale ? cloud.where('returns', (r) => r.originalSaleId === sale.id) : []), [sale?.id]);

  if (!sale || sale.tenantId !== s.tenant.id) return <NotFound what="Invoice" back={{ label: 'Back to sales', to: '/sales' }} />;
  const counter = L.counters.get(sale.counterId);
  const device = L.devices.get(sale.deviceId);
  const shift = cloud.get('shifts', sale.shiftId);
  const isRest = sale.kind === 'restaurant';

  const cols: Column<SaleLine>[] = [
    { key: 'lineNo', header: '#', width: 36, render: (l) => <span className="muted num">{l.lineNo}</span> },
    {
      key: 'name',
      header: 'Item',
      render: (l) => (
        <div>
          <div className="bo-cell-main">{l.name}{l.variantLabel ? <span className="muted"> · {l.variantLabel}</span> : null}</div>
          <div className="bo-cell-sub">
            {l.barcode ? <span className="num">{l.barcode}</span> : null}
            {l.batchCode ? <> · Batch {l.batchCode}{l.expiryDate ? ` · Exp ${date(l.expiryDate)}` : ''}</> : null}
            {l.serials?.length ? <> · S/N {l.serials.join(', ')}</> : null}
            {l.returnedQty ? <> · <span className="bo-neg">Returned {fq(l.returnedQty)}</span></> : null}
          </div>
        </div>
      ),
    },
    { key: 'hsn', header: isRest ? 'SAC' : 'HSN', render: (l) => <span className="num">{l.hsn}</span> },
    { key: 'qty', header: 'Qty', align: 'right', render: (l) => `${fq(l.qty, l.unit !== 'pcs')} ${l.unit !== 'pcs' ? l.unit : ''}` },
    { key: 'mrp', header: 'MRP', align: 'right', hidden: isRest, render: (l) => money(l.mrpPaise) },
    { key: 'rate', header: 'Rate', align: 'right', render: (l) => money(l.unitPricePaise) },
    { key: 'disc', header: 'Disc', align: 'right', render: (l) => (l.discountPaise ? money(l.discountPaise) : '—') },
    { key: 'taxable', header: 'Taxable', align: 'right', render: (l) => money(l.taxablePaise) },
    { key: 'gst', header: 'GST', align: 'right', render: (l) => <span>{money(l.cgstPaise + l.sgstPaise + l.igstPaise)} <span className="muted">({l.taxRatePct}%)</span></span> },
    { key: 'net', header: 'Amount', align: 'right', render: (l) => <b>{money(l.netPaise)}</b> },
  ];

  return (
    <PageFrame
      crumbs={[{ label: 'Sales', to: '/sales' }, { label: sale.documentNo }]}
      title={<span className="num">{sale.documentNo}</span>}
      meta={
        <>
          <span className="bo-posted-stamp"><Icon name="FileCheck2" size={14} /> POSTED</span>
          <StatusBadge meta={TRANSACTION_STATUS[sale.status]} />
          <StatusBadge meta={SYNC_STATE[sale.syncState]} />
        </>
      }
      description={`${dateTime(sale.committedAt)} · ${s.storeName(sale.storeId)} · ${counter?.code ?? ''} · ${userName(L, sale.userId)}`}
      actions={
        <>
          <Button icon="ScrollText" onClick={() => auditRef.current?.scrollIntoView({ behavior: 'smooth' })}>View audit</Button>
          <Button variant="primary" icon="Printer" onClick={() => setPrint(true)}>Print</Button>
        </>
      }
    >
      <div className="ex-hint" style={{ marginTop: -6 }}>
        <Icon name="Lock" size={13} style={{ verticalAlign: -2 }} /> Posted invoices are immutable. Corrections are made at the POS as a return or cancellation, which creates a new linked document.
      </div>
      <div className="bo-grid-main">
        <div className="ex-stack" style={{ gap: 16 }}>
          <Card className="bo-card-table">
            <CardHeader title="Lines" subtitle={`${sale.lines.length} lines · ${sale.itemCount} items${sale.interState ? ' · Inter-state (IGST)' : ''}`} icon="List" />
            <DataTable columns={cols} rows={sale.lines} rowKey={(l) => l.id} density="dense" pageSize={100} />
          </Card>
          <Card className="bo-card-table">
            <CardHeader title="Tax summary" icon="Percent" />
            <DataTable
              density="dense"
              rowKey={(r) => String(r.ratePct)}
              rows={sale.taxSummary}
              columns={[
                { key: 'rate', header: 'GST rate', render: (r) => `${r.ratePct}%` },
                { key: 'taxable', header: 'Taxable', align: 'right', render: (r) => money(r.taxablePaise) },
                { key: 'cgst', header: 'CGST', align: 'right', render: (r) => money(r.cgstPaise) },
                { key: 'sgst', header: 'SGST', align: 'right', render: (r) => money(r.sgstPaise) },
                { key: 'igst', header: 'IGST', align: 'right', render: (r) => money(r.igstPaise) },
                { key: 'tot', header: 'Total tax', align: 'right', render: (r) => <b>{money(r.cgstPaise + r.sgstPaise + r.igstPaise)}</b> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Returns against this invoice" icon="Undo2" subtitle={returns.length ? `${returns.length} return(s)` : undefined} />
            {returns.length ? (
              <DataTable
                density="dense"
                rows={returns}
                rowKey={(r) => r.id}
                columns={[
                  { key: 'doc', header: 'Return no.', render: (r) => <span className="num bo-cell-main">{r.documentNo}</span> },
                  { key: 'at', header: 'Date', render: (r) => <span className="num">{dateTime(r.createdAt)}</span> },
                  { key: 'items', header: 'Items', render: (r) => r.lines.map((l) => `${l.name} × ${l.qty}${l.restockable ? '' : ' (damaged)'}`).join(', ') },
                  { key: 'reason', header: 'Reason', render: (r) => r.lines[0]?.reason },
                  { key: 'approved', header: 'Approved by', render: (r) => userName(L, r.approvedBy) },
                  { key: 'refund', header: 'Refund', align: 'right', render: (r) => <b>{money(r.refundPaise)}</b> },
                ]}
              />
            ) : (
              <EmptyState quiet icon="Undo2" title="No returns">Returns are recorded at the POS against this invoice and appear here once synced.</EmptyState>
            )}
          </Card>
          <div ref={auditRef}>
            <Card>
              <CardHeader title="Audit timeline" icon="ScrollText" subtitle="Immutable business and technical events" />
              <div style={{ padding: 16 }}>
                <Timeline
                  items={[
                    { id: 'created', time: dateTime(sale.createdAt), title: 'Cart started on counter', meta: `${counter?.code} · ${device?.code ?? sale.deviceId}` },
                    { id: 'committed', time: dateTime(sale.committedAt), title: `Invoice ${sale.documentNo} committed locally`, meta: `${userName(L, sale.userId)}${sale.approvedBy ? ` · approved by ${userName(L, sale.approvedBy)}` : ''}`, tone: 'success' },
                    ...(sale.syncedAt ? [{ id: 'synced', time: dateTime(sale.syncedAt), title: 'Accepted by Elixir Cloud', meta: 'Sync acknowledged (idempotent)', tone: 'info' as const }] : [{ id: 'pending', time: '—', title: 'Awaiting sync from device', meta: 'Committed on device; will appear as Synced when the counter reconnects', tone: 'warning' as const }]),
                    ...audit.filter((a) => a.action !== 'sale.completed').map((a) => ({ id: a.id, time: dateTime(a.createdAt), title: a.summary, meta: `${a.category} · ${userName(L, a.actorId)}${a.approvedBy ? ` · approved by ${userName(L, a.approvedBy)}` : ''}${a.reason ? ` · ${a.reason}` : ''}`, tone: a.category === 'security' ? ('danger' as const) : undefined })),
                    ...returns.map((r) => ({ id: r.id, time: dateTime(r.createdAt), title: `Return ${r.documentNo} · ${money(r.refundPaise)}`, meta: `Refund via ${METHOD_LABEL[r.refundMethod]}`, tone: 'warning' as const })),
                  ]}
                />
              </div>
            </Card>
          </div>
        </div>

        <div className="ex-stack" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Totals" icon="Calculator" />
            <div style={{ padding: 16 }} className="ex-stack">
              <TotalRow label="Gross" paise={sale.grossPaise} />
              {sale.lineDiscountPaise ? <TotalRow label="Line discounts" paise={-sale.lineDiscountPaise} /> : null}
              {sale.billDiscountPaise ? <TotalRow label="Bill discount" paise={-sale.billDiscountPaise} /> : null}
              <TotalRow label="Taxable value" paise={sale.taxablePaise} />
              <TotalRow label="GST" paise={sale.taxPaise} />
              {sale.roundOffPaise ? <TotalRow label="Round off" paise={sale.roundOffPaise} /> : null}
              <TotalRow label="Total" paise={sale.totalPaise} grand />
              {sale.savingsPaise ? <div className="bo-pos" style={{ fontSize: 13, fontWeight: 600 }}>Customer saved {money(sale.savingsPaise)}</div> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Tenders" icon="Wallet" />
            <div style={{ padding: 16 }} className="ex-stack">
              {sale.tenders.map((t) => (
                <div key={t.id} className="ex-row" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <div className="bo-cell-main">{METHOD_LABEL[t.method]}</div>
                    <div className="bo-cell-sub">
                      {t.reference ? `Ref ${t.reference} · ` : ''}
                      {t.confirmation === 'manual' ? 'Manual reference (offline)' : t.confirmation === 'provider' ? 'Provider confirmed' : t.receivedPaise ? `Received ${money(t.receivedPaise)} · change ${money(t.changePaise ?? 0)}` : '—'}
                    </div>
                  </div>
                  <b className="num">{money(t.amountPaise)}</b>
                </div>
              ))}
              {sale.loyaltyEarned ? <Badge tone="info" icon="Gift">{sale.loyaltyEarned} points earned</Badge> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title="Origin" icon="MapPin" subtitle="Where and when this invoice was created" />
            <div style={{ padding: 16 }}>
              <DescriptionList
                items={[
                  ['Store', s.storeName(sale.storeId)],
                  ['Counter', counter ? `${counter.code} · ${counter.name}` : sale.counterId],
                  ['Device', device ? `${device.code} · ${device.name}` : sale.deviceId],
                  ['Cashier', userName(L, sale.userId)],
                  ['Shift', shift ? <button type="button" className="bo-link" onClick={() => nav(`/shifts/${shift.id}`)}>{shift.code}</button> : sale.shiftId],
                  ['Business date', date(sale.businessDate)],
                  ['Created', dateTime(sale.createdAt)],
                  ['Committed (device)', dateTime(sale.committedAt)],
                  ['Synced (cloud)', sale.syncedAt ? dateTime(sale.syncedAt) : 'Not yet'],
                  ['Customer', sale.customerId ? <button type="button" className="bo-link" onClick={() => nav(`/customers/${sale.customerId}`)}>{sale.customerName}</button> : 'Walk-in'],
                ]}
              />
            </div>
          </Card>
        </div>
      </div>
      <InvoicePrint open={print} onClose={() => setPrint(false)} sale={sale} tenant={s.tenant} store={L.stores.get(sale.storeId)} cashier={userName(L, sale.userId)} footer={settings.invoiceFooter} />
    </PageFrame>
  );
}
