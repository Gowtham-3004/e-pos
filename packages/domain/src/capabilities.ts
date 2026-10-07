import type { AddOn, AddOnCode, Capability, Permission, Plan, PlanCode, ProductFamily, Role, RoleCode, Tenant, Vertical } from '@elixir/contracts';

export const CORE_RETAIL: Capability[] = ['pos.billing', 'catalog', 'inventory', 'customers', 'gst', 'shift', 'returns', 'hold-resume', 'reports.basic', 'petty-cash'];
export const CORE_RESTAURANT: Capability[] = ['restaurant.pos', 'catalog', 'customers', 'gst', 'shift', 'reports.basic', 'restaurant.modifiers', 'restaurant.kot'];

export const VERTICAL_CAPABILITIES: Record<Vertical, Capability[]> = {
  general: ['purchase', 'suppliers'],
  grocery: ['purchase', 'suppliers', 'batch-expiry', 'weighted-items', 'scale', 'promotions'],
  fashion: ['purchase', 'suppliers', 'variants', 'promotions'],
  pharmacy: ['purchase', 'suppliers', 'batch-expiry', 'prescription'],
  electronics: ['purchase', 'suppliers', 'serial-tracking', 'warranty'],
  hardware: ['purchase', 'suppliers', 'multi-uom', 'quotation', 'credit-sales'],
  wholesale: ['purchase', 'suppliers', 'multi-uom', 'price-groups', 'credit-sales', 'quotation', 'transport'],
  restaurant: ['restaurant.tables', 'restaurant.split-bill', 'inventory', 'purchase', 'suppliers'],
};

export const VERTICAL_LABEL: Record<Vertical, string> = {
  general: 'General Retail',
  grocery: 'Grocery / Supermarket',
  fashion: 'Fashion / Apparel',
  pharmacy: 'Pharmacy',
  electronics: 'Electronics',
  hardware: 'Hardware',
  wholesale: 'Wholesale / Distribution',
  restaurant: 'Restaurant',
};

export const familyOf = (v: Vertical): ProductFamily => (v === 'restaurant' ? 'restaurant' : 'retail');

export const PLANS: Plan[] = [
  {
    code: 'starter',
    name: 'Local / Starter',
    description: 'Single-counter offline POS with local catalog, inventory and reports.',
    capabilities: [],
    maxCounters: 1,
    monthlyPricePaise: 79900,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Cloud sync, backup, web back office, mobile, multi-counter, loyalty and advanced reports.',
    capabilities: ['cloud-sync', 'cloud-backup', 'backoffice-web', 'mobile-app', 'multi-counter', 'loyalty', 'reports.advanced', 'receivables', 'payables', 'device-management', 'restaurant.waiter', 'restaurant.kds'],
    maxCounters: 5,
    monthlyPricePaise: 249900,
  },
  {
    code: 'business',
    name: 'Business / Enterprise',
    description: 'Multi-store, Store Edge, central pricing, advanced RBAC, integrations and analytics.',
    capabilities: ['cloud-sync', 'cloud-backup', 'backoffice-web', 'mobile-app', 'multi-counter', 'loyalty', 'reports.advanced', 'receivables', 'payables', 'device-management', 'multi-store', 'store-edge', 'advanced-rbac', 'integrations', 'analytics', 'restaurant.waiter', 'restaurant.kds', 'restaurant.qr'],
    maxCounters: 20,
    monthlyPricePaise: 699900,
  },
];

export const ADD_ONS: AddOn[] = [
  { code: 'multi-store', name: 'Multi-store', description: 'Manage stores, transfers and consolidated views.', capabilities: ['multi-store'], monthlyPricePaise: 149900, families: ['retail', 'restaurant'] },
  { code: 'advanced-analytics', name: 'Advanced Analytics', description: 'Trends, cohort and margin analytics.', capabilities: ['analytics', 'reports.advanced'], monthlyPricePaise: 99900, families: ['retail', 'restaurant'] },
  { code: 'loyalty', name: 'Loyalty', description: 'Points-based customer loyalty.', capabilities: ['loyalty'], monthlyPricePaise: 49900, families: ['retail', 'restaurant'] },
  { code: 'store-edge', name: 'Store Edge', description: 'LAN-local coordination for multi-counter and restaurant continuity.', capabilities: ['store-edge'], monthlyPricePaise: 199900, families: ['retail', 'restaurant'] },
  { code: 'integrations', name: 'Integrations & APIs', description: 'Payments, e-invoice, Elixir Books, webhooks.', capabilities: ['integrations'], monthlyPricePaise: 99900, families: ['retail', 'restaurant'] },
  { code: 'qr-ordering', name: 'QR Ordering', description: 'Customer table QR menu and ordering.', capabilities: ['restaurant.qr'], monthlyPricePaise: 99900, families: ['restaurant'] },
  { code: 'kds', name: 'Kitchen Display', description: 'Kitchen display system with stations.', capabilities: ['restaurant.kds'], monthlyPricePaise: 79900, families: ['restaurant'] },
];

