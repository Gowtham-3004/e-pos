import { useNavigate, useParams } from 'react-router-dom';
import type { JobCardLine } from '@elixir/contracts';
import { JOB_CARD_STATUS } from '@elixir/domain';
import { jobCardTotals } from '@elixir/local-store';
import { useEntity, useLive } from '@elixir/local-store/react';
import { Badge, Button, Card, CardHeader, DataTable, DescriptionList, InlineAlert, StatusBadge, Timeline, TotalRow, type Column } from '@elixir/ui';
import { dateTime, money } from '@elixir/format';
import { NotFound, PageFrame } from '../../components/common';
import { useCloud, useLookups, userName } from '../../lib/data';
import { useSession } from '../../lib/session';

/** Read-only job card view. Edits happen at the POS service desk. */
export function JobCardDetail() {
  const { id } = useParams();
  const s = useSession();
  const cloud = useCloud();
  const nav = useNavigate();
  const L = useLookups();
  const card = useEntity(cloud, 'jobCards', id);
  const totals = useLive(cloud, ['jobCards', 'products'], () => (card?.lines.length ? jobCardTotals(cloud, card) : undefined), [card]);
  const sale = useEntity(cloud, 'sales', card?.saleId);

  if (!card || card.tenantId !== s.tenant.id) return <NotFound what="Job card" back={{ label: 'Back to job cards', to: '/jobcards' }} />;
  const product = (l: JobCardLine) => cloud.get('products', l.productId);

  const cols: Column<JobCardLine>[] = [
    { key: 'kind', header: 'Type', render: (l) => <Badge tone={l.kind === 'service' ? 'info' : 'neutral'} icon={l.kind === 'service' ? 'Wrench' : 'Cpu'}>{l.kind === 'service' ? 'Service' : 'Part'}</Badge> },
    { key: 'name', header: 'Item', render: (l) => (<div><div className="bo-cell-main">{l.name}</div><div className="bo-cell-sub">{product(l)?.sku}{l.serials?.length ? ` · S/N ${l.serials.join(', ')}` : ''}</div></div>) },
    { key: 'hsn', header: 'HSN / SAC', render: (l) => <span className="num">{product(l)?.hsn}</span> },
    { key: 'tech', header: 'Technician', render: (l) => userName(L, l.technicianId) },
    { key: 'qty', header: 'Qty', align: 'right', render: (l) => l.qty },
    { key: 'rate', header: 'Rate', align: 'right', render: (l) => money(l.unitPricePaise) },
    { key: 'amt', header: 'Amount', align: 'right', render: (l) => <b>{money(l.unitPricePaise * l.qty)}</b> },
  ];
  const services = card.lines.filter((l) => l.kind === 'service');
  const parts = card.lines.filter((l) => l.kind === 'part');

  return (
    <PageFrame
      crumbs={[{ label: 'Job cards', to: '/jobcards' }, { label: card.jobNo }]}
      title={<span className="num">{card.jobNo}</span>}
      meta={<StatusBadge meta={JOB_CARD_STATUS[card.status]} />}
      description={`${card.device.brand} ${card.device.model} · ${card.customerName} · ${s.storeName(card.storeId)} · received ${dateTime(card.openedAt)}`}
      actions={sale ? <Button variant="primary" icon="Receipt" onClick={() => nav(`/sales/${sale.id}`)}>Invoice {sale.documentNo}</Button> : undefined}
    >
      <div className="bo-grid-main">
        <div className="ex-stack" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Device & problem" icon="Smartphone" />
            <div style={{ padding: 16 }} className="ex-stack">
              <DescriptionList
                items={[
                  ['Device', `${card.device.brand} ${card.device.model}${card.device.color ? ` · ${card.device.color}` : ''}`],
                  ['IMEI / Serial', <span className="num">{card.device.imeiOrSerial ?? '—'}</span>],
                  ['Accessories', card.device.accessories?.length ? card.device.accessories.join(', ') : 'None'],
                  ['Condition at intake', card.device.condition ?? '—'],
                  ['Reported problem', card.problem],
                  ['Diagnosis', card.diagnosis ?? '—'],
                ]}
              />
            </div>
          </Card>
          <Card className="bo-card-table">
            <CardHeader title="Services & spare parts" icon="List" subtitle={`${services.length} services · ${parts.length} parts`} />
            <DataTable columns={cols} rows={card.lines} rowKey={(l) => l.id} density="dense" pageSize={100} empty={<InlineAlert tone="neutral">No services or parts added yet.</InlineAlert>} />
          </Card>
          <Card>
            <CardHeader title="Status history" icon="History" />
            <div style={{ padding: 16 }}>
              <Timeline
                items={card.statusHistory.map((h, i) => ({
                  id: `${h.status}-${i}`,
                  time: dateTime(h.at),
                  title: JOB_CARD_STATUS[h.status].label,
                  meta: [userName(L, h.userId), h.note].filter(Boolean).join(' · '),
                  tone: JOB_CARD_STATUS[h.status].tone === 'neutral' ? undefined : (JOB_CARD_STATUS[h.status].tone as 'success' | 'warning' | 'danger' | 'info'),
                }))}
              />
            </div>
          </Card>
        </div>
        <div className="ex-stack" style={{ gap: 16 }}>
          <Card>
            <CardHeader title="Customer & workshop" icon="User" />
            <div style={{ padding: 16 }}>
              <DescriptionList
                items={[
                  ['Customer', card.customerName],
                  ['Phone', card.customerPhone],
                  ['Technician', userName(L, card.technicianId)],
                  ['Received by', userName(L, card.openedBy)],
                  ['Promised', card.promisedAt ? dateTime(card.promisedAt) : '—'],
                  ['Last update', dateTime(card.updatedAt)],
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title={sale ? 'Invoice' : 'Bill preview'} icon="IndianRupee" />
            <div className="bo-doc-totals">
              <TotalRow label="Services" paise={services.reduce((a, l) => a + l.unitPricePaise * l.qty, 0)} />
              <TotalRow label="Parts" paise={parts.reduce((a, l) => a + l.unitPricePaise * l.qty, 0)} />
              <TotalRow label="Taxable" paise={sale?.taxablePaise ?? totals?.taxablePaise ?? 0} />
              <TotalRow label="GST" paise={sale?.taxPaise ?? totals?.taxPaise ?? 0} />
              <TotalRow label="Total" paise={sale?.totalPaise ?? totals?.totalPaise ?? 0} grand />
              {card.estimatePaise ? <TotalRow label="Estimate given" paise={card.estimatePaise} /> : null}
              {card.advancePaise ? <TotalRow label="Advance noted" paise={card.advancePaise} /> : null}
            </div>
          </Card>
        </div>
      </div>
    </PageFrame>
  );
}
