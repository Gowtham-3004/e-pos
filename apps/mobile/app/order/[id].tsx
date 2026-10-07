import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { MenuItem, ModifierGroup, OrderLine, SelectedModifier } from '@elixir/contracts';
import { KOT_STATUS, TABLE_STATUS, menuItemUnitPrice, orderLineTotal, orderTotals, tableStatusFromOrder, uid, validateModifiers, type StatusMeta } from '@elixir/domain';
import { useEntity, useLive, useNow } from '@elixir/local-store/react';
import { elapsed, money, time } from '@elixir/format';
import { useApp, useSession } from '../../src/lib/app';
import { askBill, requestVoid, saveDraft, send, type VoidApproval } from '../../src/lib/actions';
import { useTheme } from '../../src/lib/theme';
import {
  Badge, Button, Card, Chip, ChipRow, Divider, EmptyState, FoodMark, Header, Icon, InlineAlert, KeyValue, OfflinePill, Row, Screen, SearchField, Segmented, Sheet, StatusBadge, Stepper, T,
  TextArea, useToast,
} from '../../src/ui';

const LINE_STATE: Record<OrderLine['state'], StatusMeta> = {
  unsent: { label: 'Not sent', tone: 'warning', icon: 'Clock' },
  sent: { label: 'Sent', tone: 'info', icon: 'Send' },
  preparing: { label: 'Preparing', tone: 'warning', icon: 'Flame' },
  ready: { label: 'Ready', tone: 'success', icon: 'BellRing' },
  served: { label: 'Served', tone: 'neutral', icon: 'HandPlatter' },
  void: { label: 'Voided', tone: 'danger', icon: 'CircleX' },
};

const VOID_REASONS = ['Customer changed order', 'Wrong item entered', 'Long wait — customer cancelled', 'Quality issue'];

const sameMods = (a: SelectedModifier[], b: SelectedModifier[]) => a.map((m) => m.optionId).sort().join() === b.map((m) => m.optionId).sort().join();

