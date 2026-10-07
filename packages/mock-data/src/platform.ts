import type { Company, Counter, Device, PeripheralStatus, Store, Tenant, User } from '@elixir/contracts';
import { DAY, iso, isoDay } from './rng';

export const TENANT_IDS = {
  abc: 't-abc',
  trendz: 't-trendz',
  wellness: 't-wellness',
  volt: 't-volt',
  spice: 't-spice',
} as const;

const NOW = Date.now();

const t = (o: Partial<Tenant> & Pick<Tenant, 'id' | 'name' | 'vertical' | 'plan'>): Tenant => ({
  legalName: `${o.name} Pvt Ltd`,
  family: o.vertical === 'restaurant' ? 'restaurant' : 'retail',
  addOns: [],
  subscriptionStatus: 'active',
  stateCode: '33',
  createdAt: iso(NOW - 400 * DAY),
  renewsOn: isoDay(NOW + 40 * DAY),
  configVersion: 42,
  contactName: 'Owner',
  contactPhone: '+91 98400 00000',
  city: 'Chennai',
  ...o,
});

/** Demo tenants with full datasets + extra tenants that only appear in Platform Admin. */
export const tenants: Tenant[] = [
  t({ id: TENANT_IDS.abc, name: 'ABC Supermarket', legalName: 'ABC Retail Ventures Pvt Ltd', gstin: '33AABCA1234F1Z5', vertical: 'grocery', plan: 'pro', addOns: ['multi-store'], contactName: 'Ramesh Kumar', contactPhone: '+91 98401 22334', city: 'Chennai' }),
  t({ id: TENANT_IDS.trendz, name: 'Trendz Fashion', legalName: 'Trendz Apparel LLP', gstin: '33AAKFT5678G1Z2', vertical: 'fashion', plan: 'pro', addOns: ['loyalty'], contactName: 'Divya Menon', contactPhone: '+91 98844 55667', city: 'Coimbatore' }),
  t({ id: TENANT_IDS.wellness, name: 'Wellness Pharmacy', legalName: 'Wellness Healthcare Pvt Ltd', gstin: '33AACCW9012H1Z8', vertical: 'pharmacy', plan: 'business', addOns: [], contactName: 'Dr. Senthil Nathan', contactPhone: '+91 94440 11223', city: 'Madurai' }),
  t({ id: TENANT_IDS.volt, name: 'Volt Electronics', legalName: 'Volt Digital Stores', gstin: '33AAFFV3456J1Z1', vertical: 'electronics', plan: 'starter', addOns: [], contactName: 'Arjun Reddy', contactPhone: '+91 90030 77889', city: 'Chennai' }),
  t({ id: TENANT_IDS.spice, name: 'Spice Route Kitchen', legalName: 'Spice Route Hospitality Pvt Ltd', gstin: '33AAGCS7890K1Z4', vertical: 'restaurant', plan: 'business', addOns: ['qr-ordering'], contactName: 'Karthik Iyer', contactPhone: '+91 99620 33445', city: 'Chennai' }),
  t({ id: 't-kumar', name: 'Kumar Hardwares', vertical: 'hardware', plan: 'pro', city: 'Salem', contactName: 'S. Kumar', createdAt: iso(NOW - 210 * DAY) }),
  t({ id: 't-metro', name: 'Metro Distributors', vertical: 'wholesale', plan: 'business', addOns: ['integrations', 'multi-store'], city: 'Bengaluru', stateCode: '29', contactName: 'Prakash Rao', createdAt: iso(NOW - 120 * DAY) }),
  t({ id: 't-bean', name: 'Bean There Cafe', vertical: 'restaurant', plan: 'pro', addOns: ['kds'], subscriptionStatus: 'trial', city: 'Pondicherry', stateCode: '34', contactName: 'Ananya Pillai', createdAt: iso(NOW - 9 * DAY), renewsOn: isoDay(NOW + 5 * DAY) }),
  t({ id: 't-fresh', name: 'FreshMart Daily', vertical: 'grocery', plan: 'starter', subscriptionStatus: 'grace', city: 'Trichy', contactName: 'Mohammed Ali', renewsOn: isoDay(NOW - 3 * DAY) }),
  t({ id: 't-style', name: 'StyleHub Boutique', vertical: 'fashion', plan: 'pro', subscriptionStatus: 'suspended', city: 'Kochi', stateCode: '32', contactName: 'Neha Thomas', renewsOn: isoDay(NOW - 22 * DAY) }),
  t({ id: 't-care', name: 'CarePlus Medicals', vertical: 'pharmacy', plan: 'pro', addOns: ['loyalty'], city: 'Vellore', contactName: 'Lakshmi R', createdAt: iso(NOW - 75 * DAY) }),
  t({ id: 't-tandoor', name: 'Tandoori Nights', vertical: 'restaurant', plan: 'business', addOns: ['store-edge', 'multi-store'], city: 'Hyderabad', stateCode: '36', contactName: 'Imran Shaikh', createdAt: iso(NOW - 300 * DAY) }),
  t({ id: 't-gadget', name: 'Gadget Galaxy', vertical: 'electronics', plan: 'business', addOns: ['multi-store', 'integrations'], city: 'Mumbai', stateCode: '27', contactName: 'Rohan Shah', createdAt: iso(NOW - 500 * DAY) }),
  t({ id: 't-general', name: 'Sri Lakshmi Stores', vertical: 'general', plan: 'starter', city: 'Tirunelveli', contactName: 'P. Ganesan', createdAt: iso(NOW - 30 * DAY) }),
];

