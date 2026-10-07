import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Kot, KotStatus } from '@elixir/contracts';
import { kotUrgency } from '@elixir/domain';
import { elapsed, time } from '@elixir/format';
import { setKotStatus } from '@elixir/local-store';
import { useLive, useNow } from '@elixir/local-store/react';
import { applyTheme, Badge, Button, CategoryChips, EmptyState, getThemePref, Icon, useToast, cx } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';

const URGENCY = {
  normal: { label: 'On time', icon: 'Clock', tone: 'info' as const },
  warning: { label: 'Due soon', icon: 'AlarmClock', tone: 'warning' as const },
  late: { label: 'Late', icon: 'Siren', tone: 'danger' as const },
};

const COLS: Array<{ key: 'new' | 'preparing' | 'ready'; label: string; statuses: KotStatus[]; icon: string }> = [
  { key: 'new', label: 'NEW', statuses: ['new'], icon: 'Sparkle' },
  { key: 'preparing', label: 'PREPARING', statuses: ['accepted', 'preparing'], icon: 'Flame' },
  { key: 'ready', label: 'READY', statuses: ['ready'], icon: 'BellRing' },
];

/** Kitchen Display (§18): large, high-contrast, big targets, no back-office controls. */
export function KdsScreen() {
  const s = useSession();
  const { device, lock } = usePos();
  const nav = useNavigate();
  const toast = useToast();
  const now = useNow(1000);
  const [station, setStation] = useState('all');
  const [hc, setHc] = useState(false);
  const [dark, setDark] = useState(getThemePref() === 'dark');
  const stations = useLive(device, ['stations'], () => device.where('stations', (x) => x.storeId === s.store.id), [s.store.id]);
  const prep = useLive(device, ['menuItems'], () => new Map(device.where('menuItems', (m) => m.tenantId === s.tenant.id).map((m) => [m.name, m.prepMinutes])), [s.tenant.id]);
  const kots = useLive(device, ['kots'], () => device.where('kots', (k) => k.storeId === s.store.id && ['new', 'accepted', 'preparing', 'ready'].includes(k.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.store.id]);
  const visible = kots.filter((k) => station === 'all' || k.stationId === station);
  const isKitchen = s.user.role === 'kitchen' || s.counter?.kind === 'kitchen';
  const target = (k: Kot) => Math.max(8, ...k.items.map((i) => prep.get(i.name) ?? 12));

  const advance = async (k: Kot, to: KotStatus) => {
    await setKotStatus(device, k.id, to);
    if (to === 'ready') toast.success(`${k.displayNo} ready`, k.tableCode ? `Table ${k.tableCode}` : `Token ${k.token}`);
  };

  return (
    <div className={cx('kds', hc && 'kds--hc')}>
      <div className="kds__bar">
        <Icon name="ChefHat" size={22} />
        <b style={{ fontSize: 18 }}>Kitchen Display</b>
        <span className="muted num">{time(now, true)}</span>
        <div style={{ marginLeft: 12, minWidth: 0, flex: 1 }}>
          <CategoryChips size="lg" label="Stations" value={station} onChange={setStation} items={[{ key: 'all', label: 'All stations', count: kots.length }, ...stations.map((st) => ({ key: st.id, label: st.name, count: kots.filter((k) => k.stationId === st.id).length }))]} />
        </div>
        <Button size="lg" variant={hc ? 'primary' : 'secondary'} icon="Contrast" onClick={() => setHc((x) => !x)}>High contrast</Button>
        <Button size="lg" icon={dark ? 'Sun' : 'Moon'} onClick={() => { applyTheme(dark ? 'light' : 'dark'); setDark(!dark); }}>{dark ? 'Light' : 'Dark'}</Button>
        {isKitchen ? <Button size="lg" icon="Lock" onClick={lock}>Lock</Button> : <Button size="lg" icon="LogOut" onClick={() => nav('/tables')}>Exit KDS</Button>}
      </div>
      <div className="kds__cols">
        {COLS.map((c) => {
          const list = visible.filter((k) => c.statuses.includes(k.status));
          return (
            <section key={c.key} className="kds__col" aria-label={`${c.label} tickets`}>
              <div className="kds__colhead"><Icon name={c.icon} size={18} />{c.label}<span className="ex-count">{list.length}</span></div>
              <div className="kds__list">
                {list.length === 0 ? <EmptyState quiet title={c.key === 'new' ? 'No active kitchen tickets.' : c.key === 'preparing' ? 'Nothing cooking.' : 'Nothing waiting for pickup.'} /> : null}
                {list.map((k) => {
                  const u = k.isVoid ? 'normal' : kotUrgency(k.createdAt, target(k), now);
                  const meta = URGENCY[u];
                  return (
                    <article key={k.id} className={cx('ticket', `ticket--${u}`, k.isVoid && 'ticket--void')} aria-label={`${k.displayNo} ${meta.label}`}>
                      <div className="ticket__head">
                        <div>
                          <div className="ticket__no">{k.displayNo}</div>
                          <div className="ticket__where">{k.tableCode ? `Table ${k.tableCode}` : `Token ${k.token}`} <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>· {k.orderType === 'dine-in' ? 'Dine-in' : k.orderType === 'takeaway' ? 'Takeaway' : 'Delivery'}</span></div>
                          <div className="muted" style={{ fontSize: 12 }}>{stations.find((x) => x.id === k.stationId)?.name}</div>
                        </div>
                        <div className="ticket__age">
                          <span className="ticket__timer" style={{ color: u === 'late' ? 'var(--status-danger)' : u === 'warning' ? 'var(--status-warning)' : undefined }}>{elapsed(k.createdAt, now)}</span>
                          {k.isVoid ? <Badge tone="danger" icon="Ban" size="lg">VOID</Badge> : <Badge tone={meta.tone} icon={meta.icon} size="lg">{meta.label}</Badge>}
                        </div>
                      </div>
                      <div className="ticket__items">
                        {k.items.map((it, i) => (
                          <div key={i} className={cx('titem', (it.void || k.isVoid) && 'titem--void')}>
                            <span className="titem__qty">{it.qty}×</span>
                            <div>
                              <div className="titem__name">{it.name}</div>
                              {it.modifiers.length ? <div className="titem__mods">{it.modifiers.join(' · ')}</div> : null}
                              {it.note ? <div className="titem__note"><Icon name="MessageSquareWarning" size={14} /> {k.isVoid ? `Void: ${it.note}` : it.note}</div> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      {s.permissions.includes('kds.operate') ? (
                        <div className="ticket__foot">
                          {k.isVoid ? (
                            <Button variant="danger-outline" icon="Check" onClick={() => void advance(k, 'completed')}>Acknowledge void</Button>
                          ) : k.status === 'new' ? (
                            <Button variant="primary" icon="Flame" onClick={() => void advance(k, 'preparing')}>Start</Button>
                          ) : k.status === 'ready' ? (
                            <Button variant="success" icon="HandPlatter" onClick={() => void advance(k, 'completed')}>{k.orderType === 'dine-in' ? 'Served' : 'Collected'}</Button>
                          ) : (
                            <Button variant="primary" icon="BellRing" onClick={() => void advance(k, 'ready')}>Ready</Button>
                          )}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
