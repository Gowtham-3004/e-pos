/**
 * Elixir POS shared domain contracts.
 *
 * Conventions
 * - Money is always integer paise (₹1.00 = 100). Never floats for currency.
 * - Quantities are numbers; weighted/decimal items allow up to 3 decimals.
 * - IDs are opaque strings (uuid-like). Human document numbers are separate (ADR-013).
 * - Timestamps are ISO-8601 strings; businessDate is 'YYYY-MM-DD'.
 */

export type ID = string;
export type Paise = number;
export type ISODate = string;
export type ISODateTime = string;

// ───────────────────────── Platform ─────────────────────────

export type ProductFamily = 'retail' | 'restaurant';

export type Vertical =
  | 'general'
  | 'grocery'
  | 'fashion'
  | 'pharmacy'
  | 'electronics'
  | 'hardware'
  | 'wholesale'
  | 'restaurant';

export type PlanCode = 'starter' | 'pro' | 'business';

export type Capability =
  // core retail
  | 'pos.billing'
  | 'catalog'
  | 'inventory'
  | 'purchase'
  | 'customers'
  | 'suppliers'
  | 'receivables'
  | 'payables'
  | 'reports.basic'
  | 'reports.advanced'
  | 'gst'
  | 'shift'
  | 'returns'
  | 'hold-resume'
  | 'quotation'
  | 'petty-cash'
  // vertical extensions
  | 'batch-expiry'
  | 'weighted-items'
  | 'scale'
  | 'promotions'
  | 'variants'
  | 'serial-tracking'
  | 'warranty'
  | 'job-card'
  | 'prescription'
  | 'multi-uom'
  | 'price-groups'
  | 'credit-sales'
  | 'transport'
  // connected / plan
  | 'cloud-sync'
  | 'cloud-backup'
  | 'backoffice-web'
  | 'mobile-app'
  | 'multi-counter'
  | 'loyalty'
  | 'multi-store'
  | 'store-edge'
  | 'advanced-rbac'
  | 'integrations'
  | 'analytics'
  | 'device-management'
  // restaurant
  | 'restaurant.pos'
  | 'restaurant.tables'
  | 'restaurant.kot'
  | 'restaurant.kds'
  | 'restaurant.waiter'
  | 'restaurant.qr'
  | 'restaurant.modifiers'
  | 'restaurant.split-bill';

export type AddOnCode =
  | 'multi-store'
  | 'advanced-analytics'
  | 'loyalty'
  | 'store-edge'
  | 'integrations'
  | 'qr-ordering'
  | 'kds';

export interface Plan {
  code: PlanCode;
  name: string;
  description: string;
  capabilities: Capability[];
  maxCounters: number;
  monthlyPricePaise: Paise;
}

export interface AddOn {
  code: AddOnCode;
  name: string;
  description: string;
  capabilities: Capability[];
  monthlyPricePaise: Paise;
  families: ProductFamily[];
}

export type SubscriptionStatus = 'active' | 'trial' | 'grace' | 'suspended' | 'cancelled';

export interface Tenant {
  id: ID;
  name: string;
  legalName: string;
  gstin?: string;
  family: ProductFamily;
  vertical: Vertical;
  plan: PlanCode;
  addOns: AddOnCode[];
  /** Explicit grants beyond plan (support overrides). */
  capabilityOverrides?: Capability[];
  /** Explicitly removed capabilities (suspension/restriction). */
  capabilityRestrictions?: Capability[];
  subscriptionStatus: SubscriptionStatus;
  stateCode: string; // GST state code e.g. '33' Tamil Nadu
  createdAt: ISODateTime;
  renewsOn: ISODate;
  configVersion: number;
  contactName: string;
  contactPhone: string;
  city: string;
}

export interface Company {
  id: ID;
  tenantId: ID;
  name: string;
  gstin?: string;
}

export interface Store {
  id: ID;
  tenantId: ID;
  companyId: ID;
  code: string;
  name: string;
  city: string;
  address: string;
  stateCode: string;
  phone: string;
  edgeEnabled: boolean;
  active: boolean;
}

export type CounterKind = 'billing' | 'kitchen' | 'waiter' | 'bar';

