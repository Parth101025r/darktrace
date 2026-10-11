import './ui.css';

// Elements inside a card that handle their own click/keyboard input.
const INTERACTIVE = 'button, a, input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])';

// True when the event started on an interactive element inside the card (not on the card itself).
const fromInner = (e) => {
  const el = e.target.closest?.(INTERACTIVE);
  return Boolean(el) && el !== e.currentTarget;
};

/**
 * Card
 * Props: title, subtitle, severity ('critical'|'high'|'medium'|'low'), glow (bool),
 *        hoverable (default true), onClick, footer, actions, children, className
 * Buttons, links and inputs placed inside a clickable card keep their own behavior;
 * they do not also trigger the card's onClick.
 */
export default function Card({
  title,
  subtitle,
  severity,
  glow = false,
  hoverable = true,
  onClick,
  footer,
  actions,
  children,
  className = '',
}) {
  const clickable = typeof onClick === 'function';
  const cls = [
    'dt-card',
    hoverable && 'dt-card--hover',
    glow && 'dt-card--glow',
    clickable && 'dt-card--clickable',
    severity && `dt-card--sev-${severity}`,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const handleClick = (e) => {
    if (!clickable || fromInner(e)) return;
    onClick(e);
  };

  const onKeyDown = (e) => {
    if (!clickable || fromInner(e)) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick(e);
    }
  };

  return (
    <section
      className={cls}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={onKeyDown}
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'button' : undefined}
    >
      {(title || actions) && (
        <header className="dt-card__head">
          <div className="dt-card__titles">
            {title && <h3 className="dt-card__title">{title}</h3>}
            {subtitle && <p className="dt-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="dt-card__actions">{actions}</div>}
        </header>
      )}
      <div className="dt-card__body">{children}</div>
      {footer && <footer className="dt-card__foot">{footer}</footer>}
    </section>
  );
}
