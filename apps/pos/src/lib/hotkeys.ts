import { useEffect, useRef } from 'react';

export type HotkeyHandler = (e: KeyboardEvent) => void;

/** True when a modal/drawer/sheet is open — global shortcuts pause so dialogs own the keyboard. */
export const overlayOpen = () => typeof document !== 'undefined' && !!document.querySelector('.ex-overlay');

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  if (t.dataset.scanner === 'true') return (t as HTMLInputElement).value.length > 0;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/**
 * Global keyboard shortcuts (§53). F-keys always work (scanners never emit them).
 * Character keys (+ - ? Delete) only fire when the operator is not typing — the scan field counts as
 * "not typing" while empty, so scanner input never triggers shortcuts.
 */
export function useHotkeys(map: Record<string, HotkeyHandler>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      if (overlayOpen()) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      const isF = /^F\d{1,2}$/.test(e.key) || e.key === 'Escape';
      const isNav = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (!isF && !isNav && isTyping(e)) return;
      if (isNav && isTyping(e) && (e.target as HTMLElement).dataset.scanner !== 'true') return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled]);
}
