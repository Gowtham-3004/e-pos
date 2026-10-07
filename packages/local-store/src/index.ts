export * from './db';
export * from './idb-backend';
export * from './commands';
export * from './sync';
export * from './selectors';

import { LocalDatabase, MemoryBackend } from './db';
import { IndexedDBBackend } from './idb-backend';

/**
 * Web/Tauri databases.
 * - `device`: the POS terminal's local transaction store (SQLite in production — ADR-004).
 * - `cloud`: a browser-local simulation of Elixir Cloud (PostgreSQL in production). Back Office and
 *   Platform Admin read this; the POS sync engine pushes into it. Same-origin apps share it live.
 */
export function createWebDatabases(prefix = 'elixir') {
  const hasIdb = typeof indexedDB !== 'undefined';
  return {
    device: new LocalDatabase(`${prefix}-device`, hasIdb ? new IndexedDBBackend(`${prefix}-device`) : new MemoryBackend()),
    cloud: new LocalDatabase(`${prefix}-cloud`, hasIdb ? new IndexedDBBackend(`${prefix}-cloud`) : new MemoryBackend()),
  };
}
