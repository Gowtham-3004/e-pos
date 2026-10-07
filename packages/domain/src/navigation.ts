import type { Capability, Permission } from '@elixir/contracts';

/**
 * Effective navigation = Family + Vertical + Plan + Add-ons + Permissions + Device mode (Design System §10).
 * Items the tenant/user cannot use are removed — never rendered disabled.
 */
export interface NavItem {
  key: string;
  label: string;
  path: string;
  /** lucide-react icon name */
  icon: string;
  group?: string;
  /** Any-of capabilities */
  capabilities?: Capability[];
  permission?: Permission;
  /** Families this applies to; default both */
  family?: 'retail' | 'restaurant';
}

export function composeNav(items: NavItem[], ctx: { capabilities: Capability[]; permissions: Permission[]; family: 'retail' | 'restaurant' }): NavItem[] {
  return items.filter((i) => {
    if (i.family && i.family !== ctx.family) return false;
    if (i.capabilities && !i.capabilities.some((c) => ctx.capabilities.includes(c))) return false;
    if (i.permission && !ctx.permissions.includes(i.permission)) return false;
    return true;
  });
}

export const POS_NAV: NavItem[] = [
  { key: 'billing', label: 'Billing', path: '/billing', icon: 'ScanBarcode', capabilities: ['pos.billing'], permission: 'pos.sell', family: 'retail' },
  { key: 'tables', label: 'Tables', path: '/tables', icon: 'LayoutGrid', capabilities: ['restaurant.tables'], permission: 'restaurant.order', family: 'restaurant' },
  { key: 'menu', label: 'New Order', path: '/order', icon: 'UtensilsCrossed', capabilities: ['restaurant.pos'], permission: 'restaurant.order', family: 'restaurant' },
  { key: 'running', label: 'Running Orders', path: '/running', icon: 'ClipboardList', capabilities: ['restaurant.pos'], permission: 'restaurant.order', family: 'restaurant' },
  { key: 'kds', label: 'Kitchen', path: '/kds', icon: 'ChefHat', capabilities: ['restaurant.kds'], permission: 'kds.operate', family: 'restaurant' },
  { key: 'jobcards', label: 'Job Cards', path: '/jobcards', icon: 'Wrench', capabilities: ['job-card'], permission: 'jobcard.edit', family: 'retail' },
  { key: 'sales', label: 'Sales', path: '/sales', icon: 'Receipt', capabilities: ['pos.billing', 'restaurant.pos'], permission: 'pos.sell' },
  { key: 'returns', label: 'Returns', path: '/returns', icon: 'Undo2', capabilities: ['returns'], permission: 'pos.return', family: 'retail' },
  { key: 'held', label: 'Held Bills', path: '/held', icon: 'CirclePause', capabilities: ['hold-resume'], permission: 'pos.hold', family: 'retail' },
  { key: 'cash', label: 'Cash & Petty', path: '/cash', icon: 'Wallet', capabilities: ['petty-cash', 'shift'], permission: 'pos.petty-cash' },
  { key: 'shift', label: 'Shift', path: '/shift', icon: 'Clock', capabilities: ['shift'], permission: 'shift.close' },
  { key: 'sync', label: 'Sync Center', path: '/sync', icon: 'RefreshCw', permission: 'sync.view' },
  { key: 'devices', label: 'Devices', path: '/devices', icon: 'Printer' },
];

