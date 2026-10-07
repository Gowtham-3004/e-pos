import type { Category, Customer, JobCard, JobCardLine, JobCardStatus, Product, SerialNumber, StockMovement } from '@elixir/contracts';
import { documentNumber } from '@elixir/domain';
import { TENANT_IDS } from './platform';
import { DAY, ean13, iso, startOfDay } from './rng';

/**
 * Repair desk for Volt Electronics: service (labour) items, spare parts with opening stock,
 * and a handful of job cards in different stages. Built separately from history so the
 * retail sales simulation (and its RNG sequence) is untouched.
 */
const NOW = Date.now();
const TODAY0 = startOfDay(NOW);
const tid = TENANT_IDS.volt;
const storeId = `s-${tid}-1`;
const counterId = `c-${storeId}-1`;
const counterCode = 'TNR-C01';

// [name, price ₹, SAC]
const SERVICES: Array<[string, number, string]> = [
  ['Diagnosis / Inspection Fee', 199, '998713'],
  ['Screen Replacement Labour', 499, '998713'],
  ['Battery Replacement Labour', 299, '998713'],
  ['Charging Port Repair Labour', 349, '998713'],
  ['Software Flash / OS Reinstall', 599, '998713'],
  ['Water Damage Cleaning', 899, '998713'],
  ['Laptop Keyboard Replacement Labour', 699, '998713'],
  ['Laptop Service & Thermal Paste', 999, '998713'],
];

// [name, mrp ₹, sale ₹, model, serial?]
const PARTS: Array<[string, number, number, string, boolean]> = [
  ['Galaxy S26 Display Assembly', 14999, 13499, 'GH82-S946', true],
  ['iPhone 17 Display Assembly', 21900, 19900, '661-A3101', true],
  ['Redmi Note 15 Pro Display', 4999, 4299, 'RN15P-LCD', false],
  ['Galaxy S26 Battery 4000mAh', 2999, 2499, 'EB-BS946', false],
  ['iPhone 17 Battery', 5499, 4999, '661-B3101', false],
  ['USB-C Charging Port Flex', 899, 699, 'FLEX-USBC', false],
  ['Galaxy S26 Back Glass', 1999, 1599, 'GH82-BG946', false],
  ['Laptop Keyboard (Dell 15)', 2999, 2499, 'DELL-KB3530', false],
  ['Thermal Paste MX-6 4g', 799, 649, 'MX6-4G', false],
];

