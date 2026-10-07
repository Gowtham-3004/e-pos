import type { ApprovalAction, Customer, OriginContext, Permission, SessionContext, User } from '@elixir/contracts';
import { roleByCode, uid } from '@elixir/domain';
import { isoDate } from '@elixir/format';
import { createApproval, decideApproval, outboxFor, type LocalDatabase } from '@elixir/local-store';
import type { ApprovalVerifyResult } from '@elixir/ui';

/** Origin identity stamped on every POS transaction (FR-COM-005). */
export function originOf(s: SessionContext): OriginContext | undefined {
  if (!s.shift || !s.counter) return undefined;
  return {
    tenantId: s.tenant.id,
    storeId: s.store.id,
    counterId: s.counter.id,
    deviceId: s.device.id,
    userId: s.user.id,
    shiftId: s.shift.id,
    businessDate: s.shift.businessDate,
  };
}

export const businessDateOf = (s: SessionContext) => s.shift?.businessDate ?? isoDate();

/**
 * Manager PIN verifier for ApprovalDialog — checks cached users locally so it works offline (§29).
 * Never signs the approver in.
 */
export function managerVerifier(db: LocalDatabase, s: SessionContext, permission: Permission = 'approvals.act', exclude: string | undefined = s.user.id) {
  // Four-eyes: the requester can never approve their own override.
  return (pin: string): ApprovalVerifyResult => {
    const u = db.where('users', (x) => x.tenantId === s.tenant.id && x.active && x.pin === pin && x.storeIds.includes(s.store.id))[0] as User | undefined;
    if (!u) return { ok: false, message: 'PIN not recognised for this store.' };
    if (exclude && u.id === exclude) return { ok: false, message: 'You cannot approve your own request — ask another manager or the owner.' };
    if (!roleByCode(u.role).permissions.includes(permission)) return { ok: false, message: `${u.name} (${roleByCode(u.role).name}) has no approval authority for this action.` };
    return { ok: true, approverId: u.id, approverName: u.name };
  };
}

/** Record an approved override as an approval request + decision (audited). */
export async function recordApproval(db: LocalDatabase, s: SessionContext, o: { action: ApprovalAction; summary: string; detail?: string; approverId: string; reason?: string; requestedValue?: number; allowedValue?: number; amountPaise?: number }) {
  try {
    const req = await createApproval(db, {
      tenantId: s.tenant.id, storeId: s.store.id, counterId: s.counter?.id, action: o.action, requestedBy: s.user.id, summary: o.summary, detail: o.detail ?? o.summary,
      requestedValue: o.requestedValue, allowedValue: o.allowedValue, amountPaise: o.amountPaise,
    });
    await decideApproval(db, req.id, 'approved', o.approverId, o.reason);
  } catch {
    /* audit is best-effort for the prototype; the action itself carries approvedBy */
  }
}

/** Quick customer creation at the counter: local write + outbox row so cloud receives it on sync. */
export async function createQuickCustomer(db: LocalDatabase, s: SessionContext, input: { name: string; phone: string }): Promise<Customer> {
  const c: Customer = {
    id: uid('cu'), tenantId: s.tenant.id, name: input.name.trim(), phone: input.phone.trim(), creditLimitPaise: 0, creditDays: 0, outstandingPaise: 0, loyaltyPoints: 0,
    createdAt: new Date().toISOString(), active: true, stateCode: s.store.stateCode,
  };
  const seqs = { ...(db.meta<Record<string, number>>('sequences') ?? {}) };
  const ob = outboxFor(db, seqs, { deviceId: s.device.id, storeId: s.store.id, eventType: 'customer.created.v1', collection: 'customers', entity: c, summary: `Customer ${c.name}` });
  await db.commit([{ collection: 'customers', put: [c] }, { collection: 'outbox', put: [ob] }], { sequences: seqs });
  return c;
}

export const ROLE_LABEL = (u: User) => roleByCode(u.role).name;
