import { useMemo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { composeNav, POS_NAV } from '@elixir/domain';
import { useLive } from '@elixir/local-store/react';
import { AppShell, Banner, Button, EmptyState } from '@elixir/ui';
import { landingFor, PosProvider, usePos, useSession } from './lib/pos';
import { PrintHost } from './lib/print';
import { PosHeader } from './components/Header';
import { ActivationScreen } from './screens/Activation';
import { LoginScreen } from './screens/Login';
import { BillingScreen } from './screens/Billing';
import { HeldScreen } from './screens/Held';
import { SalesScreen } from './screens/Sales';
import { ReturnsScreen } from './screens/Returns';
import { CashScreen } from './screens/Cash';
import { ShiftScreen } from './screens/Shift';
import { TablesScreen } from './screens/Tables';
import { OrderScreen } from './screens/Order';
import { RunningScreen } from './screens/Running';
import { KdsScreen } from './screens/Kds';
import { SyncCenterScreen } from './screens/SyncCenter';
import { DevicesScreen } from './screens/Devices';
import './styles/pos.css';

// Web is served under /pos (launcher proxy); a packaged Tauri build serves from its own root.
const basename = typeof window !== 'undefined' && window.location.pathname.startsWith('/pos') ? '/pos' : '/';

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <PosProvider>
        <Gate />
        <PrintHost />
      </PosProvider>
    </BrowserRouter>
  );
}

function Gate() {
  const { binding, auth, session } = usePos();
  if (!binding) return <ActivationScreen />;
  if (!auth || !session) return <LoginScreen />;
  if (auth.locked) return <LoginScreen lockedUserId={auth.userId} />;
  return <Shell />;
}

function Shell() {
  const s = useSession();
  const { device, network, sync } = usePos();
  const loc = useLocation();
  const nav = useNavigate();
  const isKitchenUser = s.user.role === 'kitchen' || s.counter?.kind === 'kitchen';
  const items = useMemo(() => {
    const all = composeNav(POS_NAV, { capabilities: s.capabilities, permissions: s.permissions, family: s.family });
    // Kitchen counter/users only see the KDS; the shift module is for billing counters.
    return isKitchenUser ? all.filter((i) => i.key === 'kds') : all;
  }, [s.capabilities, s.permissions, s.family, isKitchenUser]);
  const badges = useLive(device, ['heldCarts', 'orders', 'kots'], () => ({
    held: device.where('heldCarts', (h) => h.counterId === s.counter?.id).length || undefined,
    running: device.where('orders', (o) => o.storeId === s.store.id && !o.closedAt && o.status !== 'cancelled').length || undefined,
    kds: device.where('kots', (k) => k.storeId === s.store.id && (k.status === 'new' || k.status === 'accepted')).length || undefined,
  }), [s.counter?.id, s.store.id]);

  const path = loc.pathname;
  const fullScreen = path.startsWith('/kds');
  const banners: ReactNode[] = [];
  if (s.store.edgeEnabled && network.edge === 'unavailable')
    banners.push(
      <Banner key="edge" tone="warning" icon="Unplug">
        <b>Store coordination unavailable.</b> This counter can continue configured local operations. Shared stock/table state may be delayed.
      </Banner>,
    );
  if (!isKitchenUser && !s.shift && s.capabilities.includes('shift') && !path.startsWith('/shift') && !path.startsWith('/billing') && !path.startsWith('/sync') && !path.startsWith('/devices'))
    banners.push(
      <Banner key="shift" tone="info" icon="Clock" action={s.permissions.includes('shift.open') ? <Button size="sm" onClick={() => nav('/shift')}>Open shift</Button> : undefined}>
        <b>Shift not open.</b> Billing and bill settlement stay blocked until Day-In is completed on this counter.
      </Banner>,
    );
  const staleMs = sync?.lastSuccessAt ? Date.now() - new Date(sync.lastSuccessAt).getTime() : 0;
  if (sync && !sync.cloudReachable && staleMs > 12 * 3600000)
    banners.push(
      <Banner key="stale" tone="neutral" icon="History">
        <b>Configuration may be stale.</b> Last cloud sync {Math.round(staleMs / 3600000)}h ago — prices and stock from other counters may have changed.
      </Banner>,
    );

  const guard = (key: string, el: ReactNode) => (items.some((i) => i.key === key) ? el : <NoAccess />);
  const landing = landingFor(s);

  return (
    <AppShell
      product="POS"
      compact
      hideSidebar={fullScreen}
      nav={items}
      activePath={path}
      onNavigate={(p) => nav(p)}
      header={<PosHeader showLogo={fullScreen} />}
      banner={banners.length ? <div className="pos-banners">{banners}</div> : undefined}
      badges={badges}
    >
      <Routes>
        <Route path="/" element={<Navigate to={landing} replace />} />
        <Route path="/billing" element={guard('billing', <BillingScreen />)} />
        <Route path="/held" element={guard('held', <HeldScreen />)} />
        <Route path="/sales" element={guard('sales', <SalesScreen />)} />
        <Route path="/returns" element={guard('returns', <ReturnsScreen />)} />
        <Route path="/cash" element={guard('cash', <CashScreen />)} />
        <Route path="/shift" element={guard('shift', <ShiftScreen />)} />
        <Route path="/tables" element={guard('tables', <TablesScreen />)} />
        <Route path="/order" element={guard('menu', <OrderScreen />)} />
        <Route path="/order/:orderId" element={guard('menu', <OrderScreen />)} />
        <Route path="/running" element={guard('running', <RunningScreen />)} />
        <Route path="/kds" element={guard('kds', <KdsScreen />)} />
        <Route path="/sync" element={guard('sync', <SyncCenterScreen />)} />
        <Route path="/devices" element={guard('devices', <DevicesScreen />)} />
        <Route path="*" element={<Navigate to={landing} replace />} />
      </Routes>
    </AppShell>
  );
}

function NoAccess() {
  const nav = useNavigate();
  const s = useSession();
  return (
    <EmptyState icon="ShieldOff" title="Not available for your role" actions={<Button onClick={() => nav(landingFor(s))}>Go to my workspace</Button>}>
      This module is not part of your role or your store's plan on this counter. Ask a manager if you need access.
    </EmptyState>
  );
}
