import { Kbd, Modal } from '@elixir/ui';

export const BILLING_SHORTCUTS: Array<[string, string]> = [
  ['F1', 'Print last receipt'],
  ['F2', 'Sales history'],
  ['F3', 'Return'],
  ['F4', 'Hold bill'],
  ['F5', 'Reset bill (confirm)'],
  ['F6', 'Resume held bill'],
  ['F7', 'Process order / payment'],
  ['F8', 'Customer'],
  ['F9', 'Bill discount'],
  ['+ / −', 'Quantity of selected line'],
  ['↑ / ↓', 'Select line'],
  ['Del', 'Remove selected line'],
  ['Enter', 'Scan / add / confirm'],
  ['Esc', 'Close search or dialog'],
  ['?', 'This overlay'],
];

export function ShortcutOverlay({ open, onClose, items = BILLING_SHORTCUTS, title = 'Keyboard shortcuts' }: { open: boolean; onClose: () => void; items?: Array<[string, string]>; title?: string }) {
  return (
    <Modal open={open} onClose={onClose} size="md" title={title} description="Scanner input never triggers shortcuts. Shortcuts respect your permissions.">
      <div className="pos-shortcuts">
        {items.map(([k, v]) => (
          <div key={k} className="pos-shortcuts__row">
            <span>{k.split(' / ').map((x, i) => <Kbd key={i}>{x}</Kbd>)}</span>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
