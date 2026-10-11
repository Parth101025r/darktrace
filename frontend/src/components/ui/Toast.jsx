import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './ui.css';

const ToastContext = createContext(null);
const DURATION = 3000;
let nextId = 1;

const ICONS = {
  success: <path d="M3 8.5l3.2 3.2L13 4.8" />,
  error: <path d="M4 4l8 8M12 4l-8 8" />,
  warning: <path d="M8 3v6M8 12v.5" />,
  info: <path d="M8 7v5M8 4v.5" />,
};

function ToastItem({ toast, onDone }) {
  const [leaving, setLeaving] = useState(false);
  const [paused, setPaused] = useState(false);
  const timer = useRef(null);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);
  const isPaused = useRef(false);

  const close = useCallback(() => {
    setLeaving(true);
    setTimeout(() => onDone(toast.id), 220);
  }, [onDone, toast.id]);

  const run = useCallback(() => {
    startedAt.current = Date.now();
    timer.current = setTimeout(close, remaining.current);
  }, [close]);

  // Hover or keyboard focus stops the countdown (and the bar); leaving resumes with the time that is left.
  const pause = () => {
    if (isPaused.current) return;
    isPaused.current = true;
    clearTimeout(timer.current);
    remaining.current = Math.max(500, remaining.current - (Date.now() - startedAt.current));
    setPaused(true);
  };
  const resume = () => {
    if (!isPaused.current) return;
    isPaused.current = false;
    setPaused(false);
    run();
  };

  useEffect(() => {
    run();
    return () => clearTimeout(timer.current);
  }, [run]);

  return (
    <div
      className={`dt-toast dt-toast--${toast.type} ${leaving ? 'is-leaving' : ''} ${paused ? 'is-paused' : ''}`}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      role={toast.type === 'error' ? 'alert' : 'status'}
    >
      <svg className="dt-toast__icon" width="18" height="18" viewBox="0 0 16 16" fill="none"
           stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[toast.type]}
      </svg>
      <p className="dt-toast__msg">{toast.message}</p>
      <button type="button" className="dt-toast__close" onClick={close} aria-label="Dismiss notification">
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      <span className="dt-toast__timer" style={{ animationDuration: `${toast.duration}ms` }} />
    </div>
  );
}

/** Wrap your app once: <ToastProvider><App /></ToastProvider> */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const show = useCallback((message, type = 'info', duration = DURATION) => {
    setToasts((t) => [...t.slice(-3), { id: nextId++, message, type, duration }]);
  }, []);

  const api = useMemo(
    () => ({
      show,
      success: (m, d) => show(m, 'success', d),
      error: (m, d) => show(m, 'error', d),
      warning: (m, d) => show(m, 'warning', d),
      info: (m, d) => show(m, 'info', d),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="dt-toast__stack" aria-live="polite">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** const toast = useToast(); toast.success('Crawler started'); */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