export interface Counter {
  id: ID;
  storeId: ID;
  code: string; // C01
  name: string;
  kind: CounterKind;
  printerName?: string;
  active: boolean;
}

export type DeviceKind = 'pos-desktop' | 'pos-web' | 'kds' | 'mobile' | 'store-edge';
export type DeviceStatus = 'active' | 'offline' | 'revoked' | 'attention' | 'pending-activation';

export interface Device {
  id: ID;
  tenantId: ID;
  storeId: ID;
  counterId?: ID;
  code: string; // POS-02
  name: string;
  kind: DeviceKind;
  status: DeviceStatus;
  appVersion: string;
  configVersion: number;
  lastSeenAt: ISODateTime;
  lastSyncAt?: ISODateTime;
  pendingSync: number;
  failedSync: number;
  os: string;
  activatedAt?: ISODateTime;
  peripherals?: PeripheralStatus[];
}

export type PeripheralKind = 'printer' | 'scanner' | 'cash-drawer' | 'scale' | 'customer-display';
export interface PeripheralStatus {
  kind: PeripheralKind;
  name: string;
  state: 'ready' | 'connected' | 'unavailable' | 'error';
}

export type RoleCode =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'accountant'
  | 'inventory'
  | 'waiter'
  | 'kitchen'
  | 'platform-admin'
  | 'support';

export type Permission =
  | 'pos.sell'
  | 'pos.discount.line'
  | 'pos.discount.bill'
  | 'pos.discount.override'
  | 'pos.void'
  | 'pos.return'
  | 'pos.return.no-invoice'
  | 'pos.price.override'
  | 'pos.hold'
  | 'pos.petty-cash'
  | 'pos.credit-sale'
  | 'shift.open'
  | 'shift.close'
  | 'shift.reopen'
  | 'shift.variance.approve'
  | 'catalog.view'
  | 'catalog.edit'
  | 'inventory.view'
  | 'inventory.adjust'
  | 'purchase.view'
  | 'purchase.post'
  | 'customers.view'
  | 'customers.edit'
  | 'suppliers.view'
  | 'suppliers.edit'
  | 'finance.view'
  | 'reports.view'
  | 'reports.export'
  | 'settings.edit'
  | 'users.manage'
  | 'devices.manage'
  | 'sync.view'
  | 'sync.resolve'
  | 'dashboard.view'
  | 'restaurant.order'
  | 'restaurant.kot.send'
  | 'restaurant.kot.void'
  | 'restaurant.table.transfer'
  | 'restaurant.bill.split'
  | 'kds.operate'
  | 'jobcard.view'
  | 'jobcard.edit'
  | 'approvals.act'
  | 'platform.tenants'
  | 'platform.devices'
  | 'platform.support';

export interface Role {
  code: RoleCode;
  name: string;
  permissions: Permission[];
  /** Max line/bill discount % allowed without approval. */
  discountLimitPct: number;
}

export interface User {
  id: ID;
  tenantId: ID;
  name: string;
  username: string;
  role: RoleCode;
  storeIds: ID[];
  pin: string; // prototype only — 4 digit
  phone?: string;
  active: boolean;
  offlineAuthValidUntil?: ISODateTime;
  avatarColor?: string;
}

export type ShiftStatus = 'open' | 'closed' | 'reopened';

export interface DenominationCount {
  denomination: Paise; // e.g. 50000 for ₹500
  count: number;
}

export interface Shift {
  id: ID;
  code: string; // SH-284
  tenantId: ID;
  storeId: ID;
  counterId: ID;
  deviceId: ID;
  openedBy: ID;
  closedBy?: ID;
  businessDate: ISODate;
  openedAt: ISODateTime;
  closedAt?: ISODateTime;
  openingDenominations: DenominationCount[];
  openingCash: Paise;
  closingDenominations?: DenominationCount[];
  closingCash?: Paise;
  expectedCash?: Paise;
  variance?: Paise;
  varianceReason?: string;
  varianceApprovedBy?: ID;
  status: ShiftStatus;
}

// ───────────────────────── Catalog ─────────────────────────

export type Unit = 'pcs' | 'kg' | 'g' | 'l' | 'ml' | 'box' | 'pack' | 'm' | 'bag' | 'strip';

