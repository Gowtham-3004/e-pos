import { useMemo, useState } from 'react';
import type { Customer } from '@elixir/contracts';
import { money } from '@elixir/format';
import { Avatar, Badge, Button, EmptyState, Kbd, Modal, SearchInput, TextField, useToast } from '@elixir/ui';
import { usePos, useSession } from '../lib/pos';
import { createQuickCustomer } from '../lib/ops';

/** F8 customer selector: search by name/phone, create quick customer, or walk-in. */
export function CustomerPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c?: Customer) => void }) {
  const { device } = usePos();
  const s = useSession();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hi, setHi] = useState(0);
  const all = useMemo(() => device.where('customers', (c) => c.tenantId === s.tenant.id && c.active), [device, s.tenant.id, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = t ? all.filter((c) => c.name.toLowerCase().includes(t) || c.phone.replace(/\s/g, '').includes(t.replace(/\s/g, ''))) : [...all].sort((a, b) => b.loyaltyPoints - a.loyaltyPoints);
    return r.slice(0, 8);
  }, [all, q]);
  const phoneOk = /^[+0-9 ]{10,15}$/.test(phone.trim());

  const save = async () => {
    if (!name.trim() || !phoneOk) return;
    const c = await createQuickCustomer(device, s, { name, phone });
    toast.success('Customer added', `${c.name} · ${c.phone}`);
    setCreating(false);
    setName('');
    setPhone('');
    onPick(c);
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Select customer" description="Search by name or phone. Loyalty and credit apply to this bill.">
      {creating ? (
        <div className="ex-stack">
          <TextField label="Customer name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Mobile number" required value={phone} onChange={(e) => setPhone(e.target.value)} error={phone && !phoneOk ? 'Enter a 10-digit mobile number.' : undefined} placeholder="+91 98400 12345" onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <div className="ex-row" style={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => setCreating(false)}>Back</Button>
            <Button variant="primary" icon="UserPlus" disabled={!name.trim() || !phoneOk} onClick={save}>Save & select</Button>
          </div>
        </div>
      ) : (
        <div className="ex-stack">
          <SearchInput
            autoFocus
            value={q}
            onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onClear={() => setQ('')}
            placeholder="Name or mobile…"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              if (e.key === 'Enter' && list[hi]) { e.preventDefault(); onPick(list[hi]); }
            }}
          />
          <div className="pos-list">
            {list.map((c, i) => (
              <button key={c.id} type="button" className={`pos-list__row${i === hi ? ' is-hi' : ''}`} onClick={() => onPick(c)} onMouseEnter={() => setHi(i)}>
                <Avatar name={c.name} />
                <div style={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                  <b className="ex-truncate" style={{ display: 'block' }}>{c.name}</b>
                  <span className="muted num" style={{ fontSize: 12 }}>{c.phone}{c.gstin ? ` · GSTIN ${c.gstin}` : ''}</span>
                </div>
                {c.tier ? <Badge tone="info" icon="Award">{c.tier}</Badge> : null}
                <span className="num muted" style={{ fontSize: 12 }}>{c.loyaltyPoints} pts</span>
                {c.outstandingPaise > 0 ? <Badge tone="warning">Due {money(c.outstandingPaise)}</Badge> : null}
              </button>
            ))}
            {list.length === 0 ? <EmptyState quiet title="No matching customer">Create a quick customer with name and mobile.</EmptyState> : null}
          </div>
          <div className="ex-row">
            <Button icon="UserRound" onClick={() => onPick(undefined)}>Walk-in (no customer)</Button>
            <div className="ex-spacer" />
            <span className="muted" style={{ fontSize: 12 }}><Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Enter</Kbd></span>
            <Button variant="primary" icon="UserPlus" onClick={() => { setCreating(true); setPhone(/^\d+$/.test(q.trim()) ? q.trim() : ''); setName(/^\d+$/.test(q.trim()) ? '' : q.trim()); }}>New customer</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
