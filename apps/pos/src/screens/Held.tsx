import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HeldCart } from '@elixir/contracts';
import { computeCart } from '@elixir/domain';
import { dateTime, money, relative } from '@elixir/format';
import { deleteHeldCart } from '@elixir/local-store';
import { useLive } from '@elixir/local-store/react';
import { Button, ConfirmDialog, DataTable, EmptyState, Segmented, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { pricingContext, useCart } from '../lib/cart';

export function HeldScreen() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const cart = useCart();
  const [scope, setScope] = useState<'counter' | 'store'>('counter');
  const [del, setDel] = useState<HeldCart>();
  const counters = new Set(device.where('counters', (c) => c.storeId === s.store.id).map((c) => c.id));
  const rows = useLive(device, ['heldCarts'], () => device.where('heldCarts', (h) => (scope === 'counter' ? h.counterId === s.counter?.id : counters.has(h.counterId))).sort((a, b) => b.heldAt.localeCompare(a.heldAt)), [scope, s.counter?.id]);
  const totalOf = (h: HeldCart) => computeCart(h.lines, h.billDiscountPct, pricingContext(device, s, device.get('customers', h.customerId), 'retail')).totalPaise;

  const resume = async (h: HeldCart) => {
    if (cart.lines.length) {
      toast.warning('Current bill is not empty', 'Hold or finish the bill on screen before resuming another.');
      nav('/billing');
      return;
    }
    cart.load(h);
    await deleteHeldCart(device, h.id);
    toast.success('Bill resumed', h.label);
    nav('/billing');
  };

  return (
    <div className="pos-page">
      <div className="pos-page__head">
        <div>
          <div className="pos-page__title">Held bills</div>
          <div className="pos-page__desc">Bills parked with Hold (F4). Resume loads the bill back into billing.</div>
        </div>
        <div className="ex-spacer" />
        <Segmented label="Scope" value={scope} onChange={setScope} items={[{ key: 'counter', label: `Counter ${s.counter?.code}` }, { key: 'store', label: 'All counters' }]} />
      </div>
      <div className="ex-card">
        <DataTable
          rows={rows}
          rowKey={(h) => h.id}
          onRowClick={(h) => void resume(h)}
          empty={<EmptyState icon="CirclePause" title="No held bills" actions={<Button onClick={() => nav('/billing')}>Go to billing</Button>}>Press F4 on the billing screen to park a bill while the customer fetches an item.</EmptyState>}
          columns={[
            { key: 'label', header: 'Bill', render: (h) => <b>{h.label}</b> },
            { key: 'customer', header: 'Customer', render: (h) => device.get('customers', h.customerId)?.name ?? 'Walk-in' },
            { key: 'lines', header: 'Lines', align: 'right', render: (h) => h.lines.length },
            { key: 'total', header: 'Value', align: 'right', render: (h) => <span className="num">{money(totalOf(h))}</span> },
            { key: 'counter', header: 'Counter', render: (h) => device.get('counters', h.counterId)?.code },
            { key: 'user', header: 'Held by', render: (h) => device.get('users', h.userId)?.name },
            { key: 'heldAt', header: 'Held', sortable: true, render: (h) => <span title={dateTime(h.heldAt)}>{relative(h.heldAt)}</span> },
            {
              key: 'act', header: '', align: 'right', render: (h) => (
                <span className="ex-row" style={{ justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                  <Button size="sm" variant="primary" icon="CirclePlay" onClick={() => void resume(h)} disabled={h.counterId !== s.counter?.id}>Resume</Button>
                  <Button size="sm" variant="danger-outline" icon="Trash2" onClick={() => setDel(h)}>Delete</Button>
                </span>
              ),
            },
          ]}
        />
      </div>
      <ConfirmDialog open={!!del} onClose={() => setDel(undefined)} title="Delete held bill?" confirmLabel="Delete bill" onConfirm={async () => { if (del) await deleteHeldCart(device, del.id); toast.info('Held bill deleted'); setDel(undefined); }}>
        {del?.label}. This bill was never posted; deleting it cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
