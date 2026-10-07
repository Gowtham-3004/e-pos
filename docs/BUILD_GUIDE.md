# Elixir POS Prototype — Build Guide

Offline-first frontend prototype of the Elixir POS ecosystem. **No backend.** All data is deterministic dummy data from `@elixir/mock-data`, persisted in the browser (IndexedDB) through `@elixir/local-store`.

## Products
| App | Path | Dev port | Served at (launcher) | Notes |
|---|---|---|---|---|
| Launcher | `apps/launcher` | 5170 | `http://localhost:5170/` | Proxies all web apps onto one origin |
| Elixir POS (Web + Desktop) | `apps/pos` (+ `src-tauri`) | 5173 | `/pos/` | Uses `device` + `cloud` DBs, runs the sync engine |
| Elixir Back Office | `apps/backoffice` | 5174 | `/backoffice/` | Reads/writes the simulated `cloud` DB |
| Elixir Platform Admin | `apps/platform-admin` | 5175 | `/admin/` | Reads/writes the simulated `cloud` DB |
| Elixir POS Mobile | `apps/mobile` | 8081 (Expo) | — | Expo React Native; own local store (memory/AsyncStorage) |

Run everything web: `pnpm dev` then open http://localhost:5170. Always test web apps **through port 5170** (same origin = shared cloud DB + live cross-app updates via BroadcastChannel).

Screenshot/verify: `node scripts/shot.mjs <url> <out.png> [w] [h] [waitMs] [--click "text"] [--type "abc"] [--key Enter]` — prints console errors.

## Architecture of the prototype
```
POS tab ──commands──▶ device DB (IndexedDB "elixir-device")   ← SQLite in production (ADR-004)
   │                       │ sync_outbox rows written in the same commit (ADR-005)
   └── SyncEngine ─push──▶ cloud DB (IndexedDB "elixir-cloud") ← PostgreSQL in production
                  ◀─pull── change feed (master/price changes from Back Office)
Back Office / Platform Admin ──read/write──▶ cloud DB
```
- Simulated network lives in POS device meta: `engine.setNetwork({ wan: 'offline' | 'online', cloud: 'up'|'down', edge })`.
- While offline the POS keeps selling; outbox queues; Back Office does not see those sales until the POS reconnects and pushes.
- Back Office edits of masters (product price, etc.) must use `publishMasterChange(cloud, …)` so devices pull them.

## Shared packages (import, don't fork)
### `@elixir/contracts` — all domain types
Money is **integer paise** everywhere. Key types: `Tenant, Store, Counter, Device, User, Role, Shift, Product, Batch, SerialNumber, Customer, Supplier, Sale, SaleLine, Tender, SaleReturn, HeldCart, StockMovement, CashMovement, Purchase, StockAdjustment, Payment, AuditEvent, ApprovalRequest, SyncOutboxItem, SyncConflict, SyncStatusSnapshot, MenuItem, ModifierGroup, KitchenStation, Floor, DiningTable, RestaurantOrder, OrderLine, Kot, WaiterCall, JobCard, JobCardLine, JobCardStatus, EdgeNode, SupportTicket, SessionContext, Capability, Permission`.

### `@elixir/domain` — pure logic
- Tax/cart: `computeGst`, `computeCart(lines, billDiscountPct, ctx)` (MRP cap, bill-discount allocation, GST split, rupee round-off, savings), `priceLine`, `PricingError`, `discountNeedsApproval`, `changeDue`, `quickCashOptions`.
- Stock: `projectStock`, `onHandByProduct`, `stockHealth`, `expiryHealth`, `pickBatchFefo`, `MOVEMENT_LABEL`.
- Shift: `DENOMINATIONS`, `emptyDenominations`, `denominationTotal`, `expectedCash`, `variance`, `varianceNeedsApproval`, `cashBreakdown`.
- Capabilities/RBAC: `resolveCapabilities(tenant)`, `PLANS`, `ADD_ONS`, `ROLES`, `roleByCode`, `authorize`, `can`, `VERTICAL_LABEL`, `CAPABILITY_LABEL`, `familyOf`.
- Navigation: `composeNav(items, { capabilities, permissions, family })`, `POS_NAV`, `BACKOFFICE_NAV`, `PLATFORM_NAV` (icons are lucide names).
- Restaurant: `orderTotals`, `orderLineTotal`, `validateModifiers`, `menuItemUnitPrice`, `buildKots`, `tableStatusFromOrder`, `kotUrgency`.
- Job cards (repair): `JOB_CARD_FLOW`, `canTransition(from, to)`, `isJobCardOpen`, `jobCardToCartLines(card)`, `JOB_CARD_STATUS_LABEL`. `Product.isService` marks labour items (SAC, never stocked).
- Status vocabulary (label + tone + icon): `JOB_CARD_STATUS, TRANSACTION_STATUS, SYNC_STATE, OUTBOX_STATUS, CONNECTIVITY, DEVICE_STATUS, ORDER_STATUS, KOT_STATUS, TABLE_STATUS, SUBSCRIPTION_STATUS`.
- Ids: `uid(prefix)`, `documentNumber(kind, counterCode, seq)` (kinds INV, RET, PUR, ADJ, PAY, ORD, KOT, JOB).

