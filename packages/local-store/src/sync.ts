import type { ChangeFeedEntry, ConnectivityState, EdgeState, SyncConflict, SyncOutboxItem, SyncStatusSnapshot } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import type { CollectionName, LocalDatabase, WriteOp } from './db';

export interface NetworkState {
  /** Simulated WAN / internet reachability. */
  wan: 'online' | 'offline';
  /** Simulated Elixir Cloud availability (cloud outage while WAN is up). */
  cloud: 'up' | 'down';
  edge: EdgeState;
}

export const DEFAULT_NETWORK: NetworkState = { wan: 'online', cloud: 'up', edge: 'not-configured' };

const SYNCABLE_STATE = new Set<CollectionName>(['sales', 'returns']);

/**
 * Simulated sync engine (SYNC_ARCHITECTURE §5–6).
 * - Push: pending outbox → cloud, idempotent via cloud inbox (duplicate delivery = one consequence).
 * - Timeout/transient failure → retry same identity with bounded exponential backoff + jitter.
 * - Poison item → quarantined without blocking unrelated items.
 * - Pull: cloud change feed after checkpoint → applied locally; checkpoint advances only after local commit.
 * Normal recovery needs zero cashier action (§76).
 */
export class SyncEngine {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private listeners = new Set<(s: SyncStatusSnapshot) => void>();
  private lastHeartbeat = 0;
  private unsub?: () => void;
  transientFailureRate = 0.06;

  constructor(
    private local: LocalDatabase,
    private cloud: LocalDatabase,
    private ctx: { deviceId: string; tenantId: string },
  ) {}

  get network(): NetworkState {
    return { ...DEFAULT_NETWORK, ...(this.local.meta<NetworkState>('network') ?? {}) };
  }

  async setNetwork(patch: Partial<NetworkState>) {
    await this.local.setMeta('network', { ...this.network, ...patch });
    this.notify();
    if (this.canReachCloud()) void this.tick();
  }

  canReachCloud() {
    const n = this.network;
    return n.wan === 'online' && n.cloud === 'up' && !this.isRevoked();
  }

  start(intervalMs = 1500) {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.unsub = this.local.subscribe((changed) => {
      if (changed.has('outbox') || changed.size === 0) this.notify();
    });
    void this.tick();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.unsub?.();
  }

  subscribe(cb: (s: SyncStatusSnapshot) => void) {
    this.listeners.add(cb);
    cb(this.status());
    return () => {
      this.listeners.delete(cb);
    };
  }

  private notify() {
    const s = this.status();
    this.listeners.forEach((l) => l(s));
  }

  /** Outbox rows produced by this device. */
  outbox(): SyncOutboxItem[] {
    return this.local.where('outbox', (o) => o.deviceId === this.ctx.deviceId);
  }

  status(): SyncStatusSnapshot {
    const items = this.outbox();
    const pendingItems = items.filter((o) => o.status === 'pending' || o.status === 'sending' || o.status === 'retry');
    const quarantined = items.filter((o) => o.status === 'quarantined').length;
    const failed = items.filter((o) => o.status === 'retry').length;
    const n = this.network;
    let connectivity: ConnectivityState = 'online';
    if (!this.canReachCloud()) connectivity = 'offline';
    else if (quarantined > 0) connectivity = 'attention';
    else if (pendingItems.length > 0) connectivity = 'syncing';
    const oldest = pendingItems.reduce<string | undefined>((m, o) => (!m || o.createdAtOrigin < m ? o.createdAtOrigin : m), undefined);
    return {
      connectivity,
      cloudReachable: this.canReachCloud(),
      edge: n.edge,
      pending: pendingItems.length,
      failed,
      quarantined,
      lastSuccessAt: this.local.meta<string>('lastSyncAt'),
      oldestPendingAt: oldest,
    };
  }

  /** Force an immediate attempt (manager "Sync now"). */
  async syncNow() {
    await this.tick(true);
  }

  private inflight?: Promise<void>;

