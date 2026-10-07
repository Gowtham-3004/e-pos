import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, DataTable, EmptyState, InlineAlert, KpiCard, SearchInput, type Column } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { date, money, number, qty as fq } from '@elixir/format';
import { DateRangeControl, ExportMenu, KpiRow, NotAvailable, PageFrame, StoreFilter, useFirstPaint, useRange } from '../../components/common';
import { useCloud, useLookups } from '../../lib/data';
import { downloadTable, rupees } from '../../lib/csv';
import { useSession } from '../../lib/session';
import { REPORTS, type Fmt, type RRow } from './defs';
import { useAvailableReports } from './Reports';

function fmt(v: unknown, f: Fmt): React.ReactNode {
  if (v == null || v === '') return '—';
  switch (f) {
    case 'money': return money(v as number);
    case 'qty': return fq(v as number);
    case 'int': return number(v as number);
    case 'pct': return `${(v as number).toFixed(1)}%`;
    case 'date': return <span className="num">{date(String(v))}</span>;
    case 'mono': return <span className="num">{String(v)}</span>;
    default: return String(v);
  }
}
const exportVal = (v: unknown, f: Fmt) => (v == null ? '' : f === 'money' ? rupees(v as number) : f === 'pct' ? (v as number).toFixed(2) : (v as string | number));

export function ReportView() {
  const { key } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const loading = useFirstPaint(260);
  const available = useAvailableReports();
  const def = REPORTS.find((r) => r.key === key);
  const [range, setRange] = useRange('7d');
  const [store, setStore] = useState('');
  const [q, setQ] = useState('');
  const storeIds = store ? [store] : s.scope;
  const result = useLive(cloud, ['sales', 'returns', 'stockMovements', 'purchases', 'shifts', 'batches', 'products'], () => (def ? def.build({ cloud, s, L, from: range.from, to: range.to, storeIds }) : null), [def?.key, range.from, range.to, storeIds.join(','), L]);
  const rows = useMemo(() => (result ? result.rows.filter((r) => !q || Object.values(r).some((v) => typeof v === 'string' && v.toLowerCase().includes(q.toLowerCase()))) : []), [result, q]);

  if (!def) return <NotAvailable module="This report" />;
  if (!available.includes(def)) return <NotAvailable module={def.title} />;
  if (!result) return null;

  const totals = Object.fromEntries(result.columns.filter((c) => c.total).map((c) => [c.key, rows.reduce((a, r) => a + ((r[c.key] as number) || 0), 0)]));
  const cols: Column<RRow>[] = result.columns.map((c, i) => ({
    key: c.key,
    header: c.header,
    align: ['money', 'qty', 'int', 'pct'].includes(c.fmt) ? 'right' : 'left',
    sortable: true,
    sortValue: (r) => r[c.key] as string | number,
    render: (r) => (i === 0 ? <span className="bo-cell-main">{fmt(r[c.key], c.fmt)}</span> : fmt(r[c.key], c.fmt)),
  }));
  const title = `${def.title}${def.usesDates ? ` · ${date(range.from)} – ${date(range.to)}` : ''}`;
  const filename = `${def.key}${def.usesDates ? `-${range.from}-to-${range.to}` : ''}${store ? `-${L.stores.get(store)?.code}` : ''}`;
  const doExport = (kind: 'csv' | 'xls') => downloadTable(filename, result.columns.map((c) => (c.fmt === 'money' ? `${c.header} (INR)` : c.header)), [
    ...rows.map((r) => result.columns.map((c) => exportVal(r[c.key], c.fmt))),
    result.columns.map((c, i) => (i === 0 ? 'TOTAL' : c.total ? exportVal(c.fmt === 'qty' ? Math.round(totals[c.key]! * 1000) / 1000 : totals[c.key], c.fmt) : '')),
  ], kind);

  return (
    <PageFrame
      crumbs={[{ label: 'Reports', to: '/reports' }, { label: def.title }]}
      title={def.title}
      description={`${def.description} · ${store ? s.storeName(store) : s.scope.length > 1 ? `All stores (${s.scope.length})` : s.storeName(s.scope[0])}`}
      actions={s.can('reports.export') ? <ExportMenu onCsv={() => doExport('csv')} onXls={() => doExport('xls')} onPrint={() => window.print()} disabled={!rows.length} /> : undefined}
    >
      <div className="ex-row no-print" style={{ flexWrap: 'wrap', gap: 12 }}>
        {def.usesDates ? <DateRangeControl value={range} onChange={setRange} /> : <span className="muted">Snapshot as of today</span>}
        <StoreFilter value={store} onChange={setStore} />
      </div>
      <KpiRow cols={Math.min(4, result.summary.length)}>
        {result.summary.map((m) => <KpiCard key={m.label} label={m.label} icon={m.icon} value={m.fmt === 'money' ? money(m.value) : m.fmt === 'qty' ? fq(m.value) : number(m.value)} loading={loading} />)}
      </KpiRow>
      {result.note ? <InlineAlert tone={result.note.startsWith('Reconciled') || result.note.startsWith('Line-level') ? 'success' : 'info'}>{result.note}</InlineAlert> : null}
      <Card className="bo-card-table">
        <div className="bo-toolbar no-print">
          <SearchInput placeholder="Filter rows" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} />
          <span className="muted" style={{ fontSize: 13 }}>{number(rows.length)} rows · {title}</span>
        </div>
        <DataTable
          columns={cols}
          rows={rows}
          rowKey={(r) => r._id}
          loading={loading}
          density="dense"
          pageSize={50}
          onRowClick={rows.some((r) => r._to) ? (r) => r._to && nav(r._to) : undefined}
          empty={<EmptyState quiet icon="FileSearch" title="No data for this period">Try a wider date range or another store.</EmptyState>}
          footer={rows.length ? (
            <div className="bo-tfoot">
              <span>Total</span>
              {result.columns.filter((c) => c.total).map((c) => <span key={c.key}>{c.header} <b>{c.fmt === 'money' ? money(totals[c.key]!) : c.fmt === 'qty' ? fq(totals[c.key]!) : number(totals[c.key]!)}</b></span>)}
            </div>
          ) : undefined}
        />
      </Card>
    </PageFrame>
  );
}
