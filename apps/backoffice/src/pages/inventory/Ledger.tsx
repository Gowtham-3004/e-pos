import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { StockMovement } from '@elixir/contracts';
import { MOVEMENT_LABEL } from '@elixir/domain';
import { Badge, Button, Card, CardHeader, DataTable, EmptyState, Icon, InlineAlert, KpiCard, Select, type Column } from '@elixir/ui';
import { useEntity, useLive } from '@elixir/local-store/react';
import type { LocalDatabase } from '@elixir/local-store';
import { dateTime, qty as fq } from '@elixir/format';
import { DateRangeControl, ExportMenu, KpiRow, NotFound, PageFrame, useRange } from '../../components/common';
import { today, useCloud, useLookups, userName } from '../../lib/data';
import { ledger, onHandIn, type LedgerRow } from '../../lib/stock';
import { downloadTable } from '../../lib/csv';
import { useSession } from '../../lib/session';

export function sourceDoc(cloud: LocalDatabase, mv: StockMovement): { label: string; to?: string } {
  switch (mv.sourceType) {
    case 'sale': {
      const s = cloud.get('sales', mv.sourceId);
      return { label: s?.documentNo ?? mv.sourceId, to: s ? `/sales/${s.id}` : undefined };
    }
    case 'purchase': {
      const p = cloud.get('purchases', mv.sourceId);
      return { label: p?.documentNo ?? mv.sourceId, to: p ? `/purchase/${p.id}` : undefined };
    }
    case 'return': {
      const r = cloud.get('returns', mv.sourceId);
      return { label: r?.documentNo ?? mv.sourceId, to: r?.originalSaleId ? `/sales/${r.originalSaleId}` : undefined };
    }
    case 'adjustment':
    case 'stocktake':
      return { label: cloud.get('adjustments', mv.sourceId)?.documentNo ?? mv.sourceId, to: '/inventory?tab=adjustments' };
    case 'transfer':
      return { label: mv.reason ?? 'Transfer', to: '/inventory?tab=transfers' };
    case 'opening':
      return { label: 'Opening balance' };
    default:
      return { label: mv.sourceId };
  }
}

