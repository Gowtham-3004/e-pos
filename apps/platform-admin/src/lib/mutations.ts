import type { AddOnCode, AuditEvent, Capability, Company, Counter, Device, PlanCode, Store, SubscriptionStatus, SupportTicket, SyncConflict, Tenant, User, Vertical } from '@elixir/contracts';
import { familyOf, uid } from '@elixir/domain';
import { auditFor, publishMasterChange, type LocalDatabase, type WriteOp } from '@elixir/local-store';
import { isoDate } from '@elixir/format';
import { SUBSCRIPTION_STATUS } from '@elixir/domain';
import { activationCode, capLabel, capabilityDiff, planName, addOnName } from './platform';

const SUBSCRIPTION_LABEL = Object.fromEntries(Object.entries(SUBSCRIPTION_STATUS).map(([k, v]) => [k, v.label])) as Record<SubscriptionStatus, string>;

/**
 * Platform write path. Every mutation writes an AuditEvent in the same atomic commit (FR-AUD-004).
 * Tenant config and device changes go through `publishMasterChange` so devices pull them (configVersion bump).
 */

type Actor = { userId: string; name: string };

const auditOp = (a: AuditEvent) => ({ collection: 'auditEvents' as const, put: [a] });

// ───────── Tenants ─────────

export interface SubscriptionPatch {
  plan: PlanCode;
  addOns: AddOnCode[];
  capabilityOverrides: Capability[];
  capabilityRestrictions: Capability[];
}

export async function saveSubscription(cloud: LocalDatabase, actor: Actor, before: Tenant, patch: SubscriptionPatch, reason?: string): Promise<Tenant> {
  const after: Tenant = { ...before, ...patch, configVersion: before.configVersion + 1 };
  const { gained, lost } = capabilityDiff(before, after);
  const parts: string[] = [];
  if (before.plan !== after.plan) parts.push(`plan ${planName(before.plan)} → ${planName(after.plan)}`);
  const addAdded = after.addOns.filter((a) => !before.addOns.includes(a));
  const addRemoved = before.addOns.filter((a) => !after.addOns.includes(a));
  if (addAdded.length) parts.push(`add-ons +${addAdded.map(addOnName).join(', +')}`);
  if (addRemoved.length) parts.push(`add-ons −${addRemoved.map(addOnName).join(', −')}`);
  if (gained.length || lost.length) parts.push(`capabilities ${[...gained.map((c) => '+' + capLabel(c)), ...lost.map((c) => '−' + capLabel(c))].join(' ')}`);
  const summary = `Subscription updated: ${parts.join('; ') || 'overrides adjusted'} (config v${after.configVersion})`;
  const audit = auditFor({
    tenantId: before.id,
    actorId: actor.userId,
    action: 'subscription.changed',
    entity: 'tenant',
    entityId: before.id,
    summary,
    reason,
    before: { plan: before.plan, addOns: before.addOns, overrides: before.capabilityOverrides ?? [], restrictions: before.capabilityRestrictions ?? [] },
    after: { plan: after.plan, addOns: after.addOns, overrides: after.capabilityOverrides, restrictions: after.capabilityRestrictions, gained, lost },
    category: 'security',
  });
  await publishMasterChange(cloud, { tenantId: before.id, collection: 'tenants', entity: after, summary, extra: [auditOp(audit)] });
  return after;
}

const STATUS_ACTION: Record<SubscriptionStatus, string> = {
  trial: 'subscription.trial.started',
  grace: 'subscription.grace.started',
  suspended: 'subscription.suspended',
  active: 'subscription.reactivated',
  cancelled: 'subscription.cancelled',
};

export async function setSubscriptionStatus(cloud: LocalDatabase, actor: Actor, before: Tenant, status: SubscriptionStatus, opts: { reason?: string; renewsOn?: string } = {}): Promise<Tenant> {
  const after: Tenant = { ...before, subscriptionStatus: status, renewsOn: opts.renewsOn ?? before.renewsOn, configVersion: before.configVersion + 1 };
  const summary =
    status === 'suspended'
      ? `Subscription suspended — devices lose operating capabilities on next config pull (config v${after.configVersion})`
      : `Subscription ${SUBSCRIPTION_LABEL[before.subscriptionStatus]} → ${SUBSCRIPTION_LABEL[status]}${opts.renewsOn ? `, renews ${opts.renewsOn}` : ''} (config v${after.configVersion})`;
  const audit = auditFor({
    tenantId: before.id,
    actorId: actor.userId,
    action: STATUS_ACTION[status],
    entity: 'tenant',
    entityId: before.id,
    summary,
    reason: opts.reason,
    before: { subscriptionStatus: before.subscriptionStatus, renewsOn: before.renewsOn },
    after: { subscriptionStatus: status, renewsOn: after.renewsOn },
    category: 'security',
  });
  await publishMasterChange(cloud, { tenantId: before.id, collection: 'tenants', entity: after, summary, extra: [auditOp(audit)] });
  return after;
}

