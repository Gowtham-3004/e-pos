import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles/app.css';
import { useSession } from './lib/session';
import { useAccess, type PlatformAction } from './lib/access';
import { Shell } from './components/Shell';
import { NotFound, RestrictedPage } from './components/common';
import { Login } from './pages/Login';
import { Overview } from './pages/Overview';
import { Tenants } from './pages/Tenants';
import { TenantDetail } from './pages/TenantDetail';
import { Onboarding } from './pages/Onboarding';
import { Plans } from './pages/Plans';
import { Devices } from './pages/Devices';
import { SyncDiagnostics } from './pages/SyncDiagnostics';
import { StoreEdge } from './pages/StoreEdge';
import { Support } from './pages/Support';
import { AuditLog } from './pages/AuditLog';
import type { ReactNode } from 'react';

function Guard({ action, title, children }: { action: PlatformAction; title: string; children: ReactNode }) {
  const { can } = useAccess();
  return can(action) ? <>{children}</> : <RestrictedPage action={action} title={title} />;
}

function Authed() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/tenants" element={<Guard action="tenant.view" title="Tenants"><Tenants /></Guard>} />
        {/* Tenant detail stays reachable read-only for Support (links from tickets/devices). */}
        <Route path="/tenants/:id" element={<TenantDetail />} />
        <Route path="/onboarding" element={<Guard action="tenant.onboard" title="Tenant onboarding"><Onboarding /></Guard>} />
        <Route path="/plans" element={<Guard action="tenant.view" title="Plans & Add-ons"><Plans /></Guard>} />
        <Route path="/devices" element={<Guard action="device.rename" title="Device Registry"><Devices /></Guard>} />
        <Route path="/devices/:id" element={<Guard action="device.rename" title="Device Registry"><Devices /></Guard>} />
        <Route path="/sync" element={<Guard action="sync.view" title="Sync Diagnostics"><SyncDiagnostics /></Guard>} />
        <Route path="/edge" element={<Guard action="device.rename" title="Store Edge"><StoreEdge /></Guard>} />
        <Route path="/support" element={<Guard action="ticket.manage" title="Support"><Support /></Guard>} />
        <Route path="/support/:id" element={<Guard action="ticket.manage" title="Support"><Support /></Guard>} />
        <Route path="/audit" element={<Guard action="ticket.manage" title="Audit Log"><AuditLog /></Guard>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Shell>
  );
}

function Gate() {
  const session = useSession((s) => s.session);
  return session ? <Authed /> : <Login />;
}

export function App() {
  return (
    <BrowserRouter basename="/admin">
      <Gate />
    </BrowserRouter>
  );
}