export const DEMO_TENANT_IDS: string[] = Object.values(TENANT_IDS);

export const companies: Company[] = tenants.map((x) => ({ id: `co-${x.id}`, tenantId: x.id, name: x.legalName, gstin: x.gstin }));

const st = (tenantId: string, n: number, code: string, name: string, city: string, edge = false, stateCode = '33'): Store => ({
  id: `s-${tenantId}-${n}`,
  tenantId,
  companyId: `co-${tenantId}`,
  code,
  name,
  city,
  address: `${10 + n * 7}, Main Road, ${name}, ${city}`,
  stateCode,
  phone: `+91 44 2${n}45 67${n}0`,
  edgeEnabled: edge,
  active: true,
});

export const stores: Store[] = [
  st(TENANT_IDS.abc, 1, 'ANN', 'Anna Nagar', 'Chennai'),
  st(TENANT_IDS.abc, 2, 'VEL', 'Velachery', 'Chennai'),
  st(TENANT_IDS.trendz, 1, 'RSP', 'RS Puram', 'Coimbatore'),
  st(TENANT_IDS.wellness, 1, 'KKN', 'KK Nagar', 'Madurai', true),
  st(TENANT_IDS.wellness, 2, 'ANA', 'Anna Nagar', 'Madurai'),
  st(TENANT_IDS.volt, 1, 'TNR', 'T. Nagar', 'Chennai'),
  st(TENANT_IDS.spice, 1, 'ADY', 'Adyar', 'Chennai', true),
  ...tenants.filter((x) => !DEMO_TENANT_IDS.includes(x.id)).map((x) => st(x.id, 1, 'MAIN', 'Main Branch', x.city, x.addOns.includes('store-edge'), x.stateCode)),
];

export const counters: Counter[] = [];
for (const s of stores) {
  const isRest = tenants.find((x) => x.id === s.tenantId)?.vertical === 'restaurant';
  const n = s.tenantId === TENANT_IDS.abc && s.code === 'ANN' ? 4 : isRest ? 2 : 2;
  for (let i = 1; i <= n; i++) {
    counters.push({ id: `c-${s.id}-${i}`, storeId: s.id, code: `C0${i}`, name: `Counter ${i}`, kind: 'billing', printerName: `Counter ${i} Printer`, active: true });
  }
  if (isRest) counters.push({ id: `c-${s.id}-k`, storeId: s.id, code: 'K01', name: 'Main Kitchen', kind: 'kitchen', active: true });
}

const okPeripherals: PeripheralStatus[] = [
  { kind: 'printer', name: 'Epson TM-T82', state: 'ready' },
  { kind: 'scanner', name: 'Honeywell 1250g', state: 'ready' },
  { kind: 'cash-drawer', name: 'Cash Drawer', state: 'ready' },
];

