import { useMemo, useState } from 'react';
import type { Product } from '@elixir/contracts';
import { Badge, EmptyState, Icon, Modal, TextField } from '@elixir/ui';
import { usePos } from '../lib/pos';

/** Pick an in-stock serial / IMEI for a serial-tracked product (billing + job card parts). */
export function SerialPicker({ product, taken, onClose, onPick }: { product: Product; taken: string[]; onClose: () => void; onPick: (serial: string) => void }) {
  const { device } = usePos();
  const [q, setQ] = useState('');
  const serials = useMemo(() => device.where('serials', (x) => x.productId === product.id && x.status === 'in-stock' && !taken.includes(x.serial)), [device, product.id, taken]);
  const list = serials.filter((x) => x.serial.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open onClose={onClose} size="sm" title={`Select serial / IMEI`} description={`${product.name}${product.model ? ` · ${product.model}` : ''}${product.warrantyMonths ? ` · ${product.warrantyMonths} months warranty` : ''}`}>
      <div className="ex-stack">
        <TextField autoFocus icon="ScanLine" placeholder="Scan or type serial / IMEI" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) onPick(list[0].serial); }} />
        <div className="pos-list" style={{ maxHeight: 300 }}>
          {list.map((x) => (
            <button key={x.id} type="button" className="pos-list__row" onClick={() => onPick(x.serial)}>
              <Icon name="Hash" size={16} />
              <span className="num" style={{ flex: 1, textAlign: 'left' }}>{x.serial}</span>
              <Badge tone="success" icon="PackageCheck">In stock</Badge>
            </button>
          ))}
          {!list.length ? <EmptyState quiet title="No in-stock serials">{serials.length ? 'No serial matches your search.' : 'All units of this product are sold or allocated.'}</EmptyState> : null}
        </div>
      </div>
    </Modal>
  );
}
