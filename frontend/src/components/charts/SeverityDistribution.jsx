// PLACEHOLDER chart. Swap for Manpreet's Chart.js component with the same name.
// Expected props: data { critical, high, medium, low }, size (px)
// Optional: selected ('all' | severity), onSelect(severity). Segments are clickable when onSelect is given.
const ORDER = ['critical', 'high', 'medium', 'low'];
export default function SeverityDistribution({ data = {}, size = 160, selected = 'all', onSelect }) {
  const total = ORDER.reduce((s, k) => s + (data[k] || 0), 0) || 1;
  const r = 15.9155; // circumference = 100
  let offset = 25;
  return (
    <div className="cc-donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 42 42" role="img" aria-label="Severity distribution">
        <circle cx="21" cy="21" r={r} className="cc-donut__track" />
        {ORDER.map((k) => {
          const pct = ((data[k] || 0) / total) * 100;
          const el = (
            <circle key={k} cx="21" cy="21" r={r} className={`cc-donut__seg cc-donut__seg--${k}${onSelect ? ' is-clickable' : ''}${selected !== 'all' && selected !== k ? ' is-dim' : ''}`}
              onClick={onSelect ? () => onSelect(k) : undefined}
              strokeDasharray={`${Math.max(pct - 0.6, 0)} ${100 - Math.max(pct - 0.6, 0)}`} strokeDashoffset={offset}>
              <title>{`${k}: ${data[k] || 0}`}</title>
            </circle>
          );
          offset -= pct;
          return el;
        })}
      </svg>
      <div className="cc-donut__center"><strong>{total.toLocaleString()}</strong><span>total</span></div>
    </div>
  );
}
