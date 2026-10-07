import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

interface PrintState {
  content?: ReactNode;
  nonce: number;
  print: (content: ReactNode) => void;
}

export const usePrint = create<PrintState>((set) => ({
  nonce: 0,
  print: (content) => set((s) => ({ content, nonce: s.nonce + 1 })),
}));

/** Renders the current print job off-screen and invokes the browser print dialog (thermal CSS in pos.css). */
export function PrintHost() {
  const { content, nonce } = usePrint();
  useEffect(() => {
    if (!nonce) return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* print unavailable (headless) */
      }
    }, 60);
    return () => clearTimeout(t);
  }, [nonce]);
  if (!content) return null;
  return createPortal(<div className="pos-print-root" aria-hidden>{content}</div>, document.body);
}
