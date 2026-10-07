import type { JobCard } from '@elixir/contracts';
import { JOB_CARD_STATUS } from '@elixir/domain';
import { dateTime, money } from '@elixir/format';
import { jobCardTotals, type LocalDatabase } from '@elixir/local-store';

/** 80mm job sheet: customer copy at intake, workshop copy with services + parts once quoted. */
export function JobCardSlip({ db, card }: { db: LocalDatabase; card: JobCard }) {
  const tenant = db.get('tenants', card.tenantId);
  const store = db.get('stores', card.storeId);
  const tech = db.get('users', card.technicianId);
  const totals = card.lines.length ? jobCardTotals(db, card) : undefined;
  return (
    <div className="receipt" aria-label={`Job sheet ${card.jobNo}`}>
      <div className="receipt__center">
        <div className="receipt__store">{tenant?.name}</div>
        <div>{store?.name} · {store?.address}</div>
        <div>Ph {store?.phone}</div>
        <div className="receipt__title">SERVICE JOB SHEET</div>
      </div>
      <div className="receipt__rule" />
      <div className="receipt__kv"><span>Job no</span><span>{card.jobNo}</span></div>
      <div className="receipt__kv"><span>Received</span><span>{dateTime(card.openedAt)}</span></div>
      {card.promisedAt ? <div className="receipt__kv"><span>Promised</span><span>{dateTime(card.promisedAt)}</span></div> : null}
      <div className="receipt__kv"><span>Status</span><span>{JOB_CARD_STATUS[card.status].label}</span></div>
      <div className="receipt__kv"><span>Customer</span><span>{card.customerName} · {card.customerPhone}</span></div>
      <div className="receipt__rule" />
      <div className="receipt__kv"><span>Device</span><span>{card.device.brand} {card.device.model}</span></div>
      {card.device.imeiOrSerial ? <div className="receipt__kv"><span>IMEI / SN</span><span>{card.device.imeiOrSerial}</span></div> : null}
      {card.device.color ? <div className="receipt__kv"><span>Colour</span><span>{card.device.color}</span></div> : null}
      <div className="receipt__kv"><span>Accessories</span><span>{card.device.accessories?.length ? card.device.accessories.join(', ') : 'None'}</span></div>
      {card.device.condition ? <div className="receipt__kv"><span>Condition</span><span>{card.device.condition}</span></div> : null}
      <div className="receipt__rule" />
      <div className="receipt__name">Reported problem</div>
      <div>{card.problem}</div>
      {card.diagnosis ? (<><div className="receipt__name" style={{ marginTop: 4 }}>Diagnosis</div><div>{card.diagnosis}</div></>) : null}
      {tech ? <div className="receipt__kv"><span>Technician</span><span>{tech.name}</span></div> : null}
      {card.lines.length ? (
        <>
          <div className="receipt__rule" />
          <div className="receipt__line receipt__line--head"><span>Item</span><span>Qty</span><span>Rate</span><span>Amount</span></div>
          {card.lines.map((l) => (
            <div key={l.id} className="receipt__item">
              <div className="receipt__name">{l.name}</div>
              <div className="receipt__line">
                <span className="receipt__meta">{l.kind === 'service' ? 'Labour' : 'Part'}{l.serials?.length ? ` · SN ${l.serials.join(', ')}` : ''}</span>
                <span>{l.qty}</span>
                <span>{money(l.unitPricePaise)}</span>
                <span>{money(l.unitPricePaise * l.qty)}</span>
              </div>
            </div>
          ))}
          {totals ? <div className="receipt__kv receipt__total"><span>Estimated total</span><span>{money(totals.totalPaise)}</span></div> : null}
        </>
      ) : card.estimatePaise ? (
        <div className="receipt__kv receipt__total"><span>Estimate</span><span>{money(card.estimatePaise)}</span></div>
      ) : null}
      {card.advancePaise ? <div className="receipt__kv"><span>Advance noted</span><span>{money(card.advancePaise)}</span></div> : null}
      {card.saleDocumentNo ? <div className="receipt__kv"><span>Invoice</span><span>{card.saleDocumentNo}</span></div> : null}
      <div className="receipt__rule" />
      <div className="receipt__meta">Device data is the customer's responsibility. Devices not collected within 30 days of the ready date may be disposed of. Bring this slip to collect your device.</div>
      <div style={{ marginTop: 18 }} className="receipt__kv"><span>Customer sign</span><span>Staff sign</span></div>
    </div>
  );
}