export interface Category {
  id: ID;
  tenantId: ID;
  name: string;
  parentId?: ID;
  color?: string;
  sortOrder: number;
}

export interface Brand {
  id: ID;
  tenantId: ID;
  name: string;
}

export interface TaxRate {
  id: ID;
  name: string; // GST 5%
  ratePct: number; // 5 → split CGST 2.5 + SGST 2.5 intra-state; IGST 5 inter-state
  cessPct?: number;
}

export interface Batch {
  id: ID;
  productId: ID;
  code: string; // B42
  mfgDate?: ISODate;
  expiryDate: ISODate;
  mrpPaise: Paise;
  costPaise: Paise;
}

export interface UomConversion {
  unit: Unit;
  factor: number; // how many base units
  pricePaise: Paise;
  barcode?: string;
}

export interface Product {
  id: ID;
  tenantId: ID;
  sku: string;
  barcode: string;
  name: string;
  localName?: string;
  categoryId: ID;
  brandId?: ID;
  hsn: string;
  taxRateId: ID;
  /** Price on which tax is applied as inclusive (Indian retail norm). */
  taxInclusive: boolean;
  mrpPaise: Paise;
  salePaise: Paise;
  wholesalePaise?: Paise;
  costPaise: Paise;
  unit: Unit;
  decimalQty: boolean;
  active: boolean;
  imageUrl?: string;
  rack?: string;
  reorderLevel: number;
  // vertical attributes
  batchTracked?: boolean;
  weighted?: boolean;
  plu?: string;
  styleCode?: string;
  variantAttrs?: { size?: string; color?: string; season?: string };
  parentStyleId?: ID;
  serialTracked?: boolean;
  warrantyMonths?: number;
  manufacturer?: string;
  molecule?: string;
  schedule?: 'H' | 'H1' | 'X' | 'OTC';
  prescriptionRequired?: boolean;
  uomConversions?: UomConversion[];
  model?: string;
  /** Service / labour item (SAC) — priced and taxed like a product but never stocked. */
  isService?: boolean;
}

export interface SerialNumber {
  id: ID;
  productId: ID;
  serial: string; // IMEI etc
  status: 'in-stock' | 'sold' | 'returned';
  saleId?: ID;
}

export interface PriceGroup {
  id: ID;
  name: string;
  discountPct: number;
}

// ───────────────────────── Parties ─────────────────────────

export interface Customer {
  id: ID;
  tenantId: ID;
  name: string;
  phone: string;
  email?: string;
  gstin?: string;
  stateCode?: string;
  priceGroupId?: ID;
  creditLimitPaise: Paise;
  creditDays: number;
  outstandingPaise: Paise;
  loyaltyPoints: number;
  tier?: 'Silver' | 'Gold' | 'Platinum';
  createdAt: ISODateTime;
  active: boolean;
}

export interface Supplier {
  id: ID;
  tenantId: ID;
  name: string;
  phone: string;
  gstin?: string;
  stateCode: string;
  city: string;
  payableDays: number;
  outstandingPaise: Paise;
  licenceNo?: string;
  licenceValidUntil?: ISODate;
  active: boolean;
}

// ───────────────────────── Transactions ─────────────────────────

export type TransactionStatus =
  | 'draft'
  | 'open'
  | 'posted'
  | 'partially-paid'
  | 'paid'
  | 'cancelled'
  | 'returned';

export type SyncState = 'local' | 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';

/** Identity carried by every POS-originated transaction (FR-COM-005). */
export interface OriginContext {
  tenantId: ID;
  storeId: ID;
  counterId: ID;
  deviceId: ID;
  userId: ID;
  shiftId: ID;
  businessDate: ISODate;
}

export interface CartLineInput {
  productId: ID;
  qty: number;
  /** Unit price override (manager approved) in paise. */
  unitPricePaise?: Paise;
  lineDiscountPct?: number;
  batchId?: ID;
  serials?: string[];
  unit?: Unit;
  note?: string;
}

