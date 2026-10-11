import { useCallback, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import Sidebar from './components/layout/Sidebar';
import Topbar from './components/layout/Topbar';
import { Backdrop, CursorLight, ClickRings, AlertOverlay } from './components/effects/Backdrop';
import { TargetLock, useMagnetic, useCameraParallax } from './components/effects/Interactions';
import BootSequence from './components/effects/BootSequence';
import CommandPalette from './components/effects/CommandPalette';
import Spider3D from './components/spider/Spider3D';
import CommandCenter from './pages/CommandCenter';
import DarkWebCrawler from './pages/DarkWebCrawler';
import ThreatIntelligence from './pages/ThreatIntelligence';
import './components/layout/layout.css';

const PAGES = {
  command: CommandCenter,
  crawler: DarkWebCrawler,
  intel: ThreatIntelligence,
};
const TAB_KEYS = { 1: 'command', 2: 'crawler', 3: 'intel' };

function seenBoot() {
  try {
    return sessionStorage.getItem('dt-booted') === '1';
  } catch {
    return false;
  }
}

function Shell() {
  const { activeTab, setActiveTab, rainEnabled, paletteOpen, bootKey, crawlerActive } = useApp();
  const Page = PAGES[activeTab];
  const [booting, setBooting] = useState(() => !seenBoot());

  useMagnetic();
  useCameraParallax();

  useEffect(() => {
    if (bootKey > 0) setBooting(true);
  }, [bootKey]);

  const bootDone = useCallback(() => {
    setBooting(false);
    try {
      sessionStorage.setItem('dt-booted', '1');
    } catch {
      /* storage unavailable — boot will just show again next time */
    }
  }, []);

  // 1 / 2 / 3 switch tabs (ignored while typing)
  useEffect(() => {
    const onKey = (e) => {
      if (paletteOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (TAB_KEYS[e.key]) setActiveTab(TAB_KEYS[e.key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setActiveTab]);

  return (
    <div className="app">
      <Backdrop rain={rainEnabled} />
      <CursorLight />
      <Sidebar />
      <div className="main">
        <Topbar />
        <main className="content">
          <Page key={activeTab} />
        </main>
      </div>
      {/* Khaleel's spider slot: 3D spider. Crawler tab: patrols the screen edge while crawling, idle otherwise.
          Other tabs: always walking and follows the cursor. */}
      {!booting && (
        <Spider3D
          state={activeTab !== 'crawler' || crawlerActive ? 'walking' : 'idle'}
          path={activeTab === 'crawler' ? 'perimeter' : 'panels'}
          size={window.innerWidth < 700 ? 10 : 20} /* px per world unit = spider size */
        />
      )}
      <TargetLock />
      <ClickRings />
      <AlertOverlay />
      <CommandPalette />
      {booting && <BootSequence key={bootKey} onDone={bootDone} />}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
