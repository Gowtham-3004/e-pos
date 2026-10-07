# Elixir POS Ecosystem — Prototype

An offline-first frontend prototype of the Elixir POS ecosystem, built from the BRD/PRD/FRD v2.0, the architecture set (HLD, LLD, Sync, Store Edge, ADRs) and the UI/UX Design System v1.0.

**There is no backend.** Every product runs on deterministic dummy data held in the browser (IndexedDB). A simulated "Elixir Cloud" database and a sync engine stand in for the server, so you can see the offline-first behaviour end to end.

| Product | Platform | Location |
|---|---|---|
| Elixir POS | Web + Desktop (Tauri 2) | `apps/pos` |
| Elixir Back Office | Web | `apps/backoffice` |
| Elixir POS Mobile | Android + iOS (Expo) | `apps/mobile` |
| Elixir Platform Admin | Web | `apps/platform-admin` |

## Quick start

```bash
pnpm install
pnpm dev            # launcher + POS + Back Office + Platform Admin
open http://localhost:5170
```

Always open the web apps through the launcher on port **5170**. It serves them all from one origin, so they share the simulated cloud database and update each other live.

- Desktop POS: `pnpm --filter @elixir/pos desktop` (needs Rust; the dev servers must be running)
- Mobile: `pnpm --filter @elixir/mobile start` (then Expo Go, or press `w` for web)
- Tests: `pnpm test` · Typecheck: `pnpm typecheck`
- Cross-app offline check (with `pnpm dev` running): `pnpm e2e /tmp`. It sells offline on the POS, confirms Back Office can't see the sale, reconnects, and confirms it appears.

## Demo sign-ins

| Business | Vertical · Plan | Users (PIN) |
|---|---|---|
| ABC Supermarket | Grocery · Pro + Multi-store | Arun 1234, Meena 4321 (cashiers) · Priya 2222 (manager) · Ramesh 1111 (owner) · Suresh 7777 (accountant) · Vignesh 8888 (inventory) |
| Trendz Fashion | Fashion · Pro + Loyalty | same PIN pattern |
| Wellness Pharmacy | Pharmacy · Business (Store Edge) | same PIN pattern |
| Volt Electronics | Electronics · Starter · Repair desk (job cards) | same PIN pattern |
| Spice Route Kitchen | Restaurant · Business + QR | Arun 1234 (cashier) · Ravi 5555 / Deepa 5556 / John 5557 (waiters) · Chef Murugan 6666 (kitchen) · Priya 2222 · Karthik 1111 |
| Platform | — | Nisha 9999 (platform admin) · Rahul 9998 (support) |

## Try the offline-first flow

1. Open **POS**, activate the device as ABC Supermarket → Anna Nagar → C02, then sign in as Arun (1234) and open a shift.
2. In the header, switch the network to **Offline**. Scan or search items and take payment. The sale completes and shows `Cloud sync: Pending`.
3. Open **Back Office** in another tab. The sale is not there yet.
4. Switch POS back **Online**. The outbox drains, the sale shows `Synced`, and Back Office updates live.
5. Change a product price in Back Office. The POS pulls it on the next sync.

## Try a repair job card (services + parts)

1. Activate the POS as Volt Electronics → T. Nagar → C01 and sign in as Arun (1234). Open a shift.
2. Go to **Job Cards** and select **New job card**. Enter the customer, the device (brand, model, IMEI, accessories) and the reported problem.
3. Move the job through **Diagnosing** and **In Progress**. Add the labour charge under **Services** (you can quote any price) and add spare parts from stock. Serialised parts ask for a serial number.
4. Mark the job **Ready for Pickup**, then select **Bill & deliver**. This posts one GST invoice for the services and parts. Only the parts are deducted from stock, and the job card becomes **Delivered**.
5. In **Back Office**, open **Job Cards** to see every job, its timeline, and a link to its invoice.

## Known limits

- The mobile app keeps its own local and simulated-cloud databases. It does not share data with the web apps, and its kitchen status changes are simulated on the phone.
- Restaurant and approval commands don't write sync outbox rows yet; only retail sales, returns, shifts and cash movements sync from the POS.
- An equal bill split records one invoice with split tenders, not one invoice per guest.
- Wholesale price mode and multi-UOM are built but untested, because no demo business has those capabilities.
- Invoice numbering uses the counter-scoped series option from ADR-014, which is still pending compliance review.

## Repository layout

```
apps/
  launcher/         single-origin gateway (port 5170)
  pos/              Elixir POS (React + Vite) + src-tauri desktop shell
  backoffice/       Elixir Back Office
  platform-admin/   Elixir Platform Admin
  mobile/           Elixir POS Mobile (Expo)
packages/
  tokens/           design tokens (TS + CSS variables)
  contracts/        shared domain types (money in integer paise)
  domain/           pure logic: GST, cart/MRP cap, stock ledger, shifts, capabilities, navigation, KOT, status vocabulary
  format/           INR / date / timer formatting
  mock-data/        deterministic seed for 14 tenants
  local-store/      durable-first local DB, transactional commands + outbox, sync engine, selectors, React hooks
  ui/               web component library (shell, forms, tables, charts, approval, sync indicator…)
  app-kit/          data provider + "Restoring local workspace" boot screen
docs/
  DESIGN_SYSTEM.md  condensed design rules
  BUILD_GUIDE.md    package APIs and conventions
scripts/shot.mjs    headless screenshot + console check
```

## How the prototype maps to the architecture

| Production (architecture docs) | Prototype |
|---|---|
| SQLite on the POS terminal (ADR-004) | IndexedDB database `elixir-device` |
| PostgreSQL cloud (ADR-003) | IndexedDB database `elixir-cloud` |
| Transactional outbox and inbox (ADR-005) | `outbox` rows written in the same commit; cloud `inbox` dedupes by event id |
| Sync push and pull (SYNC §5–6) | `SyncEngine`: batching, backoff with jitter, quarantine, change-feed pull with checkpoint |
| Capability + RBAC dual authorization (ADR-008) | `resolveCapabilities` + role permissions → `composeNav` |
| Dual transaction identity (ADR-013) | uuid-style transaction id plus counter-scoped `INV/26-27/ANN-C02/001284` |
| Immutable movements (ADR-012) | stock is always Σ `stockMovements`; corrections are new documents |