export const planByCode = (c: PlanCode) => PLANS.find((p) => p.code === c)!;
export const addOnByCode = (c: AddOnCode) => ADD_ONS.find((a) => a.code === c)!;

/** Restaurant-only capabilities that never apply to a retail tenant (and vice versa). */
const RESTAURANT_ONLY = (c: Capability) => c.startsWith('restaurant.');

/**
 * Effective capability set = Core + Vertical + Plan + Add-ons + Overrides − Restrictions (PRD §13.1).
 */
export function resolveCapabilities(t: Pick<Tenant, 'vertical' | 'plan' | 'addOns' | 'capabilityOverrides' | 'capabilityRestrictions' | 'subscriptionStatus'>): Capability[] {
  const family = familyOf(t.vertical);
  const set = new Set<Capability>(family === 'restaurant' ? CORE_RESTAURANT : CORE_RETAIL);
  VERTICAL_CAPABILITIES[t.vertical].forEach((c) => set.add(c));
  planByCode(t.plan).capabilities.forEach((c) => set.add(c));
  t.addOns.forEach((a) => addOnByCode(a)?.capabilities.forEach((c) => set.add(c)));
  t.capabilityOverrides?.forEach((c) => set.add(c));
  t.capabilityRestrictions?.forEach((c) => set.delete(c));
  for (const c of [...set]) {
    if (family === 'retail' && RESTAURANT_ONLY(c)) set.delete(c);
  }
  if (family === 'restaurant') set.delete('pos.billing');
  if (t.subscriptionStatus === 'suspended') {
    // Security revocation path: keep only historic read access.
    return ['reports.basic'];
  }
  return [...set].sort();
}

const ALL_POS: Permission[] = ['pos.sell', 'pos.discount.line', 'pos.discount.bill', 'pos.hold', 'pos.return', 'pos.petty-cash', 'pos.credit-sale', 'shift.open', 'shift.close'];

