// Spider3D: a real-3D (Three.js) procedural spider. Drop-in replacement for <SpiderLayer>.
//   <Spider3D state="idle|walking" path="panels|perimeter" size={20} />
//   state "walking" + path "panels"    -> follows the cursor, backs away if you get too close, wanders when the mouse is still
//   state "walking" + path "perimeter" -> patrols the screen edge (clockwise)
//   state "idle"                       -> breathes, eyes pulse, turns to look at a nearby cursor
// Model: glossy black abdomen with glowing marking, head with 8 eyes, fangs, palps, 8 two-bone legs solved with IK
// (knees arch up, feet plant on the ground and step in an alternating tetrapod gait). Overlay is click-through.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const CYAN = 0x35d8ef;
const L1 = 2.4, L2 = 3.4;                       // upper / lower leg length (world units)
const HIP_Y = 0;                                // hips are at body-group origin height
const BODY_Y = 1.9;                             // body height above ground
const FOOT_REACH = [4.5, 4.0, 4.0, 4.5];        // rest distance of feet from body center, front -> back
const LEG_ANGLE = [34, 64, 102, 142].map((d) => (d * Math.PI) / 180); // from forward, per side
const GROUP_A = new Set([0, 2, 5, 7]);          // tetrapod gait: A and B alternate
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const ease = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

function glowTexture(color, inner = 1) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, `rgba(${color},${inner})`); r.addColorStop(0.35, `rgba(${color},${inner * 0.35})`); r.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
}

