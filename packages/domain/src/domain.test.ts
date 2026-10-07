import { describe, expect, it } from 'vitest';
import type { CashMovement, Product, StockMovement, TaxRate, Tenant } from '@elixir/contracts';
import { computeGst, computeCart, priceLine, PricingError, projectStock, closingBalance, cashBreakdown, expectedCash, variance, resolveCapabilities, composeNav, POS_NAV, roleByCode, validateModifiers, documentNumber, canTransition, jobCardToCartLines } from './index';

const tax5: TaxRate = { id: 't5', name: 'GST 5%', ratePct: 5 };
const tax18: TaxRate = { id: 't18', name: 'GST 18%', ratePct: 18 };
const base: Omit<Product, 'id' | 'name' | 'barcode' | 'sku'> = {
  tenantId: 't', categoryId: 'c', hsn: '0401', taxRateId: 't5', taxInclusive: true, mrpPaise: 6400, salePaise: 6200, costPaise: 5000, unit: 'pcs', decimalQty: false, active: true, reorderLevel: 5,
};
const milk: Product = { ...base, id: 'p1', name: 'Milk', barcode: '1', sku: 'M' };
const rice: Product = { ...base, id: 'p2', name: 'Rice', barcode: '2', sku: 'R', taxRateId: 't18', salePaise: 11900, mrpPaise: 12500, unit: 'kg', decimalQty: true };
const ctx = { products: { p1: milk, p2: rice }, taxRates: { t5: tax5, t18: tax18 }, interState: false };

describe('GST', () => {
  it('splits inclusive intra-state into CGST+SGST', () => {
    const g = computeGst(10500, 5, true, false);
    expect(g.taxablePaise).toBe(10000);
    expect(g.cgstPaise + g.sgstPaise).toBe(500);
    expect(g.igstPaise).toBe(0);
  });
  it('exclusive inter-state uses IGST', () => {
    const g = computeGst(10000, 18, false, true);
    expect(g.igstPaise).toBe(1800);
  });
});

describe('cart', () => {
  it('blocks price above MRP', () => {
    expect(() => priceLine({ productId: 'p1', qty: 1, unitPricePaise: 7000 }, 1, ctx)).toThrow(PricingError);
  });
  it('blocks fractional qty for unit items', () => {
    expect(() => priceLine({ productId: 'p1', qty: 1.5 }, 1, ctx)).toThrow(/whole units/);
  });
  it('computes totals with bill discount allocation and rupee rounding', () => {
    const t = computeCart([{ productId: 'p1', qty: 2 }, { productId: 'p2', qty: 1.5 }], 10, ctx);
    expect(t.errors).toHaveLength(0);
    expect(t.grossPaise).toBe(12400 + 17850);
    expect(t.billDiscountPaise).toBe(3025);
    expect(t.totalPaise % 100).toBe(0);
    expect(t.lines.reduce((s, l) => s + l.taxablePaise + l.cgstPaise + l.sgstPaise, 0)).toBe(30250 - 3025);
  });
});

describe('stock ledger', () => {
  const mv = (type: StockMovement['type'], qty: number): StockMovement => ({ id: Math.random() + '', tenantId: 't', storeId: 's', productId: 'p1', type, qty, sourceType: 'sale', sourceId: 'x', createdAt: '' });
  it('projects on-hand from movements', () => {
    const list = [mv('opening', 100), mv('purchase_in', 20), mv('sale_out', -5), mv('sale_return_restock', 1), mv('sale_return_damaged', 1), mv('adjustment_out', -2)];
    const lvl = projectStock(list).get('s|p1|')!;
    expect(lvl.onHand).toBe(114);
    expect(lvl.damaged).toBe(1);
    expect(closingBalance(0, list)).toBe(114);
  });
});

describe('shift', () => {
  it('expected cash and variance', () => {
    const o = { tenantId: 't', storeId: 's', counterId: 'c', deviceId: 'd', userId: 'u', shiftId: 'sh', businessDate: '2026-10-07', createdAt: '' };
    const ms: CashMovement[] = [
      { ...o, id: '1', type: 'opening', amountPaise: 500000 },
      { ...o, id: '2', type: 'cash_sale', amountPaise: 248500 },
      { ...o, id: '3', type: 'petty_paid', amountPaise: -20000 },
      { ...o, id: '4', type: 'cash_refund', amountPaise: -5000 },
    ];
    expect(expectedCash(ms)).toBe(723500);
    expect(cashBreakdown(ms).expected).toBe(723500);
    expect(variance(720000, 723500)).toBe(-3500);
  });
});

describe('capabilities', () => {
  const t: Tenant = { id: 't', name: 'ABC', legalName: 'ABC', family: 'retail', vertical: 'grocery', plan: 'pro', addOns: ['multi-store'], subscriptionStatus: 'active', stateCode: '33', createdAt: '', renewsOn: '', configVersion: 1, contactName: '', contactPhone: '', city: '' };
  it('composes Core + Vertical + Plan + Add-ons', () => {
    const caps = resolveCapabilities(t);
    expect(caps).toContain('batch-expiry');
    expect(caps).toContain('cloud-sync');
    expect(caps).toContain('multi-store');
    expect(caps).not.toContain('variants');
    expect(caps.some((c) => c.startsWith('restaurant.'))).toBe(false);
  });
  it('navigation hides unavailable modules', () => {
    const caps = resolveCapabilities(t);
    const nav = composeNav(POS_NAV, { capabilities: caps, permissions: roleByCode('cashier').permissions, family: 'retail' });
    expect(nav.map((n) => n.key)).toContain('billing');
    expect(nav.map((n) => n.key)).not.toContain('kds');
    expect(nav.map((n) => n.key)).not.toContain('sync');
  });
});

describe('restaurant', () => {
  it('required modifier group blocks add', () => {
    const groups = [{ id: 'g', name: 'Size', required: true, min: 1, max: 1, options: [] }];
    expect(validateModifiers(groups, []).valid).toBe(false);
  });
  it('document number is FY + counter scoped', () => {
    expect(documentNumber('INV', 'C02', 1284, new Date('2026-10-07'))).toBe('INV/26-27/C02/001284');
  });
});

describe('job card', () => {
  it('enforces the repair workflow', () => {
    expect(canTransition('received', 'diagnosing')).toBe(true);
    expect(canTransition('in-progress', 'ready')).toBe(true);
    expect(canTransition('ready', 'delivered')).toBe(true);
    expect(canTransition('received', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'in-progress')).toBe(false);
    expect(canTransition('cancelled', 'received')).toBe(false);
  });
  it('maps lines to cart inputs with quoted prices', () => {
    const lines = jobCardToCartLines({ lines: [
      { id: 'a', kind: 'service', productId: 's1', name: 'Labour', qty: 1, unitPricePaise: 49900, addedAt: '' },
      { id: 'b', kind: 'part', productId: 'p1', name: 'Display', qty: 1, unitPricePaise: 1349900, serials: ['X1'], lineDiscountPct: 5, addedAt: '' },
    ] });
    expect(lines).toEqual([
      { productId: 's1', qty: 1, unitPricePaise: 49900, lineDiscountPct: undefined, batchId: undefined, serials: undefined, note: 'service' },
      { productId: 'p1', qty: 1, unitPricePaise: 1349900, lineDiscountPct: 5, batchId: undefined, serials: ['X1'], note: 'part' },
    ]);
  });
});
