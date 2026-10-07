import { useState } from 'react';
import type { PeripheralStatus } from '@elixir/contracts';
import { DEVICE_STATUS } from '@elixir/domain';
import { dateTime } from '@elixir/format';
import { useEntity } from '@elixir/local-store/react';
import { Badge, Button, Card, CardHeader, Icon, InlineAlert, StatusBadge, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { APP_VERSION, isTauri, osLabel, platformLabel } from '../lib/platform';
import { usePrint } from '../lib/print';

const PERIPH_ICON: Record<string, string> = { printer: 'Printer', scanner: 'ScanBarcode', 'cash-drawer': 'Archive', scale: 'Scale', 'customer-display': 'MonitorSmartphone' };
const PERIPH_LABEL: Record<string, string> = { printer: 'Receipt printer', scanner: 'Barcode scanner', 'cash-drawer': 'Cash drawer', scale: 'Weighing scale', 'customer-display': 'Customer display' };
const STATE: Record<PeripheralStatus['state'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; icon: string }> = {
  ready: { label: 'Ready', tone: 'success', icon: 'CircleCheck' },
  connected: { label: 'Connected', tone: 'success', icon: 'Plug' },
  unavailable: { label: 'Unavailable', tone: 'warning', icon: 'Unplug' },
  error: { label: 'Error', tone: 'danger', icon: 'CircleAlert' },
};

export function DevicesScreen() {
  const s = useSession();
  const { device, binding } = usePos();
  const toast = useToast();
  const print = usePrint((x) => x.print);
  const dev = useEntity(device, 'devices', s.device.id) ?? s.device;
  const [testing, setTesting] = useState<string>();
  const peripherals: PeripheralStatus[] = [...(dev.peripherals ?? [])];
  if (s.capabilities.includes('scale') && !peripherals.some((p) => p.kind === 'scale')) peripherals.push({ kind: 'scale', name: 'Essae DS-852 (simulated)', state: 'connected' });

  const test = async (p: PeripheralStatus) => {
    setTesting(p.kind);
    await new Promise((r) => setTimeout(r, 700));
    setTesting(undefined);
    if (p.state === 'unavailable' || p.state === 'error') return toast.error(`${PERIPH_LABEL[p.kind]} not responding`, `${p.name} — check cable/power. Sales still complete; receipts can be reprinted from Sales.`);
    if (p.kind === 'printer')
      print(
        <div className="receipt">
          <div className="receipt__center"><div className="receipt__store">TEST PRINT</div><div>{s.tenant.name} · {s.store.name}</div><div>{s.counter?.code} · {dev.code}</div><div>{dateTime(new Date())}</div></div>
          <div className="receipt__rule" /><div className="receipt__center">Printer OK · 80mm</div>
        </div>,
      );
    toast.success(`${PERIPH_LABEL[p.kind]} OK`, p.kind === 'printer' ? 'Test page sent' : p.kind === 'cash-drawer' ? 'Drawer kick sent' : p.kind === 'scale' ? 'Reading 0.000 kg (tared)' : 'Scan received');
  };

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">This device</div>
          <div className="pos-page__desc">Identity, counter binding and peripheral readiness</div>
        </div>
      </div>
      <div className="pos-split" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <Card>
          <CardHeader title={dev.name} subtitle={`${dev.code} · ${dev.kind === 'kds' ? 'Kitchen display' : 'POS terminal'}`} icon={isTauri() ? 'Monitor' : 'Globe'} actions={<StatusBadge meta={DEVICE_STATUS[dev.status]} />} />
          <div className="pos-card-pad pos-kv">
            <span>Runtime</span><span><Badge tone={isTauri() ? 'info' : 'neutral'} icon={isTauri() ? 'AppWindow' : 'Globe'}>{platformLabel()}</Badge></span>
            <span>Operating system</span><span>{osLabel()}</span>
            <span>App version</span><span>{APP_VERSION}</span>
            <span>Device id</span><span style={{ fontSize: 12 }}>{dev.id}</span>
            <span>Tenant</span><span>{s.tenant.name}</span>
            <span>Store</span><span>{s.store.name} ({s.store.code})</span>
            <span>Counter</span><span>{s.counter ? `${s.counter.code} · ${s.counter.name}` : '—'}</span>
            <span>Activated</span><span>{binding?.activatedAt ? dateTime(binding.activatedAt) : dev.activatedAt ? dateTime(dev.activatedAt) : '—'}</span>
            <span>Config version</span><span>v{dev.configVersion}</span>
            <span>Local database</span><span>{isTauri() ? 'SQLite (desktop)' : 'IndexedDB (browser)'}</span>
          </div>
        </Card>
        <Card>
          <CardHeader title="Peripherals" subtitle="Printer, scanner, drawer and scale readiness" icon="Cable" />
          <div className="pos-card-pad">
            {peripherals.length ? (
              <div className="pos-periph">
                {peripherals.map((p) => (
                  <div key={p.kind} className="pos-stat" style={{ gap: 10 }}>
                    <div className="ex-row"><Icon name={PERIPH_ICON[p.kind] ?? 'Cpu'} size={20} /><b>{PERIPH_LABEL[p.kind] ?? p.kind}</b><span className="ex-spacer" /><Badge tone={STATE[p.state].tone} icon={STATE[p.state].icon}>{STATE[p.state].label}</Badge></div>
                    <span className="muted" style={{ fontSize: 13 }}>{p.name}</span>
                    <Button size="sm" icon={p.kind === 'printer' ? 'Printer' : 'Zap'} loading={testing === p.kind} onClick={() => void test(p)}>{p.kind === 'printer' ? 'Test print' : 'Test'}</Button>
                  </div>
                ))}
              </div>
            ) : (
              <InlineAlert tone="info">No peripherals configured for this {dev.kind === 'kds' ? 'kitchen display' : 'device'}.</InlineAlert>
            )}
          </div>
        </Card>
      </div>
      {peripherals.some((p) => p.state === 'unavailable') ? <InlineAlert tone="warning" icon="Printer" title="Printer unavailable">Sales still complete and are saved. Receipts show “Printer unavailable” with a Retry, and can be reprinted from Sales.</InlineAlert> : null}
    </div>
  );
}
