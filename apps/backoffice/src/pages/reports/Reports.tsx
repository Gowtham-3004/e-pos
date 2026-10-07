import { useNavigate } from 'react-router-dom';
import { Icon } from '@elixir/ui';
import { PageFrame } from '../../components/common';
import { useSession } from '../../lib/session';
import { REPORTS, type ReportDef } from './defs';

export function useAvailableReports(): ReportDef[] {
  const s = useSession();
  return REPORTS.filter((r) => (!r.family || r.family === s.family) && (!r.caps || r.caps.some((c) => s.has(c))));
}

export function ReportsCatalogue() {
  const nav = useNavigate();
  const list = useAvailableReports();
  const groups = [...new Set(list.map((r) => r.group))];
  return (
    <PageFrame title="Reports" description="Every report supports date range and store filters, exact totals, CSV / Excel export and print." crumbs={[{ label: 'Finance' }, { label: 'Reports' }]}>
      {groups.map((g) => (
        <section key={g} className="ex-stack" style={{ gap: 10 }}>
          <h2 className="bo-section-title">{g === 'GST' ? 'GST returns' : g}</h2>
          <div className="bo-report-grid">
            {list.filter((r) => r.group === g).map((r) => (
              <button key={r.key} type="button" className="bo-report-card" onClick={() => nav(`/reports/${r.key}`)}>
                <span className="bo-report-card__icon"><Icon name={r.icon} /></span>
                <span>
                  <span className="bo-report-card__t" style={{ display: 'block' }}>{r.title}</span>
                  <span className="bo-report-card__d" style={{ display: 'block' }}>{r.description}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </PageFrame>
  );
}
