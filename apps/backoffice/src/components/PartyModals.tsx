import { useState } from 'react';
import type { Customer, Supplier, TenderMethod } from '@elixir/contracts';
import { uid } from '@elixir/domain';
import { Button, InlineAlert, Modal, Segmented, Select, TextField, TotalRow, useToast } from '@elixir/ui';
import { money, paiseToRupeesInput, rupeesToPaise } from '@elixir/format';
import { useCloud } from '../lib/data';
import { recordCustomerReceipt, recordSupplierPayment, saveMaster } from '../lib/ops';
import { useSession } from '../lib/session';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Record a customer receipt or supplier payment. Creates a Payment, updates outstanding and audits. */
export function PaymentModal({ party, kind, onClose }: { party: Customer | Supplier; kind: 'customer' | 'supplier'; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [amount, setAmount] = useState(paiseToRupeesInput(party.outstandingPaise));
  const [method, setMethod] = useState<TenderMethod>(kind === 'customer' ? 'upi' : 'upi');
  const [ref, setRef] = useState('');
  const [store, setStore] = useState(s.storeId !== 'all' ? s.storeId : s.stores[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const amt = rupeesToPaise(amount);
  const submit = async () => {
    if (!(amt > 0)) return setErr('Enter an amount greater than zero.');
    if (amt > party.outstandingPaise) return setErr(`Amount cannot exceed the outstanding balance ${money(party.outstandingPaise)}.`);
    if (method !== 'cash' && !ref.trim()) return setErr(`Enter the ${method === 'upi' ? 'UPI transaction' : method === 'card' ? 'card approval' : 'cheque/NEFT'} reference.`);
    setBusy(true);
    const p = kind === 'customer'
      ? await recordCustomerReceipt(cloud, { customer: party as Customer, storeId: store, amountPaise: amt, method, reference: ref || undefined, userId: s.user.id })
      : await recordSupplierPayment(cloud, { supplier: party as Supplier, storeId: store, amountPaise: amt, method, reference: ref || undefined, userId: s.user.id });
    setBusy(false);
    toast.success(`${kind === 'customer' ? 'Receipt' : 'Payment'} ${p.documentNo} recorded`, `${money(amt)} · balance now ${money(party.outstandingPaise - amt)}`);
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={kind === 'customer' ? `Record receipt · ${party.name}` : `Record payment · ${party.name}`} description={kind === 'customer' ? 'Money received from the customer against credit sales.' : 'Money paid to the supplier. Allocated to the oldest open invoices first.'}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Check" loading={busy} onClick={() => void submit()}>Record {money(Math.max(0, amt))}</Button></>}>
      <div className="ex-stack">
        <TotalRow label="Outstanding now" paise={party.outstandingPaise} />
        <TextField label="Amount" required prefix="₹" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(undefined); }} className="num" autoFocus />
        <div className="ex-field">
          <span className="ex-label">Method</span>
          <Segmented label="Method" items={[{ key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'card', label: kind === 'customer' ? 'Card' : 'Bank / NEFT' }]} value={method} onChange={(k) => setMethod(k as TenderMethod)} />
        </div>
        {method !== 'cash' ? <TextField label="Reference" required value={ref} onChange={(e) => { setRef(e.target.value); setErr(undefined); }} placeholder={method === 'upi' ? 'UPI ref no.' : 'Txn / cheque no.'} /> : null}
        {s.stores.length > 1 ? <Select label="Recorded at store" value={store} onChange={(e) => setStore(e.target.value)} options={s.stores.map((x) => ({ value: x.id, label: x.name }))} /> : null}
        {amt > 0 && amt <= party.outstandingPaise ? <TotalRow label="Balance after" paise={party.outstandingPaise - amt} /> : null}
        {err ? <InlineAlert tone="danger">{err}</InlineAlert> : null}
      </div>
    </Modal>
  );
}

export function CustomerModal({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const [f, setF] = useState({ name: customer?.name ?? '', phone: customer?.phone ?? '', email: customer?.email ?? '', gstin: customer?.gstin ?? '', stateCode: customer?.stateCode ?? s.tenant.stateCode, creditLimit: customer ? paiseToRupeesInput(customer.creditLimitPaise) : '0.00', creditDays: String(customer?.creditDays ?? 0), priceGroupId: customer?.priceGroupId ?? '', active: customer?.active ?? true });
  const [e, setE] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = 'Enter the customer name.';
    if (!/^[6-9]\d{9}$/.test(f.phone.replace(/\D/g, '').slice(-10))) er.phone = 'Enter a valid 10-digit mobile number.';
    else if (cloud.where('customers', (c) => c.tenantId === s.tenant.id && c.id !== customer?.id && c.phone.slice(-10) === f.phone.replace(/\D/g, '').slice(-10)).length) er.phone = 'Another customer already uses this mobile number.';
    if (f.gstin && !GSTIN_RE.test(f.gstin.toUpperCase())) er.gstin = 'GSTIN must be 15 characters, e.g. 33AABCA1234F1Z5.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) er.email = 'Enter a valid email or leave it empty.';
    if (customer && rupeesToPaise(f.creditLimit) < customer.outstandingPaise) er.creditLimit = `Credit limit cannot be below current outstanding ${money(customer.outstandingPaise)}.`;
    setE(er);
    if (Object.keys(er).length) return;
    const c: Customer = {
      ...(customer ?? { id: `cu-${s.tenant.id}-${uid().slice(-6)}`, tenantId: s.tenant.id, outstandingPaise: 0, loyaltyPoints: 0, tier: 'Silver', createdAt: new Date().toISOString() }),
      name: f.name.trim(), phone: f.phone.replace(/\D/g, '').slice(-10), email: f.email || undefined, gstin: f.gstin ? f.gstin.toUpperCase() : undefined, stateCode: f.gstin ? f.gstin.slice(0, 2) : f.stateCode,
      creditLimitPaise: rupeesToPaise(f.creditLimit), creditDays: Number(f.creditDays) || 0, priceGroupId: f.priceGroupId || undefined, active: f.active,
    } as Customer;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'customers', entity: c, summary: `Customer ${c.name} ${customer ? 'updated' : 'created'}`, actorId: s.user.id, action: customer ? 'customer.updated' : 'customer.created', entityName: 'customer', before: customer });
    toast.success(customer ? 'Customer saved' : 'Customer added', 'Available on POS after next sync');
    onSaved?.(c);
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="md" title={customer ? `Edit ${customer.name}` : 'New customer'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Save" onClick={() => void save()}>Save customer</Button></>}>
      <div className="bo-form-grid bo-form-grid--2">
        <div className="bo-span-2"><TextField label="Name" required value={f.name} onChange={(x) => set('name', x.target.value)} error={e.name} autoFocus /></div>
        <TextField label="Mobile" required inputMode="tel" prefix="+91" value={f.phone} onChange={(x) => set('phone', x.target.value)} error={e.phone} />
        <TextField label="Email" value={f.email} onChange={(x) => set('email', x.target.value)} error={e.email} />
        <TextField label="GSTIN (B2B)" value={f.gstin} onChange={(x) => set('gstin', x.target.value.toUpperCase())} error={e.gstin} hint="Required for B2B tax invoices; sets place of supply" />
        <Select label="Price group" value={f.priceGroupId} onChange={(x) => set('priceGroupId', x.target.value)} options={[{ value: '', label: 'Retail (default)' }, ...cloud.all('priceGroups').filter((g) => g.id !== 'pg-retail').map((g) => ({ value: g.id, label: `${g.name} · ${g.discountPct}% off` }))]} />
        <TextField label="Credit limit" prefix="₹" inputMode="decimal" value={f.creditLimit} onChange={(x) => set('creditLimit', x.target.value)} error={e.creditLimit} hint="0 = no credit sales" className="num" />
        <TextField label="Credit days" inputMode="numeric" value={f.creditDays} onChange={(x) => set('creditDays', x.target.value.replace(/\D/g, ''))} />
      </div>
    </Modal>
  );
}

