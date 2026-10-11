// Terminal-style boot sequence shown on first load (click / any key skips).
import { useEffect, useState } from 'react';

const LINES = [
  ['Initializing secure kernel', 'OK'],
  ['Establishing Tor circuits [12/12]', 'OK'],
  ['Mounting I2P + Telegram collectors', 'OK'],
  ['Loading threat signature database', '18,204'],
  ['Decrypting intelligence vault', 'OK'],
  ['Spinning up global threat network', 'ONLINE'],
];

const STEP = 260;

export default function BootSequence({ onDone }) {
  const [shown, setShown] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onDone();
      return undefined;
    }
    const timers = LINES.map((_, i) => setTimeout(() => setShown(i + 1), 250 + i * STEP));
    timers.push(setTimeout(() => setLeaving(true), 250 + LINES.length * STEP + 450));
    timers.push(setTimeout(onDone, 250 + LINES.length * STEP + 1050));
    const skip = () => {
      setLeaving(true);
      timers.push(setTimeout(onDone, 450));
    };
    window.addEventListener('keydown', skip, { once: true });
    window.addEventListener('pointerdown', skip, { once: true });
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [onDone]);

  const pct = Math.round((shown / LINES.length) * 100);

  return (
    <div className={`boot ${leaving ? 'is-leaving' : ''}`} role="status" aria-label="Loading DarkTrace">
      <div className="boot-inner">
        <div className="boot-logo glitch is-glitching" data-text="DARKTRACE">
          DARK<b>TRACE</b>
        </div>
        <div className="boot-sub mono">dark web intelligence platform · v0.1.0</div>
        <div className="boot-term mono">
          {LINES.slice(0, shown).map(([text, status]) => (
            <div key={text} className="boot-line">
              <span className="boot-prompt">&gt;</span>
              <span className="boot-text">{text}</span>
              <span className="boot-dots" />
              <span className="boot-status">{status}</span>
            </div>
          ))}
          {shown < LINES.length && (
            <div className="boot-line">
              <span className="boot-prompt">&gt;</span>
              <span className="boot-caret" />
            </div>
          )}
        </div>
        <div className="boot-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="boot-foot mono">
          <span>{pct}%</span>
          <span>click or press any key to skip</span>
        </div>
      </div>
    </div>
  );
}
