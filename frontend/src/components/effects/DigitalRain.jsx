// Hacker-style digital rain: every column spells D-A-R-K-T-R-A-C-E top to bottom,
// in three depth layers on a canvas.
// - far / mid / near layers differ in size, speed and brightness (depth)
// - glyphs near the cursor light up; clicks send a shockwave through the rain
// - critical alerts turn the rain red and speed it up for a moment
// - an active crawler makes the rain fall faster
import { useEffect, useRef } from 'react';
import { eventBus } from '../../hooks/eventBus';

const WORD = 'DARKTRACE';

const LAYERS = [
  { size: 11, speed: 5.5, alpha: 0.22, density: 0.5 }, // far
  { size: 15, speed: 9, alpha: 0.42, density: 0.32 }, // mid
  { size: 21, speed: 14, alpha: 0.62, density: 0.12 }, // near
];

// letter for a grid cell, counted from where the column started so it always reads D-A-R-K…
const letterAt = (d, cell) => WORD[(((cell - d.start) % WORD.length) + WORD.length) % WORD.length];

function resetDrop(d, L, h, first) {
  d.y = first ? Math.random() * h * 1.4 - h * 0.4 : -Math.random() * h * 0.5;
  d.cell = Math.floor(d.y / L.size);
  d.start = d.cell;
  d.v = L.speed * (0.6 + Math.random() * 0.8);
}

export default function DigitalRain({ enabled }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0;
    let h = 0;
    let layers = [];
    let raf;
    let last = performance.now();
    let acc = 0;
    const mouse = { x: -999, y: -999 };
    const ripples = [];
    let alertUntil = 0;
    let crawling = false;

    const build = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mobile = w < 760;
      layers = LAYERS.map((L) => {
        const cols = Math.floor(w / L.size);
        const drops = [];
        for (let c = 0; c < cols; c++) {
          if (Math.random() > L.density * (mobile ? 0.6 : 1)) continue;
          const d = { x: c * L.size };
          resetDrop(d, L, h, true);
          drops.push(d);
        }
        return { ...L, drops };
      });
    };

    const draw = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      acc += dt;
      if (!reduce) raf = requestAnimationFrame(draw);
      if (acc < 1 / 30) return; // ~30fps is plenty for rain
      const step = acc;
      acc = 0;

      const alert = now < alertUntil;
      const speedMul = alert ? 2.4 : crawling ? 1.6 : 1;

      // fade previous frame to transparent (keeps the CSS background visible)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${alert ? 0.16 : 0.1})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      // shockwave rings
      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i];
        r.age += step;
        if (r.age > 1.1) ripples.splice(i, 1);
      }

      for (const L of layers) {
        ctx.font = `${L.size}px "JetBrains Mono", Consolas, monospace`;
        const trail = alert ? `rgba(255,59,92,${L.alpha * 0.85})` : `rgba(53,216,239,${L.alpha * 0.8})`;
        for (const d of L.drops) {
          d.y += d.v * L.size * step * speedMul;
          const cell = Math.floor(d.y / L.size);

          // letters the head passed this frame settle into the trail colour
          ctx.fillStyle = trail;
          for (let c = Math.max(d.cell, cell - 4); c < cell; c++) {
            ctx.fillText(letterAt(d, c), d.x, c * L.size);
          }
          d.cell = cell;

          // head glyph: brighter, reacts to cursor and shockwaves
          const dx = d.x - mouse.x;
          const dy = d.y - mouse.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          let boost = dist < 150 ? 1 - dist / 150 : 0;
          for (const r of ripples) {
            const rd = Math.sqrt((d.x - r.x) ** 2 + (d.y - r.y) ** 2);
            const radius = r.age * 650;
            if (Math.abs(rd - radius) < 26) boost = Math.max(boost, 1 - r.age / 1.1);
          }
          const a = Math.min(1, L.alpha + 0.25 + boost * 0.6);
          ctx.fillStyle = alert ? `rgba(255,190,200,${a})` : boost > 0.15 ? `rgba(235,255,255,${a})` : `rgba(170,240,250,${a})`;
          ctx.fillText(letterAt(d, cell), d.x, cell * L.size);

          if (d.y > h + 40) resetDrop(d, L, h, false);
        }
      }
    };

    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      // subtle parallax: the rain sits deeper than the UI
      const px = (e.clientX / window.innerWidth - 0.5) * -14;
      const py = (e.clientY / window.innerHeight - 0.5) * -10;
      canvas.style.transform = `translate3d(${px}px, ${py}px, 0)`;
    };
    const onDown = (e) => ripples.push({ x: e.clientX, y: e.clientY, age: 0 });
    const onResize = () => build();
    const off = eventBus.on(({ type, payload }) => {
      if (type === 'critical') alertUntil = performance.now() + 2600;
      if (type === 'crawler') crawling = !!payload?.active;
    });
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduce) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };

    build();
    if (reduce) {
      // static frame for reduced motion
      for (let i = 0; i < 40; i++) draw(last + 34 * (i + 1));
    } else raf = requestAnimationFrame(draw);

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      off();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      ctx.clearRect(0, 0, w, h);
    };
  }, [enabled]);

  return <canvas ref={ref} className={`rain ${enabled ? 'is-on' : ''}`} aria-hidden="true" />;
}
