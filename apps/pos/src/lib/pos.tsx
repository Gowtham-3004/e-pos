import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SessionContext, SyncStatusSnapshot } from '@elixir/contracts';
import { useElixirData } from '@elixir/app-kit';
import { resolveSession, SyncEngine, type LocalDatabase, type NetworkState } from '@elixir/local-store';
import { useLive, useMeta, useSyncStatus } from '@elixir/local-store/react';
import { familyOf } from '@elixir/domain';

/** Device binding persisted in device-DB meta `device` (activation). */
export interface DeviceBinding {
  deviceId: string;
  tenantId: string;
  storeId: string;
  counterId: string;
  activatedAt?: string;
}

interface AuthState {
  userId: string;
  authMode: SessionContext['authMode'];
  locked: boolean;
}

export interface PosContextValue {
  device: LocalDatabase;
  cloud: LocalDatabase;
  binding?: DeviceBinding;
  engine?: SyncEngine;
  network: NetworkState;
  sync?: SyncStatusSnapshot;
  auth?: AuthState;
  session?: SessionContext;
  activate: (b: DeviceBinding, edge: boolean) => Promise<void>;
  resetDevice: () => Promise<void>;
  login: (userId: string) => void;
  logout: () => void;
  lock: () => void;
  unlock: (userId: string) => void;
}

const Ctx = createContext<PosContextValue | null>(null);
const AUTH_KEY = 'elixir-pos-auth';

function loadAuth(): AuthState | undefined {
  try {
    const raw = sessionStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : undefined;
  } catch {
    return undefined;
  }
}
function saveAuth(a: AuthState | undefined) {
  try {
    if (a) sessionStorage.setItem(AUTH_KEY, JSON.stringify(a));
    else sessionStorage.removeItem(AUTH_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function PosProvider({ children }: { children: ReactNode }) {
  const { device, cloud } = useElixirData();
  const binding = useMeta<DeviceBinding>(device, 'device');
  const [auth, setAuthState] = useState<AuthState | undefined>(() => loadAuth());
  const setAuth = useCallback((a: AuthState | undefined) => {
    saveAuth(a);
    setAuthState(a);
  }, []);

  // ONE sync engine per activated device.
  const engine = useMemo(
    () => (binding ? new SyncEngine(device, cloud, { deviceId: binding.deviceId, tenantId: binding.tenantId }) : undefined),
    [device, cloud, binding?.deviceId, binding?.tenantId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!engine) return;
    engine.start();
    return () => engine.stop();
  }, [engine]);
  const sync = useSyncStatus(engine);
  // Re-render on network meta changes.
  const netMeta = useMeta<NetworkState>(device, 'network');
  const network = useMemo<NetworkState>(() => engine?.network ?? { wan: 'online', cloud: 'up', edge: 'not-configured' }, [engine, netMeta]); // eslint-disable-line react-hooks/exhaustive-deps

  const session = useLive(
    device,
    ['shifts', 'users', 'devices', 'tenants', 'stores', 'counters'],
    () => (binding && auth ? resolveSession(device, { deviceId: binding.deviceId, userId: auth.userId, authMode: auth.authMode, storeId: binding.storeId }) : undefined),
    [binding?.deviceId, binding?.storeId, auth?.userId, auth?.authMode],
  );

  const activate = useCallback(
    async (b: DeviceBinding, edge: boolean) => {
      await device.setMeta('network', { wan: 'online', cloud: 'up', edge: edge ? 'connected' : 'not-configured' });
      await device.setMeta('device', { ...b, activatedAt: new Date().toISOString() });
      setAuth(undefined);
    },
    [device, setAuth],
  );

  const resetDevice = useCallback(async () => {
    engine?.stop();
    setAuth(undefined);
    await device.setMeta('device', undefined);
  }, [device, engine, setAuth]);

  const login = useCallback(
    (userId: string) => {
      const offline = engine ? !engine.canReachCloud() : false;
      setAuth({ userId, authMode: offline ? 'offline' : 'online', locked: false });
    },
    [engine, setAuth],
  );
  const logout = useCallback(() => setAuth(undefined), [setAuth]);
  const lock = useCallback(() => auth && setAuth({ ...auth, locked: true }), [auth, setAuth]);
  const unlock = useCallback(
    (userId: string) => {
      const offline = engine ? !engine.canReachCloud() : false;
      setAuth({ userId, authMode: offline ? 'offline' : 'online', locked: false });
    },
    [engine, setAuth],
  );

  const value: PosContextValue = { device, cloud, binding, engine, network, sync, auth, session, activate, resetDevice, login, logout, lock, unlock };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePos(): PosContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePos must be used inside <PosProvider>');
  return v;
}

/** Signed-in session — only call below the auth gate. */
export function useSession(): SessionContext & { family: 'retail' | 'restaurant' } {
  const { session } = usePos();
  if (!session) throw new Error('No active POS session');
  return { ...session, family: familyOf(session.tenant.vertical) };
}

export function useCan() {
  const s = useSession();
  return (p: SessionContext['permissions'][number]) => s.permissions.includes(p);
}

/** Landing route by role + family + counter kind (Design System §10, FRD login). */
export function landingFor(s: SessionContext): string {
  if (s.counter?.kind === 'kitchen' || s.user.role === 'kitchen') return '/kds';
  const family = familyOf(s.tenant.vertical);
  if (family === 'restaurant') return '/tables';
  if (s.permissions.includes('pos.sell')) return '/billing';
  return '/devices';
}
