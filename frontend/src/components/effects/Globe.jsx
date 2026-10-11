// Holographic 3D globe of the collection network (canvas, no libraries).
// - drag to rotate (with inertia), auto-rotates when left alone
// - hover a node for its label; data packets travel along the arcs
// - speeds up while the crawler is active, flashes red on critical alerts
import { useEffect, useRef, useState } from 'react';
import { eventBus } from '../../hooks/eventBus';

const NODES = [
  { id: 'EU-West', lat: 50.1, lon: 8.7 },
  { id: 'EU-North', lat: 59.3, lon: 18.1 },
  { id: 'US-East', lat: 39.0, lon: -77.5 },
  { id: 'US-West', lat: 37.4, lon: -122.1 },
  { id: 'APAC', lat: 1.35, lon: 103.8 },
  { id: 'LATAM', lat: -23.5, lon: -46.6 },
  { id: 'ME-South', lat: 25.2, lon: 55.3 },
  { id: 'AU-East', lat: -33.9, lon: 151.2 },
];
const LINKS = [
  [0, 2], [0, 4], [1, 0], [2, 3], [2, 5], [4, 7], [6, 4], [0, 6], [3, 4], [5, 0],
];

const DEG = Math.PI / 180;
const toVec = (lat, lon) => [Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG), Math.cos(lat * DEG) * Math.cos(lon * DEG)];

// evenly spread dots on the sphere surface
function fibonacciSphere(n) {
  const pts = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push([Math.cos(g * i) * r, y, Math.sin(g * i) * r]);
  }
  return pts;
}

function slerp(a, b, t) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  if (om < 1e-4) return a;
  const s = Math.sin(om);
  const k1 = Math.sin((1 - t) * om) / s;
  const k2 = Math.sin(t * om) / s;
  return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
}

