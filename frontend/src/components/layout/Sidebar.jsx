// Sidebar navigation
import { useApp } from '../../context/AppContext';
import Icon from './Icon';
import { CubeLogo } from '../effects/Interactions';

export const TABS = [
  { id: 'command', label: 'Command Center', short: 'Command', icon: 'radar', hint: 'Overview & KPIs' },
  { id: 'crawler', label: 'Dark Web Crawler', short: 'Crawler', icon: 'web', hint: 'Live crawl control' },
  { id: 'intel', label: 'Threat Intelligence', short: 'Intel', icon: 'shield', hint: 'IOCs & findings' },
];

export default function Sidebar() {
  const { activeTab, setActiveTab } = useApp();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="brand-row">
          <CubeLogo />
          <div className="brand">
            <span className="brand-word">
              DARK<b>TRACE</b>
            </span>
            <span className="brand-tag">Dark Web Intelligence</span>
          </div>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        <span className="nav-heading">Modules</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`nav-item ${activeTab === t.id ? 'is-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            aria-current={activeTab === t.id ? 'page' : undefined}
          >
            <span className="nav-icon">
              <Icon name={t.icon} size={19} />
            </span>
            <span className="nav-text">
              <span className="nav-label">{t.label}</span>
              <span className="nav-short">{t.short}</span>
              <span className="nav-hint">{t.hint}</span>
            </span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <span className="build mono">v0.1.0</span>
      </div>
    </aside>
  );
}