// ───────── Devices ─────────

async function writeDevice(cloud: LocalDatabase, actor: Actor, after: Device, action: string, summary: string, opts: { reason?: string; before?: unknown; extra?: Device[]; extraOps?: WriteOp[]; category?: AuditEvent['category'] } = {}) {
  const audit = auditFor({
    tenantId: after.tenantId,
    storeId: after.storeId,
    counterId: after.counterId,
    deviceId: after.id,
    actorId: actor.userId,
    action,
    entity: 'device',
    entityId: after.id,
    summary,
    reason: opts.reason,
    before: opts.before,
    category: opts.category ?? 'security',
  });
  const extra: WriteOp[] = [auditOp(audit), ...(opts.extra?.length ? [{ collection: 'devices' as const, put: opts.extra }] : []), ...(opts.extraOps ?? [])];
  await publishMasterChange(cloud, { tenantId: after.tenantId, collection: 'devices', entity: after, summary, extra });
}

export async function activateDevice(cloud: LocalDatabase, actor: Actor, d: Device, tenant: Tenant | undefined, opts: { counterId?: string; newCounter?: Counter } = {}) {
  const now = new Date().toISOString();
  const counterId = opts.newCounter?.id ?? opts.counterId ?? d.counterId;
  const after: Device = { ...d, status: 'active', activatedAt: now, counterId, configVersion: tenant?.configVersion ?? d.configVersion, lastSeenAt: now };
  const where = opts.newCounter ? ` on new counter ${opts.newCounter.code}` : '';
  await writeDevice(cloud, actor, after, 'device.activated', `Device ${d.code} activated with code ${activationCode(d.id)}${where} — config v${after.configVersion} issued`, {
    before: { status: d.status, counterId: d.counterId },
    extraOps: opts.newCounter ? [{ collection: 'counters', put: [opts.newCounter] }] : [],
  });
}

export async function renameDevice(cloud: LocalDatabase, actor: Actor, d: Device, name: string) {
  await writeDevice(cloud, actor, { ...d, name }, 'device.renamed', `Device ${d.code} renamed “${d.name}” → “${name}”`, { before: { name: d.name }, category: 'technical' });
}

export async function reassignDevice(cloud: LocalDatabase, actor: Actor, d: Device, counter: Counter, fromLabel: string, toLabel: string) {
  await writeDevice(cloud, actor, { ...d, counterId: counter.id, storeId: counter.storeId }, 'device.reassigned', `Device ${d.code} reassigned ${fromLabel} → ${toLabel}`, { before: { counterId: d.counterId, storeId: d.storeId } });
}

export async function revokeDevice(cloud: LocalDatabase, actor: Actor, d: Device, reason: string) {
  await writeDevice(cloud, actor, { ...d, status: 'revoked' }, 'device.revoked', `Device ${d.code} revoked — credentials invalidated; config and sync requests will be refused`, { reason, before: { status: d.status } });
}

export async function replaceDevice(cloud: LocalDatabase, actor: Actor, oldDev: Device, replacement: Device, tenant: Tenant | undefined, reason: string, continuity: string) {
  const now = new Date().toISOString();
  const newDev: Device = {
    ...replacement,
    storeId: oldDev.storeId,
    counterId: oldDev.counterId,
    status: 'active',
    activatedAt: replacement.activatedAt ?? now,
    configVersion: tenant?.configVersion ?? replacement.configVersion,
    lastSeenAt: now,
  };
  const retired: Device = { ...oldDev, status: 'revoked', counterId: undefined };
  await writeDevice(cloud, actor, newDev, 'device.replaced', `Device ${oldDev.code} replaced by ${replacement.code} on the same counter. ${continuity}`, {
    reason,
    before: { replaced: oldDev.id, oldStatus: oldDev.status, counterId: oldDev.counterId },
    extra: [retired],
  });
}

export async function resetBootstrap(cloud: LocalDatabase, actor: Actor, d: Device) {
  await writeDevice(cloud, actor, { ...d, configVersion: 0 }, 'device.bootstrap.reset', `Local bootstrap reset for ${d.code} — device re-downloads catalog and configuration on next start`, { before: { configVersion: d.configVersion }, category: 'technical' });
}

