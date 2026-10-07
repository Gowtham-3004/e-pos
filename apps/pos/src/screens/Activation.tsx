import { useMemo, useState } from 'react';
import { TENANT_IDS } from '@elixir/mock-data';
import { CAPABILITY_LABEL, PLANS, resolveCapabilities, VERTICAL_LABEL } from '@elixir/domain';
import { Badge, Button, ElixirMark, Icon, InlineAlert, cx } from '@elixir/ui';
import { usePos } from '../lib/pos';
import { platformLabel } from '../lib/platform';

const VERTICAL_ICON: Record<string, string> = { grocery: 'ShoppingBasket', fashion: 'Shirt', pharmacy: 'Pill', electronics: 'Smartphone', restaurant: 'UtensilsCrossed' };

/** First-run device activation (mock): bind this terminal to tenant → store → counter. */
export function ActivationScreen() {
  const { device, activate } = usePos();
  const tenants = useMemo(() => Object.values(TENANT_IDS).map((id) => device.get('tenants', id)!).filter(Boolean), [device]);
  const [tenantId, setTenantId] = useState<string>();
  const [storeId, setStoreId] = useState<string>();
  const [counterId, setCounterId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const stores = tenantId ? device.where('stores', (s) => s.tenantId === tenantId && s.active) : [];
  const counters = storeId ? device.where('counters', (c) => c.storeId === storeId && c.active) : [];
  const store = device.get('stores', storeId);
  const counter = device.get('counters', counterId);
  const deviceRec = counterId ? device.get('devices', `d-${counterId}`) : undefined;
  const revoked = deviceRec?.status === 'revoked';

  const go = async () => {
    if (!tenantId || !storeId || !counterId) return;
    setBusy(true);
    await new Promise((r) => setTimeout(r, 500)); // simulated activation handshake
    await activate({ deviceId: `d-${counterId}`, tenantId, storeId, counterId }, !!store?.edgeEnabled);
    setBusy(false);
  };

  return (
    <div className="act">
      <div className="act__card ex-card">
        <div className="act__head">
          <ElixirMark size={34} />
          <div>
            <div className="act__title">Activate this terminal</div>
            <div className="muted">Elixir POS · {platformLabel()} · One-time setup binds this device to a store counter.</div>
          </div>
          <div className="ex-spacer" />
          <Badge tone="info" icon="FlaskConical">Demo activation</Badge>
        </div>
        <div className="act__cols">
          <section className="act__col" aria-label="Tenant">
            <div className="act__step"><span>1</span>Business</div>
            {tenants.map((t) => {
              const plan = PLANS.find((p) => p.code === t.plan)!;
              return (
                <button key={t.id} type="button" className={cx('act__opt', tenantId === t.id && 'is-on')} onClick={() => { setTenantId(t.id); setStoreId(undefined); setCounterId(undefined); }}>
                  <span className="act__icon"><Icon name={VERTICAL_ICON[t.vertical] ?? 'Store'} size={18} /></span>
                  <span className="act__opt-main">
                    <b>{t.name}</b>
                    <span className="muted">{VERTICAL_LABEL[t.vertical]} · {plan.name}</span>
                  </span>
                  {tenantId === t.id ? <Icon name="CircleCheck" size={18} className="act__check" /> : null}
                </button>
              );
            })}
          </section>
          <section className="act__col" aria-label="Store">
            <div className="act__step"><span>2</span>Store</div>
            {!tenantId ? <div className="act__empty">Pick a business first.</div> : null}
            {stores.map((s) => (
              <button key={s.id} type="button" className={cx('act__opt', storeId === s.id && 'is-on')} onClick={() => { setStoreId(s.id); setCounterId(undefined); }}>
                <span className="act__icon"><Icon name="Store" size={18} /></span>
                <span className="act__opt-main">
                  <b>{s.name}</b>
                  <span className="muted">{s.code} · {s.city}</span>
                </span>
                {s.edgeEnabled ? <Badge tone="info" icon="Router">Store Edge</Badge> : null}
              </button>
            ))}
          </section>
          <section className="act__col" aria-label="Counter">
            <div className="act__step"><span>3</span>Counter</div>
            {!storeId ? <div className="act__empty">Pick a store to see its counters.</div> : null}
            {counters.map((c) => {
              const d = device.get('devices', `d-${c.id}`);
              return (
                <button key={c.id} type="button" className={cx('act__opt', counterId === c.id && 'is-on')} onClick={() => setCounterId(c.id)}>
                  <span className="act__icon"><Icon name={c.kind === 'kitchen' ? 'ChefHat' : 'Monitor'} size={18} /></span>
                  <span className="act__opt-main">
                    <b>{c.code} · {c.name}</b>
                    <span className="muted">{c.kind === 'kitchen' ? 'Kitchen display' : 'Billing counter'} · {d?.code ?? 'new device'}</span>
                  </span>
                </button>
              );
            })}
          </section>
        </div>
        <div className="act__foot">
          {tenantId ? (
            <div className="act__caps">
              {resolveCapabilities(device.get('tenants', tenantId)!).filter((c) => ['batch-expiry', 'variants', 'serial-tracking', 'prescription', 'weighted-items', 'restaurant.kds', 'store-edge', 'loyalty', 'cloud-sync'].includes(c)).map((c) => (
                <Badge key={c} outline>{CAPABILITY_LABEL[c] ?? c}</Badge>
              ))}
            </div>
          ) : <span className="muted">Select business, store and counter.</span>}
          <div className="ex-spacer" />
          {revoked ? <InlineAlert tone="danger">This device record is revoked. Choose another counter.</InlineAlert> : null}
          <Button variant="primary" size="lg" icon="BadgeCheck" disabled={!counter || revoked} loading={busy} onClick={go}>
            {counter ? `Activate as ${store?.code} · ${counter.code}` : 'Activate device'}
          </Button>
        </div>
      </div>
    </div>
  );
}
