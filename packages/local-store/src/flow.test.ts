import { describe, expect, it } from 'vitest';
import { LocalDatabase, MemoryBackend } from './db';
import { completeSale, openShift, closeShift, commitReturn, createOrder, saveOrder, sendKot, setKotStatus, settleOrder, faults, LocalCommitError } from './commands';
import { SyncEngine, publishMasterChange, commitWithFeed } from './sync';
import { onHand, resolveSession, searchProducts } from './selectors';
import { orderTotals } from '@elixir/domain';

async function setup() {
  const device = new LocalDatabase('dev', new MemoryBackend());
  const cloud = new LocalDatabase('cloud', new MemoryBackend());
  await device.init();
  await cloud.init();
  return { device, cloud };
}

const T = 't-abc';
const STORE = `s-${T}-1`;
const COUNTER = `c-${STORE}-2`;
const DEVICE = `d-${COUNTER}`;
const USER = `u-${T}-arun`;

describe('offline-first retail flow', () => {
  it('sells offline, syncs once on reconnect, pulls master changes', async () => {
    const { device, cloud } = await setup();
    const session = resolveSession(device, { deviceId: DEVICE, userId: USER })!;
    expect(session.tenant.vertical).toBe('grocery');
    expect(session.capabilities).toContain('batch-expiry');

    const shift = await openShift(device, { tenantId: T, storeId: STORE, counterId: COUNTER, deviceId: DEVICE, userId: USER, denominations: [{ denomination: 50000, count: 10 }], businessDate: '2026-10-07' });
    const origin = { tenantId: T, storeId: STORE, counterId: COUNTER, deviceId: DEVICE, userId: USER, shiftId: shift.id, businessDate: '2026-10-07' };

    const engine = new SyncEngine(device, cloud, { deviceId: DEVICE, tenantId: T });
    engine.transientFailureRate = 0;
    await engine.setNetwork({ wan: 'offline' });

    const salt = searchProducts(device, T, 'tata salt')[0]!;
    const before = onHand(device, STORE, salt.id);
    const sale = await completeSale(device, { clientTransactionId: 'sale-1', origin, lines: [{ productId: salt.id, qty: 2 }], billDiscountPct: 0, tenders: [{ method: 'cash', amountPaise: 5600, receivedPaise: 10000, changePaise: 4400, confirmation: 'n/a' }] });
    expect(sale.totalPaise).toBe(5600);
    expect(sale.syncState).toBe('pending');
    expect(onHand(device, STORE, salt.id)).toBe(before - 2);
    // double submit returns the same sale
    const again = await completeSale(device, { clientTransactionId: 'sale-1', origin, lines: [{ productId: salt.id, qty: 2 }], billDiscountPct: 0, tenders: [{ method: 'cash', amountPaise: 5600, confirmation: 'n/a' }] });
    expect(again.id).toBe(sale.id);
    expect(device.where('sales', (s) => s.id === 'sale-1')).toHaveLength(1);

    expect(engine.status().connectivity).toBe('offline');
    expect(engine.status().pending).toBeGreaterThan(0);
    await engine.tick();
    expect(cloud.get('sales', 'sale-1')).toBeUndefined();

    await engine.setNetwork({ wan: 'online' });
    for (let i = 0; i < 5 && engine.status().pending; i++) await engine.syncNow();
    expect(engine.status().pending).toBe(0);
    expect(cloud.get('sales', 'sale-1')?.syncState).toBe('synced');
    expect(device.get('sales', 'sale-1')?.syncState).toBe('synced');

    // duplicate delivery: requeue an acknowledged item → no second consequence
    const ob = device.where('outbox', (o) => o.aggregateId === 'sale-1')[0]!;
    await device.put('outbox', { ...ob, status: 'pending' });
    const cloudSalesBefore = cloud.all('sales').length;
    await engine.syncNow();
    expect(cloud.all('sales').length).toBe(cloudSalesBefore);

    // master pull
    await publishMasterChange(cloud, { tenantId: T, collection: 'products', entity: { ...salt, salePaise: 2600 }, summary: 'Price change Tata Salt' });
    await engine.syncNow();
    expect(device.get('products', salt.id)?.salePaise).toBe(2600);

    // Back Office posts stock in the cloud → device pulls the movement via the change feed
    const stockBefore = onHand(device, STORE, salt.id);
    await commitWithFeed(cloud, [{ collection: 'stockMovements', put: [{ id: 'mv-bo-1', tenantId: T, storeId: STORE, productId: salt.id, type: 'purchase_in', qty: 24, sourceType: 'purchase', sourceId: 'pu-x', createdAt: new Date().toISOString() }] }]);
    await engine.syncNow();
    expect(onHand(device, STORE, salt.id)).toBe(stockBefore + 24);

    // return + shift close
    await commitReturn(device, { origin, originalSaleId: sale.id, lines: [{ saleLineId: sale.lines[0]!.id, productId: salt.id, name: salt.name, qty: 1, refundPaise: 2800, restockable: true, reason: 'test' }], refundMethod: 'cash' });
    expect(onHand(device, STORE, salt.id)).toBe(before - 1 + 24);
    const closed = await closeShift(device, { shiftId: shift.id, userId: USER, denominations: [{ denomination: 50000, count: 10 }, { denomination: 100, count: 28 }] });
    expect(closed.expectedCash).toBe(500000 + 5600 - 2800);
    expect(closed.variance).toBe(0);
  });

  it('failed local commit is never reported as success', async () => {
    const { device } = await setup();
    const shift = await openShift(device, { tenantId: T, storeId: STORE, counterId: COUNTER, deviceId: DEVICE, userId: USER, denominations: [], businessDate: '2026-10-07' });
    const origin = { tenantId: T, storeId: STORE, counterId: COUNTER, deviceId: DEVICE, userId: USER, shiftId: shift.id, businessDate: '2026-10-07' };
    const p = searchProducts(device, T, 'tata salt')[0]!;
    faults.failNextCommit = true;
    await expect(completeSale(device, { clientTransactionId: 'x', origin, lines: [{ productId: p.id, qty: 1 }], billDiscountPct: 0, tenders: [{ method: 'cash', amountPaise: 2800, confirmation: 'n/a' }] })).rejects.toBeInstanceOf(LocalCommitError);
    expect(device.get('sales', 'x')).toBeUndefined();
  });
});