### `@elixir/format`
`money(paise)`, `moneyCompact`, `rupeesToPaise`, `number`, `qty`, `pct`, `date`, `dateLong`, `time`, `dateTime`, `monthYear`, `elapsed`, `elapsedMinutes`, `relative`, `isoDate`, `daysUntil`, `initials`. Never concatenate `₹` yourself.

### `@elixir/mock-data`
`buildSeed()`, `TENANT_IDS { abc, trendz, wellness, volt, spice }`, `DEMO_LOGINS`, `PLATFORM_LOGINS`. Demo tenants: ABC Supermarket (grocery, pro, 2 stores), Trendz Fashion (fashion), Wellness Pharmacy (pharmacy, business, Store Edge), Volt Electronics (electronics, starter), Spice Route Kitchen (restaurant, business, Store Edge). Plus 9 platform-only tenants. PINs: owner 1111, manager 2222, cashier 1234 (Arun) / 4321 (Meena), accountant 7777, inventory 8888, waiters 5555/5556/5557, kitchen 6666, platform admin 9999, support 9998.
ID conventions: store `s-<tenantId>-<n>`, counter `c-<storeId>-<n>`, device `d-<counterId>`, user `u-<tenantId>-<key>` (keys: owner, mgr, arun, meena, acct, inv, ravi, deepa, john, chef).

### `@elixir/local-store`
- `LocalDatabase`: `get(c, id)`, `all(c)` (stable cached array), `where(c, pred)`, `meta(key)`, `setMeta`, `put(c, ...entities)`, `remove`, `commit(ops, meta)` (atomic, durable-first), `subscribe`, `exclusive(fn)`.
- Collections: `tenants companies stores counters devices users categories brands taxRates priceGroups products batches serials customers suppliers sales returns heldCarts stockMovements purchases adjustments payments loyaltyEvents shifts cashMovements menuItems modifierGroups stations floors tables orders kots waiterCalls auditEvents approvals syncConflicts outbox edgeNodes tickets jobCards changefeed inbox`.
- Commands (device DB, atomic, write audit + outbox): `completeSale`, `markPrinted`, `holdCart`, `deleteHeldCart`, `commitReturn`, `openShift`, `closeShift`, `recordCashMovement`, `createApproval`, `decideApproval`, `createOrder`, `saveOrder`, `sendKot`, `setKotStatus`, `voidOrderLine`, `requestBill`, `transferTable`, `setTableStatus`, `settleOrder`, `resolveWaiterCall`, `openJobCard`, `updateJobCard`, `addJobCardLine`, `removeJobCardLine`, `setJobCardStatus`, `billJobCard` (one atomic invoice: services + parts; only parts write `sale_out`; card → delivered). Errors: `LocalCommitError` (`code`: VALIDATION | STORAGE | TENDER_MISMATCH | NO_SHIFT | NOT_FOUND). Demo fault injection: `faults.failNextCommit`, `faults.failNextPrint`.
- Sync: `new SyncEngine(device, cloud, { deviceId, tenantId })` → `start()`, `stop()`, `status()`, `subscribe(cb)`, `setNetwork(patch)`, `network`, `syncNow()`, `outbox()`, `injectConflict(storeId)`, `resolveQuarantined(id, 'retry'|'dismiss')`. `publishMasterChange(cloud, { tenantId, collection, entity, summary })`.
- Selectors: `stockIndex`, `onHand(db, storeId, productId, batchId?)`, `onHandAllStores`, `tenantProducts`, `productByBarcode`, `searchProducts(db, tenantId, q)`, `batchesFor`, `lowStock`, `expiringBatches`, `salesFor`, `salesByDay`, `jobCardsFor(db, storeId, open?)`, `jobCardTotals(db, card)` (same pricing as `billJobCard`), `tenantCapabilities`, `resolveSession(db, { deviceId, userId })`, `derived(db, key, deps, compute)` for memoised projections.
- React (`@elixir/local-store/react`): `useLive(db, collections, compute, deps)`, `useCollection`, `useEntity`, `useMeta`, `useSyncStatus(engine)`, `useNow(ms)`.

