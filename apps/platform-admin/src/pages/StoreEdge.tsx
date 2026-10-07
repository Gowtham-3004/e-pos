import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, CardBody, CardHeader, EmptyState, Icon, KpiCard, Page, PageHeader, Progress, Segmented, StatusBadge } from '@elixir/ui';
import { DEVICE_STATUS } from '@elixir/domain';
import type { Device, EdgeNode } from '@elixir/contracts';
import { useLive, useNow } from '@elixir/local-store/react';
import { number, relative } from '@elixir/format';
import { useCloud, useLookups } from '../lib/hooks';
import { EDGE_STATUS, LATEST_EDGE_VERSION, ageLabel, compareVersion, secondsSince } from '../lib/platform';

type Scenario = 'wan-down' | 'edge-down' | 'both-down' | 'cloud-down';

const FAILURE_MODES: Record<Scenario, { title: string; icon: string; operates: string[]; limited: string[]; recovery: string }> = {
  'wan-down': {
    title: 'WAN down · Edge healthy',
    icon: 'WifiOff',
    operates: ['Store operates normally within local capabilities', 'POS ↔ KDS ↔ Waiter coordination continues over LAN', 'Shared numbering, table state and KOT routing stay consistent'],
    limited: ['Cloud sync accumulates in the Edge queue', 'Back Office sees store data only after reconnect', 'Online payments/e-invoice fall back to manual references'],
    recovery: 'When WAN returns, Edge drains its queue in order; devices need no action.',
  },
  'edge-down': {
    title: 'Edge down · WAN up',
    icon: 'ServerOff',
    operates: ['Each POS keeps billing on its local database', 'Devices sync directly to cloud', 'KOTs print locally per counter'],
    limited: ['Cross-device LAN coordination degrades (KDS lag, table hand-off)', 'Waiter devices fall back to cloud relay (slower)'],
    recovery: 'Restart or replace Edge; devices reconnect and resume LAN coordination automatically.',
  },
  'both-down': {
    title: 'Edge down · WAN down',
    icon: 'Unplug',
    operates: ['Every POS continues as a standalone offline terminal', 'Sales, returns and shifts commit locally with counter-prefixed numbering'],
    limited: ['No cross-device coordination; KDS/waiter unavailable', 'Everything queues per device until connectivity returns'],
    recovery: 'Devices push their outboxes once WAN or Edge returns; idempotency prevents duplicates.',
  },
  'cloud-down': {
    title: 'Cloud outage · WAN + Edge up',
    icon: 'CloudOff',
    operates: ['Store operates normally; Edge coordinates LAN', 'Edge buffers events with checkpoint'],
    limited: ['No master/price updates until cloud recovers', 'Platform dashboards show stale checkpoint age'],
    recovery: 'Cloud resumes ingest from Edge checkpoint; no device re-sends required.',
  },
};

