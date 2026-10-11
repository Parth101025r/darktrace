import './ui.css';

/**
 * Loader
 * Props: size ('sm'|'md'|'lg'), label, inline (no wrapper spacing)
 */
export default function Loader({ size = 'md', label, inline = false, className = '' }) {
  return (
    <span
      className={['dt-loader', `dt-loader--${size}`, inline && 'dt-loader--inline', className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
    >
      <span className="dt-loader__ring" aria-hidden="true" />
      {label ? <span className="dt-loader__label">{label}</span> : <span className="dt-sr">Loading</span>}
    </span>
  );
}
