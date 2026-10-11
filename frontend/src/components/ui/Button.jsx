import './ui.css';
import Loader from './Loader.jsx';

/**
 * Button
 * Props: variant ('primary'|'ghost'|'danger'), size ('sm'|'md'|'lg'),
 *        loading, disabled, icon (node), onClick, type, children, className
 */
export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  type = 'button',
  className = '',
  children,
  ...rest
}) {
  const cls = ['dt-btn', `dt-btn--${variant}`, `dt-btn--${size}`, loading && 'is-loading', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader size="sm" inline /> : icon ? <span className="dt-btn__icon">{icon}</span> : null}
      <span className="dt-btn__label">{children}</span>
    </button>
  );
}
