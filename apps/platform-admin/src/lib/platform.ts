import type { AddOnCode, Capability, Device, EdgeNode, PlanCode, SyncConflict, Tenant, Vertical } from '@elixir/contracts';
import {
  ADD_ONS,
  CAPABILITY_LABEL,
  CORE_RESTAURANT,
  CORE_RETAIL,
  PLANS,
  VERTICAL_CAPABILITIES,
  addOnByCode,
  familyOf,
  planByCode,
  resolveCapabilities,
} from '@elixir/domain';
import type { Tone } from '@elixir/domain';

export const LATEST_APP_VERSION = '1.4.0';
export const LATEST_EDGE_VERSION = '1.2.1';

export const capLabel = (c: Capability) => CAPABILITY_LABEL[c] ?? c;

/** Monthly subscription price in paise = plan + add-ons. */
export function monthlyPrice(t: Pick<Tenant, 'plan' | 'addOns'>): number {
  return planByCode(t.plan).monthlyPricePaise + t.addOns.reduce((s, a) => s + (addOnByCode(a)?.monthlyPricePaise ?? 0), 0);
}

/** Recurring revenue counts tenants that are billed (active + grace). Trials and suspended tenants are excluded. */
export const isBillable = (t: Tenant) => t.subscriptionStatus === 'active' || t.subscriptionStatus === 'grace';

export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function deviceOutdated(d: Device, t: Tenant | undefined): { app: boolean; config: boolean } {
  const latest = d.kind === 'store-edge' ? LATEST_EDGE_VERSION : LATEST_APP_VERSION;
  return {
    app: compareVersion(d.appVersion, latest) < 0,
    config: d.status !== 'pending-activation' && d.status !== 'revoked' && !!t && d.configVersion < t.configVersion,
  };
}

export const DEVICE_KIND_LABEL: Record<Device['kind'], string> = {
  'pos-desktop': 'POS Desktop',
  'pos-web': 'POS Web',
  kds: 'Kitchen Display',
  mobile: 'Mobile',
  'store-edge': 'Store Edge',
};

