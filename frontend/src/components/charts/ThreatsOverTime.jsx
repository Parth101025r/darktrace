// PLACEHOLDER chart. Swap for Manpreet's Chart.js component with the same name.
// Expected props: labels (string[]), values (number[]), height (px)
export default function ThreatsOverTime({ labels = [], values = [], height = 180 }) {
  const w = 400, h = 140, pad = 8;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2), h - pad - (v / max) * (h - pad * 2)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  return (
    <div className="cc-chart" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Threats over time">
        <polygon points={`${pad},${h} ${line} ${w - pad},${h}`} className="cc-chart__area" />
        <polyline points={line} className="cc-chart__line" />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" className="cc-chart__dot"><title>{`${labels[i]}: ${values[i]}`}</title></circle>)}
      </svg>
      <div className="cc-chart__axis">{labels.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
