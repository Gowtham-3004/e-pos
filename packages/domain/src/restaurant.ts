import type { Kot, KotItem, MenuItem, ModifierGroup, OrderLine, Paise, RestaurantOrder, SelectedModifier, TableStatus } from '@elixir/contracts';
import { computeGst } from './tax';

export function orderLineTotal(l: Pick<OrderLine, 'qty' | 'unitPricePaise' | 'modifiers'>): Paise {
  return l.qty * (l.unitPricePaise + l.modifiers.reduce((s, m) => s + m.pricePaise, 0));
}

export interface OrderTotals {
  subtotalPaise: Paise;
  discountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  itemCount: number;
}

/** Restaurant menu prices are tax-exclusive (GST 5% typical) — tax added on top. */
export function orderTotals(lines: OrderLine[], billDiscountPct: number, taxRatePct = 5): OrderTotals {
  const live = lines.filter((l) => l.state !== 'void');
  const subtotal = live.reduce((s, l) => s + orderLineTotal(l), 0);
  const discount = Math.round((subtotal * billDiscountPct) / 100);
  const g = computeGst(subtotal - discount, taxRatePct, false, false);
  const raw = subtotal - discount + g.taxPaise;
  const total = Math.round(raw / 100) * 100;
  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxablePaise: g.taxablePaise,
    cgstPaise: g.cgstPaise,
    sgstPaise: g.sgstPaise,
    taxPaise: g.taxPaise,
    roundOffPaise: total - raw,
    totalPaise: total,
    itemCount: live.reduce((s, l) => s + l.qty, 0),
  };
}

/** Validate modifier selection: required groups block Add until valid (Design System §63). */
export function validateModifiers(groups: ModifierGroup[], selected: SelectedModifier[]): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const g of groups) {
    const n = selected.filter((s) => s.groupId === g.id).length;
    if ((g.required && n < Math.max(1, g.min)) || n > g.max) missing.push(g.name);
  }
  return { valid: missing.length === 0, missing };
}

export function menuItemUnitPrice(item: MenuItem, selected: SelectedModifier[]): Paise {
  return item.pricePaise + selected.reduce((s, m) => s + m.pricePaise, 0);
}

/**
 * Send unsent lines to kitchen: groups by station, produces one KOT per station with the next
 * increment. Previously sent KOT history is never rewritten (FR-KOT-003).
 */
export function buildKots(order: RestaurantOrder, opts: { createdBy: string; now?: string; nextId: () => string; globalSeq: () => number }): { kots: Kot[]; lines: OrderLine[]; kotCount: number } {
  const unsent = order.lines.filter((l) => l.state === 'unsent');
  if (!unsent.length) return { kots: [], lines: order.lines, kotCount: order.kotCount };
  const byStation = new Map<string, OrderLine[]>();
  unsent.forEach((l) => byStation.set(l.stationId, [...(byStation.get(l.stationId) ?? []), l]));
  let kotCount = order.kotCount;
  const now = opts.now ?? new Date().toISOString();
  const kots: Kot[] = [];
  const lineKot = new Map<string, { id: string; no: number }>();
  for (const [stationId, ls] of byStation) {
    kotCount += 1;
    const id = opts.nextId();
    const items: KotItem[] = ls.map((l) => ({ orderLineId: l.id, name: l.name, qty: l.qty, modifiers: l.modifiers.map((m) => m.name), note: l.note }));
    kots.push({
      id,
      orderId: order.id,
      storeId: order.storeId,
      kotNo: kotCount,
      displayNo: `KOT #${opts.globalSeq()}`,
      stationId,
      orderType: order.type,
      tableCode: order.tableCode,
      token: order.token,
      items,
      status: 'new',
      createdBy: opts.createdBy,
      createdAt: now,
    });
    ls.forEach((l) => lineKot.set(l.id, { id, no: kotCount }));
  }
  const lines = order.lines.map((l) => {
    const k = lineKot.get(l.id);
    return k ? { ...l, state: 'sent' as const, kotId: k.id, kotNo: k.no } : l;
  });
  return { kots, lines, kotCount };
}

/** Derive table status from its running order. */
export function tableStatusFromOrder(order?: RestaurantOrder): TableStatus {
  if (!order) return 'available';
  if (order.billRequested) return 'bill-requested';
  const live = order.lines.filter((l) => l.state !== 'void');
  if (!live.length) return 'occupied';
  if (live.some((l) => l.state === 'unsent')) return 'ordered';
  if (live.every((l) => l.state === 'ready' || l.state === 'served')) return live.some((l) => l.state === 'ready') ? 'ready' : 'occupied';
  return 'preparing';
}

/** KDS urgency escalation by ticket age vs prep target. */
export function kotUrgency(createdAt: string, targetMinutes = 15, now = Date.now()): 'normal' | 'warning' | 'late' {
  const m = (now - new Date(createdAt).getTime()) / 60000;
  if (m >= targetMinutes) return 'late';
  if (m >= targetMinutes * 0.66) return 'warning';
  return 'normal';
}
