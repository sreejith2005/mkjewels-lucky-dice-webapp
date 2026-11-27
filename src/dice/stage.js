/**
 * Golden dice stage — a port of the approved motion study ("MK Jewels – Lucky Double Dice.html"):
 * black studio with a velvet tray and polished gold rails, clear-coated gold dice, room-light
 * reflections, drifting gold dust, a following camera with impact shake, and real physics playback.
 *
 * Two modes: 'showcase' (floating dice for the welcome screen) and 'game' (the rolling tray).
 * The result always comes from the server: a validated physics throw is planned in a Web Worker,
 * then the faces are re-labelled once (cube symmetry) so the dice visibly land on the official values.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { planThrow, trayFor, handAnchor, FACE_VALUES, FACE_NORMALS, HZ, STRIDE } from './physics.js';

const NORMALS = FACE_NORMALS.map((n) => new THREE.Vector3(...n));
const UP = new THREE.Vector3(0, 1, 0);
const PIPS = {
  1: [[0.5, 0.5]], 2: [[0.27, 0.27], [0.73, 0.73]], 3: [[0.27, 0.27], [0.5, 0.5], [0.73, 0.73]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]], 5: [[0.27, 0.27], [0.73, 0.27], [0.5, 0.5], [0.27, 0.73], [0.73, 0.73]],
  6: [[0.27, 0.25], [0.73, 0.25], [0.27, 0.5], [0.73, 0.5], [0.27, 0.75], [0.73, 0.75]]
};
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export function detectQuality() {
  const n = navigator, mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(n.userAgent);
  const low = (n.deviceMemory && n.deviceMemory <= 4) || (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (mobile && devicePixelRatio > 2.5 && (n.deviceMemory ?? 8) <= 6);
  return low ? 'low' : 'high';
}

/* ------------------------------------------------------------------ textures */
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dieMaterial(value, size, env) {
  const r = (v) => (v === 1 ? 0.13 : 0.085) * size;
  const map = canvasTex(size, (g, s) => {
    const lg = g.createLinearGradient(0, 0, s, s);
    lg.addColorStop(0, '#f0d08a'); lg.addColorStop(0.45, '#d9b05a'); lg.addColorStop(1, '#b8873a');
    g.fillStyle = lg; g.fillRect(0, 0, s, s);
    g.globalAlpha = 0.05;
    for (let i = 0; i < 260; i++) { g.fillStyle = i % 2 ? '#fff6d8' : '#8a6a2c'; g.fillRect(0, Math.random() * s, s, Math.random() * 1.4); }
    g.globalAlpha = 1;
    for (const [x, y] of PIPS[value]) {
      const h = r(value);
      const rim = g.createRadialGradient(x * s - h * 0.2, y * s - h * 0.2, h * 0.6, x * s, y * s, h * 1.18);
      rim.addColorStop(0, 'rgba(120,88,30,0.9)'); rim.addColorStop(0.8, 'rgba(255,240,200,0.6)'); rim.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = rim; g.beginPath(); g.arc(x * s, y * s, h * 1.18, 0, Math.PI * 2); g.fill();
      const pit = g.createRadialGradient(x * s + h * 0.25, y * s + h * 0.25, h * 0.1, x * s, y * s, h);
      pit.addColorStop(0, '#1a1712'); pit.addColorStop(0.7, '#050505'); pit.addColorStop(1, '#000');
      g.fillStyle = pit; g.beginPath(); g.arc(x * s, y * s, h, 0, Math.PI * 2); g.fill();
    }
  });
  const bump = canvasTex(size, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    for (const [x, y] of PIPS[value]) {
      const h = r(value), gr = g.createRadialGradient(x * s, y * s, h * 0.55, x * s, y * s, h * 1.08);
      gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff'); g.fillStyle = gr; g.beginPath(); g.arc(x * s, y * s, h * 1.08, 0, Math.PI * 2); g.fill();
    }
  }, false);
  const rm = canvasTex(size, (g, s) => {   // G = roughness, B = metalness
    g.fillStyle = 'rgb(0, 46, 255)'; g.fillRect(0, 0, s, s);
    for (const [x, y] of PIPS[value]) { g.fillStyle = 'rgb(0, 160, 40)'; g.beginPath(); g.arc(x * s, y * s, r(value), 0, Math.PI * 2); g.fill(); }
  }, false);
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map, bumpMap: bump, bumpScale: 2.2, metalness: 1, roughness: 1, metalnessMap: rm, roughnessMap: rm,
    clearcoat: 0.55, clearcoatRoughness: 0.12, envMap: env, envMapIntensity: 1.25
  });
}