export function SupplierModal({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const s = useSession();
  const cloud = useCloud();
  const toast = useToast();
  const pharma = s.tenant.vertical === 'pharmacy';
  const [f, setF] = useState({ name: supplier?.name ?? '', phone: supplier?.phone ?? '', gstin: supplier?.gstin ?? '', city: supplier?.city ?? s.tenant.city, payableDays: String(supplier?.payableDays ?? 30), licenceNo: supplier?.licenceNo ?? '', licenceValidUntil: supplier?.licenceValidUntil ?? '' });
  const [e, setE] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const er: Record<string, string> = {};
    if (!f.name.trim()) er.name = 'Enter the supplier name.';
    if (!f.phone.trim()) er.phone = 'Enter a contact number.';
    if (!GSTIN_RE.test(f.gstin.toUpperCase())) er.gstin = 'Enter a valid 15-character GSTIN (needed for input tax credit).';
    if (pharma && !f.licenceNo.trim()) er.licenceNo = 'Drug licence number is required for pharmacy suppliers.';
    if (pharma && !f.licenceValidUntil) er.licenceValidUntil = 'Enter the licence validity date.';
    setE(er);
    if (Object.keys(er).length) return;
    const sup: Supplier = { ...(supplier ?? { id: `su-${s.tenant.id}-${uid().slice(-6)}`, tenantId: s.tenant.id, outstandingPaise: 0, active: true }), name: f.name.trim(), phone: f.phone.trim(), gstin: f.gstin.toUpperCase(), stateCode: f.gstin.slice(0, 2), city: f.city, payableDays: Number(f.payableDays) || 0, licenceNo: f.licenceNo || undefined, licenceValidUntil: f.licenceValidUntil || undefined } as Supplier;
    await saveMaster(cloud, { tenantId: s.tenant.id, collection: 'suppliers', entity: sup, summary: `Supplier ${sup.name} ${supplier ? 'updated' : 'created'}`, actorId: s.user.id, action: supplier ? 'supplier.updated' : 'supplier.created', entityName: 'supplier', before: supplier });
    toast.success('Supplier saved');
    onClose();
  };
  return (
    <Modal open onClose={onClose} size="md" title={supplier ? `Edit ${supplier.name}` : 'New supplier'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="Save" onClick={() => void save()}>Save supplier</Button></>}>
      <div className="bo-form-grid bo-form-grid--2">
        <div className="bo-span-2"><TextField label="Name" required value={f.name} onChange={(x) => set('name', x.target.value)} error={e.name} autoFocus /></div>
        <TextField label="Phone" required value={f.phone} onChange={(x) => set('phone', x.target.value)} error={e.phone} />
        <TextField label="GSTIN" required value={f.gstin} onChange={(x) => set('gstin', x.target.value.toUpperCase())} error={e.gstin} />
        <TextField label="City" value={f.city} onChange={(x) => set('city', x.target.value)} />
        <TextField label="Payable days" inputMode="numeric" value={f.payableDays} onChange={(x) => set('payableDays', x.target.value.replace(/\D/g, ''))} hint="Used for due dates and overdue alerts" />
        {pharma ? <TextField label="Drug licence no." required value={f.licenceNo} onChange={(x) => set('licenceNo', x.target.value)} error={e.licenceNo} /> : null}
        {pharma ? <TextField label="Licence valid until" type="date" required value={f.licenceValidUntil} onChange={(x) => set('licenceValidUntil', x.target.value)} error={e.licenceValidUntil} /> : null}
      </div>
    </Modal>
  );
}
