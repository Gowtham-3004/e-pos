import type { Category, DiningTable, Floor, FoodType, KitchenStation, Kot, MenuItem, ModifierGroup, OrderLine, RestaurantOrder, WaiterCall } from '@elixir/contracts';
import { buildKots, tableStatusFromOrder } from '@elixir/domain';
import { iso, type Rng } from './rng';
import { TENANT_IDS } from './platform';

const TID = TENANT_IDS.spice;
const SID = `s-${TID}-1`;
const NOW = Date.now();

export const restaurantStoreId = SID;

export const stations: KitchenStation[] = [
  { id: 'st-main', storeId: SID, name: 'Main Kitchen' },
  { id: 'st-tandoor', storeId: SID, name: 'Tandoor' },
  { id: 'st-bar', storeId: SID, name: 'Bar & Beverages' },
  { id: 'st-dessert', storeId: SID, name: 'Desserts' },
];

export const modifierGroups: ModifierGroup[] = [
  { id: 'mg-size', name: 'Size', required: true, min: 1, max: 1, options: [{ id: 'mo-reg', name: 'Regular', pricePaise: 0 }, { id: 'mo-large', name: 'Large', pricePaise: 12000 }] },
  { id: 'mg-spice', name: 'Spice', required: false, min: 0, max: 1, options: [{ id: 'mo-mild', name: 'Mild', pricePaise: 0 }, { id: 'mo-med', name: 'Medium', pricePaise: 0 }, { id: 'mo-hot', name: 'Hot', pricePaise: 0 }] },
  { id: 'mg-addon', name: 'Add-ons', required: false, min: 0, max: 3, options: [{ id: 'mo-paneer', name: 'Extra Paneer', pricePaise: 6000 }, { id: 'mo-butter', name: 'Butter', pricePaise: 2000 }, { id: 'mo-cheese', name: 'Cheese', pricePaise: 4000 }] },
  { id: 'mg-done', name: 'Doneness', required: true, min: 1, max: 1, options: [{ id: 'mo-medrare', name: 'Medium Rare', pricePaise: 0 }, { id: 'mo-medium', name: 'Medium', pricePaise: 0 }, { id: 'mo-well', name: 'Well Done', pricePaise: 0 }] },
  { id: 'mg-sugar', name: 'Sugar', required: false, min: 0, max: 1, options: [{ id: 'mo-nosugar', name: 'No Sugar', pricePaise: 0 }, { id: 'mo-less', name: 'Less Sugar', pricePaise: 0 }, { id: 'mo-normal', name: 'Normal', pricePaise: 0 }] },
  { id: 'mg-ice', name: 'Ice', required: false, min: 0, max: 1, options: [{ id: 'mo-noice', name: 'No Ice', pricePaise: 0 }, { id: 'mo-ice', name: 'With Ice', pricePaise: 0 }] },
  { id: 'mg-bread', name: 'Bread Choice', required: true, min: 1, max: 1, options: [{ id: 'mo-naan', name: 'Butter Naan', pricePaise: 0 }, { id: 'mo-roti', name: 'Tandoori Roti', pricePaise: 0 }, { id: 'mo-kulcha', name: 'Garlic Kulcha', pricePaise: 3000 }] },
];

export const restaurantCategories: Category[] = ['Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Beverages', 'Desserts', 'Combos'].map((name, i) => ({
  id: `cat-${TID}-${i + 1}`,
  tenantId: TID,
  name,
  color: ['#e8590c', '#c2255c', '#e67700', '#2b8a3e', '#1971c2', '#ae3ec9', '#5f3dc4'][i],
  sortOrder: i,
}));

