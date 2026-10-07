import './polyfills';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Capability, Permission, Role, Store, Tenant, User } from '@elixir/contracts';
import { familyOf, resolveCapabilities, roleByCode } from '@elixir/domain';
import { DEFAULT_NETWORK, LocalDatabase, SyncEngine, type BootStep, type NetworkState } from '@elixir/local-store';
import { useMeta, useSyncStatus } from '@elixir/local-store/react';
import type { SyncStatusSnapshot } from '@elixir/contracts';
import { AsyncStorageBackend, wipeStorage } from './storage';

export type Mode = 'owner' | 'waiter';

/** Persisted sign-in on this phone (device meta `mobileSession`). */
export interface MobileSession {
  tenantId: string;
  userId: string;
  deviceId: string;
  /** Selected store for owner views; 'all' = consolidated (cloud) view. */
  storeId: string | 'all';
  mode: Mode;
  authMode: 'online' | 'offline';
  signedInAt: string;
}

/** Resolved operator context for screens. */
export interface SessionInfo extends MobileSession {
  tenant: Tenant;
  user: User;
  role: Role;
  stores: Store[];
  /** Concrete store for store-scoped work (first assigned store when 'all'). */
  store: Store;
  capabilities: Capability[];
  permissions: Permission[];
  family: 'retail' | 'restaurant';
  can: (p: Permission) => boolean;
  has: (c: Capability) => boolean;
}

interface AppValue {
  device: LocalDatabase;
  cloud: LocalDatabase;
  engine?: SyncEngine;
  session?: SessionInfo;
  sessionStartedAt: number;
  signIn: (tenantId: string, userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  setStore: (storeId: string | 'all') => Promise<void>;
  resetDemo: () => Promise<void>;
}

const DEVICE_KEY = 'elixir-mobile:device-db';
const CLOUD_KEY = 'elixir-mobile:cloud-db';

function createDbs() {
  const deviceBackend = new AsyncStorageBackend(DEVICE_KEY);
  return {
    deviceBackend,
    device: new LocalDatabase('elixir-mobile-device', deviceBackend),
    cloud: new LocalDatabase('elixir-mobile-cloud', new AsyncStorageBackend(CLOUD_KEY)),
  };
}

export const MOBILE_ROLES: User['role'][] = ['owner', 'manager', 'waiter'];
export const modeForRole = (r: User['role']): Mode | undefined => (r === 'waiter' ? 'waiter' : r === 'owner' || r === 'manager' ? 'owner' : undefined);

/** This phone's device record for a tenant (seeded as `d-<storeId>-mob`). */
export function mobileDeviceFor(db: LocalDatabase, tenantId: string): string | undefined {
  return db.where('devices', (d) => d.tenantId === tenantId && d.kind === 'mobile')[0]?.id;
}

const Ctx = createContext<AppValue | null>(null);

export function AppProvider({ children, boot }: { children: ReactNode; boot: (steps: BootStep[], error?: string) => ReactNode }) {
  const [dbs, setDbs] = useState(createDbs);
  const [ready, setReady] = useState(false);
  const [steps, setSteps] = useState<BootStep[]>([]);
  const [error, setError] = useState<string>();
  const [raw, setRaw] = useState<MobileSession>();
  const [engine, setEngine] = useState<SyncEngine>();
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      try {
        const t0 = Date.now();
        await dbs.device.init((s) => alive && setSteps(s));
        await dbs.cloud.init();
        // LocalDatabase only caches well-known meta keys; read the session straight from storage.
        const saved = (await dbs.deviceBackend.getMeta<MobileSession | null>('mobileSession')) ?? undefined;
        const wait = 500 - (Date.now() - t0);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        if (!alive) return;
        if (saved && dbs.device.get('users', saved.userId)) setRaw(saved);
        setReady(true);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dbs]);

