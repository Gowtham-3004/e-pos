# Elixir POS — Design System (condensed working copy)

Source: *Elixir POS Ecosystem — UI/UX Design System v1.0 (07 Oct 2026)*. This is the condensed rule set every product in this repo must follow. Section numbers (§) refer to the source document.

## Character (§2)
**Fast · Calm · Operational · Trustworthy · Dense where useful · Minimal where speed matters.** A POS is not a marketing app. Optimise for transaction speed, operational certainty, low cognitive load, visible system state, failure recovery, keyboard + scanner + touch efficiency.

## Core UX laws (§2.2)
- **UX-01** Primary task dominates. On billing, billing owns the hierarchy.
- **UX-02** Never hide transaction state: store, counter, user, shift, bill no., connectivity, sync state, total, payment state.
- **UX-03** Local success and cloud sync are separate. A locally committed sale is a success. Never show "failed" because sync is pending.
- **UX-04** Destructive actions (void, cancel, delete, refund, stock adjustment, shift correction, override) need deliberate interaction.
- **UX-05** Frequent actions = shortest path (scan, add, qty, pay, send KOT, open table, print).
- **UX-06** Exceptional actions may be slower (config, masters).
- **UX-07** Status is never colour alone: **colour + icon + text** (use `StatusBadge` with metas from `@elixir/domain` status.ts).

## Visual direction (§4)
Light cool-gray canvas, white cards, **deep navy primary actions**, thin neutral borders, restrained shadows, compact rounded cards (8–12px), clear sidebar, category/filter pills, persistent order summary, minimal decorative colour, green/red operational accents. Avoid: gradients, glassmorphism, everything-pill, card-heavy everything, decorative charts.

Tokens live in `packages/tokens` and are exposed as CSS variables (`--surface-*`, `--text-*`, `--border-*`, `--action-*`, `--status-*`, `--sync-*`, `--space-*`, `--radius-*`, `--fs-*`). **Never hard-code raw colours in components** — use the variables.

Type: Inter. 12/16 meta · 13/18 compact POS · 14/20 body · 16/22 card titles · 18/24 panel heads · 20–24 page titles · 28–36 totals/KPIs. **Tabular numerals** (`.num`) for money, qty, bill numbers, timers.
Spacing base 4px; POS screens 8–16px, back office 16–24px. Radius 6/8/12/16. Pills only for filters, categories, status, compact selectors, capabilities.
Icons: lucide (outline, ~1.75 stroke). Never icon-only for uncommon/destructive actions without a label/tooltip (`IconButton` requires `label`).

## Shell & navigation (§9–10)
Desktop: sidebar (220–240px; compact 64–72px) + context header + workspace. Header carries context, not decoration: store, counter/device, shift, business date, sync state, user.
**Effective navigation = Family + Vertical + Plan + Add-ons + Permissions + Device mode.** Use `composeNav()` from `@elixir/domain`. Unavailable modules are **removed**, never shown disabled.