type M = [name: string, cat: number, price: number, food: FoodType, station: string, mods: string[], desc: string, prep: number, popular?: boolean, available?: boolean];
const MENU: M[] = [
  ['Paneer Tikka', 0, 280, 'veg', 'st-tandoor', ['mg-spice', 'mg-addon'], 'Char-grilled cottage cheese, mint chutney', 14, true],
  ['Chicken 65', 0, 320, 'non-veg', 'st-main', ['mg-spice'], 'Crispy Chennai-style fried chicken', 12, true],
  ['Gobi Manchurian', 0, 240, 'veg', 'st-main', ['mg-spice'], 'Indo-Chinese cauliflower, dry or gravy', 10],
  ['Tandoori Chicken (Half)', 0, 380, 'non-veg', 'st-tandoor', ['mg-spice'], 'Overnight-marinated, clay oven roasted', 18],
  ['Apollo Fish', 0, 420, 'non-veg', 'st-main', ['mg-spice'], 'Hyderabadi spiced boneless fish', 14],
  ['Hara Bhara Kebab', 0, 220, 'veg', 'st-tandoor', [], 'Spinach and pea patties', 10],
  ['Egg Bonda', 0, 140, 'egg', 'st-main', [], 'Boiled egg in spiced gram batter', 8, false, false],
  ['Butter Chicken', 1, 320, 'non-veg', 'st-main', ['mg-size', 'mg-spice', 'mg-addon'], 'Tandoori chicken in velvety tomato makhani', 15, true],
  ['Paneer Butter Masala', 1, 290, 'veg', 'st-main', ['mg-size', 'mg-spice', 'mg-addon'], 'Cottage cheese in rich tomato gravy', 14, true],
  ['Chettinad Chicken Curry', 1, 340, 'non-veg', 'st-main', ['mg-size', 'mg-spice'], 'Fiery Karaikudi spice blend', 16],
  ['Dal Makhani', 1, 240, 'veg', 'st-main', ['mg-size', 'mg-addon'], 'Slow-cooked black lentils, cream, butter', 12],
  ['Kadai Vegetable', 1, 250, 'veg', 'st-main', ['mg-size', 'mg-spice'], 'Seasonal vegetables, bell peppers, kadai masala', 12],
  ['Mutton Rogan Josh', 1, 460, 'non-veg', 'st-main', ['mg-size', 'mg-spice'], 'Kashmiri braised lamb', 20],
  ['Wagyu Steak', 1, 1250, 'non-veg', 'st-main', ['mg-done', 'mg-addon'], 'Grilled wagyu, pepper jus, mash', 22],
  ['Butter Naan', 2, 60, 'veg', 'st-tandoor', [], 'Leavened bread, butter glaze', 5, true],
  ['Garlic Naan', 2, 80, 'veg', 'st-tandoor', [], 'Roasted garlic, coriander', 5],
  ['Tandoori Roti', 2, 40, 'veg', 'st-tandoor', [], 'Whole wheat clay-oven bread', 4],
  ['Malabar Parotta', 2, 50, 'veg', 'st-main', [], 'Flaky layered Kerala parotta', 5],
  ['Chicken Dum Biryani', 3, 360, 'non-veg', 'st-main', ['mg-size', 'mg-spice'], 'Seeraga samba, slow dum, raita', 18, true],
  ['Mutton Biryani', 3, 450, 'non-veg', 'st-main', ['mg-size'], 'Ambur style, tender mutton', 20],
  ['Veg Pulao', 3, 220, 'veg', 'st-main', ['mg-size'], 'Fragrant basmati with vegetables', 12],
  ['Jeera Rice', 3, 160, 'veg', 'st-main', [], 'Cumin tempered basmati', 8],
  ['Curd Rice', 3, 150, 'veg', 'st-main', [], 'Tempered yoghurt rice, pomegranate', 6],
  ['Filter Coffee', 4, 60, 'veg', 'st-bar', ['mg-sugar'], 'Kumbakonam degree coffee', 3, true],
  ['Masala Chai', 4, 50, 'veg', 'st-bar', ['mg-sugar'], 'Ginger, cardamom', 3],
  ['Fresh Lime Soda', 4, 90, 'veg', 'st-bar', ['mg-sugar', 'mg-ice'], 'Sweet, salt or mixed', 3],
  ['Mango Lassi', 4, 140, 'veg', 'st-bar', ['mg-sugar'], 'Alphonso mango, yoghurt', 4],
  ['Cold Coffee', 4, 160, 'veg', 'st-bar', ['mg-sugar', 'mg-ice'], 'With vanilla ice cream', 4],
  ['Mineral Water', 4, 40, 'veg', 'st-bar', [], '1 litre bottle', 1],
  ['Gulab Jamun', 5, 120, 'veg', 'st-dessert', [], 'Two pieces, warm', 3],
  ['Rasmalai', 5, 160, 'veg', 'st-dessert', [], 'Saffron milk, pistachio', 3],
  ['Brownie with Ice Cream', 5, 220, 'egg', 'st-dessert', [], 'Warm chocolate brownie, vanilla scoop', 6, true],
  ['Elaneer Payasam', 5, 180, 'veg', 'st-dessert', [], 'Tender coconut kheer', 3],
  ['North Indian Thali', 6, 420, 'veg', 'st-main', ['mg-bread'], 'Dal, 2 sabzi, paneer, rice, bread, dessert', 15, true],
  ['Non-Veg Meal Combo', 6, 520, 'non-veg', 'st-main', ['mg-bread'], 'Butter chicken, dal, rice, bread, gulab jamun', 15],
];

