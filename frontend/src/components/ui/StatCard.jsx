import { useEffect, useRef, useState } from 'react';
import './ui.css';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Counts from the value currently on screen to `to` over `ms`.
 * First render starts at 0 (no flash of the final number); later changes animate from the old value.
 * With reduced motion the number is shown immediately.
 */
function useCountUp(to, ms = 800) {
  const [n, setN] = useState(() => (typeof to === 'number' && prefersReducedMotion() ? to : 0));
  const current = useRef(n);
  useEffect(() => {
    if (typeof to !== 'number') return undefined;
    if (prefersReducedMotion()) { current.current = to; setN(to); return undefined; }
    const from = current.current;
    if (from === to) return undefined;
    let raf; let t0 = null; // t0 is the first frame's own timestamp, so the clocks never disagree
    const tick = (t) => {
      if (t0 === null) t0 = t;
      const k = Math.min(1, (t - t0) / ms);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      current.current = v;
      setN(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return n;
}

function Sparkline({ data }) {
  if (!data || data.length < 2) return null;
  const w = 120, h = 36, min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 8)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  const last = pts[pts.length - 1];
  return (
    <svg className="dt-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon points={area} className="dt-spark__area" />
      <polyline points={line} className="dt-spark__line" />
      <circle cx={last[0]} cy={last[1]} r="2.5" className="dt-spark__dot" />
    </svg>
  );
}

/**
 * StatCard
 * Props: label, value (number or string), unit, delta (percent number), upIsBad (bool),
 *        trend (array of numbers for the mini chart), variant ('accent'|'critical'|'high'|'medium'|'low')
 */
export default function StatCard({ label, value, unit, delta, upIsBad = false, trend, variant = 'accent', className = '' }) {
  const shown = useCountUp(typeof value === 'number' ? value : 0);
  const display = typeof value === 'number' ? shown.toLocaleString() : value;
  const up = typeof delta === 'number' && delta > 0;
  const tone = typeof delta !== 'number' || delta === 0 ? 'flat' : up === upIsBad ? 'bad' : 'good';
  return (
    <div className={['dt-stat', `dt-stat--${variant}`, className].filter(Boolean).join(' ')}>
      <span className="dt-stat__label">{label}</span>
      <div className="dt-stat__row">
        <span className="dt-stat__value">{display}{unit && <small>{unit}</small>}</span>
        <Sparkline data={trend} />
      </div>
      {typeof delta === 'number' && (
        <span className={`dt-stat__delta dt-stat__delta--${tone}`}>
          {up ? '\u25B2' : delta < 0 ? '\u25BC' : '\u25AC'} {Math.abs(delta)}% vs last 24 h
        </span>
      )}
    </div>
  );
}