export function LedgerPage() {
  const { productId } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const product = useEntity(cloud, 'products', productId);
  const [params] = useSearchParams();
  const [store, setStore] = useState(params.get('store') ?? (s.storeId !== 'all' ? s.storeId : ''));
  const [range, setRange] = useRange('30d');
  const storeIds = store ? [store] : s.scope;
  const data = useLive(cloud, ['stockMovements'], () => (product ? { ...ledger(cloud, storeIds, product.id, range.from, range.to), onHandNow: onHandIn(cloud, storeIds, product.id) } : null), [product?.id, storeIds.join(','), range.from, range.to]);
  const rows = useMemo(() => (data ? [...data.rows].reverse() : []), [data]);

  if (!product || product.tenantId !== s.tenant.id || !data) return <NotFound what="Product" back={{ label: 'Back to inventory', to: '/inventory' }} />;
  const reconciles = range.to >= today() ? Math.abs(data.closing - data.onHandNow) < 0.0005 : true;

  const cols: Column<LedgerRow>[] = [
    { key: 'at', header: 'Date & time', render: (r) => <span className="num">{dateTime(r.mv.createdAt)}</span> },
    { key: 'type', header: 'Movement', render: (r) => <Badge tone={r.mv.type === 'sale_return_damaged' ? 'warning' : r.mv.qty >= 0 ? 'success' : 'neutral'} icon={r.mv.qty >= 0 ? 'ArrowDownLeft' : 'ArrowUpRight'}>{MOVEMENT_LABEL[r.mv.type]}</Badge> },
    { key: 'doc', header: 'Source document', render: (r) => { const d = sourceDoc(cloud, r.mv); return d.to ? <button type="button" className="bo-link num" onClick={() => nav(d.to!)}>{d.label}</button> : <span className="num">{d.label}</span>; } },
    { key: 'store', header: 'Store', hidden: storeIds.length < 2, render: (r) => s.storeName(r.mv.storeId) },
    { key: 'batch', header: 'Batch', hidden: !product.batchTracked, render: (r) => (r.mv.batchId ? cloud.get('batches', r.mv.batchId)?.code ?? '—' : '—') },
    { key: 'user', header: 'By', render: (r) => <span className="secondary">{r.mv.userId ? userName(L, r.mv.userId) : '—'}{r.mv.reason && r.mv.sourceType !== 'transfer' ? ` · ${r.mv.reason}` : ''}</span> },
    { key: 'in', header: 'In', align: 'right', render: (r) => (r.qtyIn ? <span className="bo-pos">+{fq(r.qtyIn, product.decimalQty)}</span> : r.mv.type === 'sale_return_damaged' ? <span className="muted" title="Goes to damaged bucket">({fq(Math.abs(r.mv.qty))} dmg)</span> : '') },
    { key: 'out', header: 'Out', align: 'right', render: (r) => (r.qtyOut ? <span className="bo-neg">−{fq(r.qtyOut, product.decimalQty)}</span> : '') },
    { key: 'bal', header: 'Balance', align: 'right', render: (r) => <b>{fq(r.balance, product.decimalQty)}</b> },
  ];

  const doExport = (kind: 'csv' | 'xls') =>
    downloadTable(`stock-ledger-${product.sku}-${range.from}-${range.to}`, ['Date', 'Movement', 'Source', 'Store', 'Batch', 'In', 'Out', 'Balance'], [
      [range.from, 'Opening balance', '', '', '', '', '', data.opening],
      ...data.rows.map((r) => [r.mv.createdAt, MOVEMENT_LABEL[r.mv.type], sourceDoc(cloud, r.mv).label, s.storeName(r.mv.storeId), r.mv.batchId ? cloud.get('batches', r.mv.batchId)?.code : '', r.qtyIn || '', r.qtyOut || '', r.balance]),
      [range.to, 'Closing balance', '', '', '', data.totalIn, data.totalOut, data.closing],
    ], kind);

  return (
    <PageFrame
      crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: 'Stock ledger' }, { label: product.name }]}
      title={`Stock ledger · ${product.name}`}
      description={<span className="num">{product.sku} · {product.unit} · closing = opening + in − out (LLD §6)</span>}
      actions={
        <>
          <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} onPrint={() => window.print()} />
          {s.can('inventory.adjust') ? <Button variant="primary" icon="SlidersHorizontal" onClick={() => nav(`/inventory/adjust?product=${product.id}${store ? `&store=${store}` : ''}`)}>Adjust stock</Button> : null}
        </>
      }
    >
      <div className="ex-row" style={{ flexWrap: 'wrap', gap: 12 }}>
        <DateRangeControl value={range} onChange={setRange} />
        {s.scope.length > 1 ? <Select size="sm" aria-label="Store" value={store} onChange={(e) => setStore(e.target.value)} options={[{ value: '', label: 'All stores in scope' }, ...s.stores.filter((x) => s.scope.includes(x.id)).map((x) => ({ value: x.id, label: x.name }))]} /> : null}
      </div>
      <KpiRow cols={4}>
        <KpiCard label={`Opening · ${range.from}`} icon="CircleDot" value={fq(data.opening, product.decimalQty)} />
        <KpiCard label="Total in" icon="ArrowDownLeft" tone="success" value={`+${fq(data.totalIn, product.decimalQty)}`} />
        <KpiCard label="Total out" icon="ArrowUpRight" value={`−${fq(data.totalOut, product.decimalQty)}`} />
        <KpiCard label={`Closing · ${range.to}`} icon="Equal" value={fq(data.closing, product.decimalQty)} foot={data.damaged ? `${data.damaged} to damaged bucket (excluded)` : undefined} />
      </KpiRow>
      {range.to >= today() ? (
        reconciles ? (
          <InlineAlert tone="success" icon="CircleCheck" title="Ledger reconciles">Closing balance {fq(data.closing, product.decimalQty)} = current on-hand {fq(data.onHandNow, product.decimalQty)} {product.unit}.</InlineAlert>
        ) : (
          <InlineAlert tone="danger" title="Ledger does not reconcile">Closing {fq(data.closing)} ≠ on-hand {fq(data.onHandNow)}. Report this to Elixir support.</InlineAlert>
        )
      ) : null}
      <Card className="bo-card-table">
        <CardHeader title="Movements" subtitle={`${data.rows.length} movements · newest first`} icon="History" actions={<span className="muted" style={{ fontSize: 12 }}><Icon name="Lock" size={12} style={{ verticalAlign: -2 }} /> Immutable</span>} />
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r.mv.id}
          density="dense"
          pageSize={50}
          empty={<EmptyState quiet icon="History" title="No movements in this period">Opening balance carries forward unchanged.</EmptyState>}
          footer={<div className="bo-tfoot"><span>Opening <b>{fq(data.opening, product.decimalQty)}</b></span><span>+ In <b>{fq(data.totalIn, product.decimalQty)}</b></span><span>− Out <b>{fq(data.totalOut, product.decimalQty)}</b></span><span>= Closing <b>{fq(data.closing, product.decimalQty)}</b></span></div>}
        />
      </Card>
    </PageFrame>
  );
}
