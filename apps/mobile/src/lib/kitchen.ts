import { useEffect, useRef } from 'react';
import { setKotStatus, type LocalDatabase } from '@elixir/local-store';

/**
 * The kitchen display runs on another device; on the phone we simulate its progress for KOTs sent
 * during this session (New → Preparing after ~10s → Ready after ~35s) so waiters see live status.
 * Updates are applied one at a time: each KOT update rewrites its order's lines.
 */
export function useKitchenSimulator(db: LocalDatabase, storeId: string | undefined, since: number, onReady: (kotNo: string, table?: string) => void) {
  const cb = useRef(onReady);
  cb.current = onReady;
  useEffect(() => {
    if (!storeId) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const now = Date.now();
        for (const k of db.where('kots', (x) => x.storeId === storeId && !x.isVoid && new Date(x.createdAt).getTime() >= since - 1000)) {
          const age = now - new Date(k.createdAt).getTime();
          if (k.status === 'new' && age > 10000) await db.exclusive(() => setKotStatus(db, k.id, 'preparing'));
          else if (k.status === 'preparing' && age > 35000) {
            await db.exclusive(() => setKotStatus(db, k.id, 'ready'));
            cb.current(k.displayNo, k.tableCode);
          }
        }
      } finally {
        busy = false;
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [db, storeId, since]);
}