export async function logDiagnosticsRequest(cloud: LocalDatabase, actor: Actor, d: Device) {
  const audit = auditFor({ tenantId: d.tenantId, storeId: d.storeId, deviceId: d.id, actorId: actor.userId, action: 'device.diagnostics.requested', entity: 'device', entityId: d.id, summary: `Diagnostics bundle exported for ${d.code} (secrets and customer PII excluded)`, category: 'technical' });
  await cloud.put('auditEvents', audit);
}

// ───────── Sync conflicts ─────────

export type ConflictResolution = 'accept-origin' | 'merge' | 'ignore';
export const RESOLUTION_LABEL: Record<ConflictResolution, string> = { 'accept-origin': 'Accepted origin', merge: 'Merged', ignore: 'Ignored' };

export async function resolveConflict(cloud: LocalDatabase, actor: Actor, c: SyncConflict, mode: ConflictResolution, note: string) {
  const after: SyncConflict = { ...c, state: mode === 'ignore' ? 'ignored' : 'resolved', resolution: `${RESOLUTION_LABEL[mode]} — ${note}`, resolvedBy: actor.userId };
  const audit = auditFor({
    tenantId: c.tenantId,
    storeId: c.storeId,
    deviceId: c.deviceId,
    actorId: actor.userId,
    action: `sync.conflict.${mode}`,
    entity: 'sync_conflict',
    entityId: c.id,
    documentNo: c.documentNo,
    summary: `${c.reasonCode} on ${c.entity}${c.documentNo ? ' ' + c.documentNo : ''}: ${RESOLUTION_LABEL[mode].toLowerCase()} (posted facts retained, correction recorded)`,
    reason: note,
    before: { state: c.state },
    after: { state: after.state, resolution: after.resolution },
    category: 'technical',
  });
  await cloud.commit([{ collection: 'syncConflicts', put: [after] }, auditOp(audit)]);
}

// ───────── Onboarding ─────────

export interface OnboardDraft {
  name: string;
  legalName: string;
  gstin: string;
  contactName: string;
  contactPhone: string;
  city: string;
  stateCode: string;
  vertical: Vertical;
  plan: PlanCode;
  addOns: AddOnCode[];
  storeCode: string;
  storeName: string;
  storeAddress: string;
  storeCity: string;
  storeStateCode: string;
  counters: number;
  ownerName: string;
  ownerPin: string;
  trial: boolean;
}

export interface OnboardResult {
  tenant: Tenant;
  store: Store;
  devices: Device[];
}

export async function onboardTenant(cloud: LocalDatabase, actor: Actor, d: OnboardDraft): Promise<OnboardResult> {
  const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'tenant';
  let tenantId = `t-${slug}`;
  if (cloud.get('tenants', tenantId)) tenantId = `${tenantId}-${uid('').slice(-4)}`;
  const now = new Date();
  const family = familyOf(d.vertical);
  const renews = new Date(now.getTime() + (d.trial ? 14 : 30) * 86400000);
  const tenant: Tenant = {
    id: tenantId,
    name: d.name.trim(),
    legalName: d.legalName.trim(),
    gstin: d.gstin.trim() || undefined,
    family,
    vertical: d.vertical,
    plan: d.plan,
    addOns: d.addOns,
    subscriptionStatus: d.trial ? 'trial' : 'active',
    stateCode: d.stateCode,
    createdAt: now.toISOString(),
    renewsOn: isoDate(renews),
    configVersion: 1,
    contactName: d.contactName.trim(),
    contactPhone: d.contactPhone.trim(),
    city: d.city.trim(),
  };
  const company: Company = { id: `co-${tenantId}`, tenantId, name: tenant.legalName, gstin: tenant.gstin };
  const store: Store = {
    id: `s-${tenantId}-1`,
    tenantId,
    companyId: company.id,
    code: d.storeCode.trim().toUpperCase(),
    name: d.storeName.trim(),
    city: d.storeCity.trim() || tenant.city,
    address: d.storeAddress.trim(),
    stateCode: d.storeStateCode,
    phone: tenant.contactPhone,
    edgeEnabled: d.addOns.includes('store-edge') || d.plan === 'business',
    active: true,
  };
  const counters: Counter[] = Array.from({ length: d.counters }, (_, i) => ({
    id: `c-${store.id}-${i + 1}`,
    storeId: store.id,
    code: `C${String(i + 1).padStart(2, '0')}`,
    name: `Counter ${i + 1}`,
    kind: 'billing',
    printerName: `Counter ${i + 1} Printer`,
    active: true,
  }));
  const devices: Device[] = counters.map((c, i) => ({
    id: `d-${c.id}`,
    tenantId,
    storeId: store.id,
    counterId: c.id,
    code: `POS-${String(i + 1).padStart(2, '0')}`,
    name: `${store.name} ${c.name}`,
    kind: 'pos-desktop',
    status: 'pending-activation',
    appVersion: '1.4.0',
    configVersion: 0,
    lastSeenAt: now.toISOString(),
    pendingSync: 0,
    failedSync: 0,
    os: 'Awaiting first run',
  }));
  const owner: User = {
    id: `u-${tenantId}-owner`,
    tenantId,
    name: d.ownerName.trim() || tenant.contactName,
    username: (d.ownerName.trim() || tenant.contactName).split(' ')[0]!.toLowerCase(),
    role: 'owner',
    storeIds: [store.id],
    pin: d.ownerPin,
    phone: tenant.contactPhone,
    active: true,
    avatarColor: '#3b5bdb',
  };
  const audit = auditFor({
    tenantId,
    actorId: actor.userId,
    action: 'tenant.onboarded',
    entity: 'tenant',
    entityId: tenantId,
    summary: `Tenant ${tenant.name} onboarded — ${planName(d.plan)}${d.addOns.length ? ' + ' + d.addOns.map(addOnName).join(', ') : ''}; store ${store.code}, ${counters.length} counter(s), ${devices.length} device(s) awaiting activation`,
    after: { vertical: d.vertical, plan: d.plan, addOns: d.addOns, status: tenant.subscriptionStatus },
    category: 'security',
  });
  await publishMasterChange(cloud, {
    tenantId,
    collection: 'tenants',
    entity: tenant,
    summary: `Tenant ${tenant.name} created`,
    extra: [
      { collection: 'companies', put: [company] },
      { collection: 'stores', put: [store] },
      { collection: 'counters', put: counters },
      { collection: 'devices', put: devices },
      { collection: 'users', put: [owner] },
      auditOp(audit),
    ],
  });
  return { tenant, store, devices };
}

