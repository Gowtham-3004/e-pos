import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, BarList, Card, CardHeader, Icon, KpiCard, StatusBadge, Badge } from '@elixir/ui';
import { DEVICE_STATUS, expiryHealth } from '@elixir/domain';
import { lowStock } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { money, moneyCompact, number, pct, relative } from '@elixir/format';
import { PageFrame, KpiRow, ScopeHint } from '../components/common';
import { addDays, countable, METHOD_LABEL, paymentSplit, pctChange, saleCost, shortDay, sum, today, useCloud, useLookups, useScopedSales } from '../lib/data';
import { onHandIn } from '../lib/stock';
import { useSession } from '../lib/session';

interface Alert {
  key: string;
  tone: 'danger' | 'warning' | 'info';
  icon: string;
  count: number;
  title: string;
  sub: string;
  to: string;
}

export function Dashboard() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const sales = useScopedSales();
  const L = useLookups();
  const t = today();
  const y = addDays(t, -1);
  const isRest = s.family === 'restaurant';
  const scopeKey = s.scope.join(',');

  const alerts = useLive(
    cloud,
    ['approvals', 'stockMovements', 'batches', 'products', 'shifts', 'devices', 'syncConflicts', 'purchases', 'suppliers'],
    () => {
      const out: Alert[] = [];
      const tid = s.tenant.id;
      const approvals = cloud.where('approvals', (a) => a.tenantId === tid && a.status === 'pending' && s.scope.includes(a.storeId));
      if (approvals.length) out.push({ key: 'ap', tone: 'danger', icon: 'ShieldAlert', count: approvals.length, title: 'Pending approvals', sub: `Oldest ${relative(approvals.map((a) => a.createdAt).sort()[0])} · decide from the bell`, to: '#approvals' });
      if (!isRest && s.has('inventory')) {
        const low = new Set<string>();
        let out0 = 0;
        for (const sid of s.scope) for (const x of lowStock(cloud, tid, sid)) if (x.product.active) { low.add(x.product.id); if (x.onHand <= 0) out0++; }
        if (low.size) out.push({ key: 'low', tone: 'warning', icon: 'PackageMinus', count: low.size, title: 'Low / out of stock', sub: `In at least one store · ${out0} store-product(s) out of stock`, to: '/inventory?health=low' });
      }
      if (s.has('batch-expiry')) {
        const prod = new Set(cloud.where('products', (p) => p.tenantId === tid).map((p) => p.id));
        let expired = 0;
        let near = 0;
        for (const b of cloud.all('batches')) {
          if (!prod.has(b.productId)) continue;
          if (onHandIn(cloud, s.scope, b.productId, b.id) <= 0) continue;
          const h = expiryHealth(b.expiryDate, 30);
          if (h === 'expired') expired++;
          else if (h === 'near') near++;
        }
        if (expired + near) out.push({ key: 'exp', tone: expired ? 'danger' : 'warning', icon: 'CalendarClock', count: expired + near, title: 'Expiring batches', sub: `${expired} expired with stock · ${near} within 30 days`, to: '/expiry' });
      }
      const since = addDays(t, -7);
      const variances = cloud.where('shifts', (x) => x.tenantId === tid && s.scope.includes(x.storeId) && x.status === 'closed' && x.businessDate >= since && !!x.variance);
      if (variances.length) out.push({ key: 'var', tone: 'warning', icon: 'Scale', count: variances.length, title: 'Shift cash variances', sub: `Last 7 days · net ${money(sum(variances, (v) => v.variance ?? 0))}`, to: '/shifts?variance=1' });
      const devs = cloud.where('devices', (d) => d.tenantId === tid && s.scope.includes(d.storeId) && (d.status === 'offline' || d.status === 'attention'));
      if (devs.length) out.push({ key: 'dev', tone: devs.some((d) => d.status === 'attention') ? 'danger' : 'warning', icon: 'MonitorX', count: devs.length, title: 'Devices need attention', sub: `${devs.filter((d) => d.status === 'offline').length} offline · ${devs.filter((d) => d.status === 'attention').length} attention · ${sum(devs, (d) => d.pendingSync)} unsynced`, to: '/devices' });
      const conflicts = cloud.where('syncConflicts', (c) => c.tenantId === tid && c.state === 'open' && s.scope.includes(c.storeId));
      if (conflicts.length) out.push({ key: 'sc', tone: 'danger', icon: 'GitMerge', count: conflicts.length, title: 'Open sync conflicts', sub: conflicts[0]!.reason, to: '/audit?tab=conflicts' });
      if (s.has('payables')) {
        const overdue = cloud.where('purchases', (p) => {
          if (p.tenantId !== tid || p.status !== 'posted' || p.totalPaise - p.paidPaise <= 0 || !s.scope.includes(p.storeId)) return false;
          const sup = cloud.get('suppliers', p.supplierId);
          return addDays(p.invoiceDate, sup?.payableDays ?? 30) < t;
        });
        if (overdue.length) out.push({ key: 'due', tone: 'warning', icon: 'Landmark', count: overdue.length, title: 'Overdue supplier dues', sub: `${money(sum(overdue, (p) => p.totalPaise - p.paidPaise))} past payable terms`, to: '/finance?tab=payables' });
      }
      return out;
    },
    [s.tenant.id, scopeKey, isRest],
  );

  const k = useMemo(() => {
    const ok = sales.filter(countable);
    const tS = ok.filter((x) => x.businessDate === t);
    // Same-time-of-day comparison so a partial day isn't compared with a full one.
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const tod = (iso: string) => new Date(iso).getHours() * 60 + new Date(iso).getMinutes();
    const yAll = ok.filter((x) => x.businessDate === y);
    const yS = yAll.filter((x) => tod(x.committedAt) <= nowMin);
    const total = sum(tS, (x) => x.totalPaise);
    const yTotal = sum(yS, (x) => x.totalPaise);
    const taxable = sum(tS, (x) => x.taxablePaise);
    const cost = sum(tS, (x) => saleCost(x, L.products));
    const days = Array.from({ length: 30 }, (_, i) => addDays(t, i - 29));
    const byDay = new Map<string, number>();
    ok.forEach((x) => byDay.set(x.businessDate, (byDay.get(x.businessDate) ?? 0) + x.totalPaise));
    const hours = Array.from({ length: 15 }, (_, i) => i + 8);
    const byHour = new Map<number, number>();
    tS.forEach((x) => { const h = new Date(x.committedAt).getHours(); byHour.set(h, (byHour.get(h) ?? 0) + x.totalPaise); });
    const from30 = addDays(t, -29);
    const prod = new Map<string, { name: string; value: number; qty: number }>();
    ok.filter((x) => x.businessDate >= from30).forEach((x) => x.lines.forEach((l) => {
      const c = prod.get(l.productId) ?? { name: l.name, value: 0, qty: 0 };
      c.value += l.netPaise;
      c.qty += l.qty;
      prod.set(l.productId, c);
    }));
    const byStore = new Map<string, number>();
    tS.forEach((x) => byStore.set(x.storeId, (byStore.get(x.storeId) ?? 0) + x.totalPaise));
    return {
      total, yTotal, bills: tS.length, yBills: yS.length, avg: tS.length ? Math.round(total / tS.length) : 0, yAvg: yS.length ? Math.round(yTotal / yS.length) : 0,
      margin: taxable && cost ? ((taxable - cost) / taxable) * 100 : undefined, marginPaise: taxable - cost,
      split: paymentSplit(tS), trend: days.map((d) => ({ label: shortDay(d), value: byDay.get(d) ?? 0, sub: shortDay(d) })),
      hourly: hours.map((h) => ({ label: `${h}:00`, value: byHour.get(h) ?? 0 })),
      top: [...prod.values()].sort((a, b) => b.value - a.value).slice(0, 8),
      byStore: [...byStore].map(([id, v]) => ({ label: s.storeName(id), value: v })).sort((a, b) => b.value - a.value),
      yFull: sum(yAll, (x) => x.totalPaise), yFullBills: yAll.length,
      pendingSync: sales.filter((x) => x.syncState !== 'synced').length,
    };
  }, [sales, t, y, L.products, s]);

  const finance = useLive(cloud, ['customers', 'suppliers'], () => ({
    receivables: sum(cloud.where('customers', (c) => c.tenantId === s.tenant.id), (c) => c.outstandingPaise),
    payables: sum(cloud.where('suppliers', (c) => c.tenantId === s.tenant.id), (c) => c.outstandingPaise),
  }), [s.tenant.id]);

  const devices = useLive(cloud, ['devices'], () => cloud.where('devices', (d) => d.tenantId === s.tenant.id && s.scope.includes(d.storeId) && d.status !== 'revoked').sort((a, b) => (b.pendingSync + (b.status === 'active' ? 0 : 100)) - (a.pendingSync + (a.status === 'active' ? 0 : 100))), [s.tenant.id, scopeKey]);

  const rest = useLive(cloud, ['orders', 'kots', 'tables', 'floors'], () => {
    if (!isRest) return null;
    const storeIds = s.scope;
    const running = cloud.where('orders', (o) => storeIds.includes(o.storeId) && !o.closedAt && !o.saleId && o.status !== 'cancelled');
    const kots = cloud.where('kots', (x) => storeIds.includes(x.storeId) && x.createdAt.slice(0, 10) === t);
    const floorIds = new Set(cloud.where('floors', (f) => storeIds.includes(f.storeId)).map((f) => f.id));
    const tables = cloud.where('tables', (x) => floorIds.has(x.floorId));
    return { running, kots, tables, occupied: tables.filter((x) => x.status !== 'available' && x.status !== 'cleaning' && x.status !== 'reserved').length };
  }, [isRest, scopeKey, t]);

  const delta = (a: number, b: number) => pctChange(a, b);
  const tablesCount = rest?.tables.length || 1;
  const yRestBills = k.yFullBills;

  return (
    <PageFrame
      title="Dashboard"
      description={<>What requires attention today · <ScopeHint /></>}
      meta={k.pendingSync ? <Badge tone="warning" icon="CloudUpload">{k.pendingSync} sale(s) still syncing from devices</Badge> : undefined}
    >
      <Card>
        <CardHeader title="Needs attention" icon="BellRing" subtitle={alerts.length ? `${alerts.length} area(s) to review` : undefined} />
        {alerts.length ? (
          <div className="bo-alerts">
            {alerts.map((a) => (
              <button key={a.key} type="button" className={`bo-alert bo-alert--${a.tone}`} onClick={() => (a.to === '#approvals' ? document.querySelector<HTMLButtonElement>('.bo-bell')?.click() : nav(a.to))}>
                <span className="bo-alert__icon"><Icon name={a.icon} size={18} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="ex-row" style={{ gap: 8 }}>
                    <span className="bo-alert__count">{number(a.count)}</span>
                    <span className="bo-alert__title">{a.title}</span>
                  </span>
                  <span className="bo-alert__sub" style={{ display: 'block' }}>{a.sub}</span>
                </span>
                <Icon name="ChevronRight" size={16} className="muted" />
              </button>
            ))}
          </div>
        ) : (
          <div className="bo-allclear"><Icon name="CircleCheck" /> All clear — no approvals, stock, expiry, device or sync issues right now.</div>
        )}
      </Card>

      <KpiRow cols={isRest ? 4 : 4}>
        <KpiCard label="Today's sales" icon="IndianRupee" value={money(k.total, { whole: true })} delta={delta(k.total, k.yTotal)} deltaLabel="vs yesterday, same time" onClick={() => nav('/sales')} />
        <KpiCard label={isRest ? 'Bills settled' : 'Bills'} icon="Receipt" value={number(k.bills)} delta={delta(k.bills, k.yBills)} deltaLabel="vs yesterday" />
        <KpiCard label={isRest ? 'Avg ticket' : 'Avg bill value'} icon="Calculator" value={money(k.avg, { whole: true })} delta={delta(k.avg, k.yAvg)} deltaLabel="vs yesterday" />
        {isRest ? (
          <KpiCard label="Running orders now" icon="ClipboardList" value={number(rest?.running.length ?? 0)} foot={`${rest?.occupied ?? 0} of ${rest?.tables.length ?? 0} tables occupied`} />
        ) : (
          <KpiCard label="Gross margin (est.)" icon="Percent" value={k.margin != null ? pct(k.margin, 1) : '—'} foot={k.margin != null ? `${money(k.marginPaise, { whole: true })} on taxable value · cost-based estimate` : 'No sales yet today'} />
        )}
      </KpiRow>
      <KpiRow cols={isRest ? 4 : 3}>
        {isRest ? (
          <>
            <KpiCard label="KOTs today" icon="ChefHat" value={number(rest?.kots.length ?? 0)} foot={`${rest?.kots.filter((x) => x.status === 'new' || x.status === 'preparing' || x.status === 'accepted').length ?? 0} in kitchen now`} />
            <KpiCard label="Table turns (today)" icon="RefreshCcw" value={(k.bills / tablesCount).toFixed(1)} foot={`Yesterday ${(yRestBills / tablesCount).toFixed(1)} · ${tablesCount} tables`} />
          </>
        ) : null}
        {s.has('receivables') ? <KpiCard label="Receivables" icon="ArrowDownLeft" value={moneyCompact(finance.receivables)} foot="Customer credit outstanding" onClick={() => nav('/finance')} /> : null}
        {s.has('payables') ? <KpiCard label="Payables" icon="ArrowUpRight" value={moneyCompact(finance.payables)} foot="Supplier dues outstanding" onClick={() => nav('/finance?tab=payables')} /> : null}
        {!isRest ? <KpiCard label="Yesterday" icon="CalendarDays" value={money(k.yFull, { whole: true })} foot={`${k.yFullBills} bills · full day`} /> : null}
      </KpiRow>

      <div className="bo-grid-main">
        <Card>
          <CardHeader title="Sales · last 30 days" subtitle={`${money(sum(k.trend, (d) => d.value), { whole: true })} total`} icon="ChartColumn" />
          <div style={{ padding: 16 }}>
            <BarChart title="Daily sales, last 30 days" data={k.trend} format={(v) => moneyCompact(v)} highlightLast />
          </div>
        </Card>
        <Card>
          <CardHeader title="Payment mix · today" icon="Wallet" />
          <div style={{ padding: 16 }}>
            {k.split.length ? <BarList items={k.split.map((p) => ({ key: p.method, label: `${METHOD_LABEL[p.method]} · ${p.count}`, value: p.amount }))} format={(v) => money(v, { whole: true })} /> : <div className="muted">No payments yet today.</div>}
          </div>
        </Card>
      </div>

      <div className="bo-grid-3">
        <Card>
          <CardHeader title={isRest ? 'Top dishes · 30 days' : 'Top products · 30 days'} icon="Trophy" />
          <div style={{ padding: 16 }}>
            <BarList items={k.top.map((p) => ({ label: p.name, value: p.value }))} format={(v) => moneyCompact(v)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Hourly sales · today" icon="Clock" />
          <div style={{ padding: 16 }}>
            {k.bills ? <BarChart title="Sales by hour today" data={k.hourly} height={190} format={(v) => moneyCompact(v)} /> : <div className="muted" style={{ padding: '24px 0', textAlign: 'center' }}>No sales synced yet today. Counters that are offline will appear here once they reconnect.</div>}
          </div>
        </Card>
        {s.multiStore && s.scope.length > 1 ? (
          <Card>
            <CardHeader title="Sales by store · today" icon="Store" />
            <div style={{ padding: 16 }}>
              {k.byStore.length ? <BarList items={k.byStore} format={(v) => money(v, { whole: true })} /> : <div className="muted">No sales yet today.</div>}
            </div>
          </Card>
        ) : (
          <DevicesCard devices={devices.slice(0, 6)} />
        )}
      </div>
      {s.multiStore && s.scope.length > 1 ? <DevicesCard devices={devices.slice(0, 8)} /> : null}
    </PageFrame>
  );

  function DevicesCard({ devices: ds }: { devices: typeof devices }) {
    return (
      <Card>
        <CardHeader title="Devices & sync" icon="MonitorSmartphone" subtitle="Stores/devices with outstanding sync first" actions={s.can('devices.manage') && (s.has('device-management') || s.has('multi-counter')) ? <button className="bo-link" type="button" onClick={() => nav('/devices')}>View all</button> : undefined} />
        <div>
          {ds.map((d) => (
            <div key={d.id} className="bo-device-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="bo-cell-main ex-truncate">{d.code} · {d.name}</div>
                <div className="bo-cell-sub">{s.storeName(d.storeId)} · last sync {relative(d.lastSyncAt)}</div>
              </div>
              {d.pendingSync ? <Badge tone="warning" icon="CloudUpload">{d.pendingSync} pending</Badge> : null}
              <StatusBadge meta={DEVICE_STATUS[d.status]} />
            </div>
          ))}
        </div>
      </Card>
    );
  }
}
