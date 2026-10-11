import { useEffect, useId, useState } from 'react';
import './ui.css';

/**
 * Tooltip
 * Props: content (string|node), placement ('top'|'bottom'|'left'|'right'), children
 * Shows on hover and keyboard focus. Esc hides it while it is showing.
 * A disabled button inside still shows the tooltip on hover.
 */
export default function Tooltip({ content, placement = 'top', children, className = '' }) {
  const id = useId();
  const [active, setActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!active) { setDismissed(false); return undefined; }
    const onKey = (e) => { if (e.key === 'Escape') setDismissed(true); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  return (
    <span
      className={['dt-tip', dismissed && 'is-dismissed', className].filter(Boolean).join(' ')}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)}
      onBlur={() => setActive(false)}
    >
      <span className="dt-tip__trigger" aria-describedby={id}>
        {children}
      </span>
      <span role="tooltip" id={id} className={`dt-tip__bubble dt-tip__bubble--${placement}`}>
        {content}
      </span>
    </span>
  );
}
