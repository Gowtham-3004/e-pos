import { useState } from 'react';
import { Badge, ElixirLogo, Icon, InlineAlert, PinInput } from '@elixir/ui';
import { PLATFORM_LOGINS } from '@elixir/mock-data';
import { roleByCode } from '@elixir/domain';
import { useCloud } from '../lib/hooks';
import { useSession } from '../lib/session';

/** Platform staff sign-in. Prototype: PIN against `t-platform` users in the simulated cloud. */
export function Login() {
  const cloud = useCloud();
  const signIn = useSession((s) => s.signIn);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string>();

  const attempt = (p: string) => {
    const user = cloud.where('users', (u) => u.tenantId === 't-platform' && u.pin === p && u.active)[0];
    if (!user) {
      setError('PIN not recognised for platform staff. Check the PIN or contact the platform owner.');
      setPin('');
      return;
    }
    signIn(user);
  };

  return (
    <div className="pa-login">
      <div className="pa-login__card ex-card">
        <div className="ex-row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <ElixirLogo product="Platform" />
          <Badge tone="warning" icon="FlaskConical">Prototype · Simulated Cloud</Badge>
        </div>
        <h1 style={{ fontSize: 'var(--fs-xl)', lineHeight: 'var(--lh-xl)' }}>Platform staff sign-in</h1>
        <p className="muted" style={{ marginTop: 4, marginBottom: 20 }}>Internal operations console for tenants, subscriptions, devices, sync and support. All actions are audited.</p>
        <PinInput value={pin} onChange={(v) => { setPin(v); setError(undefined); }} onComplete={attempt} error={!!error} />
        <div style={{ marginTop: 16 }}>
          {error ? (
            <InlineAlert tone="danger">{error}</InlineAlert>
          ) : (
            <div className="pa-login__hint">
              <Icon name="KeyRound" size={14} />
              <span>
                Demo staff:{' '}
                {PLATFORM_LOGINS.map(([label, p], i) => (
                  <span key={p}>
                    {i ? ' · ' : ''}
                    {label} <b className="num">{p}</b>
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        <div className="pa-login__roles">
          {(['platform-admin', 'support'] as const).map((r) => (
            <div key={r}>
              <b>{roleByCode(r).name}</b>
              <span className="muted"> — {r === 'platform-admin' ? 'tenants, subscriptions, devices, sync resolution' : 'devices, diagnostics and tickets; read-only subscriptions'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