export const menuItems: MenuItem[] = MENU.map(([name, cat, price, food, station, mods, desc, prep, popular, available], i) => ({
  id: `mi-${i + 1}`,
  tenantId: TID,
  categoryId: restaurantCategories[cat]!.id,
  name,
  description: desc,
  pricePaise: price * 100,
  taxRateId: 'gst5',
  foodType: food,
  stationId: station,
  modifierGroupIds: mods,
  available: available ?? true,
  prepMinutes: prep,
  popular,
}));

export const floors: Floor[] = [
  { id: 'fl-ground', storeId: SID, name: 'Ground Floor', sortOrder: 0 },
  { id: 'fl-first', storeId: SID, name: 'First Floor', sortOrder: 1 },
  { id: 'fl-terrace', storeId: SID, name: 'Terrace', sortOrder: 2 },
];

function makeTables(): DiningTable[] {
  const out: DiningTable[] = [];
  const add = (floorId: string, prefix: string, n: number, cols: number) => {
    for (let i = 1; i <= n; i++) {
      out.push({
        id: `tb-${prefix}${String(i).padStart(2, '0')}`,
        floorId,
        code: `${prefix}${String(i).padStart(2, '0')}`,
        seats: i % 5 === 0 ? 6 : i % 3 === 0 ? 2 : 4,
        shape: i % 5 === 0 ? 'rect' : i % 3 === 0 ? 'round' : 'square',
        status: 'available',
        x: (i - 1) % cols,
        y: Math.floor((i - 1) / cols),
      });
    }
  };
  add('fl-ground', 'A', 12, 4);
  add('fl-first', 'B', 8, 4);
  add('fl-terrace', 'T', 6, 3);
  return out;
}