export function StoreEdge() {
  const cloud = useCloud();
  const lk = useLookups();
  const nav = useNavigate();
  const now = useNow(15000);
  const [scenario, setScenario] = useState<Scenario>('wan-down');
  const nodes = useLive(cloud, ['edgeNodes', 'devices'], () =>
    cloud.all('edgeNodes').map((e) => ({ e, devices: cloud.where('devices', (d) => d.storeId === e.storeId && d.kind !== 'store-edge' && d.status !== 'revoked') })),
  );
  const bad = nodes.filter((n) => n.e.status !== 'healthy').length;
  const fm = FAILURE_MODES[scenario];
  return (
    <Page>
      <PageHeader title="Store Edge" description="LAN-local coordinators for multi-counter and restaurant continuity. Edge failure never stops billing — devices fall back to local operation." />
      <div className="pa-kpis pa-kpis--4">
        <KpiCard label="Edge nodes" icon="Router" value={<span className="num">{nodes.length}</span>} />
        <KpiCard label="Degraded / down" icon="TriangleAlert" tone={bad ? 'warning' : 'success'} value={<span className="num">{bad}</span>} />
        <KpiCard label="Queued at Edge" icon="Layers" value={<span className="num">{number(nodes.reduce((s, n) => s + n.e.queueCount, 0))}</span>} />
        <KpiCard label="Connected devices" icon="MonitorSmartphone" value={<span className="num">{nodes.reduce((s, n) => s + n.e.connectedDevices, 0)}</span>} />
      </div>
      {nodes.length === 0 ? <EmptyState icon="Router" title="No Store Edge nodes">Edge is provisioned with the Business plan or the Store Edge add-on.</EmptyState> : null}
      <div className="ex-stack" style={{ gap: 'var(--space-lg)' }}>
        {nodes.map(({ e, devices }) => (
          <EdgeCard key={e.id} e={e} devices={devices} now={now} tenant={lk.tenantName(e.tenantId)} store={lk.storeName(e.storeId)} onTenant={() => nav(`/tenants/${e.tenantId}?tab=stores`)} />
        ))}
      </div>
      <Card>
        <CardHeader title="Failure modes" subtitle="What the store can and cannot do in each condition (STORE_EDGE §10)" icon="BookOpen" actions={
          <Segmented value={scenario} onChange={setScenario} label="Scenario" items={[{ key: 'wan-down', label: 'WAN down' }, { key: 'edge-down', label: 'Edge down' }, { key: 'both-down', label: 'Both down' }, { key: 'cloud-down', label: 'Cloud outage' }]} />
        } />
        <CardBody>
          <div className="pa-failure">
            <div className="pa-failure__title"><Icon name={fm.icon} size={18} /> <b>{fm.title}</b></div>
            <div className="pa-grid-2">
              <div>
                <div className="ex-label pa-tone-success">Keeps working</div>
                <ul className="pa-bullets pa-bullets--ok">{fm.operates.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
              <div>
                <div className="ex-label pa-tone-warning">Limited</div>
                <ul className="pa-bullets pa-bullets--warn">{fm.limited.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 8 }}><Icon name="RotateCw" size={13} /> {fm.recovery}</p>
          </div>
        </CardBody>
      </Card>
    </Page>
  );
}

