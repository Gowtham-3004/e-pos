import { createRoot } from 'react-dom/client';
import '@elixir/ui/styles.css';
import { applyTheme, Button, ElixirMark, Icon } from '@elixir/ui';
import { resetDemoData } from '@elixir/app-kit';

applyTheme();

const PRODUCTS = [
  { href: '/pos/', icon: 'ScanBarcode', title: 'Elixir POS', platform: 'Web + Desktop (Tauri)', desc: 'Offline-first billing for Retail verticals and Restaurant POS with tables, KOT and Kitchen Display.' },
  { href: '/backoffice/', icon: 'LayoutDashboard', title: 'Elixir Back Office', platform: 'Web', desc: 'Catalog, inventory, purchase, parties, finance, shifts, reports and restaurant setup.' },
  { href: '/admin/', icon: 'Building2', title: 'Elixir Platform Admin', platform: 'Web', desc: 'Tenants, plans & add-ons, device registry, sync diagnostics, Store Edge and support.' },
  { href: 'http://localhost:8081', icon: 'Smartphone', title: 'Elixir POS Mobile', platform: 'Android + iOS (Expo)', desc: 'Owner/manager visibility and approvals; waiter ordering. Run with pnpm --filter @elixir/mobile start.' },
];

function Launcher() {
  return (
    <div style={{ minHeight: '100vh', padding: '48px 16px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto' }} className="ex-stack">
        <div className="ex-row" style={{ gap: 14 }}>
          <ElixirMark size={40} />
          <div>
            <h1 style={{ fontSize: 28 }}>Elixir POS Ecosystem</h1>
            <p className="muted">Prototype · offline-first · dummy data · no backend</p>
          </div>
        </div>
        <div className="ex-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 16 }}>
          {PRODUCTS.map((p) => (
            <a key={p.title} href={p.href} className="ex-card ex-card--interactive" style={{ padding: 20, color: 'inherit', textDecoration: 'none' }}>
              <div className="ex-row" style={{ gap: 12 }}>
                <span className="ex-empty__icon" style={{ width: 44, height: 44 }}><Icon name={p.icon} size={22} /></span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{p.title}</div>
                  <div className="muted" style={{ fontSize: 13 }}>{p.platform}</div>
                </div>
              </div>
              <p className="secondary" style={{ marginTop: 12, fontSize: 14 }}>{p.desc}</p>
            </a>
          ))}
        </div>
        <div className="ex-card" style={{ padding: 16, marginTop: 8 }}>
          <div className="ex-row" style={{ flexWrap: 'wrap' }}>
            <Icon name="Info" size={16} className="muted" />
            <span className="secondary" style={{ fontSize: 14, flex: 1 }}>
              POS sales stay on the device until it syncs. Toggle Offline in the POS header, sell, then go Online and watch Back Office update live.
            </span>
            <Button size="sm" variant="ghost" icon="RotateCcw" onClick={() => confirm('Reset all demo data on this browser?') && resetDemoData()}>Reset demo data</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Launcher />);