### `@elixir/app-kit`
`<ElixirDataProvider product use={['device','cloud']}>` (boot/restore screen), `useElixirData() → { device, cloud }`, `resetDemoData()`.

### `@elixir/ui` (web) — import `@elixir/ui/styles.css` once (already in each `main.tsx`)
Primitives: `Icon(name)`, `Button(variant primary|secondary|ghost|danger|danger-outline|success|subtle, size sm|md|lg|xl, icon, iconRight, loading, block, shortcut)`, `IconButton(icon,label)`, `Kbd`, `Badge(tone, icon, dot)`, `StatusBadge(meta)`, `Card/CardHeader/CardBody/CardFooter`, `Avatar`, `Spinner`, `Skeleton`, `Divider`, `Progress`, `FoodMark`, `cx`.
Forms: `Field`, `TextField(label,hint,error,icon,prefix,suffix,size)`, `SearchInput`, `BarcodeInput(onScan)`, `Textarea`, `Select(options)`, `Checkbox`, `Radio`, `Switch`, `QuantityStepper`, `PinInput`, `NumericKeypad`.
Feedback: `InlineAlert`, `Banner`, `EmptyState`, `Modal`, `Drawer`, `Sheet`, `ConfirmDialog(requireReason)`, `ApprovalDialog(verify)`, `ToastProvider/useToast`, `Menu/MenuItem/MenuLabel/MenuSeparator`.
Navigation: `Tabs`, `Segmented`, `CategoryChips`, `Breadcrumb`, `FilterBar`, `FilterChip`.
Data: `DataTable(columns,rows,rowKey,onRowClick,loading,empty,pageSize)`, `Pagination`, `KpiCard`, `DescriptionList`, `Timeline`, `Money`, `TotalRow`.
Charts (single series, one hue, hover tooltip, sr-only table): `BarChart`, `LineChart`, `BarList`, `Sparkline`. Prefer BarList over pies; never dual axis.
Shell: `AppShell(product, nav, activePath, onNavigate, header, banner, sidebarFooter, badges)`, `Page`, `PageHeader`, `ContextStrip`, `SyncIndicator(status)`, `ElixirLogo`, `ElixirMark`, `applyTheme`.
Utility CSS classes: `ex-stack`, `ex-row`, `ex-spacer`, `ex-grid`, `num`, `muted`, `secondary`, `ex-truncate`, `ex-scroll`, `sr-only`, `ex-total-row`.

## Rules for product teams (subagents)
1. **Do not edit anything under `packages/`** — other teams build in parallel on them. If you need a helper, write it in your app (`src/lib/…`). List any shared-package improvement you'd want in your final report.
2. Follow `docs/DESIGN_SYSTEM.md`. Use semantic CSS variables only; app-specific CSS goes in your app (`src/styles/*.css` or CSS modules).
3. Use `react-router-dom` (`createBrowserRouter`/`BrowserRouter` with `basename` = the app base path, e.g. `/pos`).
4. Keep TypeScript strict and clean: `pnpm --filter <app> typecheck` must pass.
5. Every screen designs loading/empty/offline/permission/error/success states.
6. Verify visually with `scripts/shot.mjs` through `http://localhost:5170/<base>/` and fix console errors. Dev servers are already running via `pnpm dev` (check with `curl -s -o /dev/null -w '%{http_code}' http://localhost:5170/pos/`); do not start a second copy on the same ports.