export const BACKOFFICE_NAV: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', path: '/', icon: 'LayoutDashboard', group: 'Overview', permission: 'dashboard.view' },
  { key: 'sales', label: 'Sales', path: '/sales', icon: 'Receipt', group: 'Overview', permission: 'reports.view' },
  { key: 'jobcards', label: 'Job Cards', path: '/jobcards', icon: 'Wrench', group: 'Overview', capabilities: ['job-card'], permission: 'jobcard.view', family: 'retail' },
  { key: 'products', label: 'Products', path: '/products', icon: 'Package', group: 'Catalog', capabilities: ['catalog'], permission: 'catalog.view', family: 'retail' },
  { key: 'menu', label: 'Menu', path: '/menu', icon: 'UtensilsCrossed', group: 'Catalog', capabilities: ['restaurant.pos'], permission: 'catalog.view', family: 'restaurant' },
  { key: 'categories', label: 'Categories', path: '/categories', icon: 'Tags', group: 'Catalog', capabilities: ['catalog'], permission: 'catalog.view' },
  { key: 'inventory', label: 'Inventory', path: '/inventory', icon: 'Boxes', group: 'Stock', capabilities: ['inventory'], permission: 'inventory.view' },
  { key: 'expiry', label: 'Batch & Expiry', path: '/expiry', icon: 'CalendarClock', group: 'Stock', capabilities: ['batch-expiry'], permission: 'inventory.view' },
  { key: 'purchase', label: 'Purchase', path: '/purchase', icon: 'ShoppingCart', group: 'Stock', capabilities: ['purchase'], permission: 'purchase.view' },
  { key: 'customers', label: 'Customers', path: '/customers', icon: 'Users', group: 'Parties', capabilities: ['customers'], permission: 'customers.view' },
  { key: 'suppliers', label: 'Suppliers', path: '/suppliers', icon: 'Truck', group: 'Parties', capabilities: ['suppliers'], permission: 'suppliers.view' },
  { key: 'loyalty', label: 'Loyalty', path: '/loyalty', icon: 'Gift', group: 'Parties', capabilities: ['loyalty'], permission: 'customers.view' },
  { key: 'finance', label: 'Receivables & Payables', path: '/finance', icon: 'Landmark', group: 'Finance', capabilities: ['receivables', 'payables'], permission: 'finance.view' },
  { key: 'shifts', label: 'Shifts', path: '/shifts', icon: 'Clock', group: 'Finance', capabilities: ['shift'], permission: 'finance.view' },
  { key: 'reports', label: 'Reports', path: '/reports', icon: 'ChartColumn', group: 'Finance', capabilities: ['reports.basic'], permission: 'reports.view' },
  { key: 'floors', label: 'Floors & Tables', path: '/floors', icon: 'LayoutGrid', group: 'Restaurant', capabilities: ['restaurant.tables'], permission: 'settings.edit', family: 'restaurant' },
  { key: 'stations', label: 'Kitchen Stations', path: '/stations', icon: 'ChefHat', group: 'Restaurant', capabilities: ['restaurant.kot'], permission: 'settings.edit', family: 'restaurant' },
  { key: 'users', label: 'Users & Roles', path: '/users', icon: 'UserCog', group: 'Administration', permission: 'users.manage' },
  { key: 'counters', label: 'Counters & Devices', path: '/devices', icon: 'MonitorSmartphone', group: 'Administration', capabilities: ['device-management', 'multi-counter'], permission: 'devices.manage' },
  { key: 'stores', label: 'Stores', path: '/stores', icon: 'Store', group: 'Administration', capabilities: ['multi-store'], permission: 'settings.edit' },
  { key: 'audit', label: 'Audit Log', path: '/audit', icon: 'ScrollText', group: 'Administration', permission: 'reports.view' },
  { key: 'settings', label: 'Settings', path: '/settings', icon: 'Settings', group: 'Administration', permission: 'settings.edit' },
];

export const PLATFORM_NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', path: '/', icon: 'LayoutDashboard', group: 'Platform' },
  { key: 'tenants', label: 'Tenants', path: '/tenants', icon: 'Building2', group: 'Platform', permission: 'platform.tenants' },
  { key: 'onboarding', label: 'Onboard Tenant', path: '/onboarding', icon: 'Rocket', group: 'Platform', permission: 'platform.tenants' },
  { key: 'plans', label: 'Plans & Add-ons', path: '/plans', icon: 'Layers', group: 'Platform', permission: 'platform.tenants' },
  { key: 'devices', label: 'Device Registry', path: '/devices', icon: 'MonitorSmartphone', group: 'Operations', permission: 'platform.devices' },
  { key: 'sync', label: 'Sync Diagnostics', path: '/sync', icon: 'RefreshCw', group: 'Operations', permission: 'sync.view' },
  { key: 'edge', label: 'Store Edge', path: '/edge', icon: 'Router', group: 'Operations', permission: 'platform.devices' },
  { key: 'support', label: 'Support', path: '/support', icon: 'LifeBuoy', group: 'Operations', permission: 'platform.support' },
  { key: 'audit', label: 'Audit Log', path: '/audit', icon: 'ScrollText', group: 'Operations', permission: 'platform.support' },
];
