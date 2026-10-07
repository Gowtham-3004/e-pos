import type { Purchase } from '@elixir/contracts';
import { TRANSACTION_STATUS, type StatusMeta } from '@elixir/domain';

export const PURCHASE_STATUS: Record<Purchase['status'], StatusMeta> = {
  draft: TRANSACTION_STATUS.draft,
  posted: TRANSACTION_STATUS.posted,
  cancelled: TRANSACTION_STATUS.cancelled,
};

export const PAYMENT_STATUS: Record<Purchase['paymentStatus'], StatusMeta> = {
  unpaid: { label: 'Unpaid', tone: 'danger', icon: 'CircleDashed' },
  'partially-paid': TRANSACTION_STATUS['partially-paid'],
  paid: TRANSACTION_STATUS.paid,
};

/** Purchase returns are posted as negative "debit note" purchase documents. */
export const isDebitNote = (p: Purchase) => p.totalPaise < 0 || p.documentNo.startsWith('PRN/');
