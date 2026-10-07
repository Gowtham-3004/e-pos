import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MenuItem, ModifierGroup, OrderLine, OrderType, RestaurantOrder, SelectedModifier } from '@elixir/contracts';
import { discountNeedsApproval, menuItemUnitPrice, ORDER_STATUS, orderLineTotal, orderTotals, uid, validateModifiers } from '@elixir/domain';
import { elapsed, initials, money } from '@elixir/format';
import { createOrder, requestBill, saveOrder, sendKot, settleOrder, voidOrderLine } from '@elixir/local-store';
import { useLive, useNow } from '@elixir/local-store/react';
import { ApprovalDialog, Badge, Button, CategoryChips, Checkbox, ConfirmDialog, EmptyState, FoodMark, Icon, IconButton, InlineAlert, Modal, QuantityStepper, SearchInput, Segmented, StatusBadge, TextField, Textarea, useToast, cx } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { managerVerifier, originOf, recordApproval } from '../lib/ops';
import { PaymentModal } from '../components/PaymentModal';
import type { StatusMeta } from '@elixir/domain';

const LINE_STATE: Record<OrderLine['state'], StatusMeta> = {
  unsent: { label: 'Unsent', tone: 'warning', icon: 'PencilLine' },
  sent: { label: 'Sent', tone: 'info', icon: 'Send' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'Flame' },
  ready: { label: 'Ready', tone: 'success', icon: 'BellRing' },
  served: { label: 'Served', tone: 'neutral', icon: 'HandPlatter' },
  void: { label: 'Void', tone: 'danger', icon: 'Ban' },
};

function availableNow(m: MenuItem, now: number): { ok: boolean; why?: string } {
  if (!m.available) return { ok: false, why: 'Sold out' };
  if (m.availableFrom && m.availableTo) {
    const d = new Date(now);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (hm < m.availableFrom || hm > m.availableTo) return { ok: false, why: `From ${m.availableFrom}` };
  }
  return { ok: true };
}

export function OrderScreen() {
  const { orderId } = useParams();
  if (!orderId) return <NewOrder />;
  return <OrderWorkspace orderId={orderId} />;
}

/** Takeaway / delivery order creation → token. */
function NewOrder() {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [type, setType] = useState<OrderType>((params.get('type') as OrderType) || 'takeaway');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    const o = await createOrder(device, { tenantId: s.tenant.id, storeId: s.store.id, type, customerName: name.trim() || undefined, customerPhone: phone.trim() || undefined, waiterId: s.user.id, source: 'pos' });
    setBusy(false);
    nav(`/order/${o.id}`, { replace: true });
  };
  return (
    <div className="pos-center">
      <div className="ex-card" style={{ width: 'min(520px, 100%)', padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 20, fontWeight: 750 }}>New order</div>
        <Segmented size="lg" label="Order type" value={type} onChange={(t) => (t === 'dine-in' ? nav('/tables') : setType(t))} items={[{ key: 'dine-in', label: 'Dine-in', icon: 'Armchair' }, { key: 'takeaway', label: 'Takeaway', icon: 'ShoppingBag' }, { key: 'delivery', label: 'Delivery', icon: 'Bike' }]} />
        <TextField label="Customer name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" autoFocus />
        <TextField label="Mobile" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={type === 'delivery' ? 'Required for delivery' : 'Optional'} />
        <div className="ex-hint">A token number is issued for {type} orders and printed on the KOT.</div>
        <Button variant="primary" size="lg" icon="Ticket" loading={busy} disabled={type === 'delivery' && phone.trim().length < 10} onClick={create}>Start {type} order</Button>
      </div>
    </div>
  );
}

