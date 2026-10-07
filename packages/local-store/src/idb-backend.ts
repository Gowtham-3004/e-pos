import { openDB, type IDBPDatabase } from 'idb';
import type { StorageBackend, WriteOp } from './db';

const META = '__meta';

/** IndexedDB durable backend (web / Tauri webview). SQLite replaces this in the production desktop build (ADR-004). */
export class IndexedDBBackend implements StorageBackend {
  private db?: IDBPDatabase;
  constructor(private dbName: string, private schemaVersion = 4) {}

  async open(collections: readonly string[]) {
    this.db = await openDB(this.dbName, this.schemaVersion, {
      upgrade(db) {
        for (const c of collections) if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      },
    });
  }

  private get d() {
    if (!this.db) throw new Error('IndexedDB not opened');
    return this.db;
  }

  async loadAll() {
    const names = [...this.d.objectStoreNames].filter((n) => n !== META);
    return this.loadCollections(names);
  }

  async loadCollections(names: string[]) {
    if (!names.length) return {};
    const tx = this.d.transaction(names, 'readonly');
    const out: Record<string, Array<{ id: string }>> = {};
    await Promise.all(names.map(async (n) => (out[n] = await tx.objectStore(n).getAll())));
    await tx.done;
    return out;
  }

  async write(ops: WriteOp[], meta?: Record<string, unknown>) {
    const stores = [...new Set(ops.map((o) => o.collection as string))];
    if (meta) stores.push(META);
    if (!stores.length) return;
    const tx = this.d.transaction(stores, 'readwrite');
    for (const op of ops) {
      const st = tx.objectStore(op.collection);
      op.put?.forEach((e) => void st.put(e));
      op.delete?.forEach((id) => void st.delete(id));
    }
    if (meta) {
      const st = tx.objectStore(META);
      Object.entries(meta).forEach(([k, v]) => void st.put(v, k));
    }
    await tx.done;
  }

  async getMeta<T>(key: string) {
    return (await this.d.get(META, key)) as T | undefined;
  }

  async setMeta(key: string, value: unknown) {
    await this.d.put(META, value, key);
  }

  async clear() {
    const names = [...this.d.objectStoreNames];
    const tx = this.d.transaction(names, 'readwrite');
    await Promise.all(names.map((n) => tx.objectStore(n).clear()));
    await tx.done;
  }
}