export default function Globe({ height = 340 }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [tip, setTip] = useState(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dots = fibonacciSphere(window.innerWidth < 760 ? 520 : 900);
    const nodes = NODES.map((n) => ({ ...n, v: toVec(n.lat, n.lon) }));
    const packets = LINKS.map((_, i) => ({ link: i, t: Math.random(), speed: 0.12 + Math.random() * 0.12 }));

    let w = 0;
    let h = 0;
    let R = 0;
    const view = { yaw: -0.6, pitch: 0.35, vYaw: 0.18, vPitch: 0 };
    const drag = { on: false, x: 0, y: 0, lastT: 0 };
    let hover = null;
    let crawling = false;
    let alertUntil = 0;
    let visible = true;
    let raf;
    let last = performance.now();

    const resize = () => {
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      R = Math.min(w, h) * 0.4;
    };

    const project = (v) => {
      // yaw around Y, then pitch around X
      const cy = Math.cos(view.yaw);
      const sy = Math.sin(view.yaw);
      const x1 = v[0] * cy + v[2] * sy;
      const z1 = -v[0] * sy + v[2] * cy;
      const cp = Math.cos(view.pitch);
      const sp = Math.sin(view.pitch);
      const y2 = v[1] * cp - z1 * sp;
      const z2 = v[1] * sp + z1 * cp;
      const persp = 1 / (1 - z2 * 0.18);
      return { x: w / 2 + x1 * R * persp, y: h / 2 - y2 * R * persp, z: z2, s: persp };
    };

    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const alert = now < alertUntil;
      const tint = alert ? '255,59,92' : '53,216,239';

      if (!drag.on) {
        const target = (crawling ? 0.45 : 0.18) * (reduce ? 0 : 1);
        view.vYaw += (target - view.vYaw) * Math.min(1, dt * 1.5);
        view.vPitch *= 0.92;
        view.yaw += view.vYaw * dt;
        view.pitch = Math.max(-1.1, Math.min(1.1, view.pitch + view.vPitch * dt));
      }

      ctx.clearRect(0, 0, w, h);

      // atmosphere
      const glow = ctx.createRadialGradient(w / 2, h / 2, R * 0.75, w / 2, h / 2, R * 1.35);
      glow.addColorStop(0, `rgba(${tint},0.10)`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // sphere body
      const body = ctx.createRadialGradient(w / 2 - R * 0.35, h / 2 - R * 0.4, R * 0.1, w / 2, h / 2, R);
      body.addColorStop(0, 'rgba(30,60,72,0.55)');
      body.addColorStop(1, 'rgba(4,10,14,0.85)');
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, R, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = `rgba(${tint},0.35)`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // latitude rings
      for (let lat = -60; lat <= 60; lat += 30) {
        ctx.beginPath();
        for (let lon = 0; lon <= 360; lon += 6) {
          const p = project(toVec(lat, lon));
          if (lon === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = `rgba(${tint},0.07)`;
        ctx.stroke();
      }

      // surface dots (front brighter, back faint)
      for (const d of dots) {
        const p = project(d);
        const a = p.z > 0 ? 0.25 + p.z * 0.55 : 0.06;
        ctx.fillStyle = `rgba(${tint},${a.toFixed(3)})`;
        const s = p.z > 0 ? 1.4 * p.s : 0.9;
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }

      // arcs + packets
      LINKS.forEach(([a, b], i) => {
        const A = nodes[a].v;
        const B = nodes[b].v;
        ctx.beginPath();
        let started = false;
        for (let k = 0; k <= 32; k++) {
          const t = k / 32;
          const v = slerp(A, B, t);
          const lift = 1 + Math.sin(Math.PI * t) * 0.22;
          const p = project([v[0] * lift, v[1] * lift, v[2] * lift]);
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        const mid = project(slerp(A, B, 0.5));
        ctx.strokeStyle = `rgba(${tint},${mid.z > -0.2 ? 0.35 : 0.08})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        const pk = packets[i];
        pk.t += pk.speed * dt * (crawling ? 2.2 : 1) * (alert ? 1.8 : 1);
        if (pk.t > 1) pk.t -= 1;
        const v = slerp(A, B, pk.t);
        const lift = 1 + Math.sin(Math.PI * pk.t) * 0.22;
        const p = project([v[0] * lift, v[1] * lift, v[2] * lift]);
        if (p.z > -0.3) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = alert ? '#ffd0d8' : '#c9f8ff';
          ctx.shadowColor = `rgb(${tint})`;
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });

      // nodes
      let hit = null;
      nodes.forEach((n) => {
        const p = project(n.v);
        n.p = p;
        if (p.z < -0.05) return;
        const pulse = (((now / 1000 + n.lat) % 1.6) + 1.6) % 1.6; // INTEGRATION FIX: n.lat can be negative -> negative arc radius threw every frame
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3 + pulse * 7, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${tint},${(0.5 * (1 - pulse / 1.6)).toFixed(3)})`;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(p.x, p.y, hover === n.id ? 5 : 3.4, 0, Math.PI * 2);
        ctx.fillStyle = '#eaffff';
        ctx.shadowColor = `rgb(${tint})`;
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
        if (drag.mx !== undefined && Math.hypot(drag.mx - p.x, drag.my - p.y) < 12) hit = { n, p };
      });

      const id = hit?.n.id || null;
      if (id !== hover) {
        hover = id;
        setTip(hit ? { id: hit.n.id, x: hit.p.x, y: hit.p.y, lat: hit.n.lat, lon: hit.n.lon } : null);
        canvas.style.cursor = hit ? 'pointer' : drag.on ? 'grabbing' : 'grab';
      }

      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };

    const onDown = (e) => {
      drag.on = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.lastT = performance.now();
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    };
    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      drag.mx = e.clientX - r.left;
      drag.my = e.clientY - r.top;
      if (!drag.on) return;
      const now = performance.now();
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      const dts = Math.max(0.008, (now - drag.lastT) / 1000);
      view.yaw += dx * 0.008;
      view.pitch = Math.max(-1.1, Math.min(1.1, view.pitch + dy * 0.008));
      view.vYaw = (dx * 0.008) / dts;
      view.vPitch = (dy * 0.008) / dts;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.lastT = now;
    };
    const onUp = () => {
      drag.on = false;
      canvas.style.cursor = 'grab';
    };
    const onLeave = () => {
      drag.mx = undefined;
    };

    const off = eventBus.on(({ type, payload }) => {
      if (type === 'critical') alertUntil = performance.now() + 2600;
      if (type === 'crawler') crawling = !!payload?.active;
    });

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    const onVis = () => !document.hidden && visible && start();

    resize();
    start();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(raf);
      off();
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="globe" ref={wrapRef} style={{ height }}>
      <canvas ref={canvasRef} aria-label="3D globe of the crawler network. Drag to rotate." role="img" />
      {tip && (
        <div className="globe-tip mono" style={{ left: tip.x, top: tip.y }}>
          <strong>{tip.id}</strong>
          <span>
            {tip.lat.toFixed(1)}°, {tip.lon.toFixed(1)}°
          </span>
          <em>collector online</em>
        </div>
      )}
      <span className="globe-hint mono">drag to rotate</span>
    </div>
  );
}
