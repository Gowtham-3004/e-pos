import type { ReactNode } from 'react';
import './styles/app.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { BACKOFFICE_NAV } from '@elixir/domain';
import { SessionProvider, useSession, useSessionCtx } from './lib/session';
import { Login } from './pages/Login';
import { Shell } from './components/Shell';
import { NoAccess, NotAvailable, NotFound } from './components/common';
import { Dashboard } from './pages/Dashboard';
import { SalesList } from './pages/sales/SalesList';
import { SaleDetail } from './pages/sales/SaleDetail';
import { ProductsList } from './pages/products/ProductsList';
import { ProductForm } from './pages/products/ProductForm';
import { StyleMatrixPage } from './pages/products/StyleMatrix';
import { MenuPage } from './pages/menu/MenuPage';
import { ModifierGroupsPage } from './pages/menu/ModifierGroups';
import { Categories } from './pages/Categories';
import { Inventory } from './pages/inventory/Inventory';
import { LedgerPage } from './pages/inventory/Ledger';
import { AdjustPage } from './pages/inventory/Adjust';
import { TransferPage } from './pages/inventory/Transfer';
import { StockTakePage } from './pages/inventory/StockTake';
import { ExpiryPage } from './pages/Expiry';
import { PurchaseList } from './pages/purchase/PurchaseList';
import { PurchaseDoc } from './pages/purchase/PurchaseDoc';
import { Customers } from './pages/parties/Customers';
import { CustomerDetail } from './pages/parties/CustomerDetail';
import { Suppliers } from './pages/parties/Suppliers';
import { SupplierDetail } from './pages/parties/SupplierDetail';
import { LoyaltyPage } from './pages/Loyalty';
import { FinancePage } from './pages/Finance';
import { ShiftsPage } from './pages/shifts/Shifts';
import { ZReport } from './pages/shifts/ZReport';
import { ReportsCatalogue } from './pages/reports/Reports';
import { ReportView } from './pages/reports/ReportView';
import { FloorsPage } from './pages/restaurant/Floors';
import { StationsPage } from './pages/restaurant/Stations';
import { UsersPage } from './pages/Users';
import { DevicesPage } from './pages/Devices';
import { StoresPage } from './pages/Stores';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';

/** Route-level dual authorization: capability (plan) AND permission (role). Same rules as composeNav. */
function Guarded({ k, children }: { k: string; children: ReactNode }) {
  const s = useSession();
  const item = BACKOFFICE_NAV.find((n) => n.key === k);
  if (!item) return <>{children}</>;
  if ((item.family && item.family !== s.family) || (item.capabilities && !item.capabilities.some((c) => s.has(c)))) return <NotAvailable module={item.label} />;
  if (item.permission && !s.can(item.permission)) return <NoAccess module={item.label} />;
  return <>{children}</>;
}

const g = (k: string, el: ReactNode) => <Guarded k={k}>{el}</Guarded>;

function Authed() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={g('dashboard', <Dashboard />)} />
        <Route path="/sales" element={g('sales', <SalesList />)} />
        <Route path="/sales/:id" element={g('sales', <SaleDetail />)} />
        <Route path="/products" element={g('products', <ProductsList />)} />
        <Route path="/products/new" element={g('products', <ProductForm />)} />
        <Route path="/products/styles/:style" element={g('products', <StyleMatrixPage />)} />
        <Route path="/products/:id" element={g('products', <ProductForm />)} />
        <Route path="/menu" element={g('menu', <MenuPage />)} />
        <Route path="/menu/modifiers" element={g('menu', <ModifierGroupsPage />)} />
        <Route path="/categories" element={g('categories', <Categories />)} />
        <Route path="/inventory" element={g('inventory', <Inventory />)} />
        <Route path="/inventory/ledger/:productId" element={g('inventory', <LedgerPage />)} />
        <Route path="/inventory/adjust" element={g('inventory', <AdjustPage />)} />
        <Route path="/inventory/transfer" element={g('inventory', <TransferPage />)} />
        <Route path="/inventory/stocktake" element={g('inventory', <StockTakePage />)} />
        <Route path="/expiry" element={g('expiry', <ExpiryPage />)} />
        <Route path="/purchase" element={g('purchase', <PurchaseList />)} />
        <Route path="/purchase/:id" element={g('purchase', <PurchaseDoc />)} />
        <Route path="/customers" element={g('customers', <Customers />)} />
        <Route path="/customers/:id" element={g('customers', <CustomerDetail />)} />
        <Route path="/suppliers" element={g('suppliers', <Suppliers />)} />
        <Route path="/suppliers/:id" element={g('suppliers', <SupplierDetail />)} />
        <Route path="/loyalty" element={g('loyalty', <LoyaltyPage />)} />
        <Route path="/finance" element={g('finance', <FinancePage />)} />
        <Route path="/shifts" element={g('shifts', <ShiftsPage />)} />
        <Route path="/shifts/:id" element={g('shifts', <ZReport />)} />
        <Route path="/reports" element={g('reports', <ReportsCatalogue />)} />
        <Route path="/reports/:key" element={g('reports', <ReportView />)} />
        <Route path="/floors" element={g('floors', <FloorsPage />)} />
        <Route path="/stations" element={g('stations', <StationsPage />)} />
        <Route path="/users" element={g('users', <UsersPage />)} />
        <Route path="/devices" element={g('counters', <DevicesPage />)} />
        <Route path="/stores" element={g('stores', <StoresPage />)} />
        <Route path="/audit" element={g('audit', <AuditPage />)} />
        <Route path="/settings" element={g('settings', <SettingsPage />)} />
        <Route path="*" element={<NotFound what="Page" back={{ label: 'Go to dashboard', to: '/' }} />} />
      </Routes>
    </Shell>
  );
}

function Gate() {
  const { session } = useSessionCtx();
  return session ? <Authed /> : <Login />;
}

export function App() {
  return (
    <BrowserRouter basename="/backoffice">
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </BrowserRouter>
  );
}