describe('restaurant flow', () => {
  it('order → KOT → ready → settle closes table', async () => {
    const { device } = await setup();
    const RT = 't-spice';
    const RS = `s-${RT}-1`;
    const RC = `c-${RS}-1`;
    const RD = `d-${RC}`;
    const RU = `u-${RT}-arun`;
    const shift = await openShift(device, { tenantId: RT, storeId: RS, counterId: RC, deviceId: RD, userId: RU, denominations: [], businessDate: '2026-10-07' });
    const order = await createOrder(device, { tenantId: RT, storeId: RS, type: 'dine-in', tableId: 'tb-A01', guests: 2 });
    const mi = device.get('menuItems', 'mi-15')!;
    await saveOrder(device, { ...order, lines: [{ id: 'l1', menuItemId: mi.id, name: mi.name, qty: 2, unitPricePaise: mi.pricePaise, modifiers: [], state: 'unsent', stationId: mi.stationId, foodType: mi.foodType }] });
    const kots = await sendKot(device, order.id, RU);
    expect(kots).toHaveLength(1);
    expect(device.get('tables', 'tb-A01')?.status).toBe('preparing');
    await setKotStatus(device, kots[0]!.id, 'ready');
    expect(device.get('tables', 'tb-A01')?.status).toBe('ready');
    const o = device.get('orders', order.id)!;
    const total = orderTotals(o.lines, 0).totalPaise;
    await settleOrder(device, { clientTransactionId: 'rs-1', orderId: order.id, origin: { tenantId: RT, storeId: RS, counterId: RC, deviceId: RD, userId: RU, shiftId: shift.id, businessDate: '2026-10-07' }, tenders: [{ method: 'upi', amountPaise: total, confirmation: 'manual' }], billDiscountPct: 0 });
    expect(device.get('tables', 'tb-A01')?.status).toBe('cleaning');
    expect(device.get('sales', 'rs-1')?.kind).toBe('restaurant');
  });
});
