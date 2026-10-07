import { useMemo, useState } from 'react';
import { DEMO_LOGINS } from '@elixir/mock-data';
import { VERTICAL_LABEL, roleByCode } from '@elixir/domain';
import { Avatar, Badge, Button, ElixirLogo, Icon, InlineAlert, PinInput } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { useCloud } from '../lib/data';
import { useSessionCtx } from '../lib/session';

/** Back-office roles only — cashiers, waiters and kitchen sign in on POS devices. */
const BO_ROLES = new Set(['owner', 'manager', 'accountant', 'inventory']);

export function Login() {
  const cloud = useCloud();
  const { signIn } = useSessionCtx();
  const [tenantId, setTenantId] = useState<string>(DEMO_LOGINS[0].tenantId);
  const [userId, setUserId] = useState<string>();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();

  const tenants = useLive(cloud, ['tenants'], () => DEMO_LOGINS.map((d) => ({ demo: d, tenant: cloud.get('tenants', d.tenantId)! })).filter((x) => x.tenant));
  const users = useLive(cloud, ['users'], () => cloud.where('users', (u) => u.tenantId === tenantId && u.active && BO_ROLES.has(u.role)).sort((a, b) => ['owner', 'manager', 'accountant', 'inventory'].indexOf(a.role) - ['owner', 'manager', 'accountant', 'inventory'].indexOf(b.role)), [tenantId]);
  const user = useMemo(() => users.find((u) => u.id === userId), [users, userId]);

  const tryPin = (v: string) => {
    if (!user) return;
    if (v === user.pin) {
      signIn(tenantId, user.id);
    } else {
      setError('Incorrect PIN. Check the PIN and try again.');
      setPin('');
    }
  };

  return (
    <div className="bo-login">
      <div className="bo-login__panel">
        <div className="bo-login__brand">
          <ElixirLogo product="Back Office" size={30} />
          <p className="muted" style={{ marginTop: 8 }}>Manage catalog, stock, purchases, finance and devices for your business.</p>
        </div>

        <section aria-labelledby="biz-h">
          <h2 id="biz-h" className="bo-login__h">1 · Choose business</h2>
          <div className="bo-login__biz">
            {tenants.map(({ demo, tenant }) => (
              <button
                key={tenant.id}
                type="button"
                className="bo-biz"
                aria-pressed={tenant.id === tenantId}
                onClick={() => {
                  setTenantId(tenant.id);
                  setUserId(undefined);
                  setPin('');
                  setError(undefined);
                }}
              >
                <span className="bo-biz__name">{tenant.name}</span>
                <span className="bo-biz__meta">{demo.label.split(' · ').slice(1).join(' · ')}</span>
                <span className="bo-biz__city muted"><Icon name="MapPin" size={12} /> {tenant.city} · {VERTICAL_LABEL[tenant.vertical]}</span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="user-h">
          <h2 id="user-h" className="bo-login__h">2 · Who's signing in?</h2>
          <div className="bo-login__users">
            {users.map((u) => (
              <button key={u.id} type="button" className="bo-user" aria-pressed={u.id === userId} onClick={() => { setUserId(u.id); setPin(''); setError(undefined); }}>
                <Avatar name={u.name} color={u.avatarColor} />
                <span style={{ minWidth: 0 }}>
                  <span className="bo-user__name ex-truncate">{u.name}</span>
                  <span className="bo-user__role">{roleByCode(u.role).name}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="ex-hint" style={{ marginTop: 8 }}>Demo PINs — Owner 1111 · Manager 2222 · Accountant 7777 · Inventory 8888</p>
        </section>
      </div>

      <div className="bo-login__pin">
        {user ? (
          <div className="ex-stack" style={{ alignItems: 'center', gap: 16, width: '100%', maxWidth: 340 }}>
            <Avatar name={user.name} color={user.avatarColor} size="xl" />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{user.name}</div>
              <Badge>{roleByCode(user.role).name}</Badge>
            </div>
            <div className="ex-label">Enter your 4-digit PIN</div>
            <PinInput value={pin} onChange={(v) => { setPin(v); setError(undefined); }} onComplete={tryPin} error={!!error} />
            {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
            <Button variant="ghost" size="sm" icon="ArrowLeft" onClick={() => setUserId(undefined)}>Choose another user</Button>
          </div>
        ) : (
          <div className="bo-login__placeholder">
            <Icon name="ShieldCheck" size={28} />
            <div style={{ fontWeight: 650 }}>Select a user to continue</div>
            <div className="muted" style={{ fontSize: 13 }}>Cashiers, waiters and kitchen staff sign in on POS devices.</div>
          </div>
        )}
      </div>
    </div>
  );
}
