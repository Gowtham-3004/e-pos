/** Time-ordered unique id (uuidv7-like) — globally unique machine identity (ADR-013). */
export function uid(prefix = ''): string {
  const t = Date.now().toString(16).padStart(12, '0');
  let r = '';
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const a = new Uint8Array(10);
    c.getRandomValues(a);
    r = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } else {
    for (let i = 0; i < 20; i++) r += Math.floor(Math.random() * 16).toString(16);
  }
  const id = `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-${r.slice(3, 7)}-${r.slice(7, 19)}`;
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * Counter-scoped legal document number (ADR-014 proposed option: counter-scoped series).
 * INV/26-27/C02/001284 — FY + counter keeps offline counters collision-free.
 */
export function documentNumber(kind: 'INV' | 'RET' | 'PUR' | 'ADJ' | 'PAY' | 'ORD' | 'KOT', counterCode: string, seq: number, at: Date = new Date()): string {
  const y = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  const fy = `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
  return `${kind}/${fy}/${counterCode}/${String(seq).padStart(6, '0')}`;
}