  async tick(force = false): Promise<void> {
    if (this.inflight) {
      await this.inflight;
      if (!force) return;
    }
    if (!this.canReachCloud()) return;
    this.busy = true;
    this.inflight = (async () => {
      try {
        await this.push(force);
        await this.pull();
        await this.heartbeat();
      } finally {
        this.busy = false;
        this.inflight = undefined;
        this.notify();
      }
    })();
    await this.inflight;
  }

  get isSyncing() {
    return this.busy;
  }

  private async push(force: boolean) {
    const nowMs = Date.now();
    const due = this.outbox()
      .filter((o) => (o.status === 'pending' || o.status === 'retry' || o.status === 'sending') && (force || !o.nextRetryAt || new Date(o.nextRetryAt).getTime() <= nowMs))
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, 12);
    if (!due.length) return;

    await new Promise((r) => setTimeout(r, 350 + Math.random() * 550));
    if (!this.canReachCloud()) return; // connection dropped mid-flight → unknown outcome, retry same identity later

    if (Math.random() < this.transientFailureRate) {
      const retry = due.map((o) => {
        const attempts = o.attempts + 1;
        const backoff = Math.min(30000, 1000 * 2 ** attempts) + Math.random() * 500;
        return { ...o, status: 'retry' as const, attempts, nextRetryAt: new Date(Date.now() + backoff).toISOString(), lastError: 'NETWORK_TIMEOUT · outcome unknown, will retry same idempotency key' };
      });
      await this.local.commit([{ collection: 'outbox', put: retry }]);
      return;
    }

    const cloudOps = new Map<CollectionName, Array<{ id: string; [k: string]: any }>>();
    const inbox: Array<{ id: string; receivedAt: string; deviceId: string }> = [];
    const conflicts: SyncConflict[] = [];
    const acked: SyncOutboxItem[] = [];
    const quarantined: SyncOutboxItem[] = [];
    const localEntityUpdates = new Map<CollectionName, Array<{ id: string; [k: string]: any }>>();
    const ts = new Date().toISOString();

    for (const item of due) {
      const payload = item.payload as ({ id: string; __poison?: string } & Record<string, unknown>) | undefined;
      if (payload?.__poison) {
        quarantined.push({ ...item, status: 'quarantined', attempts: item.attempts + 1, lastError: payload.__poison });
        conflicts.push({ id: uid('sc'), tenantId: this.ctx.tenantId, deviceId: this.ctx.deviceId, storeId: item.storeId, entity: item.aggregateType, entityId: item.aggregateId, documentNo: item.documentNo, reasonCode: 'BUSINESS_VALIDATION', reason: payload.__poison, state: 'open', createdAt: ts });
        continue;
      }
      // Idempotent receiver: a duplicate eventId is acknowledged again without a second consequence.
      if (!this.cloud.get('inbox', item.eventId) && payload) {
        const entity = SYNCABLE_STATE.has(item.collection as CollectionName) ? { ...payload, syncState: 'synced', syncedAt: ts } : payload;
        const list = cloudOps.get(item.collection as CollectionName) ?? [];
        list.push(entity);
        cloudOps.set(item.collection as CollectionName, list);
        inbox.push({ id: item.eventId, receivedAt: ts, deviceId: this.ctx.deviceId });
      }
      acked.push({ ...item, status: 'acknowledged', acknowledgedAt: ts, attempts: item.attempts + 1, lastError: undefined });
      if (SYNCABLE_STATE.has(item.collection as CollectionName)) {
        const cur = this.local.get(item.collection as 'sales', item.aggregateId);
        if (cur) {
          const list = localEntityUpdates.get(item.collection as CollectionName) ?? [];
          list.push({ ...cur, syncState: 'synced', syncedAt: ts });
          localEntityUpdates.set(item.collection as CollectionName, list);
        }
      }
    }

