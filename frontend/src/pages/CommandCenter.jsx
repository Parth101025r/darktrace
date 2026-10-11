import { useApp } from '../context/AppContext';
import Icon from '../components/layout/Icon';
import Globe from '../components/effects/Globe';
import { PageHeader } from './PageShell';
import CommandCenterBody from '../modules/CommandCenter/CommandCenter';

function NetworkHero() {
  const { setActiveTab, crawlerActive, setCrawlerActive } = useApp();
  return (
    <section className="card hero">
      <div className="hero-copy">
        <span className="hero-kicker mono">
          <i /> Global collection network
        </span>
        <h2>Watching the dark web from 8 regions, around the clock.</h2>
        <p>
          Collectors across Tor, I2P and Telegram feed one intelligence pipeline. Drag the globe to inspect the network.
        </p>
        <div className="hero-chips mono">
          <span>
            <b>8</b> regions
          </span>
          <span>
            <b>12</b> Tor circuits
          </span>
          <span className={crawlerActive ? 'is-live' : ''}>
            <b>{crawlerActive ? 'LIVE' : 'IDLE'}</b> crawler
          </span>
        </div>
        <div className="hero-actions">
          <button className="hero-btn primary" data-magnetic onClick={() => setActiveTab('crawler')}>
            <Icon name="web" size={16} />
            Open crawler
          </button>
          <button className="hero-btn" data-magnetic onClick={() => setCrawlerActive(!crawlerActive)}>
            <Icon name="radar" size={16} />
            {crawlerActive ? 'Stop activity' : 'Simulate activity'}
          </button>
        </div>
      </div>
      <Globe height={340} />
    </section>
  );
}

export default function CommandCenter() {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Operations overview"
        title="Command Center"
        description="Live posture across monitored dark web sources, crawler fleet and threat findings."
      />

      <NetworkHero />

      {/* Saksham's dashboard (stats, severity, charts, crawlers, activity) replaces the placeholder panels */}
      <CommandCenterBody />
    </div>
  );
}
