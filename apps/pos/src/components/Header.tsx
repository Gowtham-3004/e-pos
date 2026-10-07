import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CAPABILITY_LABEL, roleByCode } from '@elixir/domain';
import { dateLong, relative, time } from '@elixir/format';
import { faults } from '@elixir/local-store';
import { resetDemoData } from '@elixir/app-kit';
import { applyTheme, Avatar, Badge, Button, ConfirmDialog, ContextStrip, ElixirLogo, Icon, Menu, MenuItem, MenuLabel, MenuSeparator, SyncIndicator, getThemePref } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { businessDateOf } from '../lib/ops';
import { platformLabel } from '../lib/platform';

export function PosHeader({ showLogo }: { showLogo?: boolean }) {
  const s = useSession();
  return (
    <>
      {showLogo ? <ElixirLogo product="POS" size={24} /> : null}
      <ContextStrip
        items={[
          { label: 'Store', value: s.store.name },
          s.counter && { label: 'Counter', value: `${s.counter.code} · ${s.counter.name}` },
          { label: 'Device', value: `${s.device.code} · ${platformLabel()}` },
          { label: 'User', value: `${s.user.name.split(' ')[0]} · ${roleByCode(s.user.role).name}` },
          s.counter?.kind !== 'kitchen' && {
            label: 'Shift',
            value: s.shift ? <span className="num">{s.shift.code} · Open {time(s.shift.openedAt)}</span> : <span style={{ color: 'var(--status-warning)' }}>Not open</span>,
          },
          { label: 'Business date', value: <span className="num">{dateLong(businessDateOf(s))}</span> },
        ]}
      />
      <div className="ex-spacer" />
      {s.authMode === 'offline' ? <Badge tone="warning" icon="ShieldAlert" title={`Offline login · authorization valid until ${s.user.offlineAuthValidUntil ? dateLong(s.user.offlineAuthValidUntil) : '—'}`}>Offline login</Badge> : null}
      <NetworkMenu />
      <SyncPill />
      <UserMenu />
    </>
  );
}