export function buildRepairDesk(customers: Customer[]) {
  const categories: Category[] = [
    { id: `cat-${tid}-svc`, tenantId: tid, name: 'Repair Services', color: '#0c8599', sortOrder: 20 },
    { id: `cat-${tid}-parts`, tenantId: tid, name: 'Spare Parts', color: '#5f3dc4', sortOrder: 21 },
  ];
  const products: Product[] = [];
  const serials: SerialNumber[] = [];
  const stockMovements: StockMovement[] = [];
  let bc = 900000;
  const base = (n: number) => ({
    id: `p-${tid}-r${n}`, tenantId: tid, sku: `VOL-R${String(n).padStart(3, '0')}`, barcode: ean13((bc += 11)), taxInclusive: true, unit: 'pcs' as const, decimalQty: false, active: true,
  });
  SERVICES.forEach(([name, price, sac], i) => {
    products.push({ ...base(i + 1), name, categoryId: categories[0]!.id, hsn: sac, taxRateId: 'gst18', mrpPaise: price * 100, salePaise: price * 100, costPaise: 0, reorderLevel: 0, isService: true });
  });
  const openAt = iso(TODAY0 - 40 * DAY);
  PARTS.forEach(([name, mrp, sale, model, serial], i) => {
    const p: Product = {
      ...base(50 + i), name, categoryId: categories[1]!.id, hsn: model.startsWith('DELL') || model.startsWith('MX6') ? '8473' : '8517', taxRateId: 'gst18',
      mrpPaise: mrp * 100, salePaise: sale * 100, costPaise: Math.round(sale * 100 * 0.7), reorderLevel: 3, model, serialTracked: serial || undefined, warrantyMonths: 3,
    };
    products.push(p);
    let qty = 8 + (i % 4) * 3;
    if (serial) {
      qty = 4;
      for (let k = 0; k < qty; k++) serials.push({ id: `sn-${p.id}-${k}`, productId: p.id, serial: `${model.replace(/[^A-Z0-9]/gi, '')}${100200 + i * 37 + k}`, status: 'in-stock' });
    }
    stockMovements.push({ id: `mv-rep-${i + 1}`, tenantId: tid, storeId, productId: p.id, type: 'opening', qty, sourceType: 'opening', sourceId: 'opening', createdAt: openAt });
  });

  const svc = (n: number) => products[n]!;
  const part = (n: number) => products[SERVICES.length + n]!;
  const line = (id: string, p: Product, at: number, technicianId?: string): JobCardLine => ({
    id, kind: p.isService ? 'service' : 'part', productId: p.id, name: p.name, qty: 1, unitPricePaise: p.salePaise, technicianId, addedAt: iso(at),
    serials: p.serialTracked ? [serials.find((x) => x.productId === p.id)!.serial] : undefined,
  });
  const tCustomers = customers.filter((c) => c.tenantId === tid && c.active);
  const tech = `u-${tid}-inv`;
  const desk = `u-${tid}-arun`;
  const hist = (steps: Array<[JobCardStatus, number]>) => steps.map(([status, at]) => ({ status, at: iso(at), userId: status === 'received' ? desk : tech }));

  type Spec = { status: JobCardStatus; ageH: number; device: JobCard['device']; problem: string; diagnosis?: string; lines: Array<[Product, number]>; estimate?: number; advance?: number; steps: JobCardStatus[] };
  const specs: Spec[] = [
    { status: 'received', ageH: 1, device: { brand: 'Apple', model: 'iPhone 17', imeiOrSerial: '356789104455120', color: 'Black', accessories: ['Back cover'], condition: 'Minor scratches on frame' }, problem: 'Battery drains within 4 hours, phone heats up while charging.', lines: [], estimate: 5500, steps: ['received'] },
    { status: 'diagnosing', ageH: 5, device: { brand: 'Dell', model: 'Inspiron 15 3530', imeiOrSerial: 'DL3530X88121', accessories: ['Charger'], condition: 'Good' }, problem: 'Several keys not working (E, R, T). Liquid spill suspected.', lines: [[svc(0), 2]], steps: ['received', 'diagnosing'] },
    { status: 'in-progress', ageH: 26, device: { brand: 'Samsung', model: 'Galaxy S26', imeiOrSerial: '351234567890128', color: 'Phantom Black', accessories: [], condition: 'Screen shattered, back intact' }, problem: 'Dropped phone — display cracked, touch not responding.', diagnosis: 'Display assembly damaged. Frame OK. Replace display.', lines: [[svc(1), 20], [part(0), 20]], estimate: 14000, advance: 2000, steps: ['received', 'diagnosing', 'awaiting-approval', 'in-progress'] },
    { status: 'ready', ageH: 50, device: { brand: 'Xiaomi', model: 'Redmi Note 15 Pro', imeiOrSerial: '869512043398771', color: 'Blue', accessories: ['Charger', 'Cable'], condition: 'Good' }, problem: 'Phone not charging, cable must be held at an angle.', diagnosis: 'Charging port worn out. Replaced USB-C flex.', lines: [[svc(0), 48], [svc(3), 30], [part(5), 30]], estimate: 1300, steps: ['received', 'diagnosing', 'in-progress', 'ready'] },
  ];

  const jobCards: JobCard[] = specs.map((s, i) => {
    const opened = NOW - s.ageH * 3600000;
    const cust = tCustomers[(i * 5 + 2) % tCustomers.length]!;
    const id = `jc-${tid}-${i + 1}`;
    const stepGap = (s.ageH * 3600000) / (s.steps.length + 1);
    return {
      id, tenantId: tid, storeId, counterId, jobNo: documentNumber('JOB', counterCode, 40 + i + 1, new Date(opened)),
      customerId: cust.id, customerName: cust.name, customerPhone: cust.phone, device: s.device, problem: s.problem, diagnosis: s.diagnosis,
      estimatePaise: s.estimate ? s.estimate * 100 : undefined, advancePaise: s.advance ? s.advance * 100 : undefined, technicianId: s.status === 'received' ? undefined : tech,
      promisedAt: iso(opened + 2 * DAY), status: s.status,
      lines: s.lines.map(([p, h], k) => line(`${id}-l${k + 1}`, p, NOW - h * 3600000, tech)),
      statusHistory: hist(s.steps.map((st, k) => [st, opened + k * stepGap])),
      openedBy: desk, openedAt: iso(opened), updatedAt: iso(opened + (s.steps.length - 1) * stepGap),
    };
  });

  return { categories, products, serials, stockMovements, jobCards, sequences: { [`JOB|${counterId}`]: 40 + specs.length } };
}