export const devices: Device[] = [];
let devSeq = 1;
for (const s of stores) {
  const tenant = tenants.find((x) => x.id === s.tenantId)!;
  const cs = counters.filter((c) => c.storeId === s.id);
  for (const c of cs) {
    const kind = c.kind === 'kitchen' ? 'kds' : 'pos-desktop';
    const n = devSeq++;
    const offline = n % 7 === 3;
    const attention = n % 11 === 5;
    const suspended = tenant.subscriptionStatus === 'suspended';
    devices.push({
      id: `d-${c.id}`,
      tenantId: s.tenantId,
      storeId: s.id,
      counterId: c.id,
      code: kind === 'kds' ? `KDS-0${c.code.slice(-1)}` : `POS-0${c.code.slice(-1)}`,
      name: kind === 'kds' ? `${s.name} Kitchen Display` : `${s.name} ${c.name}`,
      kind,
      status: suspended ? 'revoked' : attention ? 'attention' : offline ? 'offline' : 'active',
      appVersion: n % 5 === 0 ? '1.3.2' : '1.4.0',
      configVersion: n % 5 === 0 ? 39 : 42,
      lastSeenAt: iso(NOW - (offline ? (18 + n) * 60000 : n * 9000)),
      lastSyncAt: iso(NOW - (offline ? (18 + n) * 60000 : n * 15000)),
      pendingSync: offline ? 18 + n : attention ? 4 : 0,
      failedSync: attention ? 2 : 0,
      os: kind === 'kds' ? 'Android 14' : n % 2 ? 'Windows 11' : 'Windows 10',
      activatedAt: iso(NOW - (60 + n) * DAY),
      peripherals: kind === 'kds' ? [] : attention ? [{ ...okPeripherals[0]!, state: 'unavailable' }, okPeripherals[1]!, okPeripherals[2]!] : okPeripherals,
    });
  }
  if (tenant.vertical === 'restaurant' || tenant.plan !== 'starter') {
    devices.push({
      id: `d-${s.id}-mob`, tenantId: s.tenantId, storeId: s.id, code: 'MOB-01', name: tenant.vertical === 'restaurant' ? 'Waiter Phone 1' : 'Owner iPhone', kind: 'mobile',
      status: 'active', appVersion: '1.4.0', configVersion: 42, lastSeenAt: iso(NOW - 120000), lastSyncAt: iso(NOW - 120000), pendingSync: 0, failedSync: 0, os: tenant.vertical === 'restaurant' ? 'Android 15' : 'iOS 19', activatedAt: iso(NOW - 30 * DAY),
    });
  }
  if (s.edgeEnabled) {
    devices.push({
      id: `d-${s.id}-edge`, tenantId: s.tenantId, storeId: s.id, code: 'EDGE-01', name: `${s.name} Store Edge`, kind: 'store-edge',
      status: 'active', appVersion: '1.2.1', configVersion: 42, lastSeenAt: iso(NOW - 5000), lastSyncAt: iso(NOW - 30000), pendingSync: 3, failedSync: 0, os: 'Ubuntu 24.04', activatedAt: iso(NOW - 90 * DAY),
    });
  }
}
// One device waiting for activation, for the platform activation flow.
devices.push({ id: 'd-pending-1', tenantId: TENANT_IDS.abc, storeId: `s-${TENANT_IDS.abc}-2`, code: 'POS-03', name: 'Velachery Counter 3 (new)', kind: 'pos-desktop', status: 'pending-activation', appVersion: '1.4.0', configVersion: 0, lastSeenAt: iso(NOW - 600000), pendingSync: 0, failedSync: 0, os: 'Windows 11' });

const COLORS = ['#3b5bdb', '#0c8599', '#2b8a3e', '#e8590c', '#ae3ec9', '#c2255c', '#5f3dc4', '#1971c2'];
const u = (tenantId: string, key: string, name: string, role: User['role'], pin: string, storeIds: string[]): User => ({
  id: `u-${tenantId}-${key}`,
  tenantId,
  name,
  username: name.split(' ')[0]!.toLowerCase(),
  role,
  storeIds,
  pin,
  phone: `+91 9${String(name.length * 1234567).padStart(9, '0').slice(0, 9)}`,
  active: true,
  offlineAuthValidUntil: iso(NOW + 6 * DAY),
  avatarColor: COLORS[(name.length + key.length) % COLORS.length],
});

const storeIdsOf = (tid: string) => stores.filter((s) => s.tenantId === tid).map((s) => s.id);

export const users: User[] = [
  ...[TENANT_IDS.abc, TENANT_IDS.trendz, TENANT_IDS.wellness, TENANT_IDS.volt].flatMap((tid) => {
    const all = storeIdsOf(tid);
    const owner = tenants.find((x) => x.id === tid)!.contactName;
    return [
      u(tid, 'owner', owner, 'owner', '1111', all),
      u(tid, 'mgr', 'Priya Sharma', 'manager', '2222', all),
      u(tid, 'arun', 'Arun Prakash', 'cashier', '1234', [all[0]!]),
      u(tid, 'meena', 'Meena Rajan', 'cashier', '4321', all),
      u(tid, 'acct', 'Suresh Babu', 'accountant', '7777', all),
      u(tid, 'inv', 'Vignesh K', 'inventory', '8888', all),
    ];
  }),
  ...(() => {
    const tid = TENANT_IDS.spice;
    const all = storeIdsOf(tid);
    return [
      u(tid, 'owner', 'Karthik Iyer', 'owner', '1111', all),
      u(tid, 'mgr', 'Priya Sharma', 'manager', '2222', all),
      u(tid, 'arun', 'Arun Prakash', 'cashier', '1234', all),
      u(tid, 'ravi', 'Ravi Shankar', 'waiter', '5555', all),
      u(tid, 'deepa', 'Deepa Lakshmi', 'waiter', '5556', all),
      u(tid, 'john', 'John Paul', 'waiter', '5557', all),
      u(tid, 'chef', 'Chef Murugan', 'kitchen', '6666', all),
      u(tid, 'acct', 'Suresh Babu', 'accountant', '7777', all),
    ];
  })(),
  u('t-platform', 'admin', 'Nisha Varma', 'platform-admin', '9999', []),
  u('t-platform', 'support', 'Rahul Dev', 'support', '9998', []),
];
