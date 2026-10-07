import type { DeviceStatus, KotStatus, RestaurantOrderStatus, SubscriptionStatus, SyncState, TableStatus, TransactionStatus, ConnectivityState, SyncOutboxStatus } from '@elixir/contracts';

/**
 * One status vocabulary across the ecosystem (Design System §42).
 * Every status = tone (colour) + icon + text — never colour alone (UX-07).
 */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export interface StatusMeta {
  label: string;
  tone: Tone;
  /** lucide icon name */
  icon: string;
}

export const TRANSACTION_STATUS: Record<TransactionStatus, StatusMeta> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'FilePen' },
  open: { label: 'Open', tone: 'info', icon: 'CircleDot' },
  posted: { label: 'Posted', tone: 'success', icon: 'FileCheck2' },
  'partially-paid': { label: 'Partially Paid', tone: 'warning', icon: 'CircleDashed' },
  paid: { label: 'Paid', tone: 'success', icon: 'CircleCheck' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: 'CircleX' },
  returned: { label: 'Returned', tone: 'warning', icon: 'Undo2' },
};

export const SYNC_STATE: Record<SyncState, StatusMeta> = {
  local: { label: 'Local', tone: 'neutral', icon: 'HardDrive' },
  pending: { label: 'Pending', tone: 'warning', icon: 'CloudUpload' },
  syncing: { label: 'Syncing', tone: 'info', icon: 'RefreshCw' },
  synced: { label: 'Synced', tone: 'success', icon: 'CloudCheck' },
  conflict: { label: 'Conflict', tone: 'danger', icon: 'GitMerge' },
  failed: { label: 'Failed', tone: 'danger', icon: 'CloudAlert' },
};

export const OUTBOX_STATUS: Record<SyncOutboxStatus, StatusMeta> = {
  pending: { label: 'Pending', tone: 'warning', icon: 'Clock' },
  sending: { label: 'Syncing', tone: 'info', icon: 'RefreshCw' },
  acknowledged: { label: 'Synced', tone: 'success', icon: 'CloudCheck' },
  retry: { label: 'Retrying', tone: 'warning', icon: 'RotateCw' },
  quarantined: { label: 'Attention', tone: 'danger', icon: 'TriangleAlert' },
};

export const CONNECTIVITY: Record<ConnectivityState, StatusMeta> = {
  online: { label: 'Online', tone: 'success', icon: 'Wifi' },
  offline: { label: 'Offline', tone: 'neutral', icon: 'WifiOff' },
  syncing: { label: 'Syncing', tone: 'info', icon: 'RefreshCw' },
  attention: { label: 'Attention required', tone: 'danger', icon: 'TriangleAlert' },
};

export const DEVICE_STATUS: Record<DeviceStatus, StatusMeta> = {
  active: { label: 'Active', tone: 'success', icon: 'CircleCheck' },
  offline: { label: 'Offline', tone: 'neutral', icon: 'WifiOff' },
  revoked: { label: 'Revoked', tone: 'danger', icon: 'Ban' },
  attention: { label: 'Attention', tone: 'warning', icon: 'TriangleAlert' },
  'pending-activation': { label: 'Pending activation', tone: 'info', icon: 'Hourglass' },
};

export const ORDER_STATUS: Record<RestaurantOrderStatus, StatusMeta> = {
  new: { label: 'New', tone: 'info', icon: 'Sparkle' },
  accepted: { label: 'Accepted', tone: 'info', icon: 'Check' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'Flame' },
  ready: { label: 'Ready', tone: 'success', icon: 'BellRing' },
  served: { label: 'Served', tone: 'neutral', icon: 'HandPlatter' },
  collected: { label: 'Collected', tone: 'neutral', icon: 'PackageCheck' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: 'CircleX' },
};

export const KOT_STATUS: Record<KotStatus, StatusMeta> = {
  new: { label: 'New', tone: 'info', icon: 'Sparkle' },
  accepted: { label: 'Accepted', tone: 'info', icon: 'Check' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'Flame' },
  ready: { label: 'Ready', tone: 'success', icon: 'BellRing' },
  completed: { label: 'Completed', tone: 'neutral', icon: 'CircleCheck' },
  cancelled: { label: 'Cancelled', tone: 'danger', icon: 'CircleX' },
};

export const TABLE_STATUS: Record<TableStatus, StatusMeta> = {
  available: { label: 'Available', tone: 'neutral', icon: 'Circle' },
  occupied: { label: 'Occupied', tone: 'info', icon: 'Users' },
  ordered: { label: 'Ordered', tone: 'info', icon: 'ClipboardList' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'Flame' },
  ready: { label: 'Ready', tone: 'success', icon: 'BellRing' },
  'bill-requested': { label: 'Bill Requested', tone: 'danger', icon: 'Receipt' },
  'payment-pending': { label: 'Payment Pending', tone: 'warning', icon: 'Wallet' },
  reserved: { label: 'Reserved', tone: 'neutral', icon: 'CalendarCheck' },
  cleaning: { label: 'Cleaning', tone: 'neutral', icon: 'Sparkles' },
};

export const SUBSCRIPTION_STATUS: Record<SubscriptionStatus, StatusMeta> = {
  active: { label: 'Active', tone: 'success', icon: 'CircleCheck' },
  trial: { label: 'Trial', tone: 'info', icon: 'FlaskConical' },
  grace: { label: 'Grace period', tone: 'warning', icon: 'Hourglass' },
  suspended: { label: 'Suspended', tone: 'danger', icon: 'Ban' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'CircleX' },
};
