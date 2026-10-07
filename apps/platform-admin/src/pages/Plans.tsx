import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, CardBody, CardHeader, Icon, Page, PageHeader, Segmented } from '@elixir/ui';
import { ADD_ONS, PLANS, CORE_RETAIL, CORE_RESTAURANT } from '@elixir/domain';
import type { Capability } from '@elixir/contracts';
import { useLive } from '@elixir/local-store/react';
import { money, moneyCompact } from '@elixir/format';
import { useCloud } from '../lib/hooks';
import { capLabel, isBillable, monthlyPrice } from '../lib/platform';

export function Plans() {
  const cloud = useCloud();
  const nav = useNavigate();
  const [family, setFamily] = useState<'retail' | 'restaurant'>('retail');
  const stats = useLive(cloud, ['tenants'], () => {
    const ts = cloud.all('tenants');
    return {
      plans: Object.fromEntries(PLANS.map((p) => {
        const xs = ts.filter((t) => t.plan === p.code);
        return [p.code, { n: xs.length, mrr: xs.filter(isBillable).reduce((s, t) => s + monthlyPrice(t), 0) }];
      })) as Record<string, { n: number; mrr: number }>,
      addOns: Object.fromEntries(ADD_ONS.map((a) => [a.code, ts.filter((t) => t.addOns.includes(a.code)).length])) as Record<string, number>,
    };
  });
  const core = family === 'retail' ? CORE_RETAIL : CORE_RESTAURANT;
  const planCaps = [...new Set(PLANS.flatMap((p) => p.capabilities))].filter((c) => (family === 'retail' ? !c.startsWith('restaurant.') : true));
  const rows: Array<{ cap: Capability; core: boolean }> = [...core.map((c) => ({ cap: c, core: true })), ...planCaps.filter((c) => !core.includes(c)).map((c) => ({ cap: c, core: false }))];

  return (
    <Page>
      <PageHeader title="Plans & Add-ons" description="Commercial catalogue. Effective capabilities = Core + Vertical + Plan + Add-ons + Overrides − Restrictions." />
      <div className="pa-plan-cards">
        {PLANS.map((p) => (
          <Card key={p.code}>
            <CardHeader title={p.name} icon="Layers" actions={<Badge tone="info" className="num">{stats.plans[p.code]?.n ?? 0} tenants</Badge>} />
            <CardBody className="ex-stack" style={{ gap: 10 }}>
              <div className="pa-price"><b className="num">{money(p.monthlyPricePaise, { whole: true })}</b><span className="muted">/month</span></div>
              <p className="muted">{p.description}</p>
              <div className="pa-kv"><Icon name="Monitor" size={14} />Up to <b className="num">{p.maxCounters}</b> counter{p.maxCounters > 1 ? 's' : ''}</div>
              <div className="pa-kv"><Icon name="IndianRupee" size={14} />Billed MRR <b className="num">{moneyCompact(stats.plans[p.code]?.mrr ?? 0)}</b></div>
              <button type="button" className="pa-link-btn" onClick={() => nav(`/tenants?plan=${p.code}`)}>View tenants on {p.name} →</button>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Add-ons" icon="Puzzle" />
        <div className="ex-table-wrap">
          <table className="ex-table">
            <thead>
              <tr><th>Add-on</th><th>Capabilities</th><th>Families</th><th className="ex-right">Price / month</th><th className="ex-right">Tenants</th></tr>
            </thead>
            <tbody>
              {ADD_ONS.map((a) => (
                <tr key={a.code}>
                  <td><b>{a.name}</b><div className="muted">{a.description}</div></td>
                  <td><div className="pa-chips">{a.capabilities.map((c) => <span key={c} className="pa-cap">{capLabel(c)}</span>)}</div></td>
                  <td>{a.families.map((f) => <Badge key={f} outline>{f === 'retail' ? 'Retail' : 'Restaurant'}</Badge>)}</td>
                  <td className="ex-right num">{money(a.monthlyPricePaise, { whole: true })}</td>
                  <td className="ex-right num">{stats.addOns[a.code] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Capability matrix"
          subtitle="Core capabilities apply to every plan; vertical extensions are added on top by the tenant's vertical"
          icon="Grid3x3"
          actions={<Segmented value={family} onChange={setFamily} label="Family" items={[{ key: 'retail', label: 'Retail' }, { key: 'restaurant', label: 'Restaurant' }]} />}
        />
        <div className="ex-table-wrap ex-scroll">
          <table className="ex-table ex-table--dense pa-matrix">
            <caption className="sr-only">Capabilities included per plan for the {family} family</caption>
            <thead>
              <tr>
                <th scope="col">Capability</th>
                {PLANS.map((p) => <th key={p.code} scope="col" className="ex-center">{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cap, core: isCore }, i) => (
                <tr key={cap} className={i === core.length ? 'pa-matrix__split' : undefined}>
                  <th scope="row">
                    {capLabel(cap)} {isCore ? <Badge>Core</Badge> : null}
                    <span className="pa-mono muted pa-matrix__code">{cap}</span>
                  </th>
                  {PLANS.map((p) => {
                    const yes = isCore || p.capabilities.includes(cap);
                    return (
                      <td key={p.code} className="ex-center">
                        {yes ? (
                          <span className="pa-yes"><Icon name="Check" size={16} /><span className="sr-only">Included</span></span>
                        ) : (
                          <span className="muted" aria-hidden>—</span>
                        )}
                        {!yes ? <span className="sr-only">Not included</span> : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Page>
  );
}
