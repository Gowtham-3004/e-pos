import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarList, Button, Card, CardBody, CardHeader, EmptyState, Icon, KpiCard, Page, PageHeader, StatusBadge, Badge } from '@elixir/ui';
import { PLANS, SUBSCRIPTION_STATUS, VERTICAL_LABEL } from '@elixir/domain';
import type { Tone } from '@elixir/domain';
import type { Vertical } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { daysUntil, money, moneyCompact, number, relative, dateTime } from '@elixir/format';
import { useCloud, useLookups } from '../lib/hooks';
import { ageLabel, isBillable, monthlyPrice, secondsSince, EDGE_STATUS, TICKET_PRIORITY } from '../lib/platform';
import { useAccess } from '../lib/access';

interface AttentionItem {
  key: string;
  tone: Tone;
  icon: string;
  kind: string;
  title: string;
  detail: string;
  to: string;
  rank: number;
}

export function Overview() {
  const cloud = useCloud();
  const nav = useNavigate();
  const lk = useLookups();
  const { name } = useAccess();
  const now = useNow(30000);
  const [showAll, setShowAll] = useState(false);

  const data = useLive(
    cloud,
    ['tenants', 'devices', 'syncConflicts', 'edgeNodes', 'tickets', 'auditEvents'],
    () => {
      const tenants = cloud.all('tenants');
      const devices = cloud.all('devices');
      const conflicts = cloud.all('syncConflicts');
      const edges = cloud.all('edgeNodes');
      const tickets = cloud.all('tickets');
      const byStatus = { active: 0, trial: 0, grace: 0, suspended: 0, cancelled: 0 };
      tenants.forEach((t) => byStatus[t.subscriptionStatus]++);
      const mrr = tenants.filter(isBillable).reduce((s, t) => s + monthlyPrice(t), 0);
      const trialPipeline = tenants.filter((t) => t.subscriptionStatus === 'trial').reduce((s, t) => s + monthlyPrice(t), 0);
      const live = devices.filter((d) => d.status !== 'revoked' && d.status !== 'pending-activation');
      const active = live.filter((d) => d.status === 'active').length;
      const offline = live.filter((d) => d.status === 'offline').length;
      const attention = live.filter((d) => d.status === 'attention').length;
      const pending = live.reduce((s, d) => s + d.pendingSync, 0);
      const backlogged = live.filter((d) => d.pendingSync > 0);
      const oldest = backlogged.reduce<number>((m, d) => Math.max(m, secondsSince(d.lastSyncAt ?? d.lastSeenAt, now)), 0);
      const openConflicts = conflicts.filter((c) => c.state === 'open');
      const edgeBad = edges.filter((e) => e.status !== 'healthy');

      const items: AttentionItem[] = [];
      tenants.forEach((t) => {
        if (t.subscriptionStatus === 'suspended')
          items.push({ key: 'sus' + t.id, tone: 'danger', icon: 'Ban', kind: 'Subscription', title: `${t.name} is suspended`, detail: `Devices limited to historic reports · renewal lapsed ${Math.abs(daysUntil(t.renewsOn, now))}d ago`, to: `/tenants/${t.id}?tab=subscription`, rank: 1 });
        else if (t.subscriptionStatus === 'grace')
          items.push({ key: 'gr' + t.id, tone: 'warning', icon: 'Hourglass', kind: 'Subscription', title: `${t.name} in grace period`, detail: `Renewal overdue by ${Math.abs(daysUntil(t.renewsOn, now))}d · decide: reactivate or suspend`, to: `/tenants/${t.id}?tab=subscription`, rank: 2 });
        else {
          const d = daysUntil(t.renewsOn, now);
          if (d >= 0 && d <= 7 && t.subscriptionStatus !== 'cancelled')
            items.push({ key: 'rn' + t.id, tone: 'info', icon: 'CalendarClock', kind: 'Renewal', title: `${t.name} ${t.subscriptionStatus === 'trial' ? 'trial ends' : 'renews'} in ${d}d`, detail: `${money(monthlyPrice(t))}/month · ${SUBSCRIPTION_STATUS[t.subscriptionStatus].label}`, to: `/tenants/${t.id}?tab=subscription`, rank: 6 });
        }
      });
      openConflicts.forEach((c) =>
        items.push({ key: 'sc' + c.id, tone: 'danger', icon: 'GitMerge', kind: 'Quarantine', title: `${c.reasonCode} · ${lk.tenantName(c.tenantId)}`, detail: `${c.entity}${c.documentNo ? ' ' + c.documentNo : ''} · ${lk.devices.get(c.deviceId)?.code ?? c.deviceId} · ${relative(c.createdAt, now)}`, to: `/sync?conflict=${c.id}`, rank: 1 }),
      );
      edgeBad.forEach((e) =>
        items.push({ key: 'ed' + e.id, tone: e.status === 'down' ? 'danger' : 'warning', icon: 'Router', kind: 'Store Edge', title: `Edge ${EDGE_STATUS[e.status].label.toLowerCase()} · ${lk.tenantName(e.tenantId)} ${lk.storeName(e.storeId)}`, detail: `WAN ${e.wanState} · ${number(e.queueCount)} queued, oldest ${ageLabel(e.queueAgeSec)}`, to: '/edge', rank: 2 }),
      );
      backlogged
        .filter((d) => d.pendingSync >= 10 || d.status === 'attention')
        .sort((a, b) => b.pendingSync - a.pendingSync)
        .forEach((d) =>
          items.push({ key: 'dv' + d.id, tone: d.status === 'attention' ? 'warning' : 'neutral', icon: d.status === 'attention' ? 'TriangleAlert' : 'CloudUpload', kind: 'Sync backlog', title: `${d.code} · ${lk.tenantName(d.tenantId)} ${lk.storeName(d.storeId)}`, detail: `${number(d.pendingSync)} pending${d.failedSync ? `, ${d.failedSync} failed` : ''} · last seen ${relative(d.lastSeenAt, now)}`, to: `/devices/${d.id}`, rank: d.status === 'attention' ? 3 : 4 }),
        );
      tickets
        .filter((t) => t.status !== 'resolved' && (t.priority === 'urgent' || t.priority === 'high'))
        .forEach((t) =>
          items.push({ key: 'tk' + t.id, tone: t.priority === 'urgent' ? 'danger' : 'warning', icon: 'LifeBuoy', kind: `${TICKET_PRIORITY[t.priority].label} ticket`, title: t.subject, detail: `${lk.tenantName(t.tenantId)} · ${t.assignee ?? 'Unassigned'} · ${relative(t.createdAt, now)}`, to: `/support/${t.id}`, rank: t.priority === 'urgent' ? 1 : 3 }),
        );
      devices
        .filter((d) => d.status === 'pending-activation')
        .forEach((d) => items.push({ key: 'pa' + d.id, tone: 'info', icon: 'Hourglass', kind: 'Activation', title: `${d.code} awaiting activation`, detail: `${lk.tenantName(d.tenantId)} · ${lk.storeName(d.storeId)}`, to: `/devices/${d.id}`, rank: 5 }));
      items.sort((a, b) => a.rank - b.rank);

      const vert = new Map<Vertical, number>();
      tenants.forEach((t) => vert.set(t.vertical, (vert.get(t.vertical) ?? 0) + 1));
      const recentSecurity = cloud
        .where('auditEvents', (a) => a.category === 'security')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 6);
      return {
        total: tenants.length,
        byStatus,
        mrr,
        trialPipeline,
        billable: tenants.filter(isBillable).length,
        active,
        liveCount: live.length,
        offline,
        attention,
        pending,
        backlogCount: backlogged.length,
        oldest,
        openConflicts: openConflicts.length,
        edgeBad: edgeBad.length,
        edgeTotal: edges.length,
        items,
        verticals: [...vert].sort((a, b) => b[1] - a[1]).map(([v, n]) => ({ key: v, label: VERTICAL_LABEL[v], value: n })),
        plans: PLANS.map((p) => {
          const ts = tenants.filter((t) => t.plan === p.code);
          return { key: p.code, label: p.name, value: ts.length, mrr: ts.filter(isBillable).reduce((s, t) => s + monthlyPrice(t), 0) };
        }),
        recentSecurity,
      };
    },
    [now, lk],
  );

  const visible = showAll ? data.items : data.items.slice(0, 8);
  const greeting = new Date(now).getHours() < 12 ? 'Good morning' : new Date(now).getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={`${greeting}, ${name.split(' ')[0]}. ${data.items.length ? `${data.items.length} items need attention across ${data.total} tenants.` : 'Nothing needs attention right now.'}`}
        meta={<Badge tone="neutral" icon="Clock">Live · {dateTime(now)}</Badge>}
      />

      <Card>
        <CardHeader title="What requires attention" subtitle="Highest impact first — suspensions, quarantined sync, degraded Edge, backlogs, urgent tickets, renewals" icon="Siren" actions={data.items.length > 8 ? <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show top 8' : `Show all ${data.items.length}`}</Button> : null} />
        {data.items.length === 0 ? (
          <EmptyState quiet icon="CircleCheck" title="All clear">No suspended tenants, quarantined sync items, degraded Edge nodes or urgent tickets.</EmptyState>
        ) : (
          <ul className="pa-attention">
            {visible.map((i) => (
              <li key={i.key}>
                <button type="button" onClick={() => nav(i.to)} className={`pa-attention__row pa-tone-row--${i.tone}`}>
                  <span className={`pa-attention__icon pa-soft--${i.tone}`}>
                    <Icon name={i.icon} size={16} />
                  </span>
                  <span className="pa-attention__kind">{i.kind}</span>
                  <span className="pa-attention__main">
                    <b className="ex-truncate">{i.title}</b>
                    <span className="muted ex-truncate">{i.detail}</span>
                  </span>
                  <Icon name="ChevronRight" size={16} className="muted" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="pa-kpis">
        <KpiCard label="Tenants" icon="Building2" value={<span className="num">{data.total}</span>} foot={<StatusFoot s={data.byStatus} />} onClick={() => nav('/tenants')} />
        <KpiCard label="MRR (billed)" icon="IndianRupee" value={<span className="num">{moneyCompact(data.mrr)}</span>} foot={<span>{data.billable} billed tenants · {moneyCompact(data.trialPipeline)} in trials</span>} onClick={() => nav('/plans')} />
        <KpiCard label="Active devices" icon="MonitorCheck" value={<span className="num">{data.active}</span>} foot={<span>of {data.liveCount} activated devices</span>} onClick={() => nav('/devices')} />
        <KpiCard label="Offline / attention" icon="WifiOff" tone={data.attention ? 'warning' : undefined} value={<span className="num">{data.offline} / {data.attention}</span>} foot={<span>Offline devices keep selling locally</span>} onClick={() => nav('/devices?status=attention')} />
        <KpiCard label="Pending sync" icon="CloudUpload" tone={data.oldest > 1800 ? 'warning' : undefined} value={<span className="num">{number(data.pending)}</span>} foot={<span>{data.backlogCount} devices · oldest {ageLabel(data.oldest)}</span>} onClick={() => nav('/sync')} />
        <KpiCard label="Open conflicts" icon="GitMerge" tone={data.openConflicts ? 'danger' : 'success'} value={<span className="num">{data.openConflicts}</span>} foot={<span>Quarantined — other items keep syncing</span>} onClick={() => nav('/sync')} />
        <KpiCard label="Edge degraded" icon="Router" tone={data.edgeBad ? 'warning' : 'success'} value={<span className="num">{data.edgeBad} / {data.edgeTotal}</span>} foot={<span>Nodes not healthy</span>} onClick={() => nav('/edge')} />
      </div>

      <div className="pa-grid-3">
        <Card>
          <CardHeader title="Tenants by vertical" icon="Shapes" />
          <CardBody>
            <BarList items={data.verticals} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Plan distribution" subtitle="Tenants per plan · billed MRR" icon="Layers" />
          <CardBody>
            <BarList items={data.plans.map((p) => ({ key: p.key, label: p.label, value: p.value, extra: <span className="muted pa-barlist-extra"> · {moneyCompact(p.mrr)}</span> }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent security events" icon="ShieldAlert" actions={<Button size="sm" variant="ghost" iconRight="ArrowRight" onClick={() => nav('/audit?category=security')}>Audit</Button>} />
          <ul className="pa-mini-list pa-sec-list">
            {data.recentSecurity.map((a) => (
              <li key={a.id}>
                <span className="pa-sec-main">
                  <span className="ex-truncate" title={a.summary}>{a.summary}</span>
                  <span className="pa-mono ex-truncate">{a.action} · {lk.tenantName(a.tenantId)}</span>
                </span>
                <span className="muted num">{relative(a.createdAt, now)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}

function StatusFoot({ s }: { s: Record<'active' | 'trial' | 'grace' | 'suspended' | 'cancelled', number> }) {
  return (
    <span className="pa-status-foot">
      {(['active', 'trial', 'grace', 'suspended'] as const).map((k) => (
        <span key={k}>
          <span className={`pa-dot pa-dot--${SUBSCRIPTION_STATUS[k].tone}`} aria-hidden />
          {SUBSCRIPTION_STATUS[k].label.replace(' period', '')} <b className="num">{s[k]}</b>
        </span>
      ))}
    </span>
  );
}