export function NetworkMenu() {
  const { engine, network, binding, device } = usePos();
  const store = device.get('stores', binding?.storeId);
  const label = network.wan === 'offline' ? 'WAN offline' : network.cloud === 'down' ? 'Cloud down' : 'WAN online';
  return (
    <Menu
      trigger={(t) => (
        <Button size="sm" variant="ghost" icon="Antenna" {...t} title="Network simulator (demo)" aria-label={`Network simulator: ${label}`}>
          <span className="pos-hide-sm">{label}</span>
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Simulate network (demo)</MenuLabel>
          <MenuItem icon={network.wan === 'online' && network.cloud === 'up' ? 'CircleCheck' : 'Wifi'} onClick={() => { void engine?.setNetwork({ wan: 'online', cloud: 'up' }); close(); }}>Online</MenuItem>
          <MenuItem icon={network.wan === 'offline' ? 'CircleCheck' : 'WifiOff'} onClick={() => { void engine?.setNetwork({ wan: 'offline' }); close(); }}>Offline (internet down)</MenuItem>
          <MenuItem icon={network.wan === 'online' && network.cloud === 'down' ? 'CircleCheck' : 'CloudOff'} onClick={() => { void engine?.setNetwork({ wan: 'online', cloud: 'down' }); close(); }}>Cloud down</MenuItem>
          {store?.edgeEnabled ? (
            <>
              <MenuSeparator />
              <MenuLabel>{CAPABILITY_LABEL['store-edge']}</MenuLabel>
              <MenuItem icon={network.edge === 'connected' ? 'CircleCheck' : 'Router'} onClick={() => { void engine?.setNetwork({ edge: 'connected' }); close(); }}>Store Edge connected</MenuItem>
              <MenuItem icon={network.edge === 'unavailable' ? 'CircleCheck' : 'Unplug'} onClick={() => { void engine?.setNetwork({ edge: 'unavailable' }); close(); }}>Store Edge unavailable</MenuItem>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}

/** Sync pill: managers open Sync Center; cashiers get a calm explanation (cashiers never manage queues, §26). */
function SyncPill() {
  const { sync } = usePos();
  const s = useSession();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const canView = s.permissions.includes('sync.view');
  return (
    <div className="ex-menu-wrap" ref={ref}>
      <SyncIndicator status={sync} onClick={() => (canView ? nav('/sync') : setOpen((o) => !o))} />
      {open && sync ? (
        <div className="ex-menu pos-popover" role="dialog" aria-label="Sync status">
          <div className="ex-row" style={{ gap: 8 }}>
            <Icon name={sync.cloudReachable ? 'CloudCheck' : 'CloudOff'} size={18} />
            <b>{sync.cloudReachable ? (sync.pending ? 'Uploading changes' : 'Everything is synced') : 'Working offline'}</b>
          </div>
          <p className="secondary" style={{ fontSize: 13 }}>
            Billing is available. {sync.pending ? `${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync.` : 'No changes waiting.'} Sales are saved on this counter first and upload automatically.
          </p>
          <div className="muted" style={{ fontSize: 12 }}>Last sync {relative(sync.lastSuccessAt)}</div>
          {sync.quarantined ? <div style={{ fontSize: 12, color: 'var(--status-danger)' }}>Some items need a manager. Billing is not affected.</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu() {
  const s = useSession();
  const { logout, lock, resetDevice } = usePos();
  const nav = useNavigate();
  const [theme, setTheme] = useState(getThemePref());
  const [, force] = useState(0);
  const [confirmReset, setConfirmReset] = useState<'device' | 'all' | null>(null);
  return (
    <>
      <Menu
        trigger={(t) => (
          <button type="button" className="pos-user" {...t} aria-label={`User menu: ${s.user.name}`}>
            <Avatar name={s.user.name} color={s.user.avatarColor} />
            <Icon name="ChevronDown" size={14} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>{s.user.name} · {roleByCode(s.user.role).name}</MenuLabel>
            <MenuItem icon="Users" onClick={() => { close(); logout(); nav('/'); }}>Switch user</MenuItem>
            <MenuItem icon="Lock" onClick={() => { close(); lock(); }}>Lock screen</MenuItem>
            <MenuSeparator />
            <MenuLabel>Theme</MenuLabel>
            {(['light', 'dark', 'system'] as const).map((t) => (
              <MenuItem key={t} icon={theme === t ? 'CircleCheck' : t === 'dark' ? 'Moon' : t === 'light' ? 'Sun' : 'Monitor'} onClick={() => { applyTheme(t); setTheme(t); close(); }}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuLabel>Demo faults</MenuLabel>
            <MenuItem icon={faults.failNextCommit ? 'CircleCheck' : 'DatabaseZap'} onClick={() => { faults.failNextCommit = !faults.failNextCommit; force((n) => n + 1); close(); }}>Fail next local commit</MenuItem>
            <MenuItem icon={faults.failNextPrint ? 'CircleCheck' : 'Printer'} onClick={() => { faults.failNextPrint = !faults.failNextPrint; force((n) => n + 1); close(); }}>Fail next receipt print</MenuItem>
            <MenuSeparator />
            <MenuItem icon="MonitorX" danger onClick={() => { close(); setConfirmReset('device'); }}>Reset device / switch tenant</MenuItem>
            <MenuItem icon="DatabaseBackup" danger onClick={() => { close(); setConfirmReset('all'); }}>Reset all demo data</MenuItem>
          </>
        )}
      </Menu>
      <ConfirmDialog
        open={confirmReset !== null}
        onClose={() => setConfirmReset(null)}
        title={confirmReset === 'all' ? 'Reset all demo data?' : 'Reset this device?'}
        confirmLabel={confirmReset === 'all' ? 'Reset demo data' : 'Reset device'}
        onConfirm={async () => {
          if (confirmReset === 'all') await resetDemoData();
          else {
            await resetDevice();
            nav('/');
          }
          setConfirmReset(null);
        }}
      >
        {confirmReset === 'all'
          ? 'Wipes local and simulated cloud data and reseeds the demo. Unsynced sales on this counter are lost.'
          : 'Unbinds this device from its store and counter. Local transactions stay in the device database; you will run activation again.'}
      </ConfirmDialog>
    </>
  );
}