function EdgeCard({ e, devices, now, tenant, store, onTenant }: { e: EdgeNode; devices: Device[]; now: number; tenant: string; store: string; onTenant: () => void }) {
  const checkpointAge = secondsSince(e.cloudCheckpointAt, now);
  const explanation =
    e.wanState === 'down'
      ? 'WAN down, Edge healthy → store operates normally within local capabilities; cloud sync accumulates in the Edge queue and drains on reconnect.'
      : e.status === 'down'
        ? 'Edge down → each POS continues on its local database and syncs directly to cloud; LAN coordination (KDS, waiter) degrades.'
        : e.status === 'degraded'
          ? 'Edge degraded → coordination continues but check queue age, disk and KDS lag.'
          : 'Healthy → LAN coordination and cloud checkpoint current.';
  return (
    <Card>
      <CardHeader
        title={<span>{tenant} <span className="muted">· {store}</span></span>}
        subtitle={<span>Edge <span className="num">v{e.version}</span>{compareVersion(e.version, LATEST_EDGE_VERSION) < 0 ? ' (update available)' : ''} · up {ageLabel(e.uptimeHours * 3600)}</span>}
        icon="Router"
        actions={<><StatusBadge meta={EDGE_STATUS[e.status]} /><button type="button" className="pa-link-btn" onClick={onTenant}>Tenant →</button></>}
      />
      <CardBody>
        <div className="pa-edge">
          <Topology e={e} devices={devices} />
          <div className="ex-stack" style={{ gap: 12 }}>
            <div className="pa-edge-metrics">
              <Metric label="WAN" value={<Badge tone={e.wanState === 'up' ? 'success' : 'danger'} icon={e.wanState === 'up' ? 'Wifi' : 'WifiOff'}>{e.wanState === 'up' ? 'Up' : 'Down'}</Badge>} />
              <Metric label="Cloud checkpoint" value={<span className={`num${checkpointAge > 600 ? ' pa-tone-warning' : ''}`}>{ageLabel(checkpointAge)} ago</span>} />
              <Metric label="Queue" value={<span className={`num${e.queueCount > 20 ? ' pa-tone-warning' : ''}`}>{number(e.queueCount)} · oldest {ageLabel(e.queueAgeSec)}</span>} />
              <Metric label="KDS lag" value={<span className={`num${e.kdsLagMs > 200 ? ' pa-tone-warning' : ''}`}>{e.kdsLagMs} ms</span>} />
              <Metric label="Connected devices" value={<span className="num">{e.connectedDevices}</span>} />
              <Metric label="Last backup" value={<span className="num">{relative(e.lastBackupAt, now)}</span>} />
            </div>
            <div>
              <div className="ex-row" style={{ justifyContent: 'space-between' }}><span className="ex-label">Disk free</span><span className="num">{e.diskFreePct}%</span></div>
              <Progress value={e.diskFreePct} tone={e.diskFreePct < 20 ? 'danger' : e.diskFreePct < 40 ? 'warning' : 'success'} label="Disk free" />
            </div>
            <div className={`pa-explain pa-soft--${e.status === 'healthy' && e.wanState === 'up' ? 'success' : 'warning'}`}>
              <Icon name="Info" size={15} />
              <span>{explanation}</span>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="pa-metric">
      <span className="muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** POS / KDS / Waiter → Edge → Cloud, plain HTML boxes with state on each link. */
function Topology({ e, devices }: { e: EdgeNode; devices: Device[] }) {
  const groups: Array<{ label: string; icon: string; list: Device[] }> = [
    { label: 'POS', icon: 'Monitor', list: devices.filter((d) => d.kind === 'pos-desktop' || d.kind === 'pos-web') },
    { label: 'KDS', icon: 'ChefHat', list: devices.filter((d) => d.kind === 'kds') },
    { label: 'Mobile / Waiter', icon: 'Smartphone', list: devices.filter((d) => d.kind === 'mobile') },
  ].filter((g) => g.list.length);
  const lanOk = e.status !== 'down';
  const wanOk = e.wanState === 'up';
  return (
    <div className="pa-topo" role="img" aria-label={`Topology: ${devices.length} devices to Store Edge (${e.status}), WAN ${e.wanState} to Elixir Cloud`}>
      <div className="pa-topo__col">
        {groups.map((g) => (
          <div key={g.label} className="pa-topo__box">
            <div className="pa-topo__head"><Icon name={g.icon} size={14} /> {g.label}</div>
            {g.list.map((d) => (
              <div key={d.id} className="pa-topo__dev">
                <span className="pa-mono">{d.code}</span>
                <span className={`pa-dot pa-dot--${DEVICE_STATUS[d.status].tone}`} title={DEVICE_STATUS[d.status].label} aria-hidden />
                <span className="sr-only">{DEVICE_STATUS[d.status].label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={`pa-topo__link${lanOk ? '' : ' is-down'}`}><span>LAN</span></div>
      <div className="pa-topo__col pa-topo__col--center">
        <div className={`pa-topo__box pa-topo__box--edge pa-soft--${EDGE_STATUS[e.status].tone}`}>
          <div className="pa-topo__head"><Icon name="Router" size={14} /> Store Edge</div>
          <span className="num">{e.queueCount} queued</span>
          <StatusBadge meta={EDGE_STATUS[e.status]} />
        </div>
      </div>
      <div className={`pa-topo__link${wanOk ? '' : ' is-down'}`}><span>WAN {wanOk ? '' : '✕'}</span></div>
      <div className="pa-topo__col pa-topo__col--center">
        <div className="pa-topo__box">
          <div className="pa-topo__head"><Icon name="Cloud" size={14} /> Elixir Cloud</div>
          <span className="muted">{wanOk ? 'Checkpoint current' : 'Awaiting reconnect'}</span>
        </div>
      </div>
    </div>
  );
}
