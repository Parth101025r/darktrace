// Basic page structure shared by all three tabs.
// <Panel> renders a glass card with a loading skeleton shaped like the content
// that will live there. Swap a Panel for the real component when it is ready.
import { useEffect, useState } from 'react';
import { useTilt } from '../hooks/useTilt';
import ScrambleText from '../components/effects/ScrambleText';

export function PageHeader({ eyebrow, title, description, children }) {
  // occasional glitch flicker on the title
  const [glitch, setGlitch] = useState(false);
  useEffect(() => {
    let t1;
    let t2;
    const loop = () => {
      t1 = setTimeout(() => {
        setGlitch(true);
        t2 = setTimeout(() => setGlitch(false), 420);
        loop();
      }, 6000 + Math.random() * 6000);
    };
    loop();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          <ScrambleText text={eyebrow} duration={500} />
        </div>
        <h1 className={`glitch ${glitch ? 'is-glitching' : ''}`} data-text={title}>
          <ScrambleText text={title} />
        </h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

const Bar = ({ w = '100%', h = 10, className = '' }) => <span className={`sk ${className}`} style={{ width: w, height: h }} />;

const COLUMN_HEIGHTS = [38, 52, 44, 61, 70, 58, 77, 66, 84, 72, 90, 81, 69, 75, 63, 58, 49, 55];
const LOG_WIDTHS = ['82%', '64%', '91%', '58%', '76%', '69%', '88%', '61%', '79%'];

function Skeleton({ variant }) {
  switch (variant) {
    case 'stat':
      return (
        <div className="sk-stat">
          <Bar w="58%" h={30} />
          <Bar w="36%" h={10} />
          <svg className="sk-spark" viewBox="0 0 200 36" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 28 L20 24 L40 26 L60 18 L80 21 L100 14 L120 17 L140 10 L160 13 L180 7 L200 9" />
          </svg>
        </div>
      );
    case 'severity':
      return (
        <div className="sk-stat">
          <Bar w="40%" h={28} />
          <Bar w="100%" h={5} />
          <Bar w="46%" h={9} />
        </div>
      );
    case 'line':
      return (
        <div className="sk-chart">
          <div className="sk-legend">
            <Bar w={60} h={8} />
            <Bar w={50} h={8} />
            <Bar w={64} h={8} />
            <Bar w={44} h={8} />
          </div>
          <svg className="sk-line" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden="true">
            {[30, 70, 110, 150].map((y) => (
              <line key={y} x1="0" x2="400" y1={y} y2={y} />
            ))}
            <path className="a" d="M0 120 C40 110 60 118 90 100 S150 92 180 96 S240 70 270 78 S330 60 360 66 L400 58" />
            <path className="b" d="M0 140 C40 136 70 140 100 130 S160 126 190 128 S250 112 280 118 S340 104 400 106" />
          </svg>
        </div>
      );
    case 'donut':
      return (
        <div className="sk-donut">
          <span className="sk-ring" />
          <div className="sk-rows">
            {[70, 55, 62, 48].map((w, i) => (
              <Bar key={i} w={`${w}%`} h={10} />
            ))}
          </div>
        </div>
      );
    case 'bars':
      return (
        <div className="sk-bars">
          {[92, 76, 64, 55, 47, 41].map((w, i) => (
            <div key={i}>
              <Bar w="38%" h={8} />
              <Bar w={`${w}%`} h={6} />
            </div>
          ))}
        </div>
      );
    case 'columns':
      return (
        <div className="sk-columns">
          {COLUMN_HEIGHTS.map((h, i) => (
            <span key={i} className="sk" style={{ height: `${h}%`, animationDelay: `${i * 40}ms` }} />
          ))}
        </div>
      );
    case 'log':
      return (
        <div className="sk-log">
          {LOG_WIDTHS.map((w, i) => (
            <div key={i} className="sk-log-line">
              <Bar w={56} h={8} />
              <Bar w={34} h={8} />
              <Bar w={w} h={8} />
            </div>
          ))}
        </div>
      );
    case 'status':
      return (
        <div className="sk-status">
          <span className="sk-radar">
            <i />
          </span>
          <div className="sk-rows">
            <Bar w={90} h={20} className="pill" />
            <Bar w="42%" h={16} />
            <Bar w="78%" h={10} />
            <Bar w="100%" h={8} />
            <Bar w="60%" h={10} />
          </div>
        </div>
      );
    case 'filters':
      return (
        <div className="sk-filters">
          <Bar h={38} className="field" />
          <Bar h={38} className="field" />
          <Bar h={38} className="field" />
          <Bar h={38} className="field" />
        </div>
      );
    case 'threat':
      return (
        <div className="sk-threat">
          <div className="sk-rows">
            <div className="sk-inline">
              <Bar w={70} h={18} className="pill" />
              <Bar w={56} h={10} />
            </div>
            <Bar w="62%" h={14} />
            <div className="sk-inline">
              <Bar w={70} h={9} />
              <Bar w={96} h={9} />
              <Bar w={60} h={9} />
            </div>
          </div>
          <Bar w={46} h={24} />
        </div>
      );
    case 'list':
    default:
      return (
        <div className="sk-list">
          {[78, 64, 85, 58, 72].map((w, i) => (
            <div key={i} className="sk-list-row">
              <span className="sk sk-icon" />
              <div className="sk-rows">
                <Bar w={`${w}%`} h={10} />
                <Bar w="30%" h={8} />
              </div>
            </div>
          ))}
        </div>
      );
  }
}

// panels flip up into place in 3D as they scroll into view
function useReveal(ref) {
  useEffect(() => {
    const el = ref.current;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.classList.add('is-in');
      return undefined;
    }
    const index = Array.prototype.indexOf.call(el.parentElement.children, el);
    el.style.setProperty('--reveal-delay', `${Math.min(index, 6) * 70}ms`);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add('is-in');
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

export function Panel({ title, subtitle, variant = 'list', tone, className = '' }) {
  const tilt = useTilt();
  useReveal(tilt.ref);
  return (
    <section
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      className={`card panel tilt reveal ${tone ? `tone-${tone}` : ''} ${className}`}
      aria-busy="true"
    >
      {(title || subtitle) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <span className="card-sub">{subtitle}</span>}
          </div>
          {tone && <i className="tone-dot" />}
        </header>
      )}
      <Skeleton variant={variant} />
    </section>
  );
}