export interface SaleLine {
  id: ID;
  saleId: ID;
  lineNo: number;
  productId: ID;
  name: string;
  barcode: string;
  hsn: string;
  batchId?: ID;
  batchCode?: string;
  expiryDate?: ISODate;
  serials?: string[];
  variantLabel?: string;
  unit: Unit;
  qty: number;
  mrpPaise: Paise;
  unitPricePaise: Paise;
  grossPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  taxRatePct: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  netPaise: Paise;
  returnedQty: number;
}

export type TenderMethod = 'cash' | 'upi' | 'card' | 'credit' | 'redemption';

export interface Tender {
  id: ID;
  saleId: ID;
  method: TenderMethod;
  amountPaise: Paise;
  /** Cash tendered (for change calc). */
  receivedPaise?: Paise;
  changePaise?: Paise;
  reference?: string;
  /** Manual card/UPI reference recorded offline vs provider confirmed (FR-OFF-012). */
  confirmation: 'manual' | 'provider' | 'n/a';
}

export interface TaxSummaryRow {
  ratePct: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export interface Sale extends OriginContext {
  id: ID; // machine transaction id
  documentNo: string; // human/legal invoice number INV-C02-001284
  kind: 'retail' | 'restaurant' | 'service';
  status: TransactionStatus;
  customerId?: ID;
  customerName?: string;
  lines: SaleLine[];
  tenders: Tender[];
  itemCount: number;
  grossPaise: Paise;
  lineDiscountPaise: Paise;
  billDiscountPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  savingsPaise: Paise;
  interState: boolean;
  taxSummary: TaxSummaryRow[];
  approvedBy?: ID;
  createdAt: ISODateTime;
  committedAt: ISODateTime;
  syncState: SyncState;
  syncedAt?: ISODateTime;
  printed: boolean;
  restaurantOrderId?: ID;
  jobCardId?: ID;
  loyaltyEarned?: number;
  loyaltyRedeemed?: number;
}

export interface SaleReturnLine {
  saleLineId: ID;
  productId: ID;
  name: string;
  qty: number;
  refundPaise: Paise;
  restockable: boolean;
  reason: string;
}

export interface SaleReturn extends OriginContext {
  id: ID;
  documentNo: string;
  originalSaleId?: ID;
  originalDocumentNo?: string;
  lines: SaleReturnLine[];
  refundPaise: Paise;
  refundMethod: TenderMethod;
  approvedBy?: ID;
  createdAt: ISODateTime;
  syncState: SyncState;
}

export interface HeldCart {
  id: ID;
  label: string;
  counterId: ID;
  userId: ID;
  customerId?: ID;
  lines: CartLineInput[];
  billDiscountPct: number;
  heldAt: ISODateTime;
}

export type StockMovementType =
  | 'opening'
  | 'purchase_in'
  | 'purchase_return'
  | 'sale_out'
  | 'sale_return_restock'
  | 'sale_return_damaged'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'transfer_in'
  | 'transfer_out'
  | 'repack_input'
  | 'repack_output'
  | 'restaurant_consumption';

/** Immutable stock ledger row (ADR-012, LLD §6). */
export interface StockMovement {
  id: ID;
  tenantId: ID;
  storeId: ID;
  productId: ID;
  batchId?: ID;
  type: StockMovementType;
  qty: number; // signed: + in, − out
  sourceType: 'sale' | 'return' | 'purchase' | 'adjustment' | 'transfer' | 'repack' | 'opening' | 'stocktake';
  sourceId: ID;
  sourceLineNo?: number;
  reason?: string;
  userId?: ID;
  deviceId?: ID;
  createdAt: ISODateTime;
}

export interface StockLevel {
  productId: ID;
  storeId: ID;
  batchId?: ID;
  onHand: number;
  reserved: number;
  damaged: number;
  inTransit: number;
}

export type CashMovementType =
  | 'opening'
  | 'cash_sale'
  | 'cash_refund'
  | 'cash_receipt'
  | 'petty_paid'
  | 'petty_received'
  | 'closing';

export interface CashMovement extends OriginContext {
  id: ID;
  type: CashMovementType;
  amountPaise: Paise; // signed
  reference?: string;
  note?: string;
  createdAt: ISODateTime;
}

export interface PurchaseLine {
  productId: ID;
  name: string;
  batchCode?: string;
  expiryDate?: ISODate;
  qty: number;
  freeQty: number;
  costPaise: Paise;
  mrpPaise: Paise;
  taxRatePct: number;
  discountPct: number;
  netPaise: Paise;
}

export interface Purchase {
  id: ID;
  tenantId: ID;
  storeId: ID;
  documentNo: string; // PUR-0042
  supplierId: ID;
  supplierInvoiceNo: string;
  invoiceDate: ISODate;
  lines: PurchaseLine[];
  subtotalPaise: Paise;
  taxPaise: Paise;
  discountPaise: Paise;
  totalPaise: Paise;
  paidPaise: Paise;
  status: 'draft' | 'posted' | 'cancelled';
  paymentStatus: 'unpaid' | 'partially-paid' | 'paid';
  createdBy: ID;
  createdAt: ISODateTime;
  postedAt?: ISODateTime;
}

export interface StockAdjustment {
  id: ID;
  tenantId: ID;
  storeId: ID;
  documentNo: string;
  productId: ID;
  batchId?: ID;
  qty: number; // signed
  reason: 'damage' | 'expiry' | 'theft' | 'count-correction' | 'sample' | 'other';
  note?: string;
  userId: ID;
  approvedBy?: ID;
  createdAt: ISODateTime;
}

export interface Payment {
  id: ID;
  tenantId: ID;
  partyType: 'customer' | 'supplier';
  partyId: ID;
  documentNo: string;
  amountPaise: Paise;
  method: TenderMethod;
  reference?: string;
  againstDocument?: string;
  createdAt: ISODateTime;
  userId: ID;
}

export interface LoyaltyEvent {
  id: ID;
  customerId: ID;
  saleId?: ID;
  points: number; // signed
  kind: 'earn' | 'redeem' | 'adjust' | 'expire';
  createdAt: ISODateTime;
}

// ───────────────────────── Audit / Approval / Sync ─────────────────────────

export interface AuditEvent {
  id: ID;
  tenantId: ID;
  storeId?: ID;
  counterId?: ID;
  deviceId?: ID;
  shiftId?: ID;
  actorId: ID;
  approvedBy?: ID;
  action: string; // 'sale.completed', 'override.discount', 'shift.opened', 'device.revoked'
  entity: string; // 'sale'
  entityId: ID;
  documentNo?: string;
  summary: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  category: 'business' | 'technical' | 'security';
  createdAt: ISODateTime;
}

export type ApprovalAction =
  | 'discount'
  | 'void'
  | 'return-no-invoice'
  | 'price-override'
  | 'negative-stock'
  | 'shift-reopen'
  | 'shift-variance'
  | 'credit-limit'
  | 'kot-void'
  | 'stock-adjustment';

export interface ApprovalRequest {
  id: ID;
  tenantId: ID;
  storeId: ID;
  counterId?: ID;
  action: ApprovalAction;
  requestedBy: ID;
  summary: string;
  detail: string;
  amountPaise?: Paise;
  requestedValue?: number;
  allowedValue?: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decidedBy?: ID;
  decidedAt?: ISODateTime;
  reason?: string;
  createdAt: ISODateTime;
}

export type SyncOutboxStatus = 'pending' | 'sending' | 'acknowledged' | 'retry' | 'quarantined';

/** Local transactional outbox row (SYNC_ARCHITECTURE §3). */
export interface SyncOutboxItem {
  id: ID;
  eventId: ID;
  eventType: string; // retail.sale.completed.v1
  aggregateType: string;
  aggregateId: ID;
  documentNo?: string;
  sequence: number;
  idempotencyKey: string;
  schemaVersion: number;
  createdAtOrigin: ISODateTime;
  status: SyncOutboxStatus;
  attempts: number;
  nextRetryAt?: ISODateTime;
  lastError?: string;
  acknowledgedAt?: ISODateTime;
  deviceId: ID;
  storeId: ID;
  payloadSummary: string;
  bytes: number;
  /** Target collection + entity snapshot applied by the (simulated) cloud on acceptance. */
  collection: string;
  payload: unknown;
}

/** Cloud → device master/config change (pull stream, SYNC §6). */
export interface ChangeFeedEntry {
  id: ID;
  seq: number;
  tenantId: ID;
  collection: string;
  op: 'put' | 'delete';
  entityId: ID;
  payload?: unknown;
  summary: string;
  createdAt: ISODateTime;
}

export interface SyncConflict {
  id: ID;
  tenantId: ID;
  deviceId: ID;
  storeId: ID;
  entity: string;
  entityId: ID;
  documentNo?: string;
  reasonCode: string; // SYNC_SCHEMA_UNSUPPORTED, STOCK_NEGATIVE_POLICY, PRICE_VERSION_STALE
  reason: string;
  state: 'open' | 'resolved' | 'ignored';
  resolution?: string;
  resolvedBy?: ID;
  createdAt: ISODateTime;
}

export type ConnectivityState = 'online' | 'offline' | 'syncing' | 'attention';
export type EdgeState = 'connected' | 'unavailable' | 'not-configured';

export interface SyncStatusSnapshot {
  connectivity: ConnectivityState;
  cloudReachable: boolean;
  edge: EdgeState;
  pending: number;
  failed: number;
  quarantined: number;
  lastSuccessAt?: ISODateTime;
  oldestPendingAt?: ISODateTime;
}

// ───────────────────────── Restaurant ─────────────────────────

export interface ModifierOption {
  id: ID;
  name: string;
  pricePaise: Paise;
}

export interface ModifierGroup {
  id: ID;
  name: string; // Size, Spice, Add-ons
  required: boolean;
  min: number;
  max: number; // 1 = radio
  options: ModifierOption[];
}

export type FoodType = 'veg' | 'non-veg' | 'egg';

export interface MenuItem {
  id: ID;
  tenantId: ID;
  categoryId: ID;
  name: string;
  description?: string;
  pricePaise: Paise;
  taxRateId: ID;
  foodType: FoodType;
  stationId: ID;
  modifierGroupIds: ID[];
  imageUrl?: string;
  available: boolean;
  /** Time-based availability e.g. breakfast only. */
  availableFrom?: string;
  availableTo?: string;
  prepMinutes: number;
  popular?: boolean;
}

export interface KitchenStation {
  id: ID;
  storeId: ID;
  name: string; // Main Kitchen, Tandoor, Bar
}

export interface Floor {
  id: ID;
  storeId: ID;
  name: string;
  sortOrder: number;
}

export type TableStatus =
  | 'available'
  | 'occupied'
  | 'ordered'
  | 'preparing'
  | 'ready'
  | 'bill-requested'
  | 'payment-pending'
  | 'reserved'
  | 'cleaning';

export interface DiningTable {
  id: ID;
  floorId: ID;
  code: string; // A01
  seats: number;
  shape: 'square' | 'round' | 'rect';
  status: TableStatus;
  currentOrderId?: ID;
  /** Grid placement for floor map */
  x: number;
  y: number;
}

export type OrderType = 'dine-in' | 'takeaway' | 'delivery';
export type RestaurantOrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'served' | 'collected' | 'cancelled';
export type OrderLineState = 'unsent' | 'sent' | 'preparing' | 'ready' | 'served' | 'void';

export interface SelectedModifier {
  groupId: ID;
  groupName: string;
  optionId: ID;
  name: string;
  pricePaise: Paise;
}

export interface OrderLine {
  id: ID;
  menuItemId: ID;
  name: string;
  qty: number;
  unitPricePaise: Paise;
  modifiers: SelectedModifier[];
  note?: string;
  state: OrderLineState;
  kotId?: ID;
  kotNo?: number;
  stationId: ID;
  voidReason?: string;
  foodType: FoodType;
}

export interface RestaurantOrder {
  id: ID;
  tenantId: ID;
  storeId: ID;
  orderNo: string; // ORD-0231
  type: OrderType;
  tableId?: ID;
  tableCode?: string;
  token?: number;
  guests?: number;
  waiterId?: ID;
  customerName?: string;
  customerPhone?: string;
  lines: OrderLine[];
  status: RestaurantOrderStatus;
  kotCount: number;
  billDiscountPct: number;
  billRequested: boolean;
  openedAt: ISODateTime;
  closedAt?: ISODateTime;
  saleId?: ID;
  source: 'pos' | 'waiter' | 'qr';
}

export type KotStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'completed' | 'cancelled';

export interface KotItem {
  orderLineId: ID;
  name: string;
  qty: number;
  modifiers: string[];
  note?: string;
  void?: boolean;
}

export interface Kot {
  id: ID;
  orderId: ID;
  storeId: ID;
  kotNo: number; // per-order increment
  displayNo: string; // KOT #231
  stationId: ID;
  orderType: OrderType;
  tableCode?: string;
  token?: number;
  items: KotItem[];
  status: KotStatus;
  createdBy: ID;
  createdAt: ISODateTime;
  acceptedAt?: ISODateTime;
  readyAt?: ISODateTime;
  completedAt?: ISODateTime;
  isVoid?: boolean;
}

export interface WaiterCall {
  id: ID;
  storeId: ID;
  tableId: ID;
  tableCode: string;
  kind: 'call-waiter' | 'water' | 'bill';
  status: 'open' | 'acknowledged' | 'done';
  createdAt: ISODateTime;
}

// ───────────────────────── Platform admin ─────────────────────────

export interface EdgeNode {
  id: ID;
  tenantId: ID;
  storeId: ID;
  version: string;
  uptimeHours: number;
  connectedDevices: number;
  wanState: 'up' | 'down';
  cloudCheckpointAt: ISODateTime;
  queueCount: number;
  queueAgeSec: number;
  kdsLagMs: number;
  diskFreePct: number;
  lastBackupAt: ISODateTime;
  status: 'healthy' | 'degraded' | 'down';
}

export interface SupportTicket {
  id: ID;
  tenantId: ID;
  subject: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in-progress' | 'waiting' | 'resolved';
  createdAt: ISODateTime;
  assignee?: string;
}

// ───────────────────────── Session ─────────────────────────

/** Resolved runtime context for a signed-in operator on a device. */
export interface SessionContext {
  tenant: Tenant;
  store: Store;
  counter?: Counter;
  device: Device;
  user: User;
  role: Role;
  shift?: Shift;
  capabilities: Capability[];
  permissions: Permission[];
  authMode: 'online' | 'offline' | 'recovery';
}

// ───────────────────────── Service / repair job cards ─────────────────────────

export type JobCardStatus = 'received' | 'diagnosing' | 'awaiting-approval' | 'in-progress' | 'ready' | 'delivered' | 'cancelled';

export interface JobCardDevice {
  brand: string;
  model: string;
  /** IMEI for phones, serial number for other devices. */
  imeiOrSerial?: string;
  color?: string;
  accessories?: string[];
  /** Physical condition noted at intake (scratches, cracked back, etc.). */
  condition?: string;
  passcodeNote?: string;
}

export interface JobCardLine {
  id: ID;
  /** service = labour (no stock); part = spare part issued from stock. */
  kind: 'service' | 'part';
  productId: ID;
  name: string;
  qty: number;
  unitPricePaise: Paise;
  lineDiscountPct?: number;
  batchId?: ID;
  serials?: string[];
  technicianId?: ID;
  addedAt: ISODateTime;
}

export interface JobCardStatusEvent {
  status: JobCardStatus;
  at: ISODateTime;
  userId: ID;
  note?: string;
}

/** A repair job: device intake → diagnosis → services + parts → billed into a Sale on delivery. */
export interface JobCard {
  id: ID;
  tenantId: ID;
  storeId: ID;
  counterId: ID;
  jobNo: string; // JOB/26-27/TNR-C01/000012
  customerId?: ID;
  customerName: string;
  customerPhone: string;
  device: JobCardDevice;
  problem: string;
  diagnosis?: string;
  estimatePaise?: Paise;
  /** Advance collected at intake — informational, settled in the final bill tenders. */
  advancePaise?: Paise;
  technicianId?: ID;
  promisedAt?: ISODateTime;
  status: JobCardStatus;
  lines: JobCardLine[];
  statusHistory: JobCardStatusEvent[];
  openedBy: ID;
  openedAt: ISODateTime;
  updatedAt: ISODateTime;
  closedAt?: ISODateTime;
  saleId?: ID;
  saleDocumentNo?: string;
}
