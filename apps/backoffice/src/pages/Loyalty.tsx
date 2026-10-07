import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, BarChart, Button, Card, CardHeader, DataTable, InlineAlert, KpiCard, TextField, useToast } from '@elixir/ui';
import { useLive } from '@elixir/local-store/react';
import { money, number, paiseToRupeesInput, rupeesToPaise } from '@elixir/format';
import { KpiRow, PageFrame } from '../components/common';
import { addDays, shortDay, sum, today, useCloud } from '../lib/data';
import { saveSettings } from '../lib/ops';
import { useSettings } from '../lib/settings';
import { useSession } from '../lib/session';
import { TIER_TONE } from './parties/Customers';

const TIERS = [
  { name: 'Silver' as const, rule: '0 – 900 points', perk: '1 point per ₹100' },
  { name: 'Gold' as const, rule: '901 – 1,800 points', perk: '1.25× points, birthday offer' },
  { name: 'Platinum' as const, rule: '1,800+ points', perk: '1.5× points, priority billing' },
];

export function LoyaltyPage() {
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const [f, setF] = useState({ earn: String(settings.loyaltyEarnPer100), value: paiseToRupeesInput(settings.loyaltyRedeemValuePaise), min: String(settings.loyaltyMinRedeem), expiry: String(settings.loyaltyExpiryMonths) });
  const [err, setErr] = useState<string>();

  const data = useLive(cloud, ['customers', 'sales'], () => {
    const cs = cloud.where('customers', (c) => c.tenantId === s.tenant.id && c.active);
    const from = addDays(today(), -29);
    const sales = cloud.where('sales', (x) => x.tenantId === s.tenant.id && x.businessDate >= from && x.status !== 'cancelled');
    const byDay = new Map<string, number>();
    sales.forEach((x) => x.loyaltyEarned && byDay.set(x.businessDate, (byDay.get(x.businessDate) ?? 0) + x.loyaltyEarned));
    return {
      cs,
      earned: sum(sales, (x) => x.loyaltyEarned ?? 0),
      redeemed: sum(sales, (x) => x.loyaltyRedeemed ?? 0),
      memberSales: sum(sales.filter((x) => x.customerId), (x) => x.totalPaise),
      allSales: sum(sales, (x) => x.totalPaise),
      trend: Array.from({ length: 30 }, (_, i) => addDays(today(), i - 29)).map((d) => ({ label: shortDay(d), value: byDay.get(d) ?? 0 })),
    };
  }, [s.tenant.id]);
  const top = useMemo(() => [...data.cs].sort((a, b) => b.loyaltyPoints - a.loyaltyPoints).slice(0, 10), [data.cs]);
  const liability = sum(data.cs, (c) => c.loyaltyPoints) * settings.loyaltyRedeemValuePaise;

  const save = async () => {
    const earn = Number(f.earn);
    if (!(earn > 0 && earn <= 10)) return setErr('Earn rate must be between 0.1 and 10 points per ₹100.');
    if (!(rupeesToPaise(f.value) > 0)) return setErr('Point value must be greater than ₹0.');
    setErr(undefined);
    await saveSettings(cloud, s.tenant.id, { ...settings, loyaltyEarnPer100: earn, loyaltyRedeemValuePaise: rupeesToPaise(f.value), loyaltyMinRedeem: Number(f.min) || 0, loyaltyExpiryMonths: Number(f.expiry) || 0 }, s.user.id, 'Loyalty program');
    toast.success('Loyalty settings saved', 'Applies to new sales after devices sync');
  };

  return (
    <PageFrame title="Loyalty" description="Points-based program. Points are earned on POS sales for identified customers." crumbs={[{ label: 'Parties' }, { label: 'Loyalty' }]}>
      <KpiRow>
        <KpiCard label="Members" icon="Users" value={number(data.cs.length)} foot={`${data.allSales ? ((data.memberSales / data.allSales) * 100).toFixed(0) : 0}% of sales by members (30d)`} />
        <KpiCard label="Points earned · 30d" icon="TrendingUp" value={number(data.earned)} />
        <KpiCard label="Points redeemed · 30d" icon="Gift" value={number(data.redeemed)} foot={data.redeemed ? undefined : 'No redemptions recorded yet'} />
        <KpiCard label="Points liability" icon="Landmark" value={money(liability, { whole: true })} foot={`${number(sum(data.cs, (c) => c.loyaltyPoints))} points outstanding`} />
      </KpiRow>
      <div className="bo-grid-3">
        {TIERS.map((t) => {
          const members = data.cs.filter((c) => c.tier === t.name);
          return (
            <Card key={t.name}>
              <div style={{ padding: 16 }} className="ex-stack">
                <div className="ex-row" style={{ justifyContent: 'space-between' }}><Badge tone={TIER_TONE[t.name]} icon="Award" size="lg">{t.name}</Badge><span className="muted" style={{ fontSize: 12 }}>{t.rule}</span></div>
                <div style={{ fontSize: 28, fontWeight: 750 }} className="num">{number(members.length)} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>members</span></div>
                <div className="secondary" style={{ fontSize: 13 }}>{t.perk} · {number(sum(members, (c) => c.loyaltyPoints))} pts held</div>
              </div>
            </Card>
          );
        })}
      </div>
      <div className="bo-grid-main">
        <Card>
          <CardHeader title="Points earned per day · 30 days" icon="ChartColumn" />
          <div style={{ padding: 16 }}><BarChart title="Loyalty points earned per day" data={data.trend} format={(v) => number(Math.round(v))} /></div>
        </Card>
        <Card>
          <CardHeader title="Program settings" icon="Settings" subtitle="Saved to cloud, pulled by POS" />
          <div style={{ padding: 16 }} className="ex-stack">
            <fieldset disabled={!s.can('settings.edit')} style={{ border: 0, padding: 0, margin: 0 }} className="ex-stack">
              <TextField label="Earn rate" suffix="points per ₹100" inputMode="decimal" value={f.earn} onChange={(e) => setF({ ...f, earn: e.target.value })} />
              <TextField label="Value of 1 point" prefix="₹" inputMode="decimal" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
              <TextField label="Minimum points to redeem" inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/\D/g, '') })} />
              <TextField label="Points expire after" suffix="months" inputMode="numeric" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value.replace(/\D/g, '') })} hint="0 = never expire" />
              <div className="ex-hint">Example: a {money(100000, { whole: true })} bill earns {Math.floor(10 * (Number(f.earn) || 0))} points worth {money(Math.floor(10 * (Number(f.earn) || 0)) * rupeesToPaise(f.value))}.</div>
            </fieldset>
            {err ? <InlineAlert tone="danger">{err}</InlineAlert> : null}
            {s.can('settings.edit') ? <Button variant="primary" icon="Save" onClick={() => void save()}>Save settings</Button> : <span className="ex-hint">Only owners can change program settings.</span>}
          </div>
        </Card>
      </div>
      <Card className="bo-card-table">
        <CardHeader title="Top customers by points" icon="Trophy" />
        <DataTable rows={top} rowKey={(c) => c.id} onRowClick={(c) => nav(`/customers/${c.id}`)} density="dense"
          columns={[
            { key: 'r', header: '#', render: (_, i) => <span className="muted num">{i + 1}</span> },
            { key: 'n', header: 'Customer', render: (c) => <div><div className="bo-cell-main">{c.name}</div><div className="bo-cell-sub num">+91 {c.phone}</div></div> },
            { key: 't', header: 'Tier', render: (c) => (c.tier ? <Badge tone={TIER_TONE[c.tier]} icon="Award">{c.tier}</Badge> : '—') },
            { key: 'p', header: 'Points', align: 'right', render: (c) => <b>{number(c.loyaltyPoints)}</b> },
            { key: 'v', header: 'Redeemable value', align: 'right', render: (c) => money(c.loyaltyPoints * settings.loyaltyRedeemValuePaise) },
          ]} />
      </Card>
    </PageFrame>
  );
}