export function buildRestaurantRuntime(rng: Rng) {
  const tables = makeTables();
  const orders: RestaurantOrder[] = [];
  const kots: Kot[] = [];
  const waiters = [`u-${TID}-ravi`, `u-${TID}-deepa`, `u-${TID}-john`];
  let kotSeq = 220;
  let orderSeq = 228;
  let lineSeq = 1;

  const line = (itemIdx: number, qty: number, modIds: string[] = [], note?: string): OrderLine => {
    const mi = menuItems[itemIdx]!;
    const mods = modIds.map((id) => {
      const g = modifierGroups.find((gg) => gg.options.some((o) => o.id === id))!;
      const o = g.options.find((oo) => oo.id === id)!;
      return { groupId: g.id, groupName: g.name, optionId: o.id, name: o.name, pricePaise: o.pricePaise };
    });
    return { id: `ol-${lineSeq++}`, menuItemId: mi.id, name: mi.name, qty, unitPricePaise: mi.pricePaise, modifiers: mods, note, state: 'unsent', stationId: mi.stationId, foodType: mi.foodType };
  };

  // Running dine-in orders: [table, guests, minutesAgo, lines, sendState]
  const scenarios: Array<{ table: string; guests: number; mins: number; lines: OrderLine[]; stage: 'preparing' | 'ready' | 'served' | 'unsent' | 'bill' }> = [
    { table: 'A02', guests: 4, mins: 24, lines: [line(7, 1, ['mo-reg', 'mo-med']), line(14, 4), line(18, 1, ['mo-large']), line(23, 2, ['mo-less'])], stage: 'preparing' },
    { table: 'A03', guests: 2, mins: 52, lines: [line(0, 1, ['mo-hot']), line(8, 1, ['mo-reg']), line(15, 2)], stage: 'bill' },
    { table: 'A05', guests: 6, mins: 35, lines: [line(1, 2), line(19, 2, ['mo-reg']), line(33, 2, ['mo-naan']), line(26, 3, ['mo-normal'])], stage: 'ready' },
    { table: 'A08', guests: 3, mins: 12, lines: [line(13, 1, ['mo-well', 'mo-cheese'], 'Extra sauce on side'), line(9, 1, ['mo-reg', 'mo-hot']), line(17, 3)], stage: 'preparing' },
    { table: 'A12', guests: 4, mins: 18, lines: [line(7, 2, ['mo-reg', 'mo-mild']), line(10, 1, ['mo-reg']), line(14, 6), line(30, 2)], stage: 'preparing' },
    { table: 'B01', guests: 2, mins: 4, lines: [line(24, 2, ['mo-normal']), line(5, 1)], stage: 'unsent' },
    { table: 'B04', guests: 5, mins: 63, lines: [line(34, 2, ['mo-roti']), line(18, 2, ['mo-reg']), line(29, 3)], stage: 'served' },
    { table: 'T02', guests: 4, mins: 9, lines: [line(3, 1), line(4, 1, ['mo-med']), line(25, 4, ['mo-less', 'mo-ice'])], stage: 'preparing' },
  ];

  for (const sc of scenarios) {
    const table = tables.find((t) => t.code === sc.table)!;
    const openedAt = iso(NOW - sc.mins * 60000);
    let order: RestaurantOrder = {
      id: `ro-${orderSeq}`,
      tenantId: TID,
      storeId: SID,
      orderNo: `ORD-${String(orderSeq++).padStart(4, '0')}`,
      type: 'dine-in',
      tableId: table.id,
      tableCode: table.code,
      guests: sc.guests,
      waiterId: rng.pick(waiters),
      lines: sc.lines,
      status: 'new',
      kotCount: 0,
      billDiscountPct: 0,
      billRequested: sc.stage === 'bill',
      openedAt,
      source: rng.chance(0.2) ? 'qr' : 'waiter',
    };
    if (sc.stage !== 'unsent') {
      const built = buildKots(order, { createdBy: order.waiterId!, now: iso(NOW - (sc.mins - 2) * 60000), nextId: () => `kot-${kotSeq}`, globalSeq: () => kotSeq++ });
      const kotStatus = new Map(built.kots.map((k) => [k.id, (sc.stage === 'preparing' ? (rng.chance(0.5) ? 'preparing' : 'new') : sc.stage === 'ready' ? 'ready' : 'completed') as Kot['status']]));
      // Line state mirrors its KOT: a KOT the kitchen hasn't accepted yet leaves its lines at "sent".
      const lineStateFor = (kotId?: string): OrderLine['state'] => {
        const st = kotId ? kotStatus.get(kotId) : undefined;
        return st === 'new' ? 'sent' : st === 'preparing' ? 'preparing' : st === 'ready' ? 'ready' : 'served';
      };
      order = { ...order, lines: built.lines.map((l) => ({ ...l, state: lineStateFor(l.kotId) })), kotCount: built.kotCount, status: sc.stage === 'preparing' ? 'preparing' : sc.stage === 'ready' ? 'ready' : 'served' };
      for (const k of built.kots) {
        const status = kotStatus.get(k.id)!;
        kots.push({ ...k, status, acceptedAt: status !== 'new' ? iso(NOW - (sc.mins - 3) * 60000) : undefined, readyAt: status === 'ready' || status === 'completed' ? iso(NOW - 5 * 60000) : undefined });
      }
    }
    orders.push(order);
    table.currentOrderId = order.id;
    table.status = tableStatusFromOrder(order);
  }
  tables.find((t) => t.code === 'A07')!.status = 'reserved';
  tables.find((t) => t.code === 'B06')!.status = 'cleaning';
  tables.find((t) => t.code === 'T05')!.status = 'reserved';

  // Takeaway orders with tokens
  for (const [token, mins, items] of [[41, 7, [line(18, 1, ['mo-reg']), line(23, 1)]], [42, 3, [line(1, 1), line(26, 2)]]] as const) {
    let order: RestaurantOrder = {
      id: `ro-${orderSeq}`, tenantId: TID, storeId: SID, orderNo: `ORD-${String(orderSeq++).padStart(4, '0')}`, type: 'takeaway', token, customerName: token === 41 ? 'Vikram' : 'Sneha',
      lines: [...items], status: 'new', kotCount: 0, billDiscountPct: 0, billRequested: false, openedAt: iso(NOW - mins * 60000), source: 'pos',
    };
    const built = buildKots(order, { createdBy: `u-${TID}-arun`, now: order.openedAt, nextId: () => `kot-${kotSeq}`, globalSeq: () => kotSeq++ });
    order = { ...order, lines: built.lines.map((l) => ({ ...l, state: 'preparing' as const })), kotCount: built.kotCount, status: 'preparing' };
    built.kots.forEach((k) => kots.push({ ...k, status: token === 41 ? 'preparing' : 'new' }));
    orders.push(order);
  }

  const waiterCalls: WaiterCall[] = [
    { id: 'wc-1', storeId: SID, tableId: 'tb-A03', tableCode: 'A03', kind: 'bill', status: 'open', createdAt: iso(NOW - 3 * 60000) },
    { id: 'wc-2', storeId: SID, tableId: 'tb-A12', tableCode: 'A12', kind: 'water', status: 'open', createdAt: iso(NOW - 90000) },
    { id: 'wc-3', storeId: SID, tableId: 'tb-T02', tableCode: 'T02', kind: 'call-waiter', status: 'acknowledged', createdAt: iso(NOW - 6 * 60000) },
  ];

  return { tables, orders, kots, waiterCalls, nextKotSeq: kotSeq, nextOrderSeq: orderSeq };
}
