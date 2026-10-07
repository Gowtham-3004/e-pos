import { describe, expect, it } from 'vitest';
import { onHandByProduct } from '@elixir/domain';
import { buildSeed } from '../index';

describe('seed', () => {
  it('builds a consistent dataset', () => {
    const t0 = Date.now();
    const s = buildSeed();
    const counts = Object.fromEntries(Object.entries(s).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
    console.log('seed ms', Date.now() - t0, counts, 'json KB', Math.round(JSON.stringify(s).length / 1024));
    expect(s.sales.length).toBeGreaterThan(500);
    const ids = new Set(s.sales.map((x) => x.id));
    expect(ids.size).toBe(s.sales.length);
    const docs = new Set(s.sales.map((x) => x.tenantId + x.documentNo));
    expect(docs.size).toBe(s.sales.length);
    // every sale total equals sum of tenders
    for (const sale of s.sales) expect(sale.tenders.reduce((a, t) => a + t.amountPaise, 0)).toBe(sale.totalPaise);
    const neg = [...onHandByProduct(s.stockMovements).entries()].filter(([, q]) => q < 0);
    expect(neg).toHaveLength(0);
  });
});
