import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Capability, Permission, ProductFamily, Role, Store, Tenant, User } from '@elixir/contracts';
import { familyOf, resolveCapabilities, roleByCode } from '@elixir/domain';
import { useElixirData } from '@elixir/app-kit';
import { useLive } from '@elixir/local-store/react';

const KEY = 'bo-session';
export const ALL_STORES = 'all';

interface Stored {
  tenantId: string;
  userId: string;
  storeId: string;
}

export interface Session {
  tenant: Tenant;
  user: User;
  role: Role;
  family: ProductFamily;
  capabilities: Capability[];
  permissions: Permission[];
  /** Stores the user may see (tenant stores ∩ user.storeIds). */
  stores: Store[];
  /** Selected store id, or 'all' for consolidated views. */
  storeId: string;
  /** Store ids in the current scope. */
  scope: string[];
  multiStore: boolean;
  setStore: (id: string) => void;
  signOut: () => void;
  has: (c: Capability) => boolean;
  can: (p: Permission) => boolean;
  storeName: (id: string | undefined) => string;
}

interface Ctx {
  session: Session | null;
  signIn: (tenantId: string, userId: string) => void;
}

const SessionCtx = createContext<Ctx | null>(null);

function readStored(): Stored | null {
  try {
    // Demo deep link: ?demo=t-abc:owner signs in directly (used for screenshots / demos).
    const p = new URLSearchParams(location.search).get('demo');
    if (p) {
      const [tenantId, key] = p.split(':');
      const s = { tenantId: tenantId!, userId: `u-${tenantId}-${key}`, storeId: '' };
      localStorage.setItem(KEY, JSON.stringify(s));
      return s;
    }
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null) {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { cloud } = useElixirData();
  const [stored, setStored] = useState<Stored | null>(readStored);

  const signIn = useCallback((tenantId: string, userId: string) => {
    const s = { tenantId, userId, storeId: '' };
    write(s);
    setStored(s);
  }, []);

  const session = useLive(
    cloud,
    ['tenants', 'users', 'stores'],
    (): Session | null => {
      if (!stored) return null;
      const tenant = cloud.get('tenants', stored.tenantId);
      const user = cloud.get('users', stored.userId);
      if (!tenant || !user || !user.active || user.tenantId !== tenant.id) return null;
      const role = roleByCode(user.role);
      const family = familyOf(tenant.vertical);
      const capabilities = resolveCapabilities(tenant);
      let permissions: Permission[] = role.permissions;
      if (family === 'retail') permissions = permissions.filter((p) => !p.startsWith('restaurant.') && p !== 'kds.operate');
      const tenantStores = cloud.where('stores', (s) => s.tenantId === tenant.id).sort((a, b) => a.code.localeCompare(b.code));
      const stores = tenantStores.filter((s) => user.storeIds.includes(s.id));
      const visible = stores.length ? stores : tenantStores;
      const multiStore = capabilities.includes('multi-store') && visible.length > 1;
      let storeId = stored.storeId;
      if (!storeId || (storeId === ALL_STORES && !multiStore) || (storeId !== ALL_STORES && !visible.some((s) => s.id === storeId))) {
        storeId = multiStore ? ALL_STORES : visible[0]?.id ?? '';
      }
      const scope = storeId === ALL_STORES ? visible.map((s) => s.id) : [storeId];
      const names = new Map(tenantStores.map((s) => [s.id, s.name]));
      return {
        tenant,
        user,
        role,
        family,
        capabilities,
        permissions,
        stores: visible,
        storeId,
        scope,
        multiStore,
        setStore: (id: string) => {
          const s = { ...stored, storeId: id };
          write(s);
          setStored(s);
        },
        signOut: () => {
          write(null);
          setStored(null);
        },
        has: (c) => capabilities.includes(c),
        can: (p) => permissions.includes(p),
        storeName: (id) => (id ? names.get(id) ?? id : '—'),
      };
    },
    [stored],
  );

  const value = useMemo(() => ({ session, signIn }), [session, signIn]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSessionCtx(): Ctx {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}

/** Signed-in session (only call below the auth gate). */
export function useSession(): Session {
  const s = useSessionCtx().session;
  if (!s) throw new Error('Not signed in');
  return s;
}