    const ops: WriteOp[] = [...cloudOps].map(([collection, put]) => ({ collection, put }));
    ops.push({ collection: 'inbox', put: inbox });
    ops.push({ collection: 'syncConflicts', put: conflicts });
    await this.cloud.commit(ops);

    // Prune old acknowledged rows to keep the local journal small.
    const ackedAll = this.outbox().filter((o) => o.status === 'acknowledged').sort((a, b) => b.sequence - a.sequence);
    const prune = ackedAll.slice(400).map((o) => o.id);
    await this.local.commit(
      [{ collection: 'outbox', put: [...acked, ...quarantined], delete: prune }, ...[...localEntityUpdates].map(([collection, put]) => ({ collection, put }))],
      { lastSyncAt: ts },
    );
  }

  private async pull() {
    const checkpoint = this.local.meta<number>('syncCheckpoint') ?? 0;
    const changes = this.cloud
      .where('changefeed', (c) => c.seq > checkpoint && (c.tenantId === this.ctx.tenantId || c.tenantId === '*'))
      .sort((a, b) => a.seq - b.seq)
      .slice(0, 200);
    if (!changes.length) return;
    const puts = new Map<CollectionName, Array<{ id: string; [k: string]: any }>>();
    const dels = new Map<CollectionName, string[]>();
    for (const c of changes) {
      const col = c.collection as CollectionName;
      if (c.op === 'put' && c.payload) puts.set(col, [...(puts.get(col) ?? []), c.payload as { id: string }]);
      if (c.op === 'delete') dels.set(col, [...(dels.get(col) ?? []), c.entityId]);
    }
    const cols = new Set([...puts.keys(), ...dels.keys()]);
    const ops: WriteOp[] = [...cols].map((collection) => ({ collection, put: puts.get(collection), delete: dels.get(collection) }));
    await this.local.commit(ops, { syncCheckpoint: changes[changes.length - 1]!.seq, lastPullAt: new Date().toISOString(), lastPullSummary: changes.map((c) => c.summary).slice(-5) });
  }

  private async heartbeat() {
    if (Date.now() - this.lastHeartbeat < 8000) return;
    this.lastHeartbeat = Date.now();
    const dev = this.cloud.get('devices', this.ctx.deviceId);
    if (!dev) return;
    // Revoked / not-yet-activated devices keep their platform-assigned status (FR-DEV-005).
    if (dev.status === 'revoked' || dev.status === 'pending-activation') return;
    const s = this.status();
    const tenant = this.local.get('tenants', this.ctx.tenantId);
    await this.cloud.put('devices', { ...dev, status: s.quarantined ? 'attention' : 'active', lastSeenAt: new Date().toISOString(), lastSyncAt: s.lastSuccessAt ?? dev.lastSyncAt, pendingSync: s.pending, failedSync: s.quarantined, configVersion: tenant?.configVersion ?? dev.configVersion });
  }

  /** True when the platform has revoked this device: it may keep its local data but obtains no new cloud config. */
  isRevoked(): boolean {
    return this.cloud.get('devices', this.ctx.deviceId)?.status === 'revoked';
  }

  /** Demo: enqueue an item that the cloud will reject (business validation) → Attention Required. */
  async injectConflict(storeId: string) {
    const seqs = { ...(this.local.meta<Record<string, number>>('sequences') ?? {}) };
    const key = `OUTBOX|${this.ctx.deviceId}`;
    const seq = (seqs[key] ?? 0) + 1;
    seqs[key] = seq;
    const id = uid('mv');
    const item: SyncOutboxItem = {
      id: uid('ob'), eventId: uid(), eventType: 'inventory.movement.v1', aggregateType: 'stockMovements', aggregateId: id, sequence: seq, idempotencyKey: `${this.ctx.deviceId}:${id}`,
      schemaVersion: 1, createdAtOrigin: new Date().toISOString(), status: 'pending', attempts: 0, deviceId: this.ctx.deviceId, storeId, payloadSummary: 'Stock movement (simulated conflict)',
      bytes: 412, collection: 'stockMovements', payload: { id, __poison: 'STOCK_NEGATIVE_POLICY · store stock would drop below zero under Block policy' },
    };
    await this.local.commit([{ collection: 'outbox', put: [item] }], { sequences: seqs });
  }

  /** Manager/support resolution: mark quarantined row resolved (audited) without deleting origin facts. */
  async resolveQuarantined(outboxId: string, resolution: 'retry' | 'dismiss') {
    const o = this.local.get('outbox', outboxId);
    if (!o) return;
    if (resolution === 'retry') {
      const payload = { ...(o.payload as Record<string, unknown>) };
      delete payload.__poison;
      await this.local.put('outbox', { ...o, status: 'pending', payload, lastError: undefined, nextRetryAt: undefined });
    } else {
      await this.local.put('outbox', { ...o, status: 'acknowledged', acknowledgedAt: new Date().toISOString(), lastError: `Dismissed by manager · ${o.lastError ?? ''}` });
    }
  }
}

