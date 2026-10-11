import './ui.css';

/**
 * ProgressBar
 * Props: value (0-100), variant ('accent'|'critical'|'high'|'medium'|'low'),
 *        label, showValue (default true), active (animated stripes), size ('sm'|'md')
 */
export default function ProgressBar({
  value = 0,
  variant = 'accent',
  label,
  showValue = true,
  active = false,
  size = 'md',
  className = '',
}) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const cls = ['dt-progress', `dt-progress--${size}`, `dt-progress--${variant}`, active && 'is-active', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      {(label || showValue) && (
        <div className="dt-progress__meta">
          {label && <span className="dt-progress__label">{label}</span>}
          {showValue && <span className="dt-progress__value">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className="dt-progress__track"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
      >
        <div className="dt-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
