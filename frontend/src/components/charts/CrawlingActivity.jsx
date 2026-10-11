// PLACEHOLDER chart. Swap for Manpreet's Chart.js component with the same name.
// Expected props: labels (string[]), values (number[]), height (px)
export default function CrawlingActivity({ labels = [], values = [], height = 180 }) {
  const max = Math.max(...values, 1);
  return (
    <div className="cc-chart" style={{ height }}>
      <div className="cc-bars" role="img" aria-label="Crawling activity">
        {values.map((v, i) => (
          <div className="cc-bars__col" key={labels[i]} title={`${labels[i]}: ${v.toLocaleString()} pages`}>
            <div className="cc-bars__bar" style={{ height: `${(v / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="cc-chart__axis">{labels.map((l) => <span key={l}>{l}</span>)}</div>
    </div>
  );
}
