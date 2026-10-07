import { useId } from 'react';

/** Elixir mark (from brand asset retailnew.svg) — red/yellow/blue chevrons around a core dot. */
export function ElixirMark({ size = 28, dotColor = 'var(--text-primary)' }: { size?: number; dotColor?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 20.4 29.24" aria-hidden style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={`r${id}`} x1=".47" y1="14.41" x2="11.24" y2="14.41" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#e22f31" /><stop offset="1" stopColor="#eb7f62" /></linearGradient>
        <linearGradient id={`y${id}`} x1="5.55" y1="5.75" x2="19.88" y2="5.75" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f5ca25" /><stop offset="1" stopColor="#f2dc71" /></linearGradient>
        <linearGradient id={`b${id}`} x1="5.55" y1="23.07" x2="19.88" y2="23.07" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#4082bf" /><stop offset="1" stopColor="#83c0e0" /></linearGradient>
      </defs>
      <path fill={`url(#r${id})`} d="M2.27,23.38c-.46,0-.92-.18-1.27-.53-.7-.7-.7-1.84,0-2.54l5.9-5.9L1,8.51c-.7-.7-.7-1.84,0-2.54.7-.7,1.84-.7,2.54,0l7.17,7.17c.34.34.53.79.53,1.27s-.19.93-.53,1.27l-7.17,7.17c-.35.35-.81.53-1.27.53Z" />
      <path fill={`url(#y${id})`} d="M14.52,11.13c-.46,0-.92-.18-1.27-.53L6.07,3.43c-.7-.7-.7-1.84,0-2.54.7-.7,1.84-.7,2.54,0l5.9,5.9,2.3-2.3c.7-.7,1.84-.7,2.54,0,.7.7.7,1.84,0,2.54l-3.57,3.57c-.35.35-.81.53-1.27.53Z" />
      <path fill={`url(#b${id})`} d="M7.34,28.45c-.46,0-.92-.18-1.27-.53-.7-.7-.7-1.84,0-2.54l7.17-7.17c.7-.7,1.84-.7,2.54,0l3.57,3.57c.7.7.7,1.84,0,2.54-.7.7-1.84.7-2.54,0l-2.3-2.3-5.9,5.9c-.35.35-.81.53-1.27.53Z" />
      <circle fill={dotColor} cx="14.52" cy="14.41" r="1.99" />
    </svg>
  );
}

/** Product lockup: mark + "Elixir" + product label (POS / Back Office / Platform). */
export function ElixirLogo({ product, size = 26, compact }: { product?: string; size?: number; compact?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <ElixirMark size={size} />
      {!compact ? (
        <span className="ex-sidebar__brand-text">
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em' }}>Elixir</span>
          {product ? <span style={{ fontWeight: 650, fontSize: 13, color: 'var(--text-muted)' }}>{product}</span> : null}
        </span>
      ) : null}
    </span>
  );
}