  // One sync engine per signed-in tenant: device DB ⇄ simulated cloud.
  useEffect(() => {
    if (!ready || !raw) {
      setEngine(undefined);
      return;
    }
    const e = new SyncEngine(dbs.device, dbs.cloud, { deviceId: raw.deviceId, tenantId: raw.tenantId });
    e.start(1500);
    setEngine(e);
    return () => e.stop();
  }, [ready, raw?.tenantId, raw?.deviceId, dbs]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(
    async (s: MobileSession | undefined) => {
      await dbs.device.setMeta('mobileSession', s ?? null);
      setRaw(s);
    },
    [dbs],
  );

  const signIn = useCallback(
    async (tenantId: string, userId: string) => {
      const user = dbs.device.get('users', userId)!;
      const mode = modeForRole(user.role)!;
      const deviceId = mobileDeviceFor(dbs.device, tenantId) ?? `d-mobile-${tenantId}`;
      const net = { ...DEFAULT_NETWORK, ...(dbs.device.meta<NetworkState>('network') ?? {}) };
      startedAt.current = Date.now();
      await persist({ tenantId, userId, deviceId, storeId: user.storeIds[0] ?? 'all', mode, authMode: net.wan === 'online' ? 'online' : 'offline', signedInAt: new Date().toISOString() });
    },
    [dbs, persist],
  );

  const signOut = useCallback(async () => persist(undefined), [persist]);
  const setStore = useCallback(async (storeId: string | 'all') => raw && persist({ ...raw, storeId }), [raw, persist]);

  const resetDemo = useCallback(async () => {
    engine?.stop();
    await dbs.device.reset();
    await dbs.cloud.reset();
    await wipeStorage([DEVICE_KEY, CLOUD_KEY]);
    setRaw(undefined);
    setSteps([]);
    setDbs(createDbs());
  }, [dbs, engine]);

  const session = useMemo<SessionInfo | undefined>(() => {
    if (!raw || !ready) return undefined;
    const tenant = dbs.device.get('tenants', raw.tenantId);
    const user = dbs.device.get('users', raw.userId);
    if (!tenant || !user) return undefined;
    const role = roleByCode(user.role);
    const stores = dbs.device.where('stores', (s) => s.tenantId === tenant.id && user.storeIds.includes(s.id));
    const store = stores.find((s) => s.id === raw.storeId) ?? stores[0]!;
    const capabilities = resolveCapabilities(tenant);
    const family = familyOf(tenant.vertical);
    let permissions = role.permissions;
    if (family === 'retail') permissions = permissions.filter((p) => !p.startsWith('restaurant.') && p !== 'kds.operate');
    return {
      ...raw, tenant, user, role, stores, store, capabilities, permissions, family,
      can: (p) => permissions.includes(p),
      has: (c) => capabilities.includes(c),
    };
  }, [raw, ready, dbs]);

  const value = useMemo<AppValue>(
    () => ({ device: dbs.device, cloud: dbs.cloud, engine, session, sessionStartedAt: startedAt.current, signIn, signOut, setStore, resetDemo }),
    [dbs, engine, session, signIn, signOut, setStore, resetDemo],
  );

  if (!ready) return <>{boot(steps, error)}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}

/** Signed-in context; screens under (owner)/(waiter) are only mounted with a session. */
export function useSession(): SessionInfo {
  const s = useApp().session;
  if (!s) throw new Error('No session');
  return s;
}

// ───────────────────────── Network & sync ─────────────────────────

export function useNetwork() {
  const { device, engine } = useApp();
  const meta = useMeta<NetworkState>(device, 'network');
  const network: NetworkState = { ...DEFAULT_NETWORK, ...(meta ?? {}) };
  const online = network.wan === 'online' && network.cloud === 'up';
  const setWan = useCallback(
    async (wan: NetworkState['wan']) => {
      if (engine) await engine.setNetwork({ wan });
      else await device.setMeta('network', { ...network, wan });
    },
    [engine, device, network],
  );
  return { network, online, setWan };
}

/** Sync snapshot; falls back to a network-only snapshot before sign-in. */
export function useSync(): SyncStatusSnapshot {
  const { engine, device } = useApp();
  const s = useSyncStatus(engine);
  const { online } = useNetwork();
  return (
    s ?? {
      connectivity: online ? 'online' : 'offline',
      cloudReachable: online,
      edge: 'not-configured',
      pending: 0,
      failed: 0,
      quarantined: 0,
      lastSuccessAt: device.meta<string>('lastSyncAt'),
    }
  );
}
