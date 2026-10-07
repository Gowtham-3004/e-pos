/** Centralized locale formatting (Design System §57–58). Never concatenate ₹ manually. */

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const num = new Intl.NumberFormat('en-IN');
const compactFmt = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

/** ₹1,25,450.00 from paise. */
export function money(paise: number, opts: { whole?: boolean; signed?: boolean } = {}): string {
  const rupees = paise / 100;
  const s = (opts.whole ? inrWhole : inr).format(Math.abs(rupees));
  if (paise < 0) return `−${s}`;
  if (opts.signed && paise > 0) return `+${s}`;
  return s;
}

/** ₹1.2L / ₹3.4Cr style compact money for KPIs. */
export function moneyCompact(paise: number): string {
  const r = paise / 100;
  if (Math.abs(r) >= 1e7) return `₹${(r / 1e7).toFixed(2)}Cr`;
  if (Math.abs(r) >= 1e5) return `₹${(r / 1e5).toFixed(2)}L`;
  if (Math.abs(r) >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
  return money(paise, { whole: true });
}

export function rupeesToPaise(rupees: number | string): number {
  const n = typeof rupees === 'string' ? parseFloat(rupees.replace(/[^0-9.-]/g, '')) : rupees;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function paiseToRupeesInput(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function number(n: number): string {
  return num.format(n);
}

export function compact(n: number): string {
  return compactFmt.format(n);
}

export function qty(n: number, decimal = false): string {
  return decimal ? n.toFixed(3).replace(/\.?0+$/, '') : String(Math.round(n * 1000) / 1000);
}

export function pct(n: number, digits = 0): string {
  return `${n.toFixed(digits)}%`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toDate(d: string | number | Date): Date {
  return d instanceof Date ? d : new Date(d);
}

/** 07/10/2026 */
export function date(d: string | number | Date): string {
  const x = toDate(d);
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`;
}

/** 07 Oct 2026 */
export function dateLong(d: string | number | Date): string {
  const x = toDate(d);
  return `${pad(x.getDate())} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

/** 14:32 */
export function time(d: string | number | Date, seconds = false): string {
  const x = toDate(d);
  return `${pad(x.getHours())}:${pad(x.getMinutes())}${seconds ? `:${pad(x.getSeconds())}` : ''}`;
}

/** 07 Oct · 14:32 */
export function dateTime(d: string | number | Date): string {
  const x = toDate(d);
  return `${pad(x.getDate())} ${MONTHS[x.getMonth()]} · ${time(x)}`;
}

/** 07/27 expiry style */
export function monthYear(d: string | number | Date): string {
  const x = toDate(d);
  return `${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(2)}`;
}

/** Elapsed mm:ss or h:mm:ss for restaurant timers. */
export function elapsed(from: string | number | Date, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - toDate(from).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function elapsedMinutes(from: string | number | Date, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - toDate(from).getTime()) / 60000));
}

/** "2m ago", "3h ago", "Now" */
export function relative(d: string | number | Date | undefined, now: number = Date.now()): string {
  if (!d) return '—';
  const s = Math.floor((now - toDate(d).getTime()) / 1000);
  if (s < 45) return 'Now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** YYYY-MM-DD in local time */
export function isoDate(d: string | number | Date = new Date()): string {
  const x = toDate(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function daysUntil(d: string | number | Date, now: number = Date.now()): number {
  return Math.ceil((toDate(d).getTime() - now) / 86400000);
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}
