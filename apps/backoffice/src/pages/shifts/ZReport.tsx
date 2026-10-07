import { useParams, useNavigate } from 'react-router-dom';
import { BarList, Button, Card, CardHeader, DataTable, DescriptionList, InlineAlert, KpiCard, StatusBadge, TotalRow } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import { cashBreakdown, summarizeTax } from '@elixir/domain';
import { dateTime, money, number } from '@elixir/format';
import { KpiRow, NotFound, PageFrame } from '../../components/common';
import { METHOD_LABEL, paymentSplit, sum, useCloud, useLookups, userName } from '../../lib/data';
import { useSession } from '../../lib/session';
import { SHIFT_STATUS, VarianceBadge } from './Shifts';

/** Z-report computed from the shift record + sales/returns/cash movements of that shift. */
export function ZReport() {
  const { id } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const sh = useEntity(cloud, 'shifts', id);
  const data = useLive(cloud, ['sales', 'returns', 'cashMovements'], () => {
    if (!sh) return null;
    const sales = cloud.where('sales', (x) => x.shiftId === sh.id);
    const ok = sales.filter((x) => x.status !== 'cancelled');
    const returns = cloud.where('returns', (r) => r.shiftId === sh.id);
    const cms = cloud.where('cashMovements', (c) => c.shiftId === sh.id);
    const items = new Map<string, { name: string; qty: number; value: number }>();
    ok.forEach((x) => x.lines.forEach((l) => { const c = items.get(l.productId) ?? { name: l.name, qty: 0, value: 0 }; c.qty += l.qty; c.value += l.netPaise; items.set(l.productId, c); }));
    const cashSales = sum(ok, (x) => sum(x.tenders.filter((t) => t.method === 'cash'), (t) => t.amountPaise));
    const cb = cms.length ? cashBreakdown(cms) : { opening: sh.openingCash, cashSales, cashReceipts: 0, pettyReceived: 0, pettyPaid: 0, cashRefunds: sum(returns.filter((r) => r.refundMethod === 'cash'), (r) => r.refundPaise), expected: 0 };
    if (!cms.length) cb.expected = cb.opening + cb.cashSales - cb.cashRefunds;
    return {
      ok, cancelled: sales.length - ok.length, returns, split: paymentSplit(ok), cb,
      gross: sum(ok, (x) => x.grossPaise), disc: sum(ok, (x) => x.lineDiscountPaise + x.billDiscountPaise), taxable: sum(ok, (x) => x.taxablePaise), tax: sum(ok, (x) => x.taxPaise), round: sum(ok, (x) => x.roundOffPaise), total: sum(ok, (x) => x.totalPaise),
      taxRows: summarizeTax(ok.flatMap((x) => x.taxSummary.map((t) => ({ taxRatePct: t.ratePct, taxablePaise: t.taxablePaise, cgstPaise: t.cgstPaise, sgstPaise: t.sgstPaise, igstPaise: t.igstPaise })))),
      top: [...items.values()].sort((a, b) => b.value - a.value).slice(0, 8),
      petty: cms.filter((c) => c.type === 'petty_paid' || c.type === 'petty_received'),
    };
  }, [sh?.id]);
  if (!sh || sh.tenantId !== s.tenant.id || !data) return <NotFound what="Shift" back={{ label: 'Back to shifts', to: '/shifts' }} />;
  const counter = L.counters.get(sh.counterId);
  const expected = sh.expectedCash ?? data.cb.expected;
  return (
    <PageFrame
      crumbs={[{ label: 'Shifts', to: '/shifts' }, { label: sh.code }]}
      title={`Z-report · ${sh.code}`}
      meta={<StatusBadge meta={SHIFT_STATUS[sh.status]} />}
      description={`${s.storeName(sh.storeId)} · ${counter?.code} · ${userName(L, sh.openedBy)} · ${dateTime(sh.openedAt)} – ${sh.closedAt ? dateTime(sh.closedAt) : 'still open'}`}
      actions={<><Button icon="Receipt" onClick={() => nav('/sales')}>View sales</Button><Button variant="primary" icon="Printer" onClick={() => window.print()}>Print Z-report</Button></>}
    >
      {sh.status === 'open' ? <InlineAlert tone="info" title="Shift is still open">Figures are live (X-report). The final Z-report is fixed when the cashier closes the shift on the counter.</InlineAlert> : null}
      <KpiRow>
        <KpiCard label="Net sales" icon="IndianRupee" value={money(data.total)} foot={`${data.ok.length} bills · ${data.cancelled} cancelled`} />
        <KpiCard label="Returns" icon="Undo2" value={money(sum(data.returns, (r) => r.refundPaise))} foot={`${data.returns.length} return(s)`} />
        <KpiCard label="Expected cash" icon="Wallet" value={money(expected)} />
        <KpiCard label="Variance" icon="Scale" value={sh.status === 'open' ? '—' : <VarianceBadge v={sh.variance} />} foot={sh.varianceReason ? `${sh.varianceReason}${sh.varianceApprovedBy ? ` · approved by ${userName(L, sh.varianceApprovedBy)}` : ''}` : undefined} />
      </KpiRow>
      <div className="bo-grid-3">
        <Card>
          <CardHeader title="Sales summary" icon="Calculator" />
          <div style={{ padding: 16 }} className="ex-stack">
            <TotalRow label="Gross" paise={data.gross} />
            <TotalRow label="Discounts" paise={-data.disc} />
            <TotalRow label="Taxable" paise={data.taxable} />
            <TotalRow label="GST" paise={data.tax} />
            <TotalRow label="Round off" paise={data.round} />
            <TotalRow label="Net sales" paise={data.total} grand />
          </div>
        </Card>
        <Card>
          <CardHeader title="Tenders" icon="Wallet" />
          <div style={{ padding: 16 }} className="ex-stack">
            {data.split.map((p) => <TotalRow key={p.method} label={`${METHOD_LABEL[p.method]} · ${p.count}`} paise={p.amount} />)}
            <TotalRow label="Total collected" paise={sum(data.split, (p) => p.amount)} grand />
          </div>
        </Card>
        <Card>
          <CardHeader title="Cash drawer" icon="Banknote" />
          <div style={{ padding: 16 }} className="ex-stack">
            <TotalRow label="Opening float" paise={data.cb.opening} />
            <TotalRow label="+ Cash sales" paise={data.cb.cashSales} />
            {data.cb.cashReceipts ? <TotalRow label="+ Cash receipts" paise={data.cb.cashReceipts} /> : null}
            {data.cb.pettyReceived ? <TotalRow label="+ Petty received" paise={data.cb.pettyReceived} /> : null}
            {data.cb.pettyPaid ? <TotalRow label="− Petty paid" paise={-data.cb.pettyPaid} /> : null}
            {data.cb.cashRefunds ? <TotalRow label="− Cash refunds" paise={-data.cb.cashRefunds} /> : null}
            <TotalRow label="Expected" paise={expected} grand />
            {sh.closingCash != null ? <TotalRow label="Counted" paise={sh.closingCash} /> : null}
            {sh.variance != null && sh.status !== 'open' ? <TotalRow label="Variance (counted − expected)" paise={sh.variance} /> : null}
          </div>
        </Card>
      </div>
      <div className="bo-grid-2">
        <Card className="bo-card-table">
          <CardHeader title="GST summary" icon="Percent" />
          <DataTable density="dense" rows={data.taxRows} rowKey={(r) => String(r.ratePct)}
            columns={[
              { key: 'r', header: 'Rate', render: (r) => `${r.ratePct}%` },
              { key: 't', header: 'Taxable', align: 'right', render: (r) => money(r.taxablePaise) },
              { key: 'c', header: 'CGST', align: 'right', render: (r) => money(r.cgstPaise) },
              { key: 's', header: 'SGST', align: 'right', render: (r) => money(r.sgstPaise) },
              { key: 'i', header: 'IGST', align: 'right', render: (r) => money(r.igstPaise) },
            ]} />
        </Card>
        <Card>
          <CardHeader title="Top items" icon="Trophy" />
          <div style={{ padding: 16 }}><BarList items={data.top.map((t) => ({ label: `${t.name} × ${number(Math.round(t.qty * 1000) / 1000)}`, value: t.value }))} format={(v) => money(v, { whole: true })} /></div>
        </Card>
      </div>
      <div className="bo-grid-2">
        <Card>
          <CardHeader title="Opening denominations" icon="Coins" />
          <div style={{ padding: 16 }}>
            <DescriptionList right items={[...sh.openingDenominations.filter((d) => d.count).map((d) => [`${money(d.denomination, { whole: true })} × ${d.count}`, money(d.denomination * d.count)] as [string, string]), ['Total', money(sh.openingCash)]]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Petty cash & notes" icon="NotebookPen" />
          <div style={{ padding: 16 }}>
            {data.petty.length ? <DescriptionList right items={data.petty.map((p) => [`${dateTime(p.createdAt)} · ${p.note ?? p.type}`, money(p.amountPaise, { signed: true })] as [string, string])} /> : <span className="muted">No petty cash movements recorded.</span>}
          </div>
        </Card>
      </div>
    </PageFrame>
  );
}
