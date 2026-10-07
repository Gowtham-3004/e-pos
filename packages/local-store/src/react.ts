import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SyncStatusSnapshot } from '@elixir/contracts';
import type { CollectionName, EntityOf, LocalDatabase } from './db';
import type { SyncEngine } from './sync';

/** Re-render when any of the given collections change; returns a version key. */
export function useDbVersion(db: LocalDatabase, collections: CollectionName[]): string {
  const key = collections.join(',');
  const getSnapshot = useCallback(() => collections.map((c) => db.version(c)).join('.') + '|' + metaTick(db), [db, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const subscribe = useCallback(
    (cb: () => void) =>
      db.subscribe((changed) => {
        if (changed.size === 0) bumpMeta(db);
        if (changed.size === 0 || collections.some((c) => changed.has(c))) cb();
      }),
    [db, key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const metaTicks = new WeakMap<LocalDatabase, number>();
const metaTick = (db: LocalDatabase) => metaTicks.get(db) ?? 0;
const bumpMeta = (db: LocalDatabase) => metaTicks.set(db, metaTick(db) + 1);

/** Live derived value recomputed when its collections change. */
export function useLive<T>(db: LocalDatabase, collections: CollectionName[], compute: () => T, deps: unknown[] = []): T {
  const v = useDbVersion(db, collections);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(compute, [v, ...deps]);
}

export function useCollection<C extends CollectionName>(db: LocalDatabase, c: C): EntityOf<C>[] {
  const v = useDbVersion(db, [c]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => db.all(c), [v, c]);
}

export function useEntity<C extends CollectionName>(db: LocalDatabase, c: C, id: string | undefined): EntityOf<C> | undefined {
  const v = useDbVersion(db, [c]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => db.get(c, id), [v, c, id]);
}

export function useMeta<T>(db: LocalDatabase, key: string): T | undefined {
  useDbVersion(db, []);
  return db.meta<T>(key);
}

export function useSyncStatus(engine: SyncEngine | undefined): SyncStatusSnapshot | undefined {
  const [s, setS] = useState<SyncStatusSnapshot | undefined>(() => engine?.status());
  useEffect(() => (engine ? engine.subscribe(setS) : undefined), [engine]);
  return s;
}

/** Ticking clock for timers (KDS ticket age, elapsed table time). */
export function useNow(intervalMs = 1000): number {
  const [n, setN] = useState(Date.now());
  const ref = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    ref.current = setInterval(() => setN(Date.now()), intervalMs);
    return () => clearInterval(ref.current);
  }, [intervalMs]);
  return n;
}
