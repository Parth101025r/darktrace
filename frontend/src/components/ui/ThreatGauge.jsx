import './ui.css';

const level = (v) => (v >= 75 ? 'critical' : v >= 50 ? 'high' : v >= 25 ? 'medium' : 'low');
const NAMES = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

/**
 * ThreatGauge
 * Props: value (0-100), label
 * Color and level name follow the value: 0-24 Low, 25-49 Medium, 50-74 High, 75-100 Critical.
 */
export default function ThreatGauge({ value = 0, label = 'Threat level', className = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const lv = level(v);
  return (
    <div className={['dt-gauge', `dt-gauge--${lv}`, className].filter(Boolean).join(' ')} role="meter"
         aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <svg viewBox="0 0 120 72" className="dt-gauge__svg" aria-hidden="true">
        <path d="M10 62 A50 50 0 0 1 110 62" pathLength="100" className="dt-gauge__track" />
        <path d="M10 62 A50 50 0 0 1 110 62" pathLength="100" className="dt-gauge__fill"
              style={{ strokeDasharray: 100, strokeDashoffset: 100 - v }} />
      </svg>
      <div className="dt-gauge__read">
        <span className="dt-gauge__num">{Math.round(v)}</span>
        <span className="dt-gauge__lvl">{NAMES[lv]}</span>
      </div>
      <span className="dt-gauge__label">{label}</span>
    </div>
  );
}