// ───────── Support tickets ─────────

export interface TicketNote {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}
export type TicketWithNotes = SupportTicket & { notes?: TicketNote[] };

export async function createTicket(cloud: LocalDatabase, actor: Actor, t: Omit<SupportTicket, 'id' | 'createdAt' | 'status'>): Promise<SupportTicket> {
  const nums = cloud.all('tickets').map((x) => parseInt(x.id.replace(/\D/g, ''), 10)).filter((n) => isFinite(n));
  const ticket: SupportTicket = { ...t, id: `tk-${Math.max(1000, ...nums) + 1}`, status: 'open', createdAt: new Date().toISOString() };
  const audit = auditFor({ tenantId: t.tenantId, actorId: actor.userId, action: 'ticket.created', entity: 'ticket', entityId: ticket.id, summary: `Ticket ${ticket.id.toUpperCase()} opened: ${t.subject} (${t.priority})`, category: 'technical' });
  await cloud.commit([{ collection: 'tickets', put: [ticket] }, auditOp(audit)]);
  return ticket;
}

export async function updateTicket(cloud: LocalDatabase, actor: Actor, before: TicketWithNotes, patch: Partial<Pick<SupportTicket, 'status' | 'assignee' | 'priority'>>) {
  const after = { ...before, ...patch };
  const changes = Object.entries(patch)
    .filter(([k, v]) => (before as unknown as Record<string, unknown>)[k] !== v)
    .map(([k, v]) => `${k} ${String((before as unknown as Record<string, unknown>)[k] ?? '—')} → ${String(v ?? '—')}`);
  if (!changes.length) return;
  const audit = auditFor({ tenantId: before.tenantId, actorId: actor.userId, action: 'ticket.updated', entity: 'ticket', entityId: before.id, summary: `Ticket ${before.id.toUpperCase()}: ${changes.join(', ')}`, before: patch, category: 'technical' });
  await cloud.commit([{ collection: 'tickets', put: [after] }, auditOp(audit)]);
}

export async function addTicketNote(cloud: LocalDatabase, actor: Actor, before: TicketWithNotes, body: string) {
  const note: TicketNote = { id: uid('nt'), authorId: actor.userId, authorName: actor.name, body, createdAt: new Date().toISOString() };
  const after: TicketWithNotes = { ...before, notes: [...(before.notes ?? []), note] };
  const audit = auditFor({ tenantId: before.tenantId, actorId: actor.userId, action: 'ticket.note.added', entity: 'ticket', entityId: before.id, summary: `Internal note added to ${before.id.toUpperCase()}`, category: 'technical' });
  await cloud.commit([{ collection: 'tickets', put: [after] }, auditOp(audit)]);
}