function OrderWorkspace({ orderId }: { orderId: string }) {
  const s = useSession();
  const { device } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(1000);
  const order = useLive(device, ['orders'], () => device.get('orders', orderId), [orderId]);
  const menu = useLive(device, ['menuItems'], () => device.where('menuItems', (m) => m.tenantId === s.tenant.id), [s.tenant.id]);
  const groups = useLive(device, ['modifierGroups'], () => new Map(device.all('modifierGroups').map((g) => [g.id, g])), []);
  const cats = useMemo(() => {
    const ids = new Set(menu.map((m) => m.categoryId));
    return device.where('categories', (c) => ids.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [device, menu]);
  const [cat, setCat] = useState<string>('all');
  const [q, setQ] = useState('');
  const [modFor, setModFor] = useState<{ item: MenuItem; line?: OrderLine }>();
  const [voidLine, setVoidLine] = useState<OrderLine>();
  const [approval, setApproval] = useState<{ action: string; requested?: string; allowed?: string; onOk: (id: string, reason?: string) => void }>();
  const [discOpen, setDiscOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [pay, setPay] = useState<{ lineIds?: string[]; note?: string }>();
  const [sending, setSending] = useState(false);

  if (!order) return <EmptyState icon="ClipboardX" title="Order not found" actions={<Button onClick={() => nav('/tables')}>Back to tables</Button>}>It may have been settled on another counter.</EmptyState>;
  const closed = !!order.closedAt;
  const items = menu.filter((m) => (cat === 'all' || (cat === 'popular' ? m.popular : m.categoryId === cat)) && (!q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase())));
  const qtyInOrder = (id: string) => order.lines.filter((l) => l.menuItemId === id && l.state !== 'void').reduce((a, l) => a + l.qty, 0);
  const unsent = order.lines.filter((l) => l.state === 'unsent');
  const sent = order.lines.filter((l) => l.state !== 'unsent');
  const tot = orderTotals(order.lines, order.billDiscountPct);
  const write = (lines: OrderLine[], patch: Partial<RestaurantOrder> = {}) => saveOrder(device, { ...order, ...patch, lines });

  const addItem = (m: MenuItem, mods: SelectedModifier[] = [], qty = 1, note?: string, replace?: OrderLine) => {
    if (replace) return void write(order.lines.map((l) => (l.id === replace.id ? { ...l, modifiers: mods, qty, note, unitPricePaise: m.pricePaise } : l)));
    const same = !note && order.lines.find((l) => l.state === 'unsent' && l.menuItemId === m.id && JSON.stringify(l.modifiers.map((x) => x.optionId).sort()) === JSON.stringify(mods.map((x) => x.optionId).sort()) && !l.note);
    if (same) return void write(order.lines.map((l) => (l.id === same.id ? { ...l, qty: l.qty + qty } : l)));
    const line: OrderLine = { id: uid('ol'), menuItemId: m.id, name: m.name, qty, unitPricePaise: m.pricePaise, modifiers: mods, note, state: 'unsent', stationId: m.stationId, foodType: m.foodType };
    void write([...order.lines, line]);
  };

  const tapItem = (m: MenuItem) => {
    if (closed) return;
    const av = availableNow(m, now);
    if (!av.ok) return toast.warning(`${m.name} unavailable`, av.why);
    if (m.modifierGroupIds.length) setModFor({ item: m });
    else addItem(m);
  };

  const decItem = (m: MenuItem) => {
    const l = [...unsent].reverse().find((x) => x.menuItemId === m.id);
    if (!l) return toast.info('Sent items cannot be reduced here', 'Use Void on the sent line.');
    void write(l.qty > 1 ? order.lines.map((x) => (x.id === l.id ? { ...x, qty: x.qty - 1 } : x)) : order.lines.filter((x) => x.id !== l.id));
  };

  const doSend = async () => {
    setSending(true);
    try {
      const kots = await sendKot(device, order.id, s.user.id);
      const stations = kots.map((k) => `${k.displayNo} → ${device.get('stations', k.stationId)?.name ?? 'Kitchen'}`);
      toast.success(kots.length === 1 ? `${kots[0]!.displayNo} sent to ${device.get('stations', kots[0]!.stationId)?.name}` : `${kots.length} KOTs sent`, kots.length > 1 ? stations.join(' · ') : `${order.tableCode ? `Table ${order.tableCode}` : `Token ${order.token}`} · ${unsent.length} line(s)`);
    } catch (e) {
      toast.error('KOT not sent', `${(e as Error).message} Items stay unsent — retry.`);
    } finally {
      setSending(false);
    }
  };

  const confirmVoid = (line: OrderLine, reason: string) => {
    const go = (approvedBy?: string) => {
      void voidOrderLine(device, { orderId: order.id, lineId: line.id, reason, userId: s.user.id, approvedBy }).then(() => toast.warning(`Voided ${line.qty} × ${line.name}`, 'Void KOT sent to kitchen'));
    };
    setVoidLine(undefined);
    if (s.permissions.includes('restaurant.kot.void')) go(s.user.id);
    else setApproval({ action: `Void sent item · ${line.qty} × ${line.name}`, requested: money(orderLineTotal(line)), onOk: (id, r) => { void recordApproval(device, s, { action: 'kot-void', summary: `Void ${line.name} on ${order.orderNo}`, approverId: id, reason: r ?? reason }); go(id); } });
  };

  const applyDiscount = (pct: number) => {
    setDiscOpen(false);
    if (discountNeedsApproval(pct, s.role.discountLimitPct)) {
      setApproval({ action: `Bill discount on ${order.orderNo}`, requested: `${pct}%`, allowed: `${s.role.discountLimitPct}%`, onOk: (id, r) => { void recordApproval(device, s, { action: 'discount', summary: `Bill discount ${pct}% on ${order.orderNo}`, approverId: id, reason: r, requestedValue: pct, allowedValue: s.role.discountLimitPct }); void write(order.lines, { billDiscountPct: pct }); } });
    } else void write(order.lines, { billDiscountPct: pct });
  };

  const portion = pay?.lineIds ? order.lines.filter((l) => pay.lineIds!.includes(l.id)) : order.lines;
  const payTotal = orderTotals(portion, order.billDiscountPct).totalPaise;
  const canSettle = s.permissions.includes('pos.sell');
  const sentGroups = [...new Set(sent.map((l) => l.kotNo ?? 0))].sort((a, b) => a - b);
  const title = order.type === 'dine-in' ? `Table ${order.tableCode}` : `Token ${order.token}`;

  return (
    <div className="order">
      <section className="order__menu" aria-label="Menu">
        <div className="order__bar">
          <div className="ex-row">
            <div style={{ flex: 1, maxWidth: 420 }}><SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Search menu…" /></div>
            <span className="ex-spacer" />
            <span className="muted" style={{ fontSize: 12 }}>{items.length} items</span>
          </div>
          <CategoryChips
            size="lg"
            value={cat}
            onChange={setCat}
            items={[{ key: 'all', label: 'All', count: menu.length }, { key: 'popular', label: 'Popular', icon: 'Star', count: menu.filter((m) => m.popular).length }, ...cats.map((c) => ({ key: c.id, label: c.name, count: menu.filter((m) => m.categoryId === c.id).length }))]}
          />
        </div>
        <div className="order__grid">
          {items.map((m) => {
            const n = qtyInOrder(m.id);
            const av = availableNow(m, now);
            const color = device.get('categories', m.categoryId)?.color;
            return (
              <div key={m.id} role="button" tabIndex={0} className={cx('mcard', n > 0 && 'is-in', !av.ok && 'is-off')} onClick={() => tapItem(m)} onKeyDown={(e) => e.key === 'Enter' && tapItem(m)} aria-label={`${m.name} ${money(m.pricePaise)}${av.ok ? '' : ` — ${av.why}`}`}>
                <div className="mcard__tile">
                  <i style={{ background: color }} />
                  <FoodMark type={m.foodType} />
                  {!av.ok ? <Badge tone="danger" icon="Ban">{av.why}</Badge> : m.popular ? <Badge tone="warning" icon="Star">Popular</Badge> : null}
                  <span style={{ position: 'relative' }}>{initials(m.name)}</span>
                </div>
                <div className="mcard__body">
                  <div className="mcard__name">{m.name}</div>
                  {m.modifierGroupIds.length ? <div className="muted" style={{ fontSize: 11 }}>{m.modifierGroupIds.map((g) => groups.get(g)?.name).filter(Boolean).join(' · ')}</div> : null}
                  <div className="mcard__foot">
                    <span className="mcard__price num">{money(m.pricePaise)}</span>
                    {n > 0 && !m.modifierGroupIds.length ? (
                      <span onClick={(e) => e.stopPropagation()}><QuantityStepper size="sm" dark value={n} min={0} onChange={(v) => (v > n ? addItem(m) : decItem(m))} label={m.name} /></span>
                    ) : n > 0 ? (
                      <Badge tone="info" solid>{n} in order</Badge>
                    ) : av.ok ? (
                      <span className="mcard__add"><Icon name="Plus" size={14} />{m.modifierGroupIds.length ? 'Options' : 'Add'}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
          {!items.length ? <EmptyState quiet title="No dishes match" /> : null}
        </div>
      </section>

      <aside className="opanel" aria-label="Order">
        <div className="opanel__ctx">
          <div className="opanel__ctx-top">
            <IconButton icon="ArrowLeft" label="Back to tables" size="sm" onClick={() => nav(order.type === 'dine-in' ? '/tables' : '/running')} />
            <span className="opanel__ctx-title">{title}</span>
            <Badge>{order.type === 'dine-in' ? 'Dine-in' : order.type === 'takeaway' ? 'Takeaway' : 'Delivery'}</Badge>
            <span className="ex-spacer" />
            <StatusBadge meta={ORDER_STATUS[order.status]} />
          </div>
          <div className="opanel__meta">
            <span className="num"><Icon name="Hash" size={12} />{order.orderNo}</span>
            {order.guests ? <span><Icon name="Users" size={12} />{order.guests} guests</span> : null}
            {order.waiterId ? <span><Icon name="UserRound" size={12} />{device.get('users', order.waiterId)?.name}</span> : null}
            {order.customerName ? <span><Icon name="UserRound" size={12} />{order.customerName}</span> : null}
            <span className="num"><Icon name="Timer" size={12} />{elapsed(order.openedAt, now)}</span>
            <span><Icon name="Send" size={12} />{order.kotCount} KOT</span>
            {order.billRequested ? <Badge tone="danger" icon="Receipt">Bill requested</Badge> : null}
          </div>
        </div>
        <div className="opanel__lines">
          {!order.lines.length ? <EmptyState quiet title="No items yet">Tap dishes on the left to add them. Send KOT when ready.</EmptyState> : null}
          {unsent.length ? (
            <>
              <div className="opanel__group"><Icon name="PencilLine" size={12} />Unsent · {unsent.length}</div>
              {unsent.map((l) => (
                <div key={l.id} className="oline">
                  <FoodMark type={l.foodType} />
                  <div style={{ minWidth: 0 }}>
                    <div className="oline__name">{l.name}</div>
                    {l.modifiers.length ? <div className="oline__mods">{l.modifiers.map((m) => m.name).join(', ')}</div> : null}
                    {l.note ? <div className="oline__note">“{l.note}”</div> : null}
                    <div className="oline__actions">
                      <QuantityStepper size="sm" value={l.qty} min={0} onChange={(v) => void write(v <= 0 ? order.lines.filter((x) => x.id !== l.id) : order.lines.map((x) => (x.id === l.id ? { ...x, qty: v } : x)))} label={l.name} />
                      <Button size="sm" variant="ghost" icon="Pencil" onClick={() => { const it = menu.find((m) => m.id === l.menuItemId); if (it) setModFor({ item: it, line: l }); }}>Edit</Button>
                    </div>
                  </div>
                  <div className="oline__right">
                    <b className="num">{money(orderLineTotal(l))}</b>
                    <IconButton icon="Trash2" size="sm" label={`Remove ${l.name}`} onClick={() => void write(order.lines.filter((x) => x.id !== l.id))} />
                  </div>
                </div>
              ))}
            </>
          ) : null}
          {sentGroups.map((k) => (
            <div key={k}>
              <div className="opanel__group"><Icon name="Send" size={12} />Sent · KOT {k}</div>
              {sent.filter((l) => (l.kotNo ?? 0) === k).map((l) => (
                <div key={l.id} className={cx('oline', l.state === 'void' && 'oline--void')}>
                  <FoodMark type={l.foodType} />
                  <div style={{ minWidth: 0 }}>
                    <div className="oline__name">{l.qty} × {l.name}</div>
                    {l.modifiers.length ? <div className="oline__mods">{l.modifiers.map((m) => m.name).join(', ')}</div> : null}
                    {l.note ? <div className="oline__note">“{l.note}”</div> : null}
                    {l.voidReason ? <div className="oline__note" style={{ color: 'var(--status-danger)' }}>Void: {l.voidReason}</div> : null}
                  </div>
                  <div className="oline__right">
                    <b className="num">{l.state === 'void' ? <s>{money(orderLineTotal(l))}</s> : money(orderLineTotal(l))}</b>
                    <span className="ex-row" style={{ gap: 2 }}>
                      {l.state !== 'void' && !closed ? <Button size="sm" variant="ghost" onClick={() => setVoidLine(l)} aria-label={`Void ${l.name}`}>Void</Button> : null}
                      <StatusBadge meta={LINE_STATE[l.state]} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="opanel__totals">
          <div className="bill__trow"><span>Subtotal · {tot.itemCount} items</span><b className="num">{money(tot.subtotalPaise)}</b></div>
          {tot.discountPaise ? <div className="bill__trow"><span>Discount ({order.billDiscountPct}%)</span><b className="num">−{money(tot.discountPaise)}</b></div> : null}
          <div className="bill__trow"><span>CGST + SGST (5%)</span><b className="num">{money(tot.cgstPaise)} + {money(tot.sgstPaise)}</b></div>
          {tot.roundOffPaise ? <div className="bill__trow"><span>Round off</span><b className="num">{money(tot.roundOffPaise, { signed: true })}</b></div> : null}
          <div className="opanel__total"><span style={{ fontWeight: 750 }}>TOTAL</span><b className="num">{money(tot.totalPaise)}</b></div>
        </div>
        {closed ? (
          <div style={{ padding: '0 14px 14px' }}><InlineAlert tone="success" icon="CircleCheck" title="Order settled">Bill posted. Start a new order from Tables.</InlineAlert></div>
        ) : (
          <div className="opanel__actions">
            <Button variant={unsent.length ? 'primary' : 'secondary'} size="xl" icon="Send" style={{ gridColumn: 'span 2' }} disabled={!unsent.length || !s.permissions.includes('restaurant.kot.send')} loading={sending} onClick={doSend}>
              Send KOT{unsent.length ? ` · ${unsent.reduce((a, l) => a + l.qty, 0)} items` : ''}
            </Button>
            <Button size="lg" icon="Percent" disabled={!sent.length || !s.permissions.includes('pos.discount.bill')} onClick={() => setDiscOpen(true)}>Discount</Button>
            <Button size="lg" icon="Receipt" disabled={!sent.length || order.billRequested} onClick={async () => { await requestBill(device, order.id); toast.info('Bill requested', `${title} marked Bill Requested`); }}>{order.billRequested ? 'Bill requested' : 'Request bill'}</Button>
            <Button size="lg" icon="Split" disabled={!sent.length || !s.permissions.includes('restaurant.bill.split') || !canSettle} onClick={() => setSplitOpen(true)}>Split bill</Button>
            <Button variant={!unsent.length && sent.length ? 'primary' : 'secondary'} size="lg" icon="Wallet" disabled={!sent.length || !!unsent.length || !canSettle} onClick={() => (s.shift ? setPay({}) : toast.warning('Open a shift to settle bills', 'Shift → Day-In on this counter.'))}>Pay</Button>
            {unsent.length && sent.length ? <div className="ex-hint" style={{ gridColumn: 'span 2', textAlign: 'center' }}>Send or remove unsent items before settling.</div> : null}
            {!canSettle ? <div className="ex-hint" style={{ gridColumn: 'span 2', textAlign: 'center' }}>Bills are settled by the cashier.</div> : null}
          </div>
        )}
      </aside>

      {modFor ? <ModifierSheet item={modFor.item} line={modFor.line} groups={modFor.item.modifierGroupIds.map((g) => groups.get(g)!).filter(Boolean)} onClose={() => setModFor(undefined)} onAdd={(mods, qty, note) => { addItem(modFor.item, mods, qty, note, modFor.line); setModFor(undefined); }} /> : null}
      <ConfirmDialog open={!!voidLine} onClose={() => setVoidLine(undefined)} title={`Void ${voidLine?.qty} × ${voidLine?.name}?`} confirmLabel={s.permissions.includes('restaurant.kot.void') ? 'Void item' : 'Continue to approval'} requireReason reasonLabel="Void reason" onConfirm={(r) => voidLine && confirmVoid(voidLine, (r ?? '').trim())}>
        This item was already sent to the kitchen. A VOID KOT is printed at the station; KOT history is kept.
      </ConfirmDialog>
      <ApprovalDialog open={!!approval} onClose={() => setApproval(undefined)} action={approval?.action ?? ''} requested={approval?.requested} allowed={approval?.allowed} verify={managerVerifier(device, s)} onApproved={(r) => { approval?.onOk(r.approverId, r.reason); setApproval(undefined); }} />
      <DiscountDialog open={discOpen} current={order.billDiscountPct} limit={s.role.discountLimitPct} onClose={() => setDiscOpen(false)} onApply={applyDiscount} />
      {splitOpen ? <SplitDialog order={order} onClose={() => setSplitOpen(false)} onPay={(lineIds, note) => { setSplitOpen(false); if (!s.shift) return toast.warning('Open a shift to settle bills'); setPay({ lineIds, note }); }} /> : null}
      <PaymentModal
        open={!!pay}
        onClose={() => setPay(undefined)}
        duePaise={payTotal}
        title={`Settle ${title}`}
        context={`${order.orderNo} · ${portion.filter((l) => l.state !== 'void').length} lines${pay?.lineIds ? ' · split by items' : ''}${pay?.note ? ` · ${pay.note}` : ''}`}
        onCommit={(tenders, clientTransactionId) => {
          const origin = originOf(s);
          if (!origin) return Promise.reject(new Error('Open a shift before settling bills.'));
          return settleOrder(device, { clientTransactionId, orderId: order.id, origin, tenders, billDiscountPct: order.billDiscountPct, lineIds: pay?.lineIds });
        }}
        onDone={() => {
          const wasPartial = !!pay?.lineIds;
          setPay(undefined);
          const fresh = device.get('orders', order.id);
          if (!wasPartial || fresh?.closedAt) nav(order.type === 'dine-in' ? '/tables' : '/running');
        }}
      />
    </div>
  );
}

function ModifierSheet({ item, line, groups, onClose, onAdd }: { item: MenuItem; line?: OrderLine; groups: ModifierGroup[]; onClose: () => void; onAdd: (mods: SelectedModifier[], qty: number, note?: string) => void }) {
  const [sel, setSel] = useState<SelectedModifier[]>(line?.modifiers ?? []);
  const [qty, setQty] = useState(line?.qty ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  const [tried, setTried] = useState(false);
  const v = validateModifiers(groups, sel);
  const unit = menuItemUnitPrice(item, sel);
  const toggle = (g: ModifierGroup, optId: string) => {
    const opt = g.options.find((o) => o.id === optId)!;
    const has = sel.some((x) => x.optionId === optId);
    if (has) return setSel(sel.filter((x) => x.optionId !== optId));
    const mine = sel.filter((x) => x.groupId === g.id);
    const next: SelectedModifier = { groupId: g.id, groupName: g.name, optionId: opt.id, name: opt.name, pricePaise: opt.pricePaise };
    if (g.max === 1) setSel([...sel.filter((x) => x.groupId !== g.id), next]);
    else if (mine.length < g.max) setSel([...sel, next]);
  };
  return (
    <Modal open onClose={onClose} size="md" title={item.name} description={item.description}
      footer={
        <div className="ex-row" style={{ width: '100%' }}>
          <QuantityStepper size="lg" value={qty} min={1} onChange={setQty} label="Quantity" />
          <span className="ex-spacer" />
          {tried && !v.valid ? <span style={{ color: 'var(--status-danger)', fontSize: 13, fontWeight: 600 }}>Choose {v.missing.join(', ')}</span> : null}
          <Button variant="primary" size="lg" icon={line ? 'Check' : 'Plus'} onClick={() => { setTried(true); if (v.valid) onAdd(sel, qty, note.trim() || undefined); }}>
            {line ? 'Update' : 'Add'} · {money(unit * qty)}
          </Button>
        </div>
      }>
      <div className="mods">
        {groups.map((g) => {
          const missing = tried && v.missing.includes(g.name);
          return (
            <div key={g.id} className={cx('mods__group', missing && 'is-missing')}>
              <div className="mods__head">
                {g.name}
                {g.required ? <Badge tone={missing ? 'danger' : 'warning'}>Required</Badge> : <Badge>Optional{g.max > 1 ? ` · up to ${g.max}` : ''}</Badge>}
              </div>
              <div className="mods__opts" role={g.max === 1 ? 'radiogroup' : 'group'} aria-label={g.name}>
                {g.options.map((o) => {
                  const on = sel.some((x) => x.optionId === o.id);
                  return (
                    <button key={o.id} type="button" className="mods__opt" aria-pressed={on} onClick={() => toggle(g, o.id)}>
                      {on ? <Icon name="Check" size={15} /> : null}
                      {o.name}
                      {o.pricePaise ? <span className="num" style={{ opacity: 0.8 }}>+{money(o.pricePaise)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <Textarea label="Kitchen note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. No onion, less oil" />
      </div>
    </Modal>
  );
}

function DiscountDialog({ open, current, limit, onClose, onApply }: { open: boolean; current: number; limit: number; onClose: () => void; onApply: (pct: number) => void }) {
  const [v, setV] = useState(current);
  useEffect(() => { if (open) setV(current); }, [open, current]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Bill discount" description={`Your limit without approval: ${limit}%`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onApply(v)}>{v > limit ? 'Request approval' : 'Apply'}</Button></>}>
      <div className="ex-row" style={{ flexWrap: 'wrap' }}>
        {[0, 5, 10, 15, 20, 25].map((x) => <button key={x} type="button" className="ex-chip ex-chip--lg" aria-pressed={v === x} onClick={() => setV(x)}>{x === 0 ? 'None' : `${x}%`}</button>)}
      </div>
      {v > limit ? <div style={{ marginTop: 12 }}><InlineAlert tone="warning" icon="ShieldCheck">Above your {limit}% limit — manager PIN required.</InlineAlert></div> : null}
    </Modal>
  );
}

function SplitDialog({ order, onClose, onPay }: { order: RestaurantOrder; onClose: () => void; onPay: (lineIds: string[] | undefined, note?: string) => void }) {
  const [mode, setMode] = useState<'items' | 'equal'>('items');
  const live = order.lines.filter((l) => l.state !== 'void');
  const [picked, setPicked] = useState<string[]>([]);
  const [ways, setWays] = useState(Math.max(2, order.guests ?? 2));
  const total = orderTotals(order.lines, order.billDiscountPct).totalPaise;
  const pickedTotal = orderTotals(live.filter((l) => picked.includes(l.id)), order.billDiscountPct).totalPaise;
  return (
    <Modal open onClose={onClose} size="md" title="Split bill" description={`${order.orderNo} · total ${money(total)}`}
      footer={mode === 'items'
        ? <><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Wallet" disabled={!picked.length} onClick={() => onPay(picked.length === live.length ? undefined : picked)}>Pay selected · {money(pickedTotal)}</Button></>
        : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Wallet" onClick={() => onPay(undefined, `Equal split ${ways} × ${money(Math.ceil(total / ways / 100) * 100)} — record each guest with Split`)}>Collect {ways} payments</Button></>}>
      <div className="ex-stack">
        <Segmented value={mode} onChange={setMode} items={[{ key: 'items', label: 'By items', icon: 'ListChecks' }, { key: 'equal', label: 'Equal split', icon: 'Users' }]} />
        {mode === 'items' ? (
          <div className="pos-list">
            {live.map((l) => (
              <label key={l.id} className="pos-list__row" style={{ cursor: 'pointer' }}>
                <Checkbox label="" checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
                <span style={{ flex: 1 }}>{l.qty} × {l.name}{l.modifiers.length ? <span className="muted"> · {l.modifiers.map((m) => m.name).join(', ')}</span> : null}</span>
                <b className="num">{money(orderLineTotal(l))}</b>
              </label>
            ))}
          </div>
        ) : (
          <div className="ex-stack" style={{ alignItems: 'center', padding: 12 }}>
            <QuantityStepper size="lg" value={ways} min={2} max={20} onChange={setWays} label="Number of guests" />
            <div className="num" style={{ fontSize: 28, fontWeight: 800 }}>{ways} × {money(Math.ceil(total / ways / 100) * 100)}</div>
            <div className="muted" style={{ fontSize: 13 }}>One invoice; each guest's payment is recorded as a split tender.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
