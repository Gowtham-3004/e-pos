import { useEffect, useState } from 'react';
import type { LocalDatabase } from '@elixir/local-store';
import { useMeta } from '@elixir/local-store/react';
import { useCloud } from './data';
import { useSession } from './session';
import { defaultSettings, settingsKey, type TenantSettings } from './ops';

const hydrated = new Set<string>();

/** App-specific meta isn't in the boot cache after a reload — load it once. */
async function hydrateMeta(cloud: LocalDatabase, key: string): Promise<boolean> {
  if (hydrated.has(key) || cloud.meta(key) !== undefined) return false;
  hydrated.add(key);
  return (await cloud.loadMeta(key)) !== undefined;
}

export function useSettings(): TenantSettings {
  const cloud = useCloud();
  const s = useSession();
  const key = settingsKey(s.tenant.id);
  const [, bump] = useState(0);
  useEffect(() => {
    void hydrateMeta(cloud, key).then((changed) => changed && bump((n) => n + 1));
  }, [cloud, key]);
  const stored = useMeta<Partial<TenantSettings>>(cloud, key);
  return { ...defaultSettings(cloud, s.tenant.id), ...(stored ?? {}) };
}
