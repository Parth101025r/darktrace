// Shared app state for the base frontend.
// Teammates extend this (crawler simulation, threat feed, toasts…) on top of it.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { eventBus } from '../hooks/eventBus';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [activeTab, setActiveTab] = useState('command');
  const [rainEnabled, setRainEnabled] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bootKey, setBootKey] = useState(0);
  // placeholder until the Crawler tab is built — rain and globe speed up while true
  const [crawlerStatus, setCrawlerStatus] = useState('idle'); // INTEGRATION: set by the Crawler tab (idle|running|paused|stopped)
  const crawlerActive = crawlerStatus === 'running';
  const setCrawlerActive = useCallback((on) => setCrawlerStatus(on ? 'running' : 'idle'), []);

  const changeTab = useCallback((tab) => {
    setActiveTab(tab);
    eventBus.emit('tab', tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // rain and the alert overlay react to this
  const triggerCritical = useCallback((threat) => eventBus.emit('critical', threat), []);

  const replayBoot = useCallback(() => setBootKey((k) => k + 1), []);

  useEffect(() => {
    eventBus.emit('crawler', { active: crawlerActive });
  }, [crawlerActive]);

  const value = {
    activeTab,
    setActiveTab: changeTab,
    rainEnabled,
    setRainEnabled,
    paletteOpen,
    setPaletteOpen,
    bootKey,
    replayBoot,
    crawlerActive,
    setCrawlerActive,
    crawlerStatus,
    setCrawlerStatus,
    triggerCritical,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export const useApp = () => useContext(AppContext);
