import type { Sale, TenderMethod } from '@elixir/contracts';
import { expiringBatches, lowStock, salesFor, type LocalDatabase } from '@elixir/local-store';
import { isoDate } from '@elixir/format';
import type { SessionInfo } from './app';

const DAY = 86400000;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface HomeMetrics {
  todayPaise: number;
  bills: number;
  avgPaise: number;
  yesterdayPaise: number;
  /** Yesterday up to the same time of day — the fair comparison for a day in progress. */
  yesterdaySoFarPaise: number;
  deltaPct: number | null;
  mix: Array<{ method: TenderMethod; paise: number }>;
  week: Array<{ date: string; label: string; paise: number }>;
}

export function homeMetrics(db: LocalDatabase, tenantId: string, storeIds: string[], now = Date.now()): HomeMetrics {
  const today = isoDate(now);
  const yesterday = isoDate(now - DAY);
  const from = isoDate(now - 6 * DAY);
  const ids = new Set(storeIds);
  const sales = salesFor(db, { tenantId, from, to: today }).filter((s) => ids.has(s.storeId) && s.status !== 'cancelled');
  const byDay = new Map<string, Sale[]>();
  sales.forEach((s) => byDay.set(s.businessDate, [...(byDay.get(s.businessDate) ?? []), s]));
  const sum = (xs: Sale[] = []) => xs.reduce((t, s) => t + s.totalPaise, 0);
  const todays = byDay.get(today) ?? [];
  const todayPaise = sum(todays);
  const yesterdayPaise = sum(byDay.get(yesterday));
  const cutoff = new Date(now - DAY).toISOString();
  const yesterdaySoFarPaise = sum((byDay.get(yesterday) ?? []).filter((s) => s.committedAt <= cutoff));
  const mixMap = new Map<TenderMethod, number>();
  todays.forEach((s) => s.tenders.forEach((t) => mixMap.set(t.method, (mixMap.get(t.method) ?? 0) + t.amountPaise)));
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = now - (6 - i) * DAY;
    const date = isoDate(d);
    return { date, label: i === 6 ? 'Today' : WEEKDAY[new Date(d).getDay()]!, paise: sum(byDay.get(date)) };
  });
  return {
    todayPaise,
    bills: todays.length,
    avgPaise: todays.length ? Math.round(todayPaise / todays.length) : 0,
    yesterdayPaise,
    yesterdaySoFarPaise,
    deltaPct: yesterdaySoFarPaise ? ((todayPaise - yesterdaySoFarPaise) / yesterdaySoFarPaise) * 100 : null,
    mix: [...mixMap].map(([method, paise]) => ({ method, paise })).sort((a, b) => b.paise - a.paise),
    week,
  };
}

export const TENDER_LABEL: Record<TenderMethod, { label: string; icon: string }> = {
  cash: { label: 'Cash', icon: 'Rupee' },
  upi: { label: 'UPI', icon: 'Smartphone' },
  card: { label: 'Card', icon: 'Wallet' },
  credit: { label: 'Credit', icon: 'FileText' },
  redemption: { label: 'Points', icon: 'Star' },
};

export interface Alert {
  key: string;
  icon: string;
  tone: 'danger' | 'warning' | 'info' | 'neutral';
  title: string;
  detail: string;
  href: string;
}

export function homeAlerts(db: LocalDatabase, s: SessionInfo, storeIds: string[]): Alert[] {
  const out: Alert[] = [];
  const ids = new Set(storeIds);
  const pending = db.where('approvals', (a) => a.tenantId === s.tenant.id && a.status === 'pending' && ids.has(a.storeId));
  if (pending.length && s.can('approvals.act'))
    out.push({ key: 'approvals', icon: 'Inbox', tone: 'danger', title: `${pending.length} approval${pending.length > 1 ? 's' : ''} waiting`, detail: pending.slice(0, 2).map((a) => a.summary).join(' · '), href: '/approvals' });
  const variance = pending.filter((a) => a.action === 'shift-variance');
  if (variance.length) out.push({ key: 'variance', icon: 'Wallet', tone: 'warning', title: 'Shift variance needs review', detail: variance[0]!.summary + ' · ' + variance[0]!.detail, href: '/approvals' });
  if (s.has('inventory') && s.family === 'retail') {
    const low = storeIds.flatMap((sid) => lowStock(db, s.tenant.id, sid));
    const out0 = low.filter((x) => x.onHand <= 0).length;
    if (low.length) out.push({ key: 'low', icon: 'Package', tone: out0 ? 'danger' : 'warning', title: `${low.length} items low on stock`, detail: out0 ? `${out0} out of stock · reorder suggested` : 'At or below reorder level', href: '/stock?view=low' });
  }
  if (s.has('batch-expiry')) {
    const exp = storeIds.flatMap((sid) => expiringBatches(db, s.tenant.id, sid, 30));
    const expired = exp.filter((x) => x.health === 'expired').length;
    if (exp.length) out.push({ key: 'expiry', icon: 'Calendar', tone: expired ? 'danger' : 'warning', title: `${exp.length} batches expiring within 30 days`, detail: expired ? `${expired} already expired — remove from shelf` : 'Plan markdowns or returns to supplier', href: '/stock?view=expiry' });
  }
  const devices = db.where('devices', (d) => d.tenantId === s.tenant.id && ids.has(d.storeId) && d.kind !== 'mobile');
  const offline = devices.filter((d) => d.status === 'offline');
  const attention = devices.filter((d) => d.status === 'attention');
  if (offline.length || attention.length)
    out.push({ key: 'devices', icon: 'WifiOff', tone: attention.length ? 'warning' : 'neutral', title: [offline.length && `${offline.length} device${offline.length > 1 ? 's' : ''} offline`, attention.length && `${attention.length} need attention`].filter(Boolean).join(' · '), detail: [...attention, ...offline].slice(0, 2).map((d) => `${d.code} ${d.name}`).join(' · '), href: '/devices' });
  return out;
}

/** "3 devices synced, 1 offline" — freshness of the consolidated numbers (FR-RPT-007). */
export function freshness(db: LocalDatabase, tenantId: string, storeIds: string[]) {
  const ids = new Set(storeIds);
  const devices = db.where('devices', (d) => d.tenantId === tenantId && ids.has(d.storeId) && (d.kind === 'pos-desktop' || d.kind === 'pos-web'));
  const offline = devices.filter((d) => d.status === 'offline');
  const pending = devices.filter((d) => d.status !== 'offline' && d.status !== 'revoked' && d.pendingSync > 0);
  const synced = devices.filter((d) => d.status !== 'offline' && d.status !== 'revoked' && d.pendingSync === 0);
  const unsynced = offline.reduce((s, d) => s + d.pendingSync, 0) + pending.reduce((s, d) => s + d.pendingSync, 0);
  return { total: devices.length, synced: synced.length, offline: offline.length, pending: pending.length, unsynced };
}