function velvetTextures(w, d, logo) {
  const S = 1024, aspect = w / d;
  const brand = (g, kind) => {
    g.save(); g.translate(S / 2, S / 2); g.scale(1 / Math.max(aspect, 1), Math.min(aspect, 1));
    if (logo) {
      const lh = S * 0.42, lw = lh * logo.width / logo.height;
      g.globalAlpha = kind === 'color' ? 0.1 : 0.6;
      g.drawImage(logo, -lw / 2, -lh / 2 - S * 0.04, lw, lh);
      g.globalAlpha = 1;
    }
    g.textAlign = 'center';
    g.fillStyle = kind === 'color' ? 'rgba(212,180,119,0.10)' : '#dcdcdc';
    g.font = `500 ${S * 0.028}px 'Jost', sans-serif`;
    g.fillText('S I N C E   1 9 9 9', 0, S * 0.24);
    if (kind === 'color') { g.strokeStyle = 'rgba(212,180,119,0.08)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, S * 0.32, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  };
  const map = canvasTex(S, (g) => {
    g.fillStyle = '#070606'; g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) { const n = Math.random() * 10 | 0; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.8; }
    g.putImageData(img, 0, 0);
    const vg = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.75);
    vg.addColorStop(0, 'rgba(60,45,25,0.18)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, S, S);
    brand(g, 'color');
  });
  const bump = canvasTex(S, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, S, S);
    const img = g.getImageData(0, 0, S, S);
    for (let i = 0; i < img.data.length; i += 4) { const c = 128 + (Math.random() - 0.5) * 70 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = c; }
    g.putImageData(img, 0, 0);
    brand(g, 'bump');
  }, false);
  return { map, bump };
}

const glowTex = () => canvasTex(64, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(230,190,110,0.7)'); gr.addColorStop(1, 'rgba(212,175,55,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const blobTex = () => canvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

/* ------------------------------------------------------------------ planner (Web Worker) */
let worker = null, workerFailed = false, seq = 0;
const pending = new Map();
function planAsync(tray, hand, velocity, power) {
  const local = () => planThrow(tray, hand, velocity, { power });
  if (!worker && !workerFailed) {
    try {
      worker = new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); clearTimeout(p.timer); p.resolve(e.data.plan); } };
      worker.onerror = () => { workerFailed = true; worker = null; pending.forEach((p) => { clearTimeout(p.timer); p.resolve(p.local()); }); pending.clear(); };
    } catch (e) { workerFailed = true; }
  }
  if (!worker) return new Promise((r) => setTimeout(() => r(local()), 0));
  return new Promise((resolve) => {
    const id = ++seq;
    const timer = setTimeout(() => { if (pending.delete(id)) resolve(local()); }, 2500);
    pending.set(id, { resolve, local, timer });
    worker.postMessage({ id, tray, hand, velocity, power });
  });
}

