import type {
  ApprovalRequest, AuditEvent, Batch, Brand, CashMovement, Category, Company, Counter, Customer, Device, DiningTable, EdgeNode, Floor, HeldCart,
  KitchenStation, Kot, LoyaltyEvent, MenuItem, ModifierGroup, Payment, PriceGroup, Product, Purchase, RestaurantOrder, Sale, SaleReturn, SerialNumber,
  Shift, StockAdjustment, StockMovement, Store, Supplier, SupportTicket, SyncConflict, SyncOutboxItem, TaxRate, Tenant, User, WaiterCall,
} from '@elixir/contracts';
import { createRng, resetSid } from './rng';
import { companies, counters, devices, stores, tenants, users, TENANT_IDS, DEMO_TENANT_IDS } from './platform';
import { buildCatalogs, priceGroups, taxRates } from './catalog';
import { buildParties } from './parties';
import { buildRestaurantRuntime, floors, menuItems, modifierGroups, restaurantCategories, stations } from './restaurant';
import { buildHistory } from './history';

export { TENANT_IDS, DEMO_TENANT_IDS };

export interface SeedData {
  version: number;
  generatedAt: string;
  tenants: Tenant[];
  companies: Company[];
  stores: Store[];
  counters: Counter[];
  devices: Device[];
  users: User[];
  categories: Category[];
  brands: Brand[];
  taxRates: TaxRate[];
  priceGroups: PriceGroup[];
  products: Product[];
  batches: Batch[];
  serials: SerialNumber[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  returns: SaleReturn[];
  heldCarts: HeldCart[];
  stockMovements: StockMovement[];
  purchases: Purchase[];
  adjustments: StockAdjustment[];
  payments: Payment[];
  loyaltyEvents: LoyaltyEvent[];
  shifts: Shift[];
  cashMovements: CashMovement[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
  stations: KitchenStation[];
  floors: Floor[];
  tables: DiningTable[];
  orders: RestaurantOrder[];
  kots: Kot[];
  waiterCalls: WaiterCall[];
  auditEvents: AuditEvent[];
  approvals: ApprovalRequest[];
  syncConflicts: SyncConflict[];
  outbox: SyncOutboxItem[];
  edgeNodes: EdgeNode[];
  tickets: SupportTicket[];
  /** Next document sequence per `${kind}|${counterId}` so the POS continues numbering. */
  sequences: Record<string, number>;
}

/** Bump when seed shape changes; local-store reseeds when the stored version differs. */
export const SEED_VERSION = 4;

let cached: SeedData | null = null;

/** Deterministic dummy dataset shared by every Elixir product. */
export function buildSeed(): SeedData {
  if (cached) return cached;
  resetSid();
  const rng = createRng(20261007);
  const catalog = buildCatalogs(rng);
  const parties = buildParties(rng);
  const runtime = buildRestaurantRuntime(rng);
  const history = buildHistory({ rng, products: catalog.products, batches: catalog.batches, serials: catalog.serials, customers: parties.customers, suppliers: parties.suppliers, menuItems });
  const sequences: Record<string, number> = Object.fromEntries(history.counterSeq);
  sequences['KOT|global'] = runtime.nextKotSeq;
  sequences['ORD|global'] = runtime.nextOrderSeq;
  cached = {
    version: SEED_VERSION,
    generatedAt: new Date().toISOString(),
    tenants,
    companies,
    stores,
    counters,
    devices,
    users,
    categories: [...catalog.categories, ...restaurantCategories],
    brands: catalog.brands,
    taxRates,
    priceGroups,
    products: catalog.products,
    batches: catalog.batches,
    serials: catalog.serials,
    customers: parties.customers,
    suppliers: parties.suppliers,
    sales: history.sales,
    returns: history.returns,
    heldCarts: [],
    stockMovements: history.stockMovements,
    purchases: history.purchases,
    adjustments: history.adjustments,
    payments: history.payments,
    loyaltyEvents: [],
    shifts: history.shifts,
    cashMovements: history.cashMovements,
    menuItems,
    modifierGroups,
    stations,
    floors,
    tables: runtime.tables,
    orders: runtime.orders,
    kots: runtime.kots,
    waiterCalls: runtime.waiterCalls,
    auditEvents: history.auditEvents,
    approvals: history.approvals,
    syncConflicts: history.syncConflicts,
    outbox: [],
    edgeNodes: history.edgeNodes,
    tickets: history.tickets,
    sequences,
  };
  return cached;
}

/** Demo sign-in cheat sheet shown on login screens. */
export const DEMO_LOGINS = [
  { tenantId: TENANT_IDS.abc, label: 'ABC Supermarket · Grocery · Pro', users: [['Arun (Cashier)', '1234'], ['Meena (Cashier)', '4321'], ['Priya (Manager)', '2222'], ['Ramesh (Owner)', '1111']] },
  { tenantId: TENANT_IDS.trendz, label: 'Trendz Fashion · Fashion · Pro', users: [['Arun (Cashier)', '1234'], ['Priya (Manager)', '2222'], ['Divya (Owner)', '1111']] },
  { tenantId: TENANT_IDS.wellness, label: 'Wellness Pharmacy · Pharmacy · Business', users: [['Arun (Cashier)', '1234'], ['Priya (Manager)', '2222'], ['Dr. Senthil (Owner)', '1111']] },
  { tenantId: TENANT_IDS.volt, label: 'Volt Electronics · Electronics · Starter', users: [['Arun (Cashier)', '1234'], ['Priya (Manager)', '2222'], ['Arjun (Owner)', '1111']] },
  { tenantId: TENANT_IDS.spice, label: 'Spice Route Kitchen · Restaurant · Business', users: [['Arun (Cashier)', '1234'], ['Ravi (Waiter)', '5555'], ['Chef Murugan (Kitchen)', '6666'], ['Priya (Manager)', '2222'], ['Karthik (Owner)', '1111']] },
] as const;

export const PLATFORM_LOGINS = [['Nisha Varma (Platform Admin)', '9999'], ['Rahul Dev (Support)', '9998']] as const;
