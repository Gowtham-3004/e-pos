import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface ChartPoint { label: string; value: number; sub?: string }

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const ro = useRef<ResizeObserver | null>(null);
  const setRef = (el: HTMLDivElement | null) => {
    (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
    ro.current?.disconnect();
    if (el && typeof ResizeObserver !== 'undefined') {
      ro.current = new ResizeObserver((e) => setW(Math.max(200, e[0]!.contentRect.width)));
      ro.current.observe(el);
    }
  };
  return { setRef, w };
}

/**
 * Single-series bar chart (magnitude over categories/time). One hue, recessive grid,
 * 4px rounded data-ends, 2px gaps, per-bar hover tooltip, accessible table fallback.
 */
export function BarChart({ data, height = 220, format = (v) => String(v), title, highlightLast }: { data: ChartPoint[]; height?: number; format?: (v: number) => string; title: string; highlightLast?: boolean }) {
  const { setRef, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56, padB = 24, padT = 8;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = w - padL, ih = height - padB - padT;
  const bw = iw / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(36, bw - 2));
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 56)));
  return (
    <div className="ex-chart" ref={setRef}>
      <svg width={w} height={height} role="img" aria-label={title}>
        {ticks.map((t) => {
          const y = padT + ih - (t / max) * ih;
          return (
            <g key={t}>
              <line className="ex-chart__grid" x1={padL} x2={w} y1={y} y2={y} />
              <text className="ex-chart__axis" x={padL - 8} y={y + 4} textAnchor="end">{format(t)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = Math.max(d.value > 0 ? 2 : 0, (d.value / max) * ih);
          const x = padL + i * bw + (bw - barW) / 2;
          const y = padT + ih - h;
          const r = Math.min(4, barW / 2, h);
          const path = h > 0 ? `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z` : '';
          const muted = hover != null ? hover !== i : highlightLast ? i !== data.length - 1 : false;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={ih} fill="transparent" />
              {path ? <path d={path} className={`ex-chart__bar${muted ? ' ex-chart__bar--muted' : ''}`} /> : null}
              {i % labelEvery === 0 ? <text className="ex-chart__axis" x={x + barW / 2} y={height - 6} textAnchor="middle">{d.label}</text> : null}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] ? (
        <div className="ex-chart__tip" style={{ left: padL + hover * bw + bw / 2, top: padT + ih - (data[hover]!.value / max) * ih }}>
          <span className="muted">{data[hover]!.sub ?? data[hover]!.label}</span>
          <b>{format(data[hover]!.value)}</b>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.sub ?? d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Single-series line/area chart with crosshair tooltip. */
export function LineChart({ data, height = 220, format = (v) => String(v), title, area = true }: { data: ChartPoint[]; height?: number; format?: (v: number) => string; title: string; area?: boolean }) {
  const { setRef, w } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 56, padB = 24, padT = 10, padR = 8;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const iw = w - padL - padR, ih = height - padB - padT;
  const x = (i: number) => padL + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v: number) => padT + ih - (v / max) * ih;
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join(' ');
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 64)));
  return (
    <div className="ex-chart" ref={setRef}>
      <svg
        width={w}
        height={height}
        role="img"
        aria-label={title}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = e.clientX - r.left - padL;
          setHover(Math.max(0, Math.min(data.length - 1, Math.round((px / iw) * (data.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line className="ex-chart__grid" x1={padL} x2={w - padR} y1={y(t * max)} y2={y(t * max)} />
            <text className="ex-chart__axis" x={padL - 8} y={y(t * max) + 4} textAnchor="end">{format(t * max)}</text>
          </g>
        ))}
        {area && data.length > 1 ? <path className="ex-chart__area" d={`${line} L${x(data.length - 1)},${padT + ih} L${x(0)},${padT + ih} Z`} /> : null}
        <path className="ex-chart__line" d={line} />
        {data.map((d, i) => (i % labelEvery === 0 ? <text key={i} className="ex-chart__axis" x={x(i)} y={height - 6} textAnchor="middle">{d.label}</text> : null))}
        {hover != null ? (
          <>
            <line className="ex-chart__cross" x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + ih} />
            <circle className="ex-chart__marker" cx={x(hover)} cy={y(data[hover]!.value)} r={5} />
          </>
        ) : null}
      </svg>
      {hover != null && data[hover] ? (
        <div className="ex-chart__tip" style={{ left: x(hover), top: y(data[hover]!.value) }}>
          <span className="muted">{data[hover]!.sub ?? data[hover]!.label}</span>
          <b>{format(data[hover]!.value)}</b>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>{data.map((d) => <tr key={d.label}><th>{d.sub ?? d.label}</th><td>{format(d.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** Ranked horizontal bars with direct labels — preferred over pies for share/mix. */
export function BarList({ items, format = (v) => String(v), max }: { items: Array<{ label: ReactNode; value: number; key?: string; extra?: ReactNode }>; format?: (v: number) => string; max?: number }) {
  const m = useMemo(() => max ?? Math.max(1, ...items.map((i) => i.value)), [items, max]);
  return (
    <div className="ex-barlist">
      {items.map((it, i) => (
        <div key={it.key ?? i} className="ex-barlist__row">
          <span className="ex-truncate">{it.label}</span>
          <div className="ex-barlist__track"><div className="ex-barlist__fill" style={{ width: `${(it.value / m) * 100}%` }} /></div>
          <span className="ex-barlist__val">{format(it.value)}{it.extra}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 96, height = 28, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * width},${height - 2 - (v / max) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      <polyline points={pts} fill="none" stroke="var(--status-info)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