export default function OrderScreen() {
  const t = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { device } = useApp();
  const s = useSession();
  const now = useNow(1000);
  const order = useEntity(device, 'orders', id);
  const [tab, setTab] = useState<'menu' | 'review'>('menu');
  const [cat, setCat] = useState<string>('popular');
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<MenuItem>();
  const [voiding, setVoiding] = useState<OrderLine>();
  const [sending, setSending] = useState(false);
  const [billConfirm, setBillConfirm] = useState(false);

  const menu = useLive(device, ['menuItems'], () => device.where('menuItems', (m) => m.tenantId === s.tenant.id), [s.tenant.id]);
  const cats = useMemo(() => device.where('categories', (c) => c.tenantId === s.tenant.id).sort((a, b) => a.sortOrder - b.sortOrder), [device, s.tenant.id]);
  const groups = useMemo(() => new Map(device.all('modifierGroups').map((g) => [g.id, g])), [device]);
  const kots = useLive(device, ['kots'], () => device.where('kots', (k) => k.orderId === id), [id]);
  const pendingVoids = useLive(device, ['approvals'], () => device.where('approvals', (a) => a.status === 'pending' && a.action === 'kot-void' && (a as VoidApproval).orderId === id) as VoidApproval[], [id]);

  // A waiter reopening a settled order goes back to tables.
  useEffect(() => {
    if (order?.closedAt) router.replace('/tables');
  }, [order?.closedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!order) {
    return (
      <Screen header={<Header back title="Order" />}>
        <EmptyState icon="ClipboardList" title="Order not found" body="It may have been settled or moved on another device." action="Back to tables" onAction={() => router.replace('/tables')} />
      </Screen>
    );
  }

  const unsent = order.lines.filter((l) => l.state === 'unsent');
  const unsentQty = unsent.reduce((x, l) => x + l.qty, 0);
  const unsentTotal = unsent.reduce((x, l) => x + orderLineTotal(l), 0);
  const totals = orderTotals(order.lines, order.billDiscountPct);
  const tableMeta = TABLE_STATUS[tableStatusFromOrder(order)];
  const waiter = device.get('users', order.waiterId);

  const filtered = menu.filter((m) => {
    if (q) return m.name.toLowerCase().includes(q.toLowerCase());
    if (cat === 'popular') return !!m.popular;
    return m.categoryId === cat;
  });
  const qtyInOrder = (m: MenuItem) => unsent.filter((l) => l.menuItemId === m.id).reduce((x, l) => x + l.qty, 0);

  const addLine = async (item: MenuItem, mods: SelectedModifier[], qty: number, note?: string) => {
    await saveDraft(device, order.id, (lines) => {
      const existing = !note ? lines.find((l) => l.state === 'unsent' && l.menuItemId === item.id && !l.note && sameMods(l.modifiers, mods)) : undefined;
      return existing
        ? lines.map((l) => (l.id === existing.id ? { ...l, qty: l.qty + qty } : l))
        : [...lines, { id: uid('ol'), menuItemId: item.id, name: item.name, qty, unitPricePaise: item.pricePaise, modifiers: mods, note: note || undefined, state: 'unsent' as const, stationId: item.stationId, foodType: item.foodType }];
    });
    toast(`Added ${qty} × ${item.name}`, { body: mods.length ? mods.map((m) => m.name).join(', ') : undefined, haptic: 'light' });
  };

  const setQty = async (line: OrderLine, qty: number) => {
    await saveDraft(device, order.id, (lines) => (qty <= 0 ? lines.filter((l) => l.id !== line.id) : lines.map((l) => (l.id === line.id ? { ...l, qty } : l))));
  };

  const quickQty = async (item: MenuItem, delta: number) => {
    const line = unsent.find((l) => l.menuItemId === item.id && !l.note && !l.modifiers.length);
    if (line) await setQty(line, line.qty + delta);
    else if (delta > 0) await addLine(item, [], 1);
  };

  const doSend = async () => {
    setSending(true);
    try {
      const sent = await send(device, s, order.id);
      const stations = [...new Set(sent.map((k) => device.get('stations', k.stationId)?.name).filter(Boolean))].join(', ');
      toast(`${sent.map((k) => k.displayNo).join(', ')} sent`, { body: `${unsentQty} item${unsentQty > 1 ? 's' : ''} → ${stations}`, haptic: 'success' });
      setTab('review');
    } catch (e) {
      toast('KOT not sent', { body: `${(e as Error).message}. Your items are still saved on this phone.`, tone: 'danger', haptic: 'error' });
    } finally {
      setSending(false);
    }
  };

  // ───────── sections ─────────
  const sentByKot = new Map<string, OrderLine[]>();
  order.lines.filter((l) => l.state !== 'unsent').forEach((l) => sentByKot.set(l.kotId ?? 'x', [...(sentByKot.get(l.kotId ?? 'x') ?? []), l]));
  const kotOrder = [...sentByKot.keys()].sort((a, b) => (device.get('kots', b)?.createdAt ?? '').localeCompare(device.get('kots', a)?.createdAt ?? ''));

  const footer = (
    <View style={{ gap: 8 }}>
      {unsent.length ? (
        <Row gap={10}>
          {tab === 'menu' ? <Button label={`Review`} variant="secondary" size="lg" onPress={() => setTab('review')} style={{ flex: 1 }} /> : null}
          <Button label={`Send KOT · ${unsentQty} item${unsentQty > 1 ? 's' : ''}`} sublabel={money(unsentTotal)} icon="Send" size="lg" loading={sending} onPress={doSend} style={{ flex: 2 }} />
        </Row>
      ) : (
        <Row gap={10}>
          <Button label={order.billRequested ? 'Bill requested' : 'Request bill'} icon="Receipt" variant="secondary" size="lg" disabled={order.billRequested || !order.lines.some((l) => l.state !== 'void')} onPress={() => setBillConfirm(true)} style={{ flex: 1 }} />
          {tab === 'review' ? <Button label="Add items" icon="Plus" size="lg" onPress={() => setTab('menu')} style={{ flex: 1 }} /> : <Button label="Review order" size="lg" onPress={() => setTab('review')} style={{ flex: 1 }} />}
        </Row>
      )}
    </View>
  );

  return (
    <Screen
      scroll={false}
      edgesBottom
      header={
        <Header
          back
          title={order.tableCode ? `Table ${order.tableCode}` : `Token ${order.token}`}
          subtitle={`${order.orderNo} · ${order.guests ?? '—'} guests · ${elapsed(order.openedAt, now)}${waiter ? ` · ${waiter.name.split(' ')[0]}` : ''}`}
          right={
            <View style={{ alignItems: 'flex-end', gap: 4, paddingRight: 8 }}>
              <OfflinePill compact />
            </View>
          }
        />
      }
      footer={footer}
    >
      <View style={{ backgroundColor: t.c.surface.primary, paddingHorizontal: 16, paddingTop: 10, paddingBottom: tab === 'menu' ? 0 : 10, borderBottomWidth: 1, borderBottomColor: t.c.border.default, gap: 10 }}>
        <Row gap={8}>
          <StatusBadge meta={tableMeta} />
          {order.billRequested ? <Badge tone="danger" icon="Receipt" label="Bill requested" /> : null}
          <View style={{ flex: 1 }} />
          <T v="label" num>{money(totals.totalPaise)}</T>
        </Row>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'menu', label: 'Menu', icon: 'Utensils' },
            { value: 'review', label: 'Review', count: order.lines.filter((l) => l.state !== 'void').length },
          ]}
        />
        {tab === 'menu' ? (
          <>
            <SearchField value={q} onChangeText={setQ} placeholder="Search dishes" />
            {!q ? (
              <View style={{ marginHorizontal: -16 }}>
                <ChipRow>
                  <Chip label="Popular" icon="Star" selected={cat === 'popular'} onPress={() => setCat('popular')} />
                  {cats.map((c) => (
                    <Chip key={c.id} label={c.name} selected={cat === c.id} onPress={() => setCat(c.id)} count={menu.filter((m) => m.categoryId === c.id).length} />
                  ))}
                </ChipRow>
              </View>
            ) : (
              <View style={{ height: 8 }} />
            )}
          </>
        ) : null}
      </View>

      {tab === 'menu' ? (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: 24, maxWidth: 720, width: '100%', alignSelf: 'center' }}
          ItemSeparatorComponent={() => <Divider inset={44} />}
          ListEmptyComponent={<EmptyState icon="Search" title="No dishes match" body="Try another name or category." />}
          renderItem={({ item: m }) => {
            const inOrder = qtyInOrder(m);
            const hasMods = m.modifierGroupIds.length > 0;
            const required = m.modifierGroupIds.some((g) => groups.get(g)?.required);
            return (
              <Pressable
                disabled={!m.available}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, ${money(m.pricePaise)}${m.available ? '' : ', sold out'}`}
                onPress={() => (hasMods ? setPicking(m) : void quickQty(m, 1))}
                style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 72, alignItems: 'center', backgroundColor: pressed ? t.c.surface.selected : t.c.surface.primary, opacity: m.available ? 1 : 0.55 })}
              >
                <View style={{ paddingTop: 2, alignSelf: 'flex-start' }}>
                  <FoodMark type={m.foodType} size={16} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={6}>
                    <T v="bodyStrong" lines={1} style={{ flexShrink: 1 }}>{m.name}</T>
                    {m.popular ? <Icon name="Star" size={12} color={t.c.status.warning} /> : null}
                  </Row>
                  <T v="meta" c="secondary" lines={1}>{m.description}</T>
                  <Row gap={8}>
                    <T v="label" num>{money(m.pricePaise)}</T>
                    {required ? <T v="meta" c="muted">· choose options</T> : hasMods ? <T v="meta" c="muted">· customisable</T> : null}
                  </Row>
                </View>
                {!m.available ? (
                  <Badge tone="danger" icon="Ban" label="Sold out" size="sm" />
                ) : !hasMods && inOrder > 0 ? (
                  <Stepper value={inOrder} onChange={(v) => void quickQty(m, v - inOrder)} size={40} label={m.name} />
                ) : (
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, height: 40, paddingHorizontal: 14, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border.strong, backgroundColor: t.c.surface.primary }}>
                      <Icon name="Plus" size={16} color={t.c.text.primary} />
                      <T v="label">Add</T>
                    </View>
                    {inOrder ? <T v="meta" c="info" num>{`${inOrder} in order`}</T> : null}
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          {order.billRequested ? <InlineAlert tone="info" icon="Receipt" title="Bill requested">The cashier has been notified to prepare the bill for this table.</InlineAlert> : null}
          {unsent.length ? (
            <Card padded={false} style={{ borderColor: t.c.status.warning + '66' }}>
              <Row style={{ padding: 12, paddingBottom: 4 }}>
                <StatusBadge meta={LINE_STATE.unsent} />
                <T v="meta" c="secondary" style={{ flex: 1 }}>{`  ${unsentQty} item${unsentQty > 1 ? 's' : ''} saved on this phone`}</T>
              </Row>
              {unsent.map((l, i) => (
                <View key={l.id}>
                  {i ? <Divider inset={16} /> : null}
                  <Row gap={10} style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                    <FoodMark type={l.foodType} />
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" lines={2}>{l.name}</T>
                      {l.modifiers.length || l.note ? <T v="meta" c="secondary">{[...l.modifiers.map((m) => m.name), l.note && `“${l.note}”`].filter(Boolean).join(' · ')}</T> : null}
                      <T v="meta" num c="muted">{money(orderLineTotal(l))}</T>
                    </View>
                    <Stepper value={l.qty} onChange={(v) => void setQty(l, v)} size={40} label={l.name} />
                  </Row>
                </View>
              ))}
            </Card>
          ) : null}

          {kotOrder.map((kid) => {
            const kot = device.get('kots', kid);
            const lines = sentByKot.get(kid)!;
            return (
              <Card key={kid} padded={false}>
                <Row style={{ padding: 12 }}>
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">{kot?.displayNo ?? 'KOT'}</T>
                    <T v="meta" c="secondary">{[device.get('stations', kot?.stationId)?.name, kot && time(kot.createdAt)].filter(Boolean).join(' · ')}</T>
                  </View>
                  {kot ? <StatusBadge meta={KOT_STATUS[kot.status]} /> : null}
                </Row>
                <Divider />
                {lines.map((l, i) => {
                  const pv = pendingVoids.find((a) => a.lineId === l.id);
                  return (
                    <View key={l.id}>
                      {i ? <Divider inset={16} /> : null}
                      <Row gap={10} style={{ paddingHorizontal: 12, paddingVertical: 10 }} align="flex-start">
                        <View style={{ paddingTop: 3 }}>
                          <FoodMark type={l.foodType} />
                        </View>
                        <View style={{ flex: 1, gap: 3 }}>
                          <T v="bodyStrong" style={l.state === 'void' ? { textDecorationLine: 'line-through', color: t.c.text.muted } : undefined}>{`${l.qty} × ${l.name}`}</T>
                          {l.modifiers.length || l.note ? <T v="meta" c="secondary">{[...l.modifiers.map((m) => m.name), l.note && `“${l.note}”`].filter(Boolean).join(' · ')}</T> : null}
                          <Row gap={6} style={{ flexWrap: 'wrap' }}>
                            <StatusBadge meta={LINE_STATE[l.state]} size="sm" />
                            {pv ? <Badge size="sm" tone="warning" icon="Hourglass" label="Waiting for manager approval" /> : null}
                          </Row>
                          {l.voidReason ? <T v="meta" c="muted">{`Void reason: ${l.voidReason}`}</T> : null}
                        </View>
                        <View style={{ alignItems: 'flex-end', gap: 6 }}>
                          <T v="label" num style={l.state === 'void' ? { color: t.c.text.muted, textDecorationLine: 'line-through' } : undefined}>{money(orderLineTotal(l))}</T>
                          {l.state !== 'void' && l.state !== 'served' && !pv ? (
                            <Pressable accessibilityRole="button" accessibilityLabel={`Void ${l.name}`} onPress={() => setVoiding(l)} hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
                              <T v="label" c="danger">Void…</T>
                            </Pressable>
                          ) : null}
                        </View>
                      </Row>
                    </View>
                  );
                })}
              </Card>
            );
          })}

          {order.lines.length ? (
            <Card>
              <KeyValue label="Subtotal" value={money(totals.subtotalPaise)} />
              {totals.discountPaise ? <KeyValue label="Discount" value={`−${money(totals.discountPaise)}`} /> : null}
              <KeyValue label="CGST 2.5% + SGST 2.5%" value={money(totals.taxPaise)} />
              {totals.roundOffPaise ? <KeyValue label="Round off" value={money(totals.roundOffPaise, { signed: true })} /> : null}
              <Divider style={{ marginVertical: 8 }} />
              <KeyValue label="Total" value={money(totals.totalPaise)} strong />
            </Card>
          ) : (
            <EmptyState icon="Utensils" title="No items yet" body="Add dishes from the menu, then send the KOT to the kitchen." action="Open menu" onAction={() => setTab('menu')} />
          )}
        </ScrollView>
      )}

      <ModifierSheet item={picking} groups={groups} onClose={() => setPicking(undefined)} onAdd={(item, mods, qty, note) => { setPicking(undefined); void addLine(item, mods, qty, note); }} />
      <VoidSheet
        line={voiding}
        onClose={() => setVoiding(undefined)}
        onSubmit={async (line, reason) => {
          setVoiding(undefined);
          await requestVoid(device, s, order, line, reason);
          toast('Waiting for manager approval', { body: `Void ${line.qty} × ${line.name} — the kitchen is notified once approved`, tone: 'warning', haptic: 'warning' });
        }}
      />
      <Sheet
        open={billConfirm}
        onClose={() => setBillConfirm(false)}
        title={`Request bill · ${order.tableCode ? `Table ${order.tableCode}` : order.orderNo}`}
        subtitle={`${totals.itemCount} items · ${money(totals.totalPaise)}`}
        footer={
          <Button
            label="Request bill"
            icon="Receipt"
            size="lg"
            block
            onPress={async () => {
              setBillConfirm(false);
              await askBill(device, s, order.id);
              toast('Bill requested', { body: 'Cashier notified to print the bill', haptic: 'success' });
            }}
          />
        }
      >
        <T c="secondary">The table moves to “Bill Requested” and the cashier prepares the bill. You can still add items if the guests order more.</T>
      </Sheet>
    </Screen>
  );
}

/** Modifier bottom sheet: required groups block Add until valid (§63), notes, qty, live price. */
function ModifierSheet({ item, groups, onClose, onAdd }: { item?: MenuItem; groups: Map<string, ModifierGroup>; onClose: () => void; onAdd: (item: MenuItem, mods: SelectedModifier[], qty: number, note?: string) => void }) {
  const t = useTheme();
  const [sel, setSel] = useState<SelectedModifier[]>([]);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setSel([]);
    setQty(1);
    setNote('');
    setTried(false);
  }, [item?.id]);
  const gs = (item?.modifierGroupIds ?? []).map((g) => groups.get(g)).filter((g): g is ModifierGroup => !!g);
  const v = validateModifiers(gs, sel);
  const unit = item ? menuItemUnitPrice(item, sel) : 0;

  const toggle = (g: ModifierGroup, o: ModifierGroup['options'][number]) => {
    const has = sel.some((m) => m.optionId === o.id);
    const mod: SelectedModifier = { groupId: g.id, groupName: g.name, optionId: o.id, name: o.name, pricePaise: o.pricePaise };
    if (g.max === 1) setSel([...sel.filter((m) => m.groupId !== g.id), ...(has && !g.required ? [] : [mod])]);
    else if (has) setSel(sel.filter((m) => m.optionId !== o.id));
    else if (sel.filter((m) => m.groupId === g.id).length < g.max) setSel([...sel, mod]);
  };

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={item?.name ?? ''}
      subtitle={item ? `${money(item.pricePaise)} · ${item.description ?? ''}` : undefined}
      footer={
        <View style={{ gap: 8 }}>
          {tried && !v.valid ? <T v="meta" c="danger" center>{`Choose ${v.missing.join(', ')} to continue`}</T> : null}
          <Row gap={12}>
            <Stepper value={qty} onChange={setQty} min={1} max={50} />
            <Button
              label={v.valid ? `Add · ${money(unit * qty)}` : `Choose ${v.missing[0]}`}
              size="lg"
              variant={v.valid ? 'primary' : 'subtle'}
              icon={v.valid ? 'Plus' : 'AlertCircle'}
              onPress={() => (v.valid && item ? onAdd(item, sel, qty, note.trim()) : setTried(true))}
              style={{ flex: 1 }}
            />
          </Row>
        </View>
      }
    >
      <View style={{ gap: 18 }}>
        {gs.map((g) => {
          const n = sel.filter((m) => m.groupId === g.id).length;
          const missing = g.required && n < Math.max(1, g.min);
          return (
            <View key={g.id} style={{ gap: 8 }}>
              <Row>
                <T v="h3" style={{ flex: 1 }}>{g.name}</T>
                {g.required ? (
                  <Badge size="sm" tone={missing ? 'warning' : 'success'} icon={missing ? 'AlertCircle' : 'CircleCheck'} label={missing ? 'Required' : 'Done'} />
                ) : (
                  <T v="meta" c="muted">{g.max > 1 ? `Optional · up to ${g.max}` : 'Optional'}</T>
                )}
              </Row>
              <View style={{ borderWidth: 1, borderColor: missing && tried ? t.c.status.warning : t.c.border.default, borderRadius: t.radius.md, overflow: 'hidden' }}>
                {g.options.map((o, i) => {
                  const on = sel.some((m) => m.optionId === o.id);
                  return (
                    <Pressable
                      key={o.id}
                      accessibilityRole={g.max === 1 ? 'radio' : 'checkbox'}
                      accessibilityState={{ checked: on }}
                      onPress={() => toggle(g, o)}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: t.c.border.default, backgroundColor: on ? t.c.surface.selected : pressed ? t.c.surface.sunken : t.c.surface.primary })}
                    >
                      <View style={{ width: 22, height: 22, borderRadius: g.max === 1 ? 11 : 5, borderWidth: 2, borderColor: on ? t.c.action.primary : t.c.border.strong, alignItems: 'center', justifyContent: 'center', backgroundColor: on && g.max > 1 ? t.c.action.primary : 'transparent' }}>
                        {on ? (g.max === 1 ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.c.action.primary }} /> : <Icon name="Check" size={14} color={t.c.text.inverse} />) : null}
                      </View>
                      <T v={on ? 'bodyStrong' : 'body'} style={{ flex: 1 }}>{o.name}</T>
                      <T v="meta" c="secondary" num>{o.pricePaise ? `+${money(o.pricePaise)}` : 'Included'}</T>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
        <TextArea label="Kitchen note" value={note} onChangeText={setNote} placeholder="e.g. No onion, extra gravy on side" />
      </View>
    </Sheet>
  );
}

function VoidSheet({ line, onClose, onSubmit }: { line?: OrderLine; onClose: () => void; onSubmit: (l: OrderLine, reason: string) => void }) {
  const [preset, setPreset] = useState<string>();
  const [note, setNote] = useState('');
  useEffect(() => {
    setPreset(undefined);
    setNote('');
  }, [line?.id]);
  const reason = [preset, note.trim()].filter(Boolean).join(' — ');
  return (
    <Sheet
      open={!!line}
      onClose={onClose}
      title={line ? `Void ${line.qty} × ${line.name}` : 'Void item'}
      subtitle="Sent items need manager approval"
      footer={<Button label="Request manager approval" icon="Shield" variant="danger" size="lg" block disabled={!reason} onPress={() => line && onSubmit(line, reason)} />}
    >
      <View style={{ gap: 14 }}>
        <InlineAlert tone="warning" title="This item is already in the kitchen">Once a manager approves, a VOID ticket goes to the kitchen. Sent history is never rewritten.</InlineAlert>
        <T v="label" c="secondary">Reason</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {VOID_REASONS.map((r) => (
            <Chip key={r} label={r} selected={preset === r} onPress={() => setPreset(preset === r ? undefined : r)} />
          ))}
        </View>
        <TextArea label="Note (optional)" value={note} onChangeText={setNote} placeholder="Add detail for the manager" />
      </View>
    </Sheet>
  );
}