export const ROLES: Role[] = [
  {
    code: 'owner',
    name: 'Owner',
    discountLimitPct: 100,
    permissions: [
      ...ALL_POS, 'pos.discount.override', 'pos.void', 'pos.return.no-invoice', 'pos.price.override', 'shift.reopen', 'shift.variance.approve',
      'catalog.view', 'catalog.edit', 'inventory.view', 'inventory.adjust', 'purchase.view', 'purchase.post', 'customers.view', 'customers.edit',
      'suppliers.view', 'suppliers.edit', 'finance.view', 'reports.view', 'reports.export', 'settings.edit', 'users.manage', 'devices.manage',
      'sync.view', 'sync.resolve', 'dashboard.view', 'restaurant.order', 'restaurant.kot.send', 'restaurant.kot.void', 'restaurant.table.transfer',
      'restaurant.bill.split', 'kds.operate', 'approvals.act',
    ],
  },
  {
    code: 'manager',
    name: 'Store Manager',
    discountLimitPct: 25,
    permissions: [
      ...ALL_POS, 'pos.discount.override', 'pos.void', 'pos.return.no-invoice', 'pos.price.override', 'shift.reopen', 'shift.variance.approve',
      'catalog.view', 'catalog.edit', 'inventory.view', 'inventory.adjust', 'purchase.view', 'purchase.post', 'customers.view', 'customers.edit',
      'suppliers.view', 'suppliers.edit', 'finance.view', 'reports.view', 'reports.export', 'users.manage', 'devices.manage', 'sync.view',
      'dashboard.view', 'restaurant.order', 'restaurant.kot.send', 'restaurant.kot.void', 'restaurant.table.transfer', 'restaurant.bill.split',
      'kds.operate', 'approvals.act',
    ],
  },
  {
    code: 'cashier',
    name: 'Cashier',
    discountLimitPct: 10,
    permissions: [...ALL_POS, 'catalog.view', 'customers.view', 'customers.edit', 'restaurant.order', 'restaurant.kot.send', 'restaurant.bill.split'],
  },
  {
    code: 'accountant',
    name: 'Accountant',
    discountLimitPct: 0,
    permissions: ['finance.view', 'reports.view', 'reports.export', 'customers.view', 'suppliers.view', 'purchase.view', 'dashboard.view', 'inventory.view', 'catalog.view'],
  },
  {
    code: 'inventory',
    name: 'Inventory Executive',
    discountLimitPct: 0,
    permissions: ['catalog.view', 'catalog.edit', 'inventory.view', 'inventory.adjust', 'purchase.view', 'purchase.post', 'suppliers.view', 'suppliers.edit', 'reports.view'],
  },
  {
    code: 'waiter',
    name: 'Waiter / Captain',
    discountLimitPct: 0,
    permissions: ['restaurant.order', 'restaurant.kot.send', 'catalog.view'],
  },
  {
    code: 'kitchen',
    name: 'Kitchen',
    discountLimitPct: 0,
    permissions: ['kds.operate'],
  },
  {
    code: 'platform-admin',
    name: 'Platform Admin',
    discountLimitPct: 0,
    permissions: ['platform.tenants', 'platform.devices', 'platform.support', 'sync.view', 'sync.resolve'],
  },
  {
    code: 'support',
    name: 'Support',
    discountLimitPct: 0,
    permissions: ['platform.devices', 'platform.support', 'sync.view'],
  },
];

export const roleByCode = (c: RoleCode) => ROLES.find((r) => r.code === c)!;

export function can(permissions: Permission[], p: Permission): boolean {
  return permissions.includes(p);
}

/** Dual authorization (ADR-008): tenant capability AND user permission. */
export function authorize(capabilities: Capability[], permissions: Permission[], need: { capability?: Capability; permission?: Permission }): boolean {
  if (need.capability && !capabilities.includes(need.capability)) return false;
  if (need.permission && !permissions.includes(need.permission)) return false;
  return true;
}

export const CAPABILITY_LABEL: Partial<Record<Capability, string>> = {
  'pos.billing': 'POS & Billing',
  catalog: 'Catalog',
  inventory: 'Inventory',
  purchase: 'Purchasing',
  customers: 'Customers',
  suppliers: 'Suppliers',
  receivables: 'Receivables',
  payables: 'Payables',
  'reports.basic': 'Reports',
  'reports.advanced': 'Advanced Reports',
  gst: 'GST Engine',
  shift: 'Shifts',
  returns: 'Returns',
  'hold-resume': 'Hold / Resume',
  quotation: 'Quotation',
  'petty-cash': 'Petty Cash',
  'batch-expiry': 'Batch & Expiry',
  'weighted-items': 'Weighted Items',
  scale: 'Scale Integration',
  promotions: 'Promotions',
  variants: 'Variants',
  'serial-tracking': 'Serial / IMEI',
  warranty: 'Warranty',
  prescription: 'Prescription Controls',
  'multi-uom': 'Multi-UOM',
  'price-groups': 'Price Groups',
  'credit-sales': 'Credit Sales',
  transport: 'Shipping / Transport',
  'cloud-sync': 'Cloud Sync',
  'cloud-backup': 'Cloud Backup',
  'backoffice-web': 'Web Back Office',
  'mobile-app': 'Mobile App',
  'multi-counter': 'Multi-counter',
  loyalty: 'Loyalty',
  'multi-store': 'Multi-store',
  'store-edge': 'Store Edge',
  'advanced-rbac': 'Advanced RBAC',
  integrations: 'Integrations',
  analytics: 'Analytics',
  'device-management': 'Device Management',
  'restaurant.pos': 'Restaurant POS',
  'restaurant.tables': 'Tables & Floors',
  'restaurant.kot': 'KOT',
  'restaurant.kds': 'Kitchen Display',
  'restaurant.waiter': 'Waiter Mode',
  'restaurant.qr': 'QR Ordering',
  'restaurant.modifiers': 'Modifiers',
  'restaurant.split-bill': 'Split Bill',
};
