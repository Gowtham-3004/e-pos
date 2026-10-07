import { useNavigate } from 'react-router-dom';
import { Button, EmptyState } from '@elixir/ui';
import { useSession } from '../lib/pos';

/** FR-SHF-001: billing requires an open shift on this counter. */
export function ShiftGate({ what = 'billing' }: { what?: string }) {
  const s = useSession();
  const nav = useNavigate();
  const canOpen = s.permissions.includes('shift.open');
  return (
    <div className="pos-center">
      <div className="ex-card" style={{ maxWidth: 520, width: '100%' }}>
        <EmptyState
          icon="Clock"
          title={`Open a shift to start ${what}`}
          actions={canOpen ? <Button variant="primary" size="lg" icon="LogIn" onClick={() => nav('/shift')}>Open shift (Day-In)</Button> : undefined}
        >
          Counter {s.counter?.code} has no open shift. Count the opening cash in the drawer to begin. {canOpen ? '' : 'Ask a cashier or manager to open the shift.'}
        </EmptyState>
      </div>
    </div>
  );
}
