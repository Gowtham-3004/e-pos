import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildSeed } from '@elixir/mock-data';
import type { StorageBackend, WriteOp } from '@elixir/local-store';

type Entity = { id: string };
interface Overlay {
  puts: Record<string, Record<string, Entity>>;
  dels: Record<string, string[]>;
  meta: Record<string, unknown>;
}

const empty = (): Overlay => ({ puts: {}, dels: {}, meta: {} });

/**
 * Durable phone storage for `LocalDatabase` (SQLite in production).
 *
 * The deterministic demo seed (`buildSeed()`) is treated as an immutable base layer, so only
 * entities written after seeding are persisted to AsyncStorage as an overlay (puts + deletes + meta).
 * That keeps the persisted footprint tiny (AsyncStorage on Android caps rows at ~2MB) while
 * every write is still awaited before memory changes (durable-first, FR-OFF-006).
 */
export class AsyncStorageBackend implements StorageBackend {
  private overlay: Overlay = empty();
  private collections: readonly string[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(private key: string) {}

  async open(collections: readonly string[]) {
    this.collections = collections;
    try {
      const raw = await AsyncStorage.getItem(this.key);
      if (raw) this.overlay = { ...empty(), ...(JSON.parse(raw) as Overlay) };
    } catch {
      this.overlay = empty();
    }
  }

  private base(): Record<string, Entity[]> {
    if (this.overlay.meta.seedVersion === undefined) return {};
    const seed = buildSeed() as unknown as Record<string, unknown>;
    return Object.fromEntries(this.collections.map((c) => [c, Array.isArray(seed[c]) ? (seed[c] as Entity[]) : []]));
  }

  async loadCollections(names: string[]) {
    const base = this.base();
    return Object.fromEntries(
      names.map((n) => {
        const m = new Map<string, Entity>((base[n] ?? []).map((e) => [e.id, e]));
        for (const id of this.overlay.dels[n] ?? []) m.delete(id);
        for (const e of Object.values(this.overlay.puts[n] ?? {})) m.set(e.id, e);
        return [n, [...m.values()]];
      }),
    );
  }

  async loadAll() {
    return this.loadCollections([...this.collections]);
  }

  async write(ops: WriteOp[], meta?: Record<string, unknown>) {
    const seeding = !!meta && 'seedVersion' in meta;
    if (!seeding) {
      for (const op of ops) {
        const puts = (this.overlay.puts[op.collection] ??= {});
        const dels = new Set(this.overlay.dels[op.collection] ?? []);
        op.put?.forEach((e) => {
          puts[e.id] = e;
          dels.delete(e.id);
        });
        op.delete?.forEach((id) => {
          delete puts[id];
          dels.add(id);
        });
        this.overlay.dels[op.collection] = [...dels];
      }
    }
    if (meta) Object.assign(this.overlay.meta, meta);
    await this.persist();
  }

  async getMeta<T>(key: string) {
    return this.overlay.meta[key] as T | undefined;
  }

  async setMeta(key: string, value: unknown) {
    this.overlay.meta[key] = value;
    await this.persist();
  }

  async clear() {
    this.overlay = empty();
    await this.persist();
  }

  private persist(): Promise<void> {
    const json = JSON.stringify(this.overlay);
    const write = this.chain.then(() => AsyncStorage.setItem(this.key, json));
    this.chain = write.catch(() => undefined);
    return write; // a failed write rejects → the local commit is not shown as success

  }
}

export async function wipeStorage(keys: string[]) {
  await AsyncStorage.multiRemove(keys).catch(() => undefined);
}
