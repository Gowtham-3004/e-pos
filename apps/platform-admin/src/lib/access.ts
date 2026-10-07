import type { Permission } from '@elixir/contracts';
import { useCurrentSession } from './session';

/**
 * Platform action policy (§67). Each action names the permissions it needs; the UI hides or disables
 * the control and explains which permission is missing. Security-sensitive device actions (revoke,
 * replace) need tenant authority in addition to device authority.
 */
export const ACTION_POLICY = {
  'tenant.view': ['platform.tenants'],
  'tenant.plan.change': ['platform.tenants'],
  'tenant.status.change': ['platform.tenants'],
  'tenant.onboard': ['platform.tenants'],
  'device.activate': ['platform.devices'],
  'device.rename': ['platform.devices'],
  'device.reassign': ['platform.devices'],
  'device.reset': ['platform.devices'],
  'device.diagnostics': ['platform.devices'],
  'device.revoke': ['platform.devices', 'platform.tenants'],
  'device.replace': ['platform.devices', 'platform.tenants'],
  'sync.view': ['sync.view'],
  'sync.resolve': ['sync.resolve'],
  'ticket.manage': ['platform.support'],
} satisfies Record<string, Permission[]>;

export type PlatformAction = keyof typeof ACTION_POLICY;

const PERMISSION_LABEL: Partial<Record<Permission, string>> = {
  'platform.tenants': 'Tenant administration',
  'platform.devices': 'Device administration',
  'platform.support': 'Support desk',
  'sync.view': 'Sync diagnostics',
  'sync.resolve': 'Sync conflict resolution',
};

export function useAccess() {
  const s = useCurrentSession();
  const can = (a: PlatformAction) => (ACTION_POLICY[a] as Permission[]).every((p) => s.permissions.includes(p));
  const why = (a: PlatformAction): string | undefined => {
    const missing = (ACTION_POLICY[a] as Permission[]).filter((p) => !s.permissions.includes(p));
    if (!missing.length) return undefined;
    return `Your role (${s.roleName}) does not include ${missing.map((m) => `${PERMISSION_LABEL[m] ?? m} (${m})`).join(' and ')}. Ask a Platform Admin to perform this action.`;
  };
  return { ...s, can, why };
}
