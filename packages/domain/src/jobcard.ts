import type { CartLineInput, JobCard, JobCardStatus } from '@elixir/contracts';
import type { StatusMeta } from './status';

/** Repair workflow. `delivered` is only reached by billing the card (billJobCard). */
export const JOB_CARD_FLOW: Record<JobCardStatus, JobCardStatus[]> = {
  received: ['diagnosing', 'in-progress', 'cancelled'],
  diagnosing: ['awaiting-approval', 'in-progress', 'cancelled'],
  'awaiting-approval': ['in-progress', 'cancelled'],
  'in-progress': ['ready', 'awaiting-approval', 'cancelled'],
  ready: ['delivered', 'in-progress'],
  delivered: [],
  cancelled: [],
};

export const JOB_CARD_STATUS_LABEL: Record<JobCardStatus, string> = {
  received: 'Received',
  diagnosing: 'Diagnosing',
  'awaiting-approval': 'Awaiting Approval',
  'in-progress': 'In Progress',
  ready: 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** Badge meta per status (shared by POS + Back Office). */
export const JOB_CARD_STATUS: Record<JobCardStatus, StatusMeta> = {
  received: { label: 'Received', tone: 'info', icon: 'Inbox' },
  diagnosing: { label: 'Diagnosing', tone: 'info', icon: 'Stethoscope' },
  'awaiting-approval': { label: 'Awaiting Approval', tone: 'warning', icon: 'MessageCircleQuestion' },
  'in-progress': { label: 'In Progress', tone: 'warning', icon: 'Wrench' },
  ready: { label: 'Ready for Pickup', tone: 'success', icon: 'PackageCheck' },
  delivered: { label: 'Delivered', tone: 'neutral', icon: 'CircleCheck' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: 'CircleX' },
};

export function canTransition(from: JobCardStatus, to: JobCardStatus): boolean {
  return JOB_CARD_FLOW[from].includes(to);
}

export const isJobCardOpen = (s: JobCardStatus) => s !== 'delivered' && s !== 'cancelled';

/** Job card lines → cart inputs so billing reuses computeCart (GST, MRP cap, discounts). */
export function jobCardToCartLines(card: Pick<JobCard, 'lines'>): CartLineInput[] {
  return card.lines.map((l) => ({
    productId: l.productId,
    qty: l.qty,
    unitPricePaise: l.unitPricePaise,
    lineDiscountPct: l.lineDiscountPct,
    batchId: l.batchId,
    serials: l.serials,
    note: l.kind,
  }));
}
