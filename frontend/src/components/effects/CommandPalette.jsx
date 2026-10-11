// Ctrl/⌘ + K command palette.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import Icon from '../layout/Icon';

export default function CommandPalette() {
  const app = useApp();
  const { paletteOpen, setPaletteOpen } = app;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);

  const commands = useMemo(
    () => [
      { id: 'go-command', label: 'Go to Command Center', hint: '1', icon: 'radar', run: () => app.setActiveTab('command') },
      { id: 'go-crawler', label: 'Go to Dark Web Crawler', hint: '2', icon: 'web', run: () => app.setActiveTab('crawler') },
      { id: 'go-intel', label: 'Go to Threat Intelligence', hint: '3', icon: 'shield', run: () => app.setActiveTab('intel') },
      { id: 'critical', label: 'Simulate critical threat', icon: 'alert', run: () => app.triggerCritical() },
      {
        id: 'rain',
        label: app.rainEnabled ? 'Turn off digital rain' : 'Turn on digital rain',
        icon: 'rain',
        run: () => app.setRainEnabled(!app.rainEnabled),
      },
      {
        id: 'crawl',
        label: app.crawlerActive ? 'Stop crawler activity' : 'Simulate crawler activity',
        icon: 'web',
        run: () => app.setCrawlerActive(!app.crawlerActive),
      },
      { id: 'boot', label: 'Replay boot sequence', icon: 'terminal', run: () => app.replayBoot() },
    ],
    [app]
  );

  const results = commands.filter((c) => c.label.toLowerCase().includes(q.trim().toLowerCase()));

  // global shortcut
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const run = (c) => {
    setPaletteOpen(false);
    c.run();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') setPaletteOpen(false);
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(results.length - 1, s + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === 'Enter' && results[sel]) run(results[sel]);
  };

  return (
    <div className="palette-backdrop" onMouseDown={() => setPaletteOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="terminal" size={17} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSel(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command…"
            aria-label="Command"
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? 'is-sel' : ''}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(c)}
            >
              <Icon name={c.icon} size={16} />
              <span>{c.label}</span>
              {c.hint && <kbd>{c.hint}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