/* ------------------------------------------------------------------ stage */
export class DiceStage {
  constructor(host, { mode = 'game', quality = 'high', reducedMotion = false, logoUrl = '/brand/mk-logo.png' } = {}) {
    this.el = host; this.mode = mode; this.reduced = reducedMotion; this.low = quality === 'low';
    this.listeners = {};
    this.state = 'idle';
    this.time = 0; this.shake = 0; this.frameTimes = []; this.degraded = false; this.visible = true;
    this.handPos = [new THREE.Vector3(), new THREE.Vector3()];
    this.handSpin = [new THREE.Vector3(0.6, 0.9, 0.3), new THREE.Vector3(-0.7, 0.5, 0.8)];
    this.shakeOffset = new THREE.Vector3(); this.shakeTarget = new THREE.Vector3();
    this.camBase = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.camTarget = new THREE.Vector3();
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.2);
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.dice = []; this.blobs = [];

    const w = host.clientWidth || 360, h = host.clientHeight || 640;
    const tray = mode === 'showcase' ? { w: 8, d: 5 } : trayFor(w, h);
    this.trayW = tray.w; this.trayD = tray.d;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: !this.low, alpha: mode === 'showcase', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.low ? 1.25 : 2));
    r.setSize(w, h);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = mode === 'showcase' ? 0.95 : 1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const cv = r.domElement;
    cv.className = 'dice-canvas';
    cv.style.touchAction = mode === 'game' ? 'none' : 'pan-y';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', mode === 'game' ? 'Golden dice tray. Swipe the dice up to throw them.' : 'Two golden dice');
    host.appendChild(cv);

    const scene = this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    const env = this.env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
    pmrem.dispose();
    scene.environment = env;
    if (mode === 'game') scene.background = new THREE.Color('#050505');
    this.camera = new THREE.PerspectiveCamera(mode === 'showcase' ? 30 : 36, w / h, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xfff1d6, 0.25), new THREE.HemisphereLight(0xfff0d0, 0x1a1208, 0.3));
    const spot = this.spot = new THREE.SpotLight(0xffe2b0, mode === 'showcase' ? 260 : 420, 40, Math.PI / 5, 0.55, 1.6);
    spot.position.set(2.5, 14, 6); spot.castShadow = true;
    const sm = this.low ? 512 : 1024;
    spot.shadow.mapSize.set(sm, sm); spot.shadow.bias = -0.0004; spot.shadow.radius = 6;
    scene.add(spot, spot.target);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.6); rim.position.set(-8, 6, -8); scene.add(rim);
    const warm = new THREE.PointLight(0xffc98a, 18, 30, 1.8); warm.position.set(-5, 5, 6); scene.add(warm);

    this.fitCamera(w, h);
    this.buildTray(logoUrl);
    this.buildDice();
    this.buildParticles();
    this.resetHand(true);
    this.dice.forEach((d, i) => d.position.copy(this.handPos[i]));
    if (mode === 'game') this.bindPointer();

    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; }, { threshold: 0 }); this.io.observe(host);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, data) { (this.listeners[ev] || []).forEach((fn) => fn(data)); }

  /* -------------------------------------------------------------- build */
  fitCamera(w, h) {
    const aspect = w / h;
    this.camera.aspect = aspect;
    if (this.mode === 'showcase') { this.camBase.set(0, 3.2, 7.2); this.camLook.set(0, 0.7, 0); }
    else {
      const fov = THREE.MathUtils.degToRad(this.camera.fov);
      const byD = (this.trayD * 0.92) / (2 * Math.tan(fov / 2)), byW = (this.trayW * 1.12) / (2 * Math.tan(fov / 2) * aspect);
      const c = Math.max(byD, byW) * 1.12;
      this.camBase.set(0, c * 0.86, c * 0.55); this.camLook.set(0, 0, 0.35);
      this.scene.fog = new THREE.Fog('#050505', c * 1.25, c * 2.6);
      this.spot.position.set(2.5, Math.max(14, c * 0.7), 6);
    }
    if (!this.camReady || this.state === 'idle') { this.camera.position.copy(this.camBase); this.camTarget.copy(this.camLook); this.camera.lookAt(this.camLook); }
    this.camReady = true;
    this.camera.updateProjectionMatrix();
  }

  buildTray(logoUrl) {
    if (this.mode === 'showcase') {
      const alpha = canvasTex(256, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#bbb'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshPhysicalMaterial({ color: '#0a0907', roughness: 1, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color('#3b2d1a'), transparent: true, alphaMap: alpha, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.receiveShadow = true; this.scene.add(pad);
      return;
    }
    const floorMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0, bumpScale: 0.6, sheen: 0.8, sheenRoughness: 0.6, sheenColor: new THREE.Color('#4a3a22') });
    const paint = (logo) => { const t = velvetTextures(this.trayW, this.trayD, logo); floorMat.map?.dispose(); floorMat.bumpMap?.dispose(); floorMat.map = t.map; floorMat.bumpMap = t.bump; floorMat.needsUpdate = true; };
    paint(null);
    if (logoUrl) { const img = new Image(); img.onload = () => { if (!this.disposed) paint(img); }; img.src = logoUrl; }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(this.trayW, this.trayD), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#040404' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; this.scene.add(ground);
    const gold = new THREE.MeshPhysicalMaterial({ color: '#d6aa55', metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.1, envMap: this.env, envMapIntensity: 1.5 });
    const H = 0.42, T = 0.34;
    const rail = (len, dep, x, z) => { const m = new THREE.Mesh(new RoundedBoxGeometry(len, H, dep, 3, 0.1), gold); m.position.set(x, H / 2, z); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); };
    rail(this.trayW + T * 2, T, 0, this.trayD / 2 + T / 2); rail(this.trayW + T * 2, T, 0, -this.trayD / 2 - T / 2);
    rail(T, this.trayD, this.trayW / 2 + T / 2, 0); rail(T, this.trayD, -this.trayW / 2 - T / 2, 0);
  }

  buildDice() {
    const size = this.low ? 256 : 512;
    const geo = new RoundedBoxGeometry(1, 1, 1, this.low ? 3 : 5, 0.12);
    const mats = FACE_VALUES.map((v) => dieMaterial(v, size, this.env));
    const blob = blobTex();
    for (let i = 0; i < 2; i++) {
      const m = new THREE.Mesh(geo, mats); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); this.dice.push(m);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, opacity: 0.7 }));
      b.rotation.x = -Math.PI / 2; b.position.y = 0.012; b.renderOrder = 1; this.scene.add(b); this.blobs.push(b);
    }
  }

  buildParticles() {
    const n = this.reduced ? 30 : this.low ? 70 : 150;
    const pos = new Float32Array(n * 3), speed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.trayW * 1.6; pos[i * 3 + 1] = Math.random() * 6; pos[i * 3 + 2] = (Math.random() - 0.5) * this.trayD * 1.4;
      speed[i] = 0.05 + Math.random() * 0.18;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
    this.particles = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex(), size: 0.11, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.75, sizeAttenuation: true }));
    this.scene.add(this.particles);
  }

  /* -------------------------------------------------------------- hand */
  resetHand(randomise = false) {
    const a = this.mode === 'showcase' ? [[-0.85, 0.95, 0], [0.85, 1.05, 0.15]] : handAnchor({ w: this.trayW, d: this.trayD });
    this.handPos[0].set(...a[0]); this.handPos[1].set(...a[1]);
    if (randomise) this.dice.forEach((d, i) => d.quaternion.setFromEuler(_e.set(i ? -0.3 : 0.5, i ? -0.7 : 0.6, i ? 0.4 : 0.1)));
  }

  bindPointer() {
    const cv = this.renderer.domElement;
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.ray.setFromCamera(this.ndc, this.camera);
      const p = new THREE.Vector3();
      return this.ray.ray.intersectPlane(this.dragPlane, p) ? p : null;
    };
    this.onDown = (e) => {
      if (this.state !== 'idle' || this.locked) return;
      const p = at(e); if (!p) return;
      this.dragging = true; this.samples = [{ t: performance.now(), p }];
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* */ }
      this.emit('grab');
    };
    this.onMove = (e) => {
      if (!this.dragging) return;
      const p = at(e); if (!p) return;
      p.x = THREE.MathUtils.clamp(p.x, -this.trayW / 2 + 0.8, this.trayW / 2 - 0.8);
      p.z = THREE.MathUtils.clamp(p.z, -this.trayD / 2 + 0.8, this.trayD / 2 - 0.6);
      this.samples.push({ t: performance.now(), p }); if (this.samples.length > 8) this.samples.shift();
      this.handPos[0].set(p.x - 0.9, 2.2, p.z + 0.1); this.handPos[1].set(p.x + 0.9, 2.35, p.z - 0.1);
    };
    this.onUp = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* */ }
      const s = this.samples;
      if (s.length >= 2) {
        const a = s[Math.max(0, s.length - 5)], b = s[s.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 0.016);
        const v = b.p.clone().sub(a.p).divideScalar(dt);
        if (s[0].p.distanceTo(b.p) > 0.9 && v.length() > 1.2) { v.setLength(Math.max(v.length() * 1.6, 9)); this.emit('swipe', { velocity: [v.x, 0, v.z] }); return; }
      }
      this.resetHand();
    };
    cv.addEventListener('pointerdown', this.onDown); cv.addEventListener('pointermove', this.onMove);
    cv.addEventListener('pointerup', this.onUp); cv.addEventListener('pointercancel', this.onUp);
  }

  /** Lock the tray against new grabs. */
  setLocked(v) { this.locked = v; }

  /** Dice start shaking in the hand. kind 'shake' lets the phone's motion drive them. */
  beginAwait(kind = 'auto') {
    if (this.state !== 'idle') return;
    this.awaitKind = kind; this.nextRattle = 0;
    this.state = 'awaiting';
  }

  /** Gravity-free phone acceleration (m/s², device axes) while shaking. */
  shakeInput(ax, ay, az) {
    this.shakeTarget.set(ax, az * 0.4, -ay).multiplyScalar(0.035).clampLength(0, 0.7);
    const mag = Math.hypot(ax, ay, az);
    if (this.state === 'awaiting' && mag > 9 && this.time > (this.nextRattle || 0)) { this.nextRattle = this.time + 0.07 + Math.random() * 0.05; this.emit('rattle', { strength: Math.min(1, mag / 25) }); }
  }

  cancelAwait() { if (this.state === 'awaiting') { this.state = 'idle'; this.resetHand(); } }

  /**
   * Throw so that the dice land on values [left die, right die].
   * velocity: [vx, 0, vz] from a swipe, or null. Resolves when the dice have settled.
   */
  throw(values, { velocity = null, power = 0.5 } = {}) {
    if (this.state === 'rolling') return Promise.resolve();
    const hand = this.dice.map((d) => [d.position.x, d.position.y, d.position.z]);
    return planAsync({ w: this.trayW, d: this.trayD }, hand, velocity, power).then((plan) => new Promise((resolve) => {
      if (this.disposed) { resolve(); return; }
      if (!plan) { this.showResult(values); resolve(); return; }
      // the left-most die shows values[0] so the read-out matches what people see
      const leftFirst = plan.finals[0].x <= plan.finals[1].x;
      const mine = leftFirst ? values : [values[1], values[0]];
      this.remap = plan.finals.map((f, i) => new THREE.Quaternion().setFromUnitVectors(NORMALS[FACE_VALUES.indexOf(mine[i])], NORMALS[f.index]));
      this.rec = plan; this.playhead = 0; this.nextHit = 0; this.settleResolve = resolve;
      this.blendFrom = this.dice.map((d) => ({ p: d.position.clone(), q: d.quaternion.clone() }));
      this.state = 'rolling';
      this.emit('throw');
    }));
  }

  /** Static result (a returning player). */
  showResult(values) {
    const face = (v, yaw) => new THREE.Quaternion().setFromUnitVectors(NORMALS[FACE_VALUES.indexOf(v)], UP).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    this.dice[0].position.set(-0.85, 0.5, -0.2); this.dice[0].quaternion.copy(face(values[0], 0.35));
    this.dice[1].position.set(0.85, 0.5, 0.25); this.dice[1].quaternion.copy(face(values[1], -0.5));
    this.rec = null; this.state = 'settled';
  }

  reset() { this.rec = null; this.state = 'idle'; this.resetHand(true); }

  /* -------------------------------------------------------------- frame loop */
  loop(now) {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
    if (!this.visible || document.hidden) return;
    this.time += dt;
    this.adaptQuality(dt);
    if (this.state === 'rolling' && this.rec) this.playback(dt);
    else if (this.state === 'idle' || this.state === 'awaiting' || this.mode === 'showcase') this.animateHand(dt);
    this.updateBlobs(); this.updateParticles(dt); this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
  }

  animateHand(dt) {
    const awaiting = this.state === 'awaiting', t = this.time;
    const shaking = awaiting && this.awaitKind === 'shake';
    this.shakeOffset.lerp(shaking ? this.shakeTarget : _v.set(0, 0, 0), 1 - Math.exp(-14 * dt));
    this.dice.forEach((d, i) => {
      const p = _v.copy(this.handPos[i]);
      p.y += Math.sin(t * 1.6 + i * 1.3) * (this.mode === 'showcase' ? 0.12 : 0.08);
      if (awaiting && !this.reduced) {
        if (shaking) { p.add(this.shakeOffset); p.x += Math.sin(t * 31 + i) * 0.04; p.z += Math.cos(t * 27 + i) * 0.04; }
        else { p.x += Math.sin(t * 38 + i) * 0.09; p.z += Math.cos(t * 33 + i * 2) * 0.09; }
      }
      d.position.lerp(p, 1 - Math.pow(1 - (this.dragging ? 0.35 : 0.12), dt * 60));
      const k = awaiting ? 9 : this.dragging ? 2.5 : this.reduced ? 0.15 : 0.45;
      const s = this.handSpin[i];
      d.quaternion.multiply(_q.setFromEuler(_e.set(s.x * k * dt, s.y * k * dt, s.z * k * dt)));
    });
    if (awaiting && !shaking && this.time > (this.nextRattle || 0)) { this.nextRattle = this.time + 0.09 + Math.random() * 0.12; this.emit('rattle', { strength: 0.5 + Math.random() * 0.4 }); }
  }

  playback(dt) {
    const rec = this.rec, n = rec.frameCount, f = rec.frames;
    const remaining = (n - this.playhead) / HZ;
    const speed = this.reduced ? 1.6 : remaining < 0.9 ? 0.55 : 1;
    this.playhead = Math.min(this.playhead + dt * HZ * speed, n - 1);
    const i0 = Math.floor(this.playhead), i1 = Math.min(i0 + 1, n - 1), a = this.playhead - i0;
    const blend = this.blendFrom ? Math.min(this.playhead / 10, 1) : 1;
    for (let k = 0; k < 2; k++) {
      const o0 = i0 * STRIDE + k * 7, o1 = i1 * STRIDE + k * 7, d = this.dice[k];
      _v.set(f[o0] + (f[o1] - f[o0]) * a, f[o0 + 1] + (f[o1 + 1] - f[o0 + 1]) * a, f[o0 + 2] + (f[o1 + 2] - f[o0 + 2]) * a);
      _q.set(f[o0 + 3], f[o0 + 4], f[o0 + 5], f[o0 + 6]).slerp(_q2.set(f[o1 + 3], f[o1 + 4], f[o1 + 5], f[o1 + 6]), a).multiply(this.remap[k]);
      if (blend < 1) { d.position.copy(this.blendFrom[k].p).lerp(_v, blend); d.quaternion.copy(this.blendFrom[k].q).slerp(_q, blend); }
      else { d.position.copy(_v); d.quaternion.copy(_q); }
    }
    if (blend >= 1) this.blendFrom = null;
    while (this.nextHit < rec.hits.length && rec.hits[this.nextHit].frame <= this.playhead) {
      const hit = rec.hits[this.nextHit++];
      if (hit.strength > 4 && !this.reduced) this.shake = Math.min(0.12, this.shake + hit.strength * 0.006);
      this.emit('impact', { kind: hit.kind, strength: hit.strength, pan: THREE.MathUtils.clamp(hit.x, -1, 1) * 0.6 });
    }
    if (this.playhead >= n - 1) {
      this.state = 'settled'; this.rec = null;
      this.emit('settled');
      const r = this.settleResolve; this.settleResolve = null; if (r) r();
    }
  }

  centroid() { return this.dice[0].position.clone().add(this.dice[1].position).multiplyScalar(0.5).setY(0.4); }

  updateCamera(dt) {
    if (this.mode === 'showcase') {
      const r = this.time * 0.25;
      this.camera.position.set(this.camBase.x + Math.sin(r) * 0.6, this.camBase.y + Math.sin(r * 0.7) * 0.15, this.camBase.z);
      this.camera.lookAt(this.camLook);
      return;
    }
    let pos = this.camBase.clone(); const look = this.camLook.clone();
    if (this.state === 'rolling' || this.state === 'settled') {
      look.lerp(this.centroid(), this.state === 'settled' ? 1 : 0.45);
      const off = this.camBase.clone().sub(this.camLook), full = off.length();
      const fit = (this.dice[0].position.distanceTo(this.dice[1].position) + 2.2) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.min(this.camera.aspect, 1)) * 1.15;
      const dist = this.state === 'settled' ? THREE.MathUtils.clamp(fit * 1.35, 8.5, full * 0.84) : full * 0.88;
      pos = look.clone().add(off.normalize().multiplyScalar(dist));
    }
    const k = 1 - Math.pow(0.02, dt);
    this.camera.position.lerp(pos, k * 0.6); this.camTarget.lerp(look, k);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.002, dt);
    }
    this.camera.lookAt(this.camTarget);
  }

  updateBlobs() {
    this.dice.forEach((d, i) => {
      const b = this.blobs[i], lift = Math.max(d.position.y - 0.5, 0);
      b.position.x = d.position.x; b.position.z = d.position.z;
      b.scale.setScalar(1 + lift * 0.35); b.material.opacity = THREE.MathUtils.clamp(0.75 - lift * 0.22, 0.12, 0.75);
    });
  }

  updateParticles(dt) {
    if (!this.particles.visible) return;
    const pos = this.particles.geometry.getAttribute('position'), sp = this.particles.geometry.getAttribute('speed');
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + sp.getX(i) * dt * (this.reduced ? 0.3 : 1);
      if (y > 6.5) y = 0.1;
      pos.setY(i, y); pos.setX(i, pos.getX(i) + Math.sin(this.time * 0.6 + i) * 0.002);
    }
    pos.needsUpdate = true;
    this.particles.material.opacity = 0.55 + Math.sin(this.time * 2) * 0.15;
  }

  /** On slow devices drop to 1× resolution and turn off shadows and dust, once. */
  adaptQuality(dt) {
    if (this.degraded) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((s, x) => s + x, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 38) {
      this.degraded = true;
      this.renderer.setPixelRatio(1); this.spot.castShadow = false; this.particles.visible = false;
      this.resize();
    }
  }

  resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.fitCamera(w, h);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf); this.ro.disconnect(); this.io.disconnect();
    const cv = this.renderer.domElement;
    if (this.onDown) { cv.removeEventListener('pointerdown', this.onDown); cv.removeEventListener('pointermove', this.onMove); cv.removeEventListener('pointerup', this.onUp); cv.removeEventListener('pointercancel', this.onUp); }
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []).forEach((m) => { Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); }); m.dispose(); });
    });
    this.env.dispose();
    this.renderer.dispose();
    if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
    cv.remove();
  }
}