export default function Spider3D({ state = 'idle', path = 'panels', size = 20 }) {
  const host = useRef(null);
  const live = useRef({ state, path });
  live.current = { state, path };

  useEffect(() => {
    const el = host.current;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(25, 1, 1, 600);
    const ELEV = (58 * Math.PI) / 180;
    try { // soft studio reflections so the black shell reads as glossy 3D instead of flat
      const pm = new THREE.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    } catch (e) { /* lights below still work */ }
    scene.add(new THREE.HemisphereLight(0x6fa8c8, 0x05080c, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(10, 60, 25); scene.add(key);
    const rimA = new THREE.DirectionalLight(CYAN, 3.2); rimA.position.set(-35, 30, -30); scene.add(rimA);
    const rimB = new THREE.DirectionalLight(0x4a8dff, 2.2); rimB.position.set(35, 20, 15); scene.add(rimB);

    /* ---------- materials ---------- */
    const shell = new THREE.MeshPhysicalMaterial({ color: 0x0b0f15, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.18, envMapIntensity: 1.3 });
    const legMat = new THREE.MeshStandardMaterial({ color: 0x131a22, metalness: 0.6, roughness: 0.34, envMapIntensity: 1.2 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0x1a232d, metalness: 0.7, roughness: 0.3, emissive: CYAN, emissiveIntensity: 0.18 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: CYAN });
    const markMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 });

    /* ---------- body (forward = -Z) ---------- */
    const spider = new THREE.Group(); scene.add(spider);
    const body = new THREE.Group(); spider.add(body);

    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), shell);
    abdomen.scale.set(1.25, 1.05, 1.65); abdomen.position.set(0, 0.35, 2.15); body.add(abdomen);
    const hour = new THREE.Shape(); // hourglass marking
    hour.moveTo(-0.5, -0.8); hour.lineTo(0.5, -0.8); hour.lineTo(0.08, 0); hour.lineTo(0.5, 0.8); hour.lineTo(-0.5, 0.8); hour.lineTo(-0.08, 0); hour.closePath();
    const mark = new THREE.Mesh(new THREE.ShapeGeometry(hour), markMat);
    mark.rotation.x = -Math.PI / 2; mark.scale.set(0.8, 0.8, 0.8); mark.position.set(0, 1.4, 2.15); body.add(mark);
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), shell);
    thorax.scale.set(0.95, 0.75, 1.1); thorax.position.set(0, 0.1, -0.35); body.add(thorax);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 20), shell);
    head.scale.set(0.62, 0.52, 0.55); head.position.set(0, 0.05, -1.25); body.add(head);

    const eyes = [];
    [[0.2, 0.3, -1.72, 0.15], [0.5, 0.2, -1.6, 0.105], [0.28, 0.5, -1.58, 0.085], [0.6, 0.38, -1.45, 0.07]].forEach(([x, y, z, r]) => {
      [-1, 1].forEach((s) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), eyeMat); m.position.set(x * s, y, z); body.add(m); eyes.push(m); });
    });
    const eyeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('53,216,239', 1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    eyeGlow.scale.set(3.4, 3.4, 1); eyeGlow.position.set(0, 0.35, -1.9); body.add(eyeGlow);
    const eyeLight = new THREE.PointLight(CYAN, 12, 9, 2); eyeLight.position.set(0, 0.6, -2.2); body.add(eyeLight);

    const fangGeo = new THREE.ConeGeometry(0.09, 0.55, 10);
    [-1, 1].forEach((s) => { const f = new THREE.Mesh(fangGeo, jointMat); f.position.set(0.2 * s, -0.25, -1.78); f.rotation.set(-2.3, 0, 0.15 * s); body.add(f); });
    const palps = [-1, 1].map((s) => { // short feelers at the front
      const g = new THREE.Group(); g.position.set(0.38 * s, -0.05, -1.45);
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1, 8), legMat); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 1, 8), legMat);
      g.add(a, b); body.add(g); return { g, a, b, s };
    });

    /* ---------- legs ---------- */
    const legs = [];
    const mkSeg = (r1, r2, mat = legMat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, 1, 10), mat); scene.add(m); return m; };
    for (let side = 0; side < 2; side += 1) {
      const sgn = side === 0 ? -1 : 1;
      for (let i = 0; i < 4; i += 1) {
        const idx = side * 4 + i, phi = LEG_ANGLE[i];
        const hip = new THREE.Vector3(sgn * Math.sin(phi) * 0.8, HIP_Y, -Math.cos(phi) * 0.8 - 0.25);
        const rest = new THREE.Vector3(sgn * Math.sin(phi) * FOOT_REACH[i], 0, -Math.cos(phi) * FOOT_REACH[i] + 0.2);
        const knee = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), jointMat); scene.add(knee);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 8), jointMat); scene.add(tip);
        legs.push({ idx, hip, rest, group: GROUP_A.has(idx) ? 0 : 1, upper: mkSeg(0.21, 0.14), lower: mkSeg(0.14, 0.05), knee, tip,
          foot: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, stepping: false });
      }
    }

    /* ---------- ground glow + shadow ---------- */
    const under = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), new THREE.MeshBasicMaterial({ map: glowTexture('53,216,239', 0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    under.rotation.x = -Math.PI / 2; under.position.y = 0.02; scene.add(under);
    const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(0,0,0,.75)'); r.addColorStop(0.5, 'rgba(0,0,0,.35)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; scene.add(shadow);

    // silk thread for the drop-in entrance
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: 0x9fdcea, transparent: true, opacity: 0.8 }));
    scene.add(thread);

    /* ---------- screen <-> ground ---------- */
    let W = 1, H = 1;
    const ray = new THREE.Raycaster(); const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); const ndc = new THREE.Vector2(); const tmp = new THREE.Vector3();
    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      renderer.setSize(W, H, false); camera.aspect = W / H;
      const d = (H / 2) / Math.tan((camera.fov * Math.PI) / 360) / size;     // so ~`size` px = 1 world unit at screen center
      camera.position.set(0, d * Math.sin(ELEV), d * Math.cos(ELEV)); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    }
    const toGround = (sx, sy, out) => { ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1); ray.setFromCamera(ndc, camera); ray.ray.intersectPlane(plane, out); return out; };
    resize();

    /* ---------- behaviour state ---------- */
    const M = Math.max(70, size * 4.5);
    let sx = W * 0.58, sy = H * 0.42, heading = 0.6, speed = 0; // px, px, rad (0 = screen up), px/s
    let mx = W / 2, my = H / 2, seen = -99, t = 0, perim = 0, wander = null, wanderT = 0;
    const pos = new THREE.Vector3(); const fwd = new THREE.Vector3(); const hipW = new THREE.Vector3(); const restW = new THREE.Vector3();
    const kneeW = new THREE.Vector3(); const dir = new THREE.Vector3(); const pole = new THREE.Vector3(); const gp = new THREE.Vector3();
    toGround(sx, sy, pos);
    legs.forEach((l) => { l.foot.set(pos.x, 0, pos.z); });
    let primed = false;

    const onMove = (e) => { mx = e.clientX; my = e.clientY; seen = t; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('resize', resize);

    const perimPoint = (s, out) => { // clockwise rectangle inset by M
      const w = W - M * 2, h = H - M * 2, P = 2 * (w + h); s = ((s % P) + P) % P;
      if (s < w) { out.x = M + s; out.y = M; out.a = Math.PI / 2; } else if (s < w + h) { out.x = W - M; out.y = M + (s - w); out.a = Math.PI; }
      else if (s < 2 * w + h) { out.x = W - M - (s - w - h); out.y = H - M; out.a = -Math.PI / 2; } else { out.x = M; out.y = H - M - (s - 2 * w - h); out.a = 0; }
      return out;
    };
    const pp = { x: 0, y: 0, a: 0 };
    const solveLeg = (l) => {
      dir.copy(l.foot).sub(hipW); let len = dir.length(); const maxL = L1 + L2 - 0.02;
      if (len > maxL) { dir.setLength(maxL); len = maxL; l.foot.copy(hipW).add(dir); }
      dir.divideScalar(len || 1);
      const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len || 1), h = Math.sqrt(Math.max(L1 * L1 - a * a, 0));
      pole.set(0, 1, 0).addScaledVector(dir, -dir.y).normalize();            // knees arch upward
      kneeW.copy(hipW).addScaledVector(dir, a).addScaledVector(pole, h);
    };
    const seg = (mesh, a, b) => { mesh.position.copy(a).add(b).multiplyScalar(0.5); tmp.copy(b).sub(a); const len = tmp.length(); mesh.scale.set(1, len, 1); mesh.quaternion.setFromUnitVectors(Y_AXIS, tmp.divideScalar(len || 1)); };

    let raf = 0, last = performance.now();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
      const { state: st, path: pth } = live.current;
      const walking = st === 'walking' && !reduce;
      const hasMouse = t - seen < 6;
      let want = heading, v = 0;

      if (walking && pth === 'perimeter') {
        perim += 125 * dt; perimPoint(perim, pp); const nx = pp.x - sx, ny = pp.y - sy;
        if (Math.hypot(nx, ny) > 2) want = Math.atan2(nx, -ny);
        sx += (pp.x - sx) * Math.min(1, dt * 6); sy += (pp.y - sy) * Math.min(1, dt * 6); v = 125;
      } else if (walking) {
        let tx = null, ty = null;
        if (hasMouse) {
          const dx = mx - sx, dy = my - sy, d = Math.hypot(dx, dy);
          want = Math.atan2(dx, -dy);
          if (d < size * 7) { v = -210; }                                       // too close: back away fast
          else if (d > size * 11) { v = clamp(d * 0.9, 90, 260); }             // approach
        } else {                                                                // wander when the mouse is idle
          wanderT -= dt;
          if (!wander || wanderT <= 0) { wander = { x: M + Math.random() * (W - M * 2), y: M + Math.random() * (H - M * 2) }; wanderT = 4 + Math.random() * 3; }
          tx = wander.x; ty = wander.y; const dx = tx - sx, dy = ty - sy;
          if (Math.hypot(dx, dy) > 12) { want = Math.atan2(dx, -dy); v = 85; }
        }
      } else if (hasMouse && Math.hypot(mx - sx, my - sy) < 520) { want = Math.atan2(mx - sx, -(my - sy)); }

      // turn the body toward `want`, then move along the heading
      heading += clamp(angDiff(heading, want), -1, 1) * Math.min(1, dt * 5.5);
      const aligned = Math.abs(angDiff(heading, want)) < 0.9 || v < 0;
      const goal = aligned ? v : 0;
      speed += (goal - speed) * Math.min(1, dt * 7);
      if (!(walking && pth === 'perimeter')) {
        sx = clamp(sx + Math.sin(heading) * speed * dt, M * 0.6, W - M * 0.6);
        sy = clamp(sy - Math.cos(heading) * speed * dt, M * 0.6, H - M * 0.6);
      }
      const mv = Math.abs(speed) / size;                                        // world units / s

      // entrance: lower on a silk thread
      const intro = reduce ? 1 : clamp(t / 1.5, 0, 1), drop = (1 - ease(intro)) * 30;
      toGround(sx, sy, pos);
      const bob = Math.sin(t * (4 + mv * 1.1)) * 0.05 * Math.min(1, mv / 2) + Math.sin(t * 1.7) * 0.035;
      spider.position.set(pos.x, 0, pos.z); spider.rotation.y = -heading;
      body.position.y = BODY_Y + bob + drop;
      body.rotation.x = -Math.min(0.14, mv * 0.012) + Math.sin(t * 1.3) * 0.01;
      body.rotation.z = Math.sin(t * (3 + mv)) * 0.012 * Math.min(1, mv / 2);
      abdomen.scale.y = 1.05 + Math.sin(t * 1.7) * 0.025;
      spider.updateMatrixWorld(true);

      fwd.set(Math.sin(heading), 0, -Math.cos(heading));
      const stepDur = clamp(0.3 - mv * 0.012, 0.11, 0.28), thresh = 1.05;
      if (!primed) { legs.forEach((l) => { l.foot.copy(restW.copy(l.rest).applyMatrix4(spider.matrixWorld)); l.foot.y = 0; }); primed = true; }
      const stepping = [false, false]; legs.forEach((l) => { if (l.stepping) stepping[l.group] = true; });

      legs.forEach((l) => {
        hipW.copy(l.hip); body.localToWorld(hipW);
        restW.copy(l.rest).applyMatrix4(spider.matrixWorld); restW.y = 0;
        if (!l.stepping) {
          const dxz = Math.hypot(l.foot.x - restW.x, l.foot.z - restW.z);
          if (dxz > thresh && !stepping[1 - l.group]) { l.stepping = true; l.t = 0; l.from.copy(l.foot); l.to.copy(restW).addScaledVector(fwd, clamp(mv * stepDur * 0.55, 0, 1.4) * Math.sign(speed || 1)); stepping[l.group] = true; }
        }
        if (l.stepping) {
          l.t += dt / stepDur; const k = Math.min(1, l.t);
          l.foot.lerpVectors(l.from, l.to, ease(k)); l.foot.y = Math.sin(Math.PI * k) * (0.7 + mv * 0.05);
          if (k >= 1) { l.stepping = false; l.foot.y = 0; }
        } else l.foot.y = Math.max(0, body.position.y - BODY_Y) * 0.9; // feet dangle up while dropping in
        solveLeg(l);
        seg(l.upper, hipW, kneeW); seg(l.lower, kneeW, l.foot);
        l.knee.position.copy(kneeW); l.tip.position.copy(l.foot).y += 0.15;
      });

      palps.forEach((p) => {
        const w = Math.sin(t * 2.3 + p.s) * 0.12; const base = new THREE.Vector3(0, 0, 0), j = new THREE.Vector3(p.s * 0.1 + w, -0.1, -0.65), e = new THREE.Vector3(p.s * 0.05, -0.55, -0.9);
        seg(p.a, base, j); seg(p.b, j, e);
      });
      const pulse = 0.82 + Math.sin(t * (walking ? 5 : 2.2)) * 0.18;
      eyeGlow.material.opacity = pulse; eyeLight.intensity = 9 + pulse * 6; eyes.forEach((e, i) => e.scale.setScalar(1 + Math.sin(t * 3 + i) * 0.04));
      markMat.opacity = 0.65 + Math.sin(t * 1.9) * 0.25;
      under.position.set(pos.x, 0.02, pos.z); shadow.position.set(pos.x, 0.01, pos.z);
      under.material.opacity = 0.9; shadow.material.opacity = 1 - Math.min(0.6, drop / 40);

      thread.visible = drop > 0.4;
      if (thread.visible) { const p = thread.geometry.attributes.position; p.setXYZ(0, pos.x, 60, pos.z - 6); p.setXYZ(1, pos.x, body.position.y + 1.2, pos.z + 0.2); p.needsUpdate = true; }

      renderer.render(scene, camera);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove); window.removeEventListener('resize', resize);
      scene.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.dispose?.(); }); });
      renderer.dispose(); renderer.domElement.remove();
    };
  }, [size]);

  return <div ref={host} id="spider3d" aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 100, pointerEvents: 'none' }} />;
}
