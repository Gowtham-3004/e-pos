import { useMemo } from 'react';
import { useElixirData } from '@elixir/app-kit';
import { useCollection } from '@elixir/local-store/react';
import type { Counter, Device, Store, Tenant, User } from '@elixir/contracts';
import { useCurrentSession } from './session';

export function useCloud() {
  return useElixirData().cloud;
}

/** Actor for audit attribution. */
export function useActor() {
  const s = useCurrentSession();
  return { userId: s.userId, name: s.name };
}

function byId<T extends { id: string }>(xs: T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]));
}

/** Live id → entity maps for joins in tables. */
export function useLookups() {
  const cloud = useCloud();
  const tenants = useCollection(cloud, 'tenants');
  const stores = useCollection(cloud, 'stores');
  const counters = useCollection(cloud, 'counters');
  const users = useCollection(cloud, 'users');
  const devices = useCollection(cloud, 'devices');
  return useMemo(() => {
    const t = byId<Tenant>(tenants), s = byId<Store>(stores), c = byId<Counter>(counters), u = byId<User>(users);
    return {
      tenants: t,
      stores: s,
      counters: c,
      users: u,
      devices: byId<Device>(devices),
      tenantName: (id?: string) => (id ? t.get(id)?.name ?? id : '—'),
      storeName: (id?: string) => (id ? s.get(id)?.name ?? id : '—'),
      counterCode: (id?: string) => (id ? c.get(id)?.code ?? '—' : '—'),
      userName: (id?: string) => (id ? u.get(id)?.name ?? id : '—'),
    };
  }, [tenants, stores, counters, users, devices]);
}