/** Deterministic activation code a device shows on its first-run screen (prototype). */
export function activationCode(deviceId: string): string {
  let h = 2166136261;
  for (let i = 0; i < deviceId.length; i++) h = Math.imul(h ^ deviceId.charCodeAt(i), 16777619);
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  let x = h >>> 0;
  for (let i = 0; i < 8; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += alphabet[(x >>> 16) % alphabet.length];
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

// ───────── Capability composition ─────────

export type CapSource = 'core' | 'vertical' | 'plan' | 'add-on' | 'override';
export const CAP_SOURCE_LABEL: Record<CapSource, string> = {
  core: 'Core',
  vertical: 'Vertical',
  plan: 'Plan',
  'add-on': 'Add-ons',
  override: 'Overrides',
};

export interface CapabilityBreakdown {
  effective: Capability[];
  bySource: Record<CapSource, Capability[]>;
  restricted: Capability[];
  suspended: boolean;
}

type TenantShape = Pick<Tenant, 'vertical' | 'plan' | 'addOns' | 'capabilityOverrides' | 'capabilityRestrictions' | 'subscriptionStatus'>;

/** Attribute each effective capability to the first layer that grants it (Core + Vertical + Plan + Add-ons + Overrides − Restrictions). */
export function capabilityBreakdown(t: TenantShape): CapabilityBreakdown {
  const effective = resolveCapabilities(t);
  const eff = new Set(effective);
  const seen = new Set<Capability>();
  const family = familyOf(t.vertical);
  const take = (caps: Capability[]) => {
    const out: Capability[] = [];
    caps.forEach((c) => {
      if (!seen.has(c) && eff.has(c)) {
        seen.add(c);
        out.push(c);
      }
    });
    return out;
  };
  const bySource: Record<CapSource, Capability[]> = {
    core: take(family === 'restaurant' ? CORE_RESTAURANT : CORE_RETAIL),
    vertical: take(VERTICAL_CAPABILITIES[t.vertical]),
    plan: take(planByCode(t.plan).capabilities),
    'add-on': take(t.addOns.flatMap((a) => addOnByCode(a)?.capabilities ?? [])),
    override: take(t.capabilityOverrides ?? []),
  };
  // Anything left over (e.g. suspended → reports.basic) is attributed to core.
  effective.forEach((c) => !seen.has(c) && bySource.core.push(c));
  return { effective, bySource, restricted: t.capabilityRestrictions ?? [], suspended: t.subscriptionStatus === 'suspended' };
}

export function capabilityDiff(before: TenantShape, after: TenantShape) {
  const a = new Set(resolveCapabilities(before));
  const b = new Set(resolveCapabilities(after));
  return { gained: [...b].filter((c) => !a.has(c)).sort(), lost: [...a].filter((c) => !b.has(c)).sort() };
}

/** Capabilities whose loss stops something operators rely on — losing these needs a reason. */
const DESTRUCTIVE: Capability[] = ['cloud-sync', 'cloud-backup', 'multi-counter', 'multi-store', 'store-edge', 'backoffice-web', 'pos.billing', 'restaurant.pos', 'device-management', 'mobile-app', 'restaurant.kds', 'restaurant.waiter'];
export const isDestructiveLoss = (lost: Capability[]) => lost.some((c) => DESTRUCTIVE.includes(c));

/** Every capability that is meaningful for a family (for override/restriction pickers and the plan matrix). */
export function capabilitiesForFamily(family: 'retail' | 'restaurant'): Capability[] {
  const all = new Set<Capability>([
    ...(family === 'restaurant' ? CORE_RESTAURANT : CORE_RETAIL),
    ...Object.entries(VERTICAL_CAPABILITIES)
      .filter(([v]) => familyOf(v as Vertical) === family)
      .flatMap(([, c]) => c),
    ...PLANS.flatMap((p) => p.capabilities),
    ...ADD_ONS.filter((a) => a.families.includes(family)).flatMap((a) => a.capabilities),
  ]);
  return [...all].filter((c) => (family === 'retail' ? !c.startsWith('restaurant.') : c !== 'pos.billing'));
}

export const addOnsFor = (family: 'retail' | 'restaurant') => ADD_ONS.filter((a) => a.families.includes(family));
export const planName = (p: PlanCode) => planByCode(p)?.name ?? p;
export const addOnName = (a: AddOnCode) => addOnByCode(a)?.name ?? a;

// ───────── Vertical descriptions (onboarding cards) ─────────

export const VERTICAL_INFO: Record<Vertical, { icon: string; description: string }> = {
  general: { icon: 'Store', description: 'Kirana, general and convenience stores with simple purchasing.' },
  grocery: { icon: 'ShoppingBasket', description: 'Supermarkets with weighed produce, scales, batches and promotions.' },
  fashion: { icon: 'Shirt', description: 'Apparel and footwear with size/colour variants and seasonal promotions.' },
  pharmacy: { icon: 'Pill', description: 'Chemists with batch & expiry control and prescription schedules.' },
  electronics: { icon: 'Smartphone', description: 'Serial/IMEI tracked devices with warranty registration.' },
  hardware: { icon: 'Wrench', description: 'Multi-unit items, quotations and credit customers.' },
  wholesale: { icon: 'Truck', description: 'Distributors with price groups, credit, UOM and transport.' },
  restaurant: { icon: 'UtensilsCrossed', description: 'Dine-in, takeaway and delivery with tables, KOT and modifiers.' },
};

// ───────── Store Edge ─────────

export const EDGE_STATUS: Record<EdgeNode['status'], { label: string; tone: Tone; icon: string }> = {
  healthy: { label: 'Healthy', tone: 'success', icon: 'CircleCheck' },
  degraded: { label: 'Degraded', tone: 'warning', icon: 'TriangleAlert' },
  down: { label: 'Down', tone: 'danger', icon: 'CircleX' },
};

export const TICKET_PRIORITY: Record<'low' | 'medium' | 'high' | 'urgent', { label: string; tone: Tone; icon: string }> = {
  low: { label: 'Low', tone: 'neutral', icon: 'ArrowDown' },
  medium: { label: 'Medium', tone: 'info', icon: 'Minus' },
  high: { label: 'High', tone: 'warning', icon: 'ArrowUp' },
  urgent: { label: 'Urgent', tone: 'danger', icon: 'Siren' },
};

export const TICKET_STATUS: Record<'open' | 'in-progress' | 'waiting' | 'resolved', { label: string; tone: Tone; icon: string }> = {
  open: { label: 'Open', tone: 'info', icon: 'CircleDot' },
  'in-progress': { label: 'In progress', tone: 'warning', icon: 'Loader' },
  waiting: { label: 'Waiting on tenant', tone: 'neutral', icon: 'Hourglass' },
  resolved: { label: 'Resolved', tone: 'success', icon: 'CircleCheck' },
};

export const CONFLICT_STATE: Record<SyncConflict['state'], { label: string; tone: Tone; icon: string }> = {
  open: { label: 'Conflict', tone: 'danger', icon: 'GitMerge' },
  resolved: { label: 'Resolved', tone: 'success', icon: 'CircleCheck' },
  ignored: { label: 'Ignored', tone: 'neutral', icon: 'EyeOff' },
};

export const AUDIT_CATEGORY: Record<'security' | 'business' | 'technical', { label: string; tone: Tone; icon: string }> = {
  security: { label: 'Security', tone: 'danger', icon: 'ShieldAlert' },
  business: { label: 'Business', tone: 'info', icon: 'Briefcase' },
  technical: { label: 'Technical', tone: 'neutral', icon: 'Cpu' },
};

/** GSTIN: 2-digit state + 10-char PAN + entity + Z + checksum. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const STATE_CODES: Array<{ value: string; label: string }> = [
  { value: '33', label: '33 · Tamil Nadu' },
  { value: '29', label: '29 · Karnataka' },
  { value: '32', label: '32 · Kerala' },
  { value: '34', label: '34 · Puducherry' },
  { value: '36', label: '36 · Telangana' },
  { value: '37', label: '37 · Andhra Pradesh' },
  { value: '27', label: '27 · Maharashtra' },
  { value: '07', label: '07 · Delhi' },
  { value: '24', label: '24 · Gujarat' },
  { value: '19', label: '19 · West Bengal' },
];

/** Age in seconds → "42m", "3h 10m", "2d". */
export function ageLabel(sec: number): string {
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(sec / 86400)}d`;
}

export const secondsSince = (iso: string | undefined, now = Date.now()) => (iso ? (now - new Date(iso).getTime()) / 1000 : 0);
