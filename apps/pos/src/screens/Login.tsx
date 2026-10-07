import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { User } from '@elixir/contracts';
import { roleByCode, VERTICAL_LABEL } from '@elixir/domain';
import { dateLong, dateTime } from '@elixir/format';
import { DEMO_LOGINS } from '@elixir/mock-data';
import { Avatar, Badge, Button, ElixirMark, Icon, InlineAlert, PinInput, cx } from '@elixir/ui';
import { usePos } from '../lib/pos';
import { NetworkMenu } from '../components/Header';
import { platformLabel } from '../lib/platform';

const POS_ROLES = new Set(['owner', 'manager', 'cashier', 'waiter', 'kitchen']);

/** PIN login + lock screen (fast user switch keeps counter/device, §27). */
export function LoginScreen({ lockedUserId }: { lockedUserId?: string }) {
  const { device, binding, login, unlock, engine, network, resetDevice } = usePos();
  const nav = useNavigate();
  const tenant = device.get('tenants', binding!.tenantId)!;
  const store = device.get('stores', binding!.storeId)!;
  const counter = device.get('counters', binding!.counterId);
  const dev = device.get('devices', binding!.deviceId);
  const users = useMemo(
    () =>
      device
        .where('users', (u) => u.tenantId === tenant.id && u.active && u.storeIds.includes(store.id) && POS_ROLES.has(u.role))
        .filter((u) => (counter?.kind === 'kitchen' ? u.role === 'kitchen' || u.role === 'manager' || u.role === 'owner' : true))
        .sort((a, b) => ['cashier', 'waiter', 'kitchen', 'manager', 'owner'].indexOf(a.role) - ['cashier', 'waiter', 'kitchen', 'manager', 'owner'].indexOf(b.role)),
    [device, tenant.id, store.id, counter?.kind],
  );
  const [selected, setSelected] = useState<User | undefined>(() => (lockedUserId ? device.get('users', lockedUserId) : undefined));
  const [switching, setSwitching] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string>();
  const offline = engine ? !engine.canReachCloud() : false;
  const demo = DEMO_LOGINS.find((d) => d.tenantId === tenant.id);
  const isLock = !!lockedUserId && !switching;

  const submit = (p: string) => {
    if (!selected) return;
    if (p !== selected.pin) {
      setErr('Incorrect PIN. Try again.');
      setPin('');
      return;
    }
    if (offline && selected.offlineAuthValidUntil && new Date(selected.offlineAuthValidUntil).getTime() < Date.now()) {
      setErr(`Offline authorization expired on ${dateTime(selected.offlineAuthValidUntil)}. Connect to the cloud to sign in.`);
      setPin('');
      return;
    }
    if (lockedUserId) unlock(selected.id);
    else login(selected.id);
    if (!lockedUserId || selected.id !== lockedUserId) nav('/');
  };

  return (
    <div className="login">
      <div className="login__top">
        <ElixirMark size={28} />
        <div className="login__brand">Elixir <span>POS</span></div>
        <div className="login__ctx">
          <span><Icon name="Store" size={14} /> {tenant.name} · {store.name}</span>
          <span><Icon name="Monitor" size={14} /> {counter?.code} · {dev?.code} · {platformLabel()}</span>
        </div>
        <div className="ex-spacer" />
        <NetworkMenu />
        <Badge tone={offline ? 'neutral' : 'success'} icon={offline ? 'WifiOff' : 'Wifi'}>{offline ? (network.wan === 'offline' ? 'Offline' : 'Cloud unreachable') : 'Online'}</Badge>
      </div>
      <div className="login__body">
        <div className="login__panel ex-card">
          {isLock ? (
            <div className="login__locked">
              <Icon name="Lock" size={18} className="muted" />
              <span>Screen locked · counter {counter?.code} stays assigned</span>
            </div>
          ) : (
            <>
              <div className="login__h">Who's on {counter?.code ?? 'this counter'}?</div>
              <div className="login__tiles">
                {users.map((u) => (
                  <button key={u.id} type="button" className={cx('login__tile', selected?.id === u.id && 'is-on')} onClick={() => { setSelected(u); setPin(''); setErr(undefined); }}>
                    <Avatar name={u.name} color={u.avatarColor} size="lg" />
                    <b className="ex-truncate">{u.name}</b>
                    <span className="muted">{roleByCode(u.role).name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {selected ? (
            <div className="login__pin">
              <div className="ex-row" style={{ justifyContent: 'center', gap: 10 }}>
                <Avatar name={selected.name} color={selected.avatarColor} />
                <div>
                  <b>{selected.name}</b>
                  <div className="muted" style={{ fontSize: 12 }}>{roleByCode(selected.role).name} · enter 4-digit PIN</div>
                </div>
              </div>
              {offline ? (
                <InlineAlert tone="warning" icon="ShieldAlert" title="Offline login">
                  Signing in with cached credentials. Authorization valid until {selected.offlineAuthValidUntil ? dateLong(selected.offlineAuthValidUntil) : '—'}.
                </InlineAlert>
              ) : null}
              <PinInput key={selected.id} value={pin} onChange={(v) => { setPin(v); setErr(undefined); }} onComplete={submit} error={!!err} />
              {err ? <InlineAlert tone="danger">{err}</InlineAlert> : null}
              {isLock ? <Button variant="ghost" icon="Users" onClick={() => { setSwitching(true); setSelected(undefined); setPin(''); }}>Switch user</Button> : null}
            </div>
          ) : (
            <div className="login__hint muted"><Icon name="MousePointerClick" size={16} /> Select your name to continue</div>
          )}
        </div>
        <aside className="login__demo ex-card">
          <div className="ex-row"><Icon name="KeyRound" size={16} /><b>Demo sign-in</b></div>
          <div className="muted" style={{ fontSize: 12 }}>{demo?.label ?? `${tenant.name} · ${VERTICAL_LABEL[tenant.vertical]}`}</div>
          <table className="login__demo-table">
            <tbody>
              {(demo?.users ?? []).map(([n, p]) => (
                <tr key={n}><td>{n}</td><td className="num"><code>{p}</code></td></tr>
              ))}
            </tbody>
          </table>
          <div className="ex-hint">Simulate “Offline” from the network menu to try an offline login.</div>
          <Button size="sm" variant="ghost" icon="MonitorX" onClick={() => void resetDevice()}>Switch demo tenant / counter</Button>
        </aside>
      </div>
    </div>
  );
}
