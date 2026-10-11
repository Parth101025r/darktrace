import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Badge, ProgressBar, StatCard, ThreatGauge, LogFeed, Tooltip } from '../../components/ui';
import { ThreatsOverTime, CrawlingActivity, SeverityDistribution } from '../../components/charts';
import { getAlerts, getCrawlJobs, getSources, getSummary } from '../../api';
import './CommandCenter.css';

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const EMPTY_SEVERITY = { critical: 0, high: 0, medium: 0, low: 0 };

const asNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const severityOf = (value) => String(value || 'low').toLowerCase();
const timeOf = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

function pagesFor(job) {
  const stats = job.stats || {};
  return asNumber(stats.pages_crawled ?? stats.pagesCrawled ?? stats.pages ?? stats.documents_processed ?? stats.documentsProcessed);
}

function crawlerStatus(state) {
  if (state === 'running') return 'running';
  if (state === 'queued') return 'paused';
  if (state === 'failed' || state === 'dead') return 'stopped';
  return 'idle';
}

function severityCounts(summary, alerts) {
  const fromSummary = summary?.alerts_by_severity || {};
  const counts = { ...EMPTY_SEVERITY };
  for (const key of SEVERITIES) counts[key] = asNumber(fromSummary[key]);
  if (Object.values(counts).some(Boolean)) return counts;
  for (const alert of alerts) {
    const key = severityOf(alert.severity);
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

function threatSeries(alerts) {
  const now = new Date();
  const values = Array(8).fill(0);
  const labels = Array.from({ length: 8 }, (_, index) => {
    const date = new Date(now.getTime() - (7 - index) * 3 * 60 * 60 * 1000);
    return `${String(date.getHours()).padStart(2, '0')}:00`;
  });
  for (const alert of alerts) {
    const created = new Date(alert.created_at);
    const ageHours = (now.getTime() - created.getTime()) / (60 * 60 * 1000);
    if (!Number.isNaN(created.getTime()) && ageHours >= 0 && ageHours < 24) values[7 - Math.floor(ageHours / 3)] += 1;
  }
  return { labels, values };
}

function crawlSeries(jobs) {
  const now = new Date();
  const values = Array(7).fill(0);
  const labels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (6 - index));
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  });
  for (const job of jobs) {
    const stamp = job.finished_at || job.started_at;
    const date = stamp && new Date(stamp);
    const ageDays = date && (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
    if (date && !Number.isNaN(date.getTime()) && ageDays >= 0 && ageDays < 7) values[6 - Math.floor(ageDays)] += pagesFor(job) || 1;
  }
  return { labels, values };
}

