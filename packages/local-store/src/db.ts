import type { ChangeFeedEntry } from '@elixir/contracts';
import { buildSeed, SEED_VERSION, type SeedData } from '@elixir/mock-data';

/** Every persisted collection. Mirrors SeedData arrays plus sync bookkeeping. */
export const COLLECTIONS = [
  'tenants', 'companies', 'stores', 'counters', 'devices', 'users', 'categories', 'brands', 'taxRates', 'priceGroups', 'products', 'batches', 'serials',
  'customers', 'suppliers', 'sales', 'returns', 'heldCarts', 'stockMovements', 'purchases', 'adjustments', 'payments', 'loyaltyEvents', 'shifts',
  'cashMovements', 'menuItems', 'modifierGroups', 'stations', 'floors', 'tables', 'orders', 'kots', 'waiterCalls', 'auditEvents', 'approvals',
  'syncConflicts', 'outbox', 'edgeNodes', 'tickets', 'changefeed', 'inbox',
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

type SeedArrays = { [K in keyof SeedData as SeedData[K] extends unknown[] ? K : never]: SeedData[K] };
export type EntityOf<C extends CollectionName> = C extends keyof SeedArrays
  ? SeedArrays[C][number]
  : C extends 'changefeed'
    ? ChangeFeedEntry
    : C extends 'inbox'
      ? { id: string; receivedAt: string; deviceId: string }
      : never;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntity = { id: string } & { [k: string]: any };

export interface WriteOp {
  collection: CollectionName;
  put?: AnyEntity[];
  delete?: string[];
}

/** Durable storage adapter. IndexedDB on web; memory (or AsyncStorage) elsewhere. */
export interface StorageBackend {
  open(collections: readonly string[]): Promise<void>;
  loadAll(): Promise<Record<string, Array<{ id: string }>>>;
  loadCollections(names: string[]): Promise<Record<string, Array<{ id: string }>>>;
  write(ops: WriteOp[], meta?: Record<string, unknown>): Promise<void>;
  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryBackend implements StorageBackend {
  private data = new Map<string, Map<string, { id: string }>>();
  private meta = new Map<string, unknown>();
  async open(collections: readonly string[]) {
    collections.forEach((c) => this.data.has(c) || this.data.set(c, new Map()));
  }
  async loadAll() {
    return Object.fromEntries([...this.data].map(([k, v]) => [k, [...v.values()]]));
  }
  async loadCollections(names: string[]) {
    return Object.fromEntries(names.map((n) => [n, [...(this.data.get(n)?.values() ?? [])]]));
  }
  async write(ops: WriteOp[], meta?: Record<string, unknown>) {
    for (const op of ops) {
      const m = this.data.get(op.collection)!;
      op.put?.forEach((e) => m.set(e.id, structuredClone(e)));
      op.delete?.forEach((id) => m.delete(id));
    }
    if (meta) Object.entries(meta).forEach(([k, v]) => this.meta.set(k, v));
  }
  async getMeta<T>(key: string) {
    return this.meta.get(key) as T | undefined;
  }
  async setMeta(key: string, value: unknown) {
    this.meta.set(key, value);
  }
  async clear() {
    this.data.forEach((m) => m.clear());
    this.meta.clear();
  }
}

export interface BootStep {
  key: string;
  label: string;
  done: boolean;
}

type Listener = (changed: Set<CollectionName>) => void;

/**
 * In-memory projection over a durable backend.
 * Reads are synchronous from memory (fast local search, <300ms scan-to-cart).
 * Writes are durable-first: memory only changes after the backend commit resolves,
 * so a failed local commit is never shown as success (FR-OFF-006).
 */
export class LocalDatabase {
  readonly name: string;
  private backend: StorageBackend;
  private mem = new Map<CollectionName, Map<string, { id: string }>>();
  private arrays = new Map<CollectionName, unknown[]>();
  private versions = new Map<CollectionName, number>();
  private listeners = new Set<Listener>();
  private channel?: BroadcastChannel;
  private metaCache = new Map<string, unknown>();
  ready = false;

  constructor(name: string, backend: StorageBackend) {
    this.name = name;
    this.backend = backend;
    COLLECTIONS.forEach((c) => {
      this.mem.set(c, new Map());
      this.versions.set(c, 0);
    });
  }

  /** Open storage, seed on first run, load the workspace into memory. */
  async init(onStep?: (steps: BootStep[]) => void): Promise<void> {
    const steps: BootStep[] = [
      { key: 'db', label: 'Local database', done: false },
      { key: 'seed', label: 'Catalog & configuration', done: false },
      { key: 'tx', label: 'Last committed transactions', done: false },
      { key: 'sync', label: 'Pending sync queue', done: false },
      { key: 'periph', label: 'Printer configuration', done: false },
    ];
    const tick = (k: string) => {
      steps.find((s) => s.key === k)!.done = true;
      onStep?.(steps.map((s) => ({ ...s })));
    };
    onStep?.(steps);
    await this.backend.open(COLLECTIONS);
    tick('db');
    const seeded = await this.backend.getMeta<number>('seedVersion');
    if (seeded !== SEED_VERSION) {
      await this.backend.clear();
      const seed = buildSeed();
      const ops: WriteOp[] = COLLECTIONS.filter((c) => Array.isArray((seed as unknown as Record<string, unknown>)[c])).map((c) => ({
        collection: c,
        put: (seed as unknown as Record<string, Array<{ id: string }>>)[c],
      }));
      await this.backend.write(ops, { seedVersion: SEED_VERSION, sequences: seed.sequences, seededAt: new Date().toISOString() });
    }
    tick('seed');
    const all = await this.backend.loadAll();
    for (const c of COLLECTIONS) {
      const m = new Map<string, { id: string }>();
      (all[c] ?? []).forEach((e) => m.set(e.id, e));
      this.mem.set(c, m);
    }
    tick('tx');
    for (const k of ['sequences', 'device', 'network', 'syncCheckpoint', 'lastSyncAt']) this.metaCache.set(k, await this.backend.getMeta(k));
    tick('sync');
    tick('periph');
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`elixir-db:${this.name}`);
      this.channel.onmessage = (ev: MessageEvent<{ collections: CollectionName[]; meta?: string[] }>) => void this.reloadFromPeer(ev.data);
    }
    this.ready = true;
  }

  private async reloadFromPeer(msg: { collections: CollectionName[]; meta?: string[] }) {
    const data = await this.backend.loadCollections(msg.collections);
    for (const c of msg.collections) {
      const m = new Map<string, { id: string }>();
      (data[c] ?? []).forEach((e) => m.set(e.id, e));
      this.mem.set(c, m);
      this.bump(c);
    }
    for (const k of msg.meta ?? []) this.metaCache.set(k, await this.backend.getMeta(k));
    this.emit(new Set(msg.collections));
  }

  private bump(c: CollectionName) {
    this.arrays.delete(c);
    this.versions.set(c, (this.versions.get(c) ?? 0) + 1);
  }

  private emit(changed: Set<CollectionName>) {
    this.listeners.forEach((l) => l(changed));
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  version(c: CollectionName): number {
    return this.versions.get(c) ?? 0;
  }

  get<C extends CollectionName>(c: C, id: string | undefined): EntityOf<C> | undefined {
    if (!id) return undefined;
    return this.mem.get(c)!.get(id) as EntityOf<C> | undefined;
  }

  /** Cached array of a collection — stable identity until the collection changes. */
  all<C extends CollectionName>(c: C): EntityOf<C>[] {
    let a = this.arrays.get(c);
    if (!a) {
      a = [...this.mem.get(c)!.values()];
      this.arrays.set(c, a);
    }
    return a as EntityOf<C>[];
  }

  where<C extends CollectionName>(c: C, pred: (e: EntityOf<C>) => boolean): EntityOf<C>[] {
    return this.all(c).filter(pred);
  }

  meta<T>(key: string): T | undefined {
    return this.metaCache.get(key) as T | undefined;
  }

  /** Load (and cache) a meta key that isn't part of the boot set. */
  async loadMeta<T>(key: string): Promise<T | undefined> {
    const v = await this.backend.getMeta<T>(key);
    this.metaCache.set(key, v);
    return v;
  }

  async setMeta(key: string, value: unknown) {
    await this.backend.setMeta(key, value);
    this.metaCache.set(key, value);
    this.channel?.postMessage({ collections: [], meta: [key] });
    this.emit(new Set());
  }

  /** Atomic multi-collection write. Memory updates only after durable commit. */
  async commit(ops: WriteOp[], meta?: Record<string, unknown>): Promise<void> {
    const clean = ops.filter((o) => o.put?.length || o.delete?.length);
    await this.backend.write(clean, meta);
    const changed = new Set<CollectionName>();
    for (const op of clean) {
      const m = this.mem.get(op.collection)!;
      op.put?.forEach((e) => m.set(e.id, e));
      op.delete?.forEach((id) => m.delete(id));
      this.bump(op.collection);
      changed.add(op.collection);
    }
    if (meta) Object.entries(meta).forEach(([k, v]) => this.metaCache.set(k, v));
    this.channel?.postMessage({ collections: [...changed], meta: meta ? Object.keys(meta) : [] });
    this.emit(changed);
  }

  async put<C extends CollectionName>(c: C, ...entities: EntityOf<C>[]) {
    await this.commit([{ collection: c, put: entities as Array<{ id: string }> }]);
  }

  async remove(c: CollectionName, ...ids: string[]) {
    await this.commit([{ collection: c, delete: ids }]);
  }

  /** Next value for a named sequence; persisted with the write that uses it. */
  peekSequence(key: string, start = 0): number {
    const seq = (this.metaCache.get('sequences') as Record<string, number> | undefined) ?? {};
    return (seq[key] ?? start) + 1;
  }

  sequencesWith(key: string, value: number): Record<string, number> {
    const seq = { ...((this.metaCache.get('sequences') as Record<string, number> | undefined) ?? {}) };
    seq[key] = value;
    return seq;
  }

  private lock: Promise<unknown> = Promise.resolve();
  /** Serialize read-compute-write sections (sequence allocation, stock checks). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Wipe and reseed (demo reset). */
  async reset() {
    await this.backend.clear();
    this.ready = false;
  }
}
