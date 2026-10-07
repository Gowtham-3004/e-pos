import type { ApprovalAction, DeviceKind } from '@elixir/contracts';
import { relative } from '@elixir/format';

/** "just now" / "2m ago" / "3h ago". */
export const ago = (d?: string | number) => {
  const r = relative(d);
  return r === 'Now' ? 'just now' : r;
};

export const ACTION_LABEL: Record<ApprovalAction, { label: string; icon: string }> = {
  discount: { label: 'Discount', icon: 'Percent' },
  void: { label: 'Void bill', icon: 'CircleX' },
  'return-no-invoice': { label: 'Return without invoice', icon: 'Undo2' },
  'price-override': { label: 'Price override', icon: 'Tag' },
  'negative-stock': { label: 'Negative stock', icon: 'Package' },
  'shift-reopen': { label: 'Shift reopen', icon: 'RotateCw' },
  'shift-variance': { label: 'Shift variance', icon: 'Wallet' },
  'credit-limit': { label: 'Credit limit', icon: 'FileText' },
  'kot-void': { label: 'KOT void', icon: 'ChefHat' },
  'stock-adjustment': { label: 'Stock adjustment', icon: 'Box' },
};

export const DEVICE_KIND: Record<DeviceKind, { label: string; icon: string }> = {
  'pos-desktop': { label: 'POS terminal', icon: 'Monitor' },
  'pos-web': { label: 'Web POS', icon: 'Monitor' },
  kds: { label: 'Kitchen display', icon: 'Kds' },
  mobile: { label: 'Mobile', icon: 'Smartphone' },
  'store-edge': { label: 'Store Edge', icon: 'Server' },
};

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', manager: 'Store Manager', waiter: 'Waiter / Captain', cashier: 'Cashier', kitchen: 'Kitchen', accountant: 'Accountant', inventory: 'Inventory' };

/** Waiter section assignment (demo): each waiter owns one floor. */
export const WAITER_SECTION: Record<string, string> = { ravi: 'fl-ground', deepa: 'fl-first', john: 'fl-terrace' };
export const sectionOf = (userId: string) => WAITER_SECTION[userId.split('-').pop() ?? ''];
