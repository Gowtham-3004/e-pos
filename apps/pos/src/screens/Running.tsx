import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ORDER_STATUS, orderTotals } from '@elixir/domain';
import { elapsed, elapsedMinutes, money } from '@elixir/format';
import { useLive, useNow } from '@elixir/local-store/react';
import { Badge, Button, DataTable, EmptyState, Segmented, StatusBadge } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';

export function RunningScreen() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const now = useNow(1000);
  const [type, setType] = useState<'all' | 'dine-in' | 'takeaway' | 'delivery'>('all');
  const all = useLive(device, ['orders'], () => device.where('orders', (o) => o.storeId === s.store.id && !o.closedAt && o.status !== 'cancelled').sort((a, b) => a.openedAt.localeCompare(b.openedAt)), [s.store.id]);
  const rows = all.filter((o) => type === 'all' || o.type === type);
  const totalValue = rows.reduce((a, o) => a + orderTotals(o.lines, o.billDiscountPct).totalPaise, 0);
  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Running orders</div>
          <div className="pos-page__desc">{rows.length} open · {money(totalValue)} on the floor</div>
        </div>
        <div className="ex-spacer" />
        <Segmented label="Order type" value={type} onChange={setType} items={[{ key: 'all', label: 'All', count: all.length }, { key: 'dine-in', label: 'Dine-in', count: all.filter((o) => o.type === 'dine-in').length }, { key: 'takeaway', label: 'Takeaway', count: all.filter((o) => o.type === 'takeaway').length }, { key: 'delivery', label: 'Delivery', count: all.filter((o) => o.type === 'delivery').length }]} />
        <Button variant="primary" icon="Plus" onClick={() => nav('/order?type=takeaway')}>New takeaway</Button>
      </div>
      <div className="ex-card">
        <DataTable
          rows={rows}
          rowKey={(o) => o.id}
          onRowClick={(o) => nav(`/order/${o.id}`)}
          empty={<EmptyState quiet icon="ClipboardList" title="No running orders">Open a table or start a takeaway.</EmptyState>}
          columns={[
            { key: 'where', header: 'Table / token', render: (o) => <b style={{ fontSize: 15 }}>{o.type === 'dine-in' ? `Table ${o.tableCode}` : `Token ${o.token}`}</b> },
            { key: 'orderNo', header: 'Order', render: (o) => <span className="num">{o.orderNo}</span> },
            { key: 'type', header: 'Type', render: (o) => <Badge>{o.type === 'dine-in' ? 'Dine-in' : o.type === 'takeaway' ? 'Takeaway' : 'Delivery'}</Badge> },
            { key: 'status', header: 'Status', render: (o) => <span className="ex-row" style={{ gap: 4 }}><StatusBadge meta={ORDER_STATUS[o.status]} />{o.billRequested ? <Badge tone="danger" icon="Receipt">Bill</Badge> : null}{o.lines.some((l) => l.state === 'unsent') ? <Badge tone="warning" icon="Send">Unsent</Badge> : null}</span> },
            { key: 'who', header: 'Guest / waiter', render: (o) => o.customerName ?? device.get('users', o.waiterId)?.name ?? '—' },
            { key: 'items', header: 'Items', align: 'right', render: (o) => o.lines.filter((l) => l.state !== 'void').reduce((a, l) => a + l.qty, 0) },
            { key: 'kots', header: 'KOTs', align: 'right', render: (o) => o.kotCount },
            { key: 'elapsed', header: 'Elapsed', align: 'right', render: (o) => <span className="num" style={{ color: elapsedMinutes(o.openedAt, now) > 45 ? 'var(--status-danger)' : undefined, fontWeight: 650 }}>{elapsed(o.openedAt, now)}</span> },
            { key: 'total', header: 'Total', align: 'right', render: (o) => <b className="num">{money(orderTotals(o.lines, o.billDiscountPct).totalPaise)}</b> },
          ]}
        />
      </div>
    </div>
  );
}
