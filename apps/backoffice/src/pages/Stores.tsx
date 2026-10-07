import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardHeader, DescriptionList, Icon, KpiCard, StatusBadge } from '@elixir/ui';
import { DEVICE_STATUS } from '@elixir/domain';
import { useLive } from '@elixir/local-store/react';
import { money, number, relative } from '@elixir/format';
import { KpiRow, PageFrame } from '../components/common';
import { sum, today, useCloud } from '../lib/data';
import { useSession } from '../lib/session';

export function StoresPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const t = today();
  const data = useLive(cloud, ['stores', 'sales', 'devices', 'edgeNodes', 'shifts'], () => s.stores.map((st) => {
    const sales = cloud.where('sales', (x) => x.storeId === st.id && x.businessDate === t && x.status !== 'cancelled');
    const devices = cloud.where('devices', (d) => d.storeId === st.id && d.status !== 'revoked');
    return {
      st, sales: sum(sales, (x) => x.totalPaise), bills: sales.length, devices,
      edge: cloud.where('edgeNodes', (e) => e.storeId === st.id)[0],
      openShifts: cloud.where('shifts', (x) => x.storeId === st.id && x.status !== 'closed').length,
      pending: sum(devices, (d) => d.pendingSync),
    };
  }), [s.stores.map((x) => x.id).join(','), t]);
  return (
    <PageFrame title="Stores" description="Each store has its own counters, stock and invoice series. Switch the header scope to work in one store." crumbs={[{ label: 'Administration' }, { label: 'Stores' }]}>
      <KpiRow>
        <KpiCard label="Stores" icon="Store" value={number(data.length)} />
        <KpiCard label="Sales today (all stores)" icon="IndianRupee" value={money(sum(data, (d) => d.sales), { whole: true })} foot={`${sum(data, (d) => d.bills)} bills`} />
        <KpiCard label="Devices" icon="MonitorSmartphone" value={number(sum(data, (d) => d.devices.length))} foot={`${sum(data, (d) => d.devices.filter((x) => x.status === 'offline' || x.status === 'attention').length)} need attention`} />
        <KpiCard label="Records waiting to sync" icon="CloudUpload" tone={sum(data, (d) => d.pending) ? 'warning' : undefined} value={number(sum(data, (d) => d.pending))} />
      </KpiRow>
      <div className="bo-store-cards">
        {data.map((d) => (
          <Card key={d.st.id}>
            <CardHeader title={d.st.name} subtitle={`${d.st.code} · ${d.st.city}`} icon="Store" actions={d.st.active ? <Badge tone="success" icon="CircleCheck">Active</Badge> : <Badge>Inactive</Badge>} />
            <div style={{ padding: 16 }} className="ex-stack">
              <div className="bo-stats">
                <div className="bo-stat"><span className="bo-stat__k">Sales today</span><span className="bo-stat__v" style={{ fontSize: 20 }}>{money(d.sales, { whole: true })}</span></div>
                <div className="bo-stat"><span className="bo-stat__k">Bills</span><span className="bo-stat__v" style={{ fontSize: 20 }}>{number(d.bills)}</span></div>
                <div className="bo-stat"><span className="bo-stat__k">Open shifts</span><span className="bo-stat__v" style={{ fontSize: 20 }}>{d.openShifts}</span></div>
              </div>
              <div>
                <div className="ex-label" style={{ marginBottom: 6 }}>Devices</div>
                <div className="ex-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {d.devices.map((x) => <span key={x.id} title={`${x.name} · last seen ${relative(x.lastSeenAt)}`}><StatusBadge meta={DEVICE_STATUS[x.status]} label={`${x.code}${x.pendingSync ? ` · ${x.pendingSync}` : ''}`} /></span>)}
                </div>
              </div>
              <div className="ex-row" style={{ gap: 8, fontSize: 13 }}>
                <Icon name="Router" size={16} className="muted" />
                {d.st.edgeEnabled ? (d.edge ? <><span>Store Edge</span><Badge tone={d.edge.status === 'healthy' ? 'success' : d.edge.status === 'degraded' ? 'warning' : 'danger'} icon={d.edge.status === 'healthy' ? 'CircleCheck' : 'TriangleAlert'}>{d.edge.status === 'healthy' ? 'Healthy' : d.edge.status === 'degraded' ? 'Degraded' : 'Down'}</Badge><span className="muted">· WAN {d.edge.wanState} · queue {d.edge.queueCount}</span></> : <Badge tone="info">Store Edge enabled</Badge>) : <span className="muted">Store Edge not enabled{s.has('store-edge') ? '' : ' (add-on)'}</span>}
              </div>
              <DescriptionList items={[['Address', d.st.address], ['Phone', d.st.phone], ['GST state', d.st.stateCode]]} />
              <div className="ex-row">
                <Button size="sm" icon="LayoutDashboard" onClick={() => { s.setStore(d.st.id); nav('/'); }}>Open dashboard</Button>
                <Button size="sm" variant="ghost" icon="MonitorSmartphone" onClick={() => { s.setStore(d.st.id); nav('/devices'); }}>Devices</Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageFrame>
  );
}