## Operational screens (§11–29)
- Primary operational action always visible without scrolling.
- **Restaurant POS** (§12): sidebar ~14% · menu workspace ~60% · order panel ~26%. Sticky horizontal category chips with counts; search always available. Menu card: image/placeholder, name, price, availability; when already in order the CTA becomes `− 2 +`. States: available, selected, in-order, sold out, unavailable by time, variant/modifier required.
- Order panel rows: item, qty, variant, modifiers, note, price, edit, remove, KOT state. Summary: Subtotal, Discount, Tax, **Total** (strongest). Context: Dine-in/Takeaway/Delivery, table/token, guests, waiter, order no., elapsed, KOT state.
- Table states: Available, Occupied, Ordered, Preparing, Ready, Bill Requested, Payment Pending, Reserved, Cleaning — never colour alone.
- **KOT** (§17): Send KOT is a distinct transition (Unsaved → Sent · KOT #n). Additional items produce a new KOT increment; never rewrite sent history. Void: select → reason → manager approval if required → void KOT event.
- **KDS** (§18): NEW / PREPARING / READY columns; large text, high contrast, big targets, ticket age timer, station filter, urgency escalation, modifiers/notes prominent; no back-office controls.
- **Waiter** (§19): mobile-first; Tables | Orders | Calls | Profile; Table → Category → Item → Modifier → Qty → Add → Review → Send KOT; thumb-reachable bottom actions.
- **Retail POS** (§21–22): not image-grid-first. **Scan → cart → payment.** Top bar: customer, mode, search/barcode, shift, sync. Billing grid: Barcode | Product | Batch | Unit | Qty | Rate | Disc | Tax | Net | Action (columns adapt to capabilities). Right: bill summary + **PROCESS ORDER**. Scan adds directly; Enter advances; +/- qty; F-keys for pay/hold/resume; focus returns to the scan input after every add. *The cashier should not need the mouse during barcode billing.*
- **Search** (§23): barcode, name, code, local name, category, vertical attributes (pharmacy: batch/expiry/rack/stock; fashion: colour·size·SKU).
- **Payment** (§24): focused mode — amount due always visible; Cash/UPI/Card/Credit/Split; keypad on touch; split shows remaining; prevent duplicate submit; after local commit immediately show success; sync independent.
- **Success** (§25): `✓ Sale completed · Invoice INV-… · ₹… · Printed · Cloud sync: Pending` — pending is informational.
- **Offline** (§26): header pill `● Online / ● Offline / ● Syncing 12 / ● Attention required` (`SyncIndicator`). No disruptive banner for ordinary connectivity loss; banner only when it changes what the operator can do. Allowed actions stay visually normal. Cloud-only actions explain why unavailable ("Requires cloud connection"). Never disable the whole app. Sync Center for managers: last sync, pending, failed, device, Store Edge, cloud, View queue, Diagnostics. Cashiers never manage queues.
- **Multi-counter** (§27): show Store · Counter · Device · User · Shift. User switch never silently changes counter/device.
- **Shift** (§28): Day-In with denominations → opening total → Open Shift. Header `C02 · Arun · Shift Open 09:03`. Day-Out: expected vs counted, variance, tender breakdown → Close Shift; variance needs reason/approval by policy.
- **Manager override** (§29): never log the manager in. Transient approval dialog showing action, requested vs allowed, manager PIN → Approve once. Audit: cashier, approver, action, reason, time. (`ApprovalDialog`.)

## Back office (§30–41)
Page anatomy: Breadcrumb · Title + primary action · Filters/search · KPI summary where relevant · Data table · Pagination. Tables: sorting, filters, search, sticky header, horizontal overflow, empty/loading/error states; **numbers right-aligned**, text left, status as badges, actions not dominating. Filter bar + active filter chips + Clear all; filters survive pagination. Forms: grouped sections (Basic, Classification, Barcode, Tax & Pricing, Inventory, Batch/Expiry, Units, Vertical attributes), 2-col desktop / 1-col mobile. Validation: prevent → inline → explain corrective action (*"Selling price cannot exceed MRP ₹500.00."*) → preserve input → focus first invalid.
Dashboard answers *"What requires attention?"*: alerts → KPIs → trends → exceptions → drill-down. Reports: title · date range/store/filters · summary · table · Export Excel/CSV/Print. Inventory distinguishes On hand / Available / Reserved / Damaged / In transit (when enabled); batch drill-down. Purchase: document-entry layout; **Save Draft** visually different from **Post Purchase**; posted = read-only. **Posted transactions show `POSTED`, read-only, actions Print / Return / Cancel-Reversal / View Audit — never Edit.** Audit timeline: business vs technical events.

## Status vocabulary (§42) — use exactly these words
Transaction: Draft, Open, Posted, Partially Paid, Paid, Cancelled, Returned · Sync: Local, Pending, Syncing, Synced, Conflict, Failed · Device: Active, Offline, Revoked, Attention · Restaurant order: New, Accepted, Preparing, Ready, Served/Collected, Cancelled. (All in `@elixir/domain` status maps.)

## Feedback (§43–48)
Toast: item added, saved, print initiated, non-critical sync info. Inline alert: validation, stale config, limited offline. Banner: significant operational condition. Modal: only when user must decide. Avoid modal-after-modal.
Confirm/authorise: cancel posted invoice, void KOT, close shift, delete referenced master, stock decrease, refund, destructive reset, device revoke. No confirm for reversible actions.
Empty states explain what to do (`No products yet — Add your first product or import… [Add Product] [Bulk Import]`); operational empties are quiet (`No active kitchen tickets.`).
Loading: POS renders cached data immediately, localized progress only, **never a full-screen spinner for background sync**. Back office: skeletons preserving table structure.
Errors answer: What happened? Was my transaction saved? What can I do? (`Sale completed locally. Receipt printing failed. Invoice INV-001284 [Retry Print]`).
Recovery screen on restart: `Restoring local workspace… ✓ Local database ✓ Last committed invoice ✓ Pending sync queue ✓ Printer configuration`.

## Responsive, touch, keyboard, a11y (§49–56)
Desktop POS min 1366×768, no page scroll during checkout. Tablet: collapsible nav, larger targets, order summary as drawer, 2–3 menu columns. Mobile = waiter/owner/approvals only; never shrink the cashier grid onto a phone. Breakpoints: <640 mobile, 640–1023 tablet, 1024–1279 compact desktop, 1280–1599 desktop, ≥1600 wide.
Touch targets ≥44px; POS high-frequency ≥48px. Keyboard: visible focus, no traps, shortcut overlay, deterministic focus order, scanner input must not trigger global shortcuts, shortcuts respect permissions. Default F-keys: F1 Print · F2 Sales · F3 Return · F4 Hold · F5 Reset · F6 Resume · F7 Process Order (+ document others in overlay).
WCAG 2.2 AA; semantic labels; reduced motion; error association. Localisation: allow 30–40% label growth; INR via `@elixir/format` (`₹1,25,450.00`); dates `07/10/2026`, operational `07 Oct · 14:32`, timers `18:42`.

## Modal vs drawer vs page (§62)
Modal: manager PIN, small confirm, compact irreversible decision. Drawer/sheet: tablet cart, filters, product details, modifiers, audit preview. Page: master creation, complex purchase, reports, device config.

## Motion (§69)
Functional, 120–220ms: drawers, cart-item confirmation, state transitions, toasts. No decorative page animation.

## Every screen must design (§84)
Loading · Ready · Empty · Partial · Offline · Permission restricted · Validation error · Recoverable error · Fatal/local data error · Sync pending · Sync conflict (where applicable) · Success.

## Anti-patterns (§79)
Generic admin template called POS; card-heavy everything; images where data density matters; gradients/glassmorphism; hidden operational state; internet-required local navigation; raw technical sync errors to cashiers; colour-only status; critical checkout actions below the fold; modal after modal; editable posted transactions; separate visual systems per vertical; disabled menu items for unpurchased capabilities; mobile POS by shrinking desktop.
