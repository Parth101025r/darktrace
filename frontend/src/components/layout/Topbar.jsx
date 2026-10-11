// Top bar + live hex ticker
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext'; // BACKEND
import Icon from './Icon';
import { TABS } from './Sidebar';

function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const iv = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return <span className="mono clock">{t.toISOString().slice(11, 19)} UTC</span>;
}

const hex = (n) =>
  Array.from({ length: n }, () => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');

function Ticker() {
  // decorative telemetry stream, regenerated now and then
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setSeed((s) => s + 1), 20000);
    return () => clearInterval(iv);
  }, []);
  const items = useMemo(
    () => [
      `TOR-CIRCUIT ${hex(4)}::${hex(4)} ROTATED`,
      `SHA256 ${hex(16)}…`,
      `NODE EU-W-02 LATENCY ${(40 + Math.random() * 80).toFixed(0)}ms`,
      `ONION ${hex(16)}.onion INDEXED`,
      `PGP KEY 0x${hex(8).toUpperCase()} VERIFIED`,
      `PACKETS ${(Math.random() * 9 + 1).toFixed(2)}M/s`,
      `I2P TUNNEL ${hex(6)} UP`,
      `ENTROPY POOL ${(90 + Math.random() * 9).toFixed(1)}%`,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed]
  );
  const row = items.map((t, i) => (
    <span key={i}>
      <i>◆</i>
      {t}
    </span>
  ));
  return (
    <div className="ticker mono" aria-hidden="true">
      <div className="ticker-track">
        {row}
        {row}
      </div>
    </div>
  );
}

export default function Topbar() {
  const { activeTab, rainEnabled, setRainEnabled, triggerCritical, setPaletteOpen } = useApp();
  const { logout } = useAuth();
  const tab = TABS.find((t) => t.id === activeTab);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <span className="muted">DarkTrace</span>
          <Icon name="chevron" size={14} />
          <strong key={tab.id}>{tab.label}</strong>
        </div>

        <button className="cmd-btn" data-magnetic onClick={() => setPaletteOpen(true)} aria-label="Open command palette">
          <Icon name="search" size={15} />
          <span>Search or run a command…</span>
          <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
        </button>

        <div className="topbar-right">
          <span className="live-pill">
            <i />
            LIVE
          </span>
          <Clock />
          <button
            data-magnetic
            className={`icon-btn ${rainEnabled ? 'on' : ''}`}
            onClick={() => setRainEnabled(!rainEnabled)}
            title={rainEnabled ? 'Turn off digital rain' : 'Turn on digital rain'}
            aria-label="Toggle digital rain"
            aria-pressed={rainEnabled}
          >
            <Icon name="rain" />
          </button>
          <button className="top-btn" data-magnetic onClick={() => triggerCritical()} title="Fire a test critical event">
            <Icon name="alert" size={15} />
            <span>Simulate critical</span>
          </button>
          <button className="top-btn" data-magnetic onClick={logout} title="Sign out">
            ⏻<span> Logout</span>
          </button>
        </div>
      </header>
      <Ticker />
    </>
  );
}