/**
 * Back Office / Platform write path: update a cloud-authoritative master and append to the change feed
 * so devices pull it on next sync (Product master = cloud authority, SYNC §7).
 */
export async function publishMasterChange(cloud: LocalDatabase, input: { tenantId: string; collection: CollectionName; entity: { id: string; [k: string]: any }; summary: string; op?: 'put' | 'delete'; extra?: WriteOp[] }): Promise<void> {
  await cloud.exclusive(async () => {
    const seq = cloud.peekSequence('CHANGEFEED');
    const entry: ChangeFeedEntry = { id: uid('cf'), seq, tenantId: input.tenantId, collection: input.collection, op: input.op ?? 'put', entityId: input.entity.id, payload: input.op === 'delete' ? undefined : input.entity, summary: input.summary, createdAt: new Date().toISOString() };
    await cloud.commit(
      [
        input.op === 'delete' ? { collection: input.collection, delete: [input.entity.id] } : { collection: input.collection, put: [input.entity] },
        { collection: 'changefeed', put: [entry] },
        ...(input.extra ?? []),
      ],
      { sequences: cloud.sequencesWith('CHANGEFEED', seq) },
    );
  });
}

/** Cloud-originated transactional facts that devices must receive (stock posted in Back Office, new batches, etc.). */
const FEED_COLLECTIONS = new Set<CollectionName>(['stockMovements', 'batches', 'adjustments', 'purchases', 'approvals']);

/**
 * Commit cloud-side writes and append change-feed entries for device-relevant facts, so POS devices
 * pull Back Office purchases / adjustments / transfers on their next sync. Not re-entrant-locked:
 * call it inside your own `cloud.exclusive` section when allocating sequences.
 */
export async function commitWithFeed(cloud: LocalDatabase, ops: WriteOp[], meta?: Record<string, unknown>): Promise<void> {
  const base = { ...((meta?.sequences as Record<string, number> | undefined) ?? (cloud.meta<Record<string, number>>('sequences') ?? {})) };
  let seq = base['CHANGEFEED'] ?? cloud.meta<Record<string, number>>('sequences')?.['CHANGEFEED'] ?? 0;
  const ts = new Date().toISOString();
  const feed: ChangeFeedEntry[] = [];
  for (const op of ops) {
    if (!FEED_COLLECTIONS.has(op.collection)) continue;
    for (const e of op.put ?? []) {
      const tenantId = (e.tenantId as string | undefined) ?? cloud.get('products', e.productId as string | undefined)?.tenantId;
      if (!tenantId) continue;
      feed.push({ id: uid('cf'), seq: ++seq, tenantId, collection: op.collection, op: 'put', entityId: e.id, payload: e, summary: `${op.collection} ${(e.documentNo as string | undefined) ?? e.id}`, createdAt: ts });
    }
  }
  base['CHANGEFEED'] = seq;
  await cloud.commit(feed.length ? [...ops, { collection: 'changefeed', put: feed }] : ops, { ...(meta ?? {}), sequences: base });
}