export default function CommandCenter() {
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState({ summary: null, alerts: [], sources: [], jobs: [] });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    const load = async () => {
      const [summary, alerts, sources, jobs] = await Promise.allSettled([
        getSummary(), getAlerts(), getSources(), getCrawlJobs(),
      ]);
      if (!alive) return;
      const resolved = (result, fallback) => (result.status === 'fulfilled' ? result.value : fallback);
      setData({
        summary: resolved(summary, null),
        alerts: resolved(alerts, []),
        sources: resolved(sources, []),
        jobs: resolved(jobs, []),
      });
      setLoadError([summary, alerts, sources, jobs].some((result) => result.status === 'rejected')
        ? 'Some live data could not be loaded.'
        : '');
      setLoading(false);
    };
    load();
    const timer = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [live]);

  const severity = useMemo(() => severityCounts(data.summary, data.alerts), [data]);
  const totalThreats = useMemo(() => SEVERITIES.reduce((total, key) => total + severity[key], 0), [severity]);
  const sourceById = useMemo(() => new Map(data.sources.map((source) => [source.source_id, source])), [data.sources]);
  const crawlers = useMemo(() => {
    const latestBySource = new Map();
    for (const job of data.jobs) if (!latestBySource.has(job.source_id)) latestBySource.set(job.source_id, job);
    const sourceIds = new Set([...data.sources.map((source) => source.source_id), ...latestBySource.keys()]);
    return [...sourceIds].map((sourceId) => {
      const source = sourceById.get(sourceId);
      const job = latestBySource.get(sourceId);
      const rawProgress = job?.stats?.progress ?? job?.stats?.percent_complete;
      const progress = rawProgress == null ? (job?.state === 'done' ? 100 : 0) : Math.max(0, Math.min(100, asNumber(rawProgress)));
      return {
        id: sourceId,
        name: source?.name || sourceId,
        source: source?.onion_addr || source?.source_type || 'No source address reported',
        status: crawlerStatus(job?.state),
        progress,
        state: job?.state || 'no jobs',
      };
    });
  }, [data.jobs, data.sources, sourceById]);
  const activeCount = data.jobs.filter((job) => job.state === 'running').length;
  const queuedCount = data.jobs.filter((job) => job.state === 'queued').length;
  const pages = data.jobs.reduce((total, job) => total + pagesFor(job), 0);
  const riskScore = totalThreats
    ? Math.round((severity.critical * 100 + severity.high * 68 + severity.medium * 35 + severity.low * 10) / totalThreats)
    : 0;
  const events = useMemo(() => {
    const alertEvents = data.alerts.map((alert) => {
      const severity = severityOf(alert.severity);
      return {
        id: `alert-${alert.id}`,
        time: timeOf(alert.created_at),
        level: severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info',
        severity,
        text: alert.title || 'Untitled alert',
        stamp: new Date(alert.created_at).getTime() || 0,
      };
    });
    const jobEvents = data.jobs
      .filter((job) => job.started_at || job.finished_at)
      .map((job) => ({
        id: `job-${job.job_id}`,
        time: timeOf(job.finished_at || job.started_at),
        level: job.state === 'failed' || job.state === 'dead' ? 'error' : job.state === 'done' ? 'success' : 'info',
        severity: 'system',
        text: `Crawl job ${job.job_id} is ${job.state}${job.error ? `: ${job.error}` : ''}`,
        stamp: new Date(job.finished_at || job.started_at).getTime() || 0,
      }));
    return [...alertEvents, ...jobEvents].sort((a, b) => b.stamp - a.stamp);
  }, [data.alerts, data.jobs]);
  const shown = useMemo(() => (filter === 'all' ? events : events.filter((event) => event.severity === filter)), [events, filter]);
  const threatsOverTime = useMemo(() => threatSeries(data.alerts), [data.alerts]);
  const crawlingActivity = useMemo(() => crawlSeries(data.jobs), [data.jobs]);
  const toggleLive = () => setLive((value) => !value);
  const pickSeverity = (key) => setFilter((current) => (current === key ? 'all' : key));

  return (
    <main className="cc">
      <header className="cc-head">
        <div>
          <h1 className="cc-title">Command Center</h1>
          <p className="cc-sub">Overview of crawling, sources and threat activity</p>
        </div>
        <div className="cc-head__right">
          <Badge status={live ? 'running' : 'paused'}>{live ? 'LIVE MONITORING' : 'POLLING PAUSED'}</Badge>
          <Button size="sm" variant="ghost" onClick={toggleLive}>{live ? 'Pause updates' : 'Resume updates'}</Button>
        </div>
      </header>

      {loadError && <p className="cc-sub" role="status">{loadError}</p>}
      {loading && <p className="cc-sub" role="status">Loading dashboard data…</p>}

      <section className="cc-stats" aria-label="Key statistics">
        <StatCard label="Threats detected" value={totalThreats} upIsBad variant="critical" />
        <StatCard label="Sources monitored" value={data.sources.length} variant="accent" />
        <StatCard label="Pages crawled" value={pages} variant="low" />
        <StatCard label="Active crawl jobs" value={activeCount} unit={` / ${data.jobs.length}`} variant="medium" />
      </section>

      <section className="cc-sev" aria-label="Severity breakdown">
        {SEVERITIES.map((key) => (
          <Card key={key} severity={key} glow={key === 'critical'} onClick={() => pickSeverity(key)}
            className={filter === key ? 'cc-sev__card is-selected' : 'cc-sev__card'}>
            <div className="cc-sev__top">
              <Badge severity={key} />
              <span className="cc-sev__count">{severity[key].toLocaleString()}</span>
            </div>
            <ProgressBar value={(severity[key] / (totalThreats || 1)) * 100} variant={key} size="sm" label="Share of all threats" />
          </Card>
        ))}
      </section>

      <div className="cc-grid">
        <Card title="Threats over time" subtitle="Alerts received in the last 24 hours" className="cc-span-2">
          <ThreatsOverTime {...threatsOverTime} />
        </Card>
        <Card title="Threat level" subtitle="Derived from alert severity" className="cc-fit">
          <ThreatGauge value={riskScore} label="Current level" />
        </Card>

        <Card title="Severity distribution" subtitle="Click a segment to filter activity" className="cc-fit">
          <div className="cc-center"><SeverityDistribution data={severity} size={200} selected={filter} onSelect={pickSeverity} /></div>
          <ul className="cc-legend">
            {SEVERITIES.map((key) => (
              <li key={key}>
                <button type="button" className={`cc-legend__btn${filter === key ? ' is-on' : ''}`} aria-pressed={filter === key}
                  onClick={() => pickSeverity(key)} title={`Filter activity: ${key}`}>
                  <i className={`cc-dot cc-dot--${key}`} />{key}<b>{severity[key].toLocaleString()}</b>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Crawl activity" subtitle="Reported pages during the last 7 days" className="cc-fit">
          <CrawlingActivity {...crawlingActivity} height="100%" />
        </Card>
        <Card title="Monitored sources" subtitle={`${activeCount} running · ${queuedCount} queued`} className="cc-fit">
          <ul className="cc-crawlers">
            {crawlers.length ? crawlers.map((crawler) => (
              <li key={crawler.id} className={`cc-crawlers__item is-${crawler.status}`}>
                <div className="cc-crawlers__row">
                  <Tooltip content={`Current source: ${crawler.source}`}><span className="cc-crawlers__name">{crawler.name}</span></Tooltip>
                  <Badge status={crawler.status}>{crawler.state}</Badge>
                </div>
                <ProgressBar value={crawler.progress} size="sm" showValue={false} active={crawler.status === 'running'} label={crawler.source} />
              </li>
            )) : <li className="cc-crawlers__item">No monitored sources have been returned by the backend.</li>}
          </ul>
        </Card>

        <Card title="Recent activity" className="cc-span-3"
          subtitle={filter === 'all' ? 'Alerts and crawl-job state changes' : `Filtered: ${filter}`}
          actions={
            <div className="cc-filters" role="group" aria-label="Filter activity by severity">
              {['all', ...SEVERITIES].map((key) => (
                <button key={key} type="button" className={`cc-chip${filter === key ? ' is-on' : ''}`} onClick={() => setFilter(key)}>{key}</button>
              ))}
            </div>
          }>
          <LogFeed lines={shown} height={260} live={live} empty="No alert or crawl-job activity has been reported yet." />
        </Card>
      </div>
    </main>
  );
}
