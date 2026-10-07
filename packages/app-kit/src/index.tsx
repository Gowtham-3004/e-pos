import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createWebDatabases, type BootStep, type LocalDatabase } from '@elixir/local-store';
import { ElixirMark, Icon, InlineAlert, Button, Progress } from '@elixir/ui';

export interface ElixirData {
  /** POS terminal local store (only initialised when `device` is requested). */
  device: LocalDatabase;
  /** Simulated Elixir Cloud (shared live across same-origin apps). */
  cloud: LocalDatabase;
}

const Ctx = createContext<ElixirData | null>(null);
const dbs = createWebDatabases();

/**
 * Initialises local databases and renders the restore screen (§48) until ready.
 * POS uses both; Back Office / Platform Admin only need `cloud`.
 */
export function ElixirDataProvider({ use = ['cloud'], product, children }: { use?: Array<'device' | 'cloud'>; product: string; children: ReactNode }) {
  const [steps, setSteps] = useState<BootStep[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const t0 = performance.now();
        if (use.includes('device')) await dbs.device.init((s) => alive && setSteps(s));
        if (use.includes('cloud')) await dbs.cloud.init(use.includes('device') ? undefined : (s) => alive && setSteps(s));
        const elapsed = performance.now() - t0;
        if (elapsed < 450) await new Promise((r) => setTimeout(r, 450 - elapsed));
        if (alive) setReady(true);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <BootScreen product={product} steps={steps} error={error} />;
  return <Ctx.Provider value={dbs}>{children}</Ctx.Provider>;
}

export function useElixirData(): ElixirData {
  const v = useContext(Ctx);
  if (!v) throw new Error('useElixirData must be used inside <ElixirDataProvider>');
  return v;
}

/** "Restoring local workspace…" (§48). */
export function BootScreen({ product, steps, error }: { product: string; steps: BootStep[]; error?: string }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--surface-app)', padding: 16 }}>
      <div className="ex-card" style={{ width: 'min(400px, 100%)', padding: 28 }}>
        <div className="ex-row" style={{ gap: 12, marginBottom: 20 }}>
          <ElixirMark size={34} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em' }}>Elixir {product}</div>
            <div className="muted" style={{ fontSize: 13 }}>Restoring local workspace…</div>
          </div>
        </div>
        <div className="ex-stack" style={{ gap: 10 }}>
          {(steps.length ? steps : [{ key: 'db', label: 'Local database', done: false }]).map((s) => (
            <div key={s.key} className="ex-row" style={{ fontSize: 14 }}>
              <Icon name={s.done ? 'CircleCheck' : 'Loader2'} size={16} className={s.done ? undefined : 'ex-spin'} style={{ color: s.done ? 'var(--status-success)' : 'var(--text-muted)' }} />
              <span className={s.done ? undefined : 'muted'}>{s.label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <Progress value={steps.length ? (done / steps.length) * 100 : 5} label="Restore progress" />
        </div>
        {error ? (
          <div style={{ marginTop: 16 }}>
            <InlineAlert tone="danger" title="Local data could not be opened">
              {error}. Committed transactions are not affected. Retry, or contact support to run recovery.
            </InlineAlert>
            <Button style={{ marginTop: 10 }} onClick={() => location.reload()} icon="RotateCw">Retry</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Wipe local + simulated cloud data and reseed (demo tool). */
export async function resetDemoData() {
  const del = (name: string) =>
    new Promise<void>((res) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
  await Promise.all([del(dbs.device.name), del(dbs.cloud.name)]);
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  location.reload();
}
