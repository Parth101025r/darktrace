import { useEffect, useRef } from 'react';
import './ui.css';

/**
 * LogFeed
 * Props: lines [{ time, level: 'info'|'success'|'warn'|'error', text }], height (px, default 220),
 *        live (blinking cursor), empty (text shown when there are no lines)
 * New lines scroll into view only while the reader is at the bottom; scrolling up pauses it.
 * Text is rendered as plain text, so crawled content can never run as code.
 */
export default function LogFeed({ lines = [], height = 220, live = false, empty = 'No activity yet. Start the crawler to see events.', className = '' }) {
  const box = useRef(null);
  const stick = useRef(true); // true while the reader is at (or near) the bottom
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  return (
    <div className={['dt-log', className].filter(Boolean).join(' ')} ref={box} onScroll={onScroll} style={{ maxHeight: height }} role="log" aria-live="polite">
      {lines.length === 0 && <p className="dt-log__empty">{empty}</p>}
      {lines.map((l, i) => (
        <div className={`dt-log__row dt-log__row--${l.level || 'info'}`} key={l.id ?? i}>
          <time className="dt-log__time">{l.time}</time>
          <span className="dt-log__lvl">{(l.level || 'info').toUpperCase()}</span>
          <span className="dt-log__text">{l.text}</span>
        </div>
      ))}
      {live && <span className="dt-log__cursor" aria-hidden="true" />}
    </div>
  );
}
