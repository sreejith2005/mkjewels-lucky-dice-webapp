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
function canvasTex(size, draw, srgb = true, height = size) {
  const c = document.createElement('canvas'); c.width = size; c.height = height;
  draw(c.getContext('2d'), size, height);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Logo recoloured to a flat colour (for foil / engraving masks). */
function tinted(logo, color) {
  const c = document.createElement('canvas'); c.width = logo.width; c.height = logo.height;
  const g = c.getContext('2d'); g.drawImage(logo, 0, 0);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Jewellery-studio light: a dark room with large warm softboxes and thin strip lights, so the
 * polished gold picks up crisp highlights and deep contrast (like product photography).
 */
function studioEnvironment(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070506');
  const box = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: '#2b2a28', side: THREE.BackSide }));
  box.position.y = 6; scene.add(box);
  const panel = (w, h, color, k, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); scene.add(m);
  };
  panel(12, 8, '#ffffff', 6, [0, 13, 2], [0, 0, 0]);          // big overhead key
  panel(3, 12, '#fffaf2', 5, [-12, 6, 2], [0, 2, 0]);          // left strip
  panel(3, 12, '#fffaf2', 4, [12, 6, -3], [0, 2, 0]);          // right strip
  panel(18, 7, '#fff6ea', 3.4, [0, 6, 13], [0, 1, 0]);         // warm front fill (camera side)
  panel(6, 2, '#c9a0ff', 0.25, [0, 3, -13], [0, 1, 0]);        // faint cool back bounce
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

/** Six gold die faces. The "1" is a large engraved pip carrying the MK monogram. */
function dieMaterials(size, env, logo) {
  const r = (v) => (v === 1 ? 0.2 : 0.082) * size;
  const pits = (v) => PIPS[v].map(([x, y]) => [x * size, y * size, r(v)]);
  const logoIn = (g, x, y, rad, img) => {
    const lh = rad * 1.25, lw = lh * img.width / img.height;
    g.drawImage(img, x - lw / 2, y - lh / 2 - rad * 0.05, lw, lh);
  };
  return FACE_VALUES.map((value) => {
    const map = canvasTex(size, (g, s) => {
      const lg = g.createLinearGradient(0, 0, s, s);
      lg.addColorStop(0, '#f8e6b8'); lg.addColorStop(0.5, '#ebcd8a'); lg.addColorStop(1, '#d4ad62');
      g.fillStyle = lg; g.fillRect(0, 0, s, s);
      // a very fine satin brush
      g.globalAlpha = 0.035;
      for (let i = 0; i < 160; i++) { g.fillStyle = i % 2 ? '#fff8e4' : '#8a6a2c'; g.fillRect(0, Math.random() * s, s, 0.6 + Math.random()); }
      g.globalAlpha = 1;
      for (const [x, y, h] of pits(value)) {
        // bevelled gold rim, then black enamel
        const rim = g.createRadialGradient(x - h * 0.25, y - h * 0.25, h * 0.7, x, y, h * 1.14);
        rim.addColorStop(0, '#6b4c18'); rim.addColorStop(0.75, '#fff1c8'); rim.addColorStop(1, 'rgba(255,241,200,0)');
        g.fillStyle = rim; g.beginPath(); g.arc(x, y, h * 1.14, 0, Math.PI * 2); g.fill();
        const pit = g.createRadialGradient(x + h * 0.3, y + h * 0.3, h * 0.05, x, y, h);
        pit.addColorStop(0, '#24201a'); pit.addColorStop(0.6, '#0b0a09'); pit.addColorStop(1, '#000');
        g.fillStyle = pit; g.beginPath(); g.arc(x, y, h, 0, Math.PI * 2); g.fill();
        if (value === 1 && logo) logoIn(g, x, y, h, tinted(logo, '#e9c77f'));
      }
    });
    const bump = canvasTex(size, (g, s) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
      for (const [x, y, h] of pits(value)) {
        const gr = g.createRadialGradient(x, y, h * 0.6, x, y, h * 1.06);
        gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff');
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, h * 1.06, 0, Math.PI * 2); g.fill();
        if (value === 1 && logo) logoIn(g, x, y, h, tinted(logo, '#9a9a9a'));
      }
    }, false);
    const rm = canvasTex(size, (g, s) => {   // G = roughness, B = metalness
      g.fillStyle = 'rgb(0, 52, 255)'; g.fillRect(0, 0, s, s);
      for (const [x, y, h] of pits(value)) {
        g.fillStyle = 'rgb(0, 95, 0)'; g.beginPath(); g.arc(x, y, h, 0, Math.PI * 2); g.fill();   // glossy black enamel
        if (value === 1 && logo) logoIn(g, x, y, h, tinted(logo, 'rgb(0, 60, 255)'));
      }
    }, false);
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map, bumpMap: bump, bumpScale: 2.4, metalness: 1, roughness: 1, metalnessMap: rm, roughnessMap: rm,
      clearcoat: 0.7, clearcoatRoughness: 0.08, envMap: env, envMapIntensity: 1.35
    });
  });
}

/** Plum velvet (the Jiyo Saj Ke campaign colour) with a gold-foil MK logo, campaign line and inlay. */
function velvetTextures(w, d, logo, hi) {
  const L = hi ? 2048 : 1280, W = Math.round(w >= d ? L : L * w / d), H = Math.round(w >= d ? L * d / w : L);
  const px = W / w;                                   // pixels per world unit
  const foil = (g, colour) => {
    const inset = 0.32 * px;
    g.strokeStyle = colour; g.lineWidth = Math.max(2, 0.03 * px);
    g.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    g.lineWidth = Math.max(1, 0.012 * px);
    g.strokeRect(inset + 0.1 * px, inset + 0.1 * px, W - inset * 2 - 0.2 * px, H - inset * 2 - 0.2 * px);
    g.save(); g.translate(W / 2, H / 2);
    if (logo) {
      const lh = Math.min(w, d) * 0.34 * px, lw = lh * logo.width / logo.height;
      g.drawImage(tinted(logo, colour), -lw / 2, -lh - Math.min(w, d) * 0.06 * px, lw, lh);
    }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = colour;
    g.font = `400 ${Math.min(w, d) * 0.1 * px}px 'Great Vibes', cursive`;
    g.fillText('Jiyo Saj Ke', 0, Math.min(w, d) * 0.06 * px);
    g.restore();
  };
  const map = canvasTex(W, (g) => {
    g.fillStyle = '#2a0b1d'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), dd = img.data;
    for (let i = 0; i < dd.length; i += 4) { const n = (Math.random() - 0.5) * 14; dd[i] += n; dd[i + 1] += n * 0.6; dd[i + 2] += n * 0.8; }
    g.putImageData(img, 0, 0);
    const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.1, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(90,30,62,0.18)'); vg.addColorStop(1, 'rgba(6,0,3,0.62)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.globalAlpha = 0.62; foil(g, '#d9b26a'); g.globalAlpha = 1;
  }, true, H);
  const bump = canvasTex(W, (g) => {
    g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    const img = g.getImageData(0, 0, W, H), dd = img.data;
    for (let i = 0; i < dd.length; i += 4) { const c = 128 + (Math.random() - 0.5) * 60 | 0; dd[i] = dd[i + 1] = dd[i + 2] = c; }
    g.putImageData(img, 0, 0);
    foil(g, '#5a5a5a');                                // foil is pressed into the pile
  }, false, H);
  const rm = canvasTex(W, (g) => {
    g.fillStyle = 'rgb(0, 245, 0)'; g.fillRect(0, 0, W, H);
    foil(g, 'rgb(0, 80, 255)');                        // foil is metallic and smoother
  }, false, H);
  return { map, bump, rm };
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
    this.dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.25);
    this.restQ = [new THREE.Quaternion(), new THREE.Quaternion()]; this.gatherUntil = 0;
    this.ray = new THREE.Raycaster(); this.ndc = new THREE.Vector2();
    this.dice = []; this.blobs = [];

    const w = host.clientWidth || 360, h = host.clientHeight || 640;
    const tray = mode === 'showcase' ? { w: 8, d: 5 } : trayFor(w, h);
    this.trayW = tray.w; this.trayD = tray.d;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: mode === 'showcase', powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(devicePixelRatio || 1, this.low ? 1.5 : 2));
    r.setSize(w, h);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = mode === 'game' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;   // neutral keeps gold yellow, not bronze
    r.toneMappingExposure = mode === 'showcase' ? 0.95 : 0.9;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    const cv = r.domElement;
    cv.className = 'dice-canvas';
    cv.style.touchAction = mode === 'game' ? 'none' : 'pan-y';
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', mode === 'game' ? 'Golden dice tray. Swipe the dice up to throw them.' : 'Two golden dice');
    host.appendChild(cv);

    const scene = this.scene = new THREE.Scene();
    const env = this.env = studioEnvironment(r);
    scene.environment = env;
    if (mode === 'game') scene.background = new THREE.Color('#0a0508');
    this.camera = new THREE.PerspectiveCamera(mode === 'showcase' ? 30 : 36, w / h, 0.1, 100);

    scene.add(new THREE.AmbientLight(0xfff1d6, 0.25), new THREE.HemisphereLight(0xfff0d0, 0x1a1208, 0.3));
    const spot = this.spot = new THREE.SpotLight(0xfff0d8, mode === 'showcase' ? 260 : 420, 40, Math.PI / 5, 0.55, 1.6);
    spot.position.set(2.5, 14, 6); spot.castShadow = true;
    const sm = this.low ? 1024 : 2048;
    spot.shadow.mapSize.set(sm, sm); spot.shadow.bias = -0.0004; spot.shadow.radius = 6;
    scene.add(spot, spot.target);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 0.6); rim.position.set(-8, 6, -8); scene.add(rim);
    const warm = new THREE.PointLight(0xffe0b8, 14, 30, 1.8); warm.position.set(-5, 5, 6); scene.add(warm);

    this.fitCamera(w, h);
    this.buildTray();
    this.buildDice();
    if (logoUrl) {
      // brand the felt and the "1" faces once the logo (and the campaign script font) are ready
      const img = new Image();
      const fonts = document.fonts ? document.fonts.load("400 40px 'Great Vibes'").catch(() => {}) : Promise.resolve();
      img.onload = () => fonts.then(() => { if (!this.disposed) this.applyBrand(img); });
      img.src = logoUrl;
    }
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
      this.scene.fog = new THREE.Fog('#0a0508', c * 1.25, c * 2.6);
      this.spot.position.set(2.5, Math.max(14, c * 0.7), 6);
    }
    if (!this.camReady || this.state === 'idle') { this.camera.position.copy(this.camBase); this.camTarget.copy(this.camLook); this.camera.lookAt(this.camLook); }
    this.camReady = true;
    this.camera.updateProjectionMatrix();
  }

  buildTray() {
    if (this.mode === 'showcase') {
      const alpha = canvasTex(256, (g, s) => { const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#bbb'); gr.addColorStop(1, '#000'); g.fillStyle = gr; g.fillRect(0, 0, s, s); }, false);
      const pad = new THREE.Mesh(new THREE.CircleGeometry(3.4, 64), new THREE.MeshPhysicalMaterial({ color: '#0a0907', roughness: 1, sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color('#3b2d1a'), transparent: true, alphaMap: alpha, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.receiveShadow = true; this.scene.add(pad);
      return;
    }
    const floorMat = this.floorMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 1, bumpScale: 0.8, sheen: 1, sheenRoughness: 0.55, sheenColor: new THREE.Color('#7a2f58'), envMapIntensity: 0.7 });
    this.paintFelt(null);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(this.trayW, this.trayD), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; this.scene.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: '#0b0609', roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; this.scene.add(ground);
    const gold = new THREE.MeshPhysicalMaterial({ color: '#e9cd8f', metalness: 1, roughness: 0.16, clearcoat: 0.8, clearcoatRoughness: 0.06, envMap: this.env, envMapIntensity: 1.6 });
    const seg = this.low ? 3 : 5;
    const H = 0.46, T = 0.36;
    const rail = (len, dep, x, z) => { const m = new THREE.Mesh(new RoundedBoxGeometry(len, H, dep, seg, 0.14), gold); m.position.set(x, H / 2, z); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); };
    rail(this.trayW + T * 2, T, 0, this.trayD / 2 + T / 2); rail(this.trayW + T * 2, T, 0, -this.trayD / 2 - T / 2);
    rail(T, this.trayD, this.trayW / 2 + T / 2, 0); rail(T, this.trayD, -this.trayW / 2 - T / 2, 0);
    // a slim polished lip where the velvet meets the rail
    const lipMat = new THREE.MeshPhysicalMaterial({ color: '#f3dba6', metalness: 1, roughness: 0.1, envMap: this.env, envMapIntensity: 1.8 });
    const lip = (len, dep, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.03, dep), lipMat); m.position.set(x, 0.015, z); this.scene.add(m); };
    const e = 0.05;
    lip(this.trayW, e, 0, this.trayD / 2 - e / 2); lip(this.trayW, e, 0, -this.trayD / 2 + e / 2);
    lip(e, this.trayD, this.trayW / 2 - e / 2, 0); lip(e, this.trayD, -this.trayW / 2 + e / 2, 0);
  }

  paintFelt(logo) {
    const m = this.floorMat; if (!m) return;
    const t = velvetTextures(this.trayW, this.trayD, logo, !this.low);
    ['map', 'bumpMap', 'roughnessMap', 'metalnessMap'].forEach((k) => { if (m[k] && m[k] !== m.roughnessMap) m[k].dispose(); });
    m.roughnessMap?.dispose();
    m.map = t.map; m.bumpMap = t.bump; m.roughnessMap = t.rm; m.metalnessMap = t.rm; m.needsUpdate = true;
  }

  applyBrand(logo) {
    this.paintFelt(logo);
    const mats = dieMaterials(this.low ? 512 : 1024, this.env, logo), old = this.dice[0].material;
    this.dice.forEach((d) => { d.material = mats; });
    old.forEach((m) => { Object.values(m).forEach((v) => { if (v && v.isTexture && v !== this.env) v.dispose(); }); m.dispose(); });
  }

  buildDice() {
    const size = this.low ? 512 : 1024;
    const geo = new RoundedBoxGeometry(1, 1, 1, this.low ? 4 : 7, 0.12);
    const mats = dieMaterials(size, this.env, null);
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
    if (this.mode === 'showcase') {
      if (randomise) this.dice.forEach((d, i) => d.quaternion.setFromEuler(_e.set(i ? -0.3 : 0.5, i ? -0.7 : 0.6, i ? 0.4 : 0.1)));
      return;
    }
    // resting pose on the felt: a face up, slightly turned
    const faces = [6, 5, 4, 3, 2].sort(() => Math.random() - 0.5);
    this.restQ.forEach((q, i) => q.setFromUnitVectors(NORMALS[FACE_VALUES.indexOf(faces[i])], UP).premultiply(_q2.setFromAxisAngle(UP, (i ? -0.45 : 0.35) + (Math.random() - 0.5) * 0.4)));
    if (randomise && this.state === 'idle' && !this.dice[0].userData.placed) {
      this.dice.forEach((d, i) => { d.quaternion.copy(this.restQ[i]); d.position.set(this.handPos[i].x, 0.5, this.handPos[i].z); d.userData.placed = true; });
    }
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
      if (this.state === 'settled' && !this.locked) { this.emit('pick'); return; }   // pick the dice up again (fun rolls)
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
      this.handPos[0].set(p.x - 0.9, 1.2, p.z + 0.1); this.handPos[1].set(p.x + 0.9, 1.3, p.z - 0.1);
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

  /** Back to the start for another roll: the dice are gathered up and set down at the front. */
  reset() { this.rec = null; this.state = 'idle'; this.gatherUntil = this.time + 0.55; this.resetHand(true); }

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
    const show = this.mode === 'showcase';
    const lifted = show || awaiting || this.dragging || t < this.gatherUntil;
    this.dice.forEach((d, i) => {
      const p = _v.copy(this.handPos[i]);
      if (show) p.y += Math.sin(t * 1.6 + i * 1.3) * 0.12;
      else if (!lifted) p.y = 0.5;                       // resting on the felt
      else p.y += Math.sin(t * 2.2 + i * 1.3) * 0.03;
      if (awaiting && !this.reduced) {
        if (shaking) { p.add(this.shakeOffset); p.x += Math.sin(t * 31 + i) * 0.04; p.z += Math.cos(t * 27 + i) * 0.04; }
        else { p.x += Math.sin(t * 38 + i) * 0.09; p.z += Math.cos(t * 33 + i * 2) * 0.09; }
      }
      d.position.lerp(p, 1 - Math.pow(1 - (this.dragging ? 0.35 : lifted ? 0.14 : 0.2), dt * 60));
      if (!show && !lifted) { d.quaternion.slerp(this.restQ[i], 1 - Math.exp(-10 * dt)); return; }
      const k = awaiting ? 9 : this.dragging ? 2.5 : show ? (this.reduced ? 0.15 : 0.45) : 3;
      const s = this.handSpin[i];
      d.quaternion.multiply(_q.setFromEuler(_e.set(s.x * k * dt, s.y * k * dt, s.z * k * dt)));
    });
    if (awaiting && !shaking && this.time > (this.nextRattle || 0)) { this.nextRattle = this.time + 0.09 + Math.random() * 0.12; this.emit('rattle', { strength: 0.5 + Math.random() * 0.4 }); }
  }

  playback(dt) {
    const rec = this.rec, n = rec.frameCount, f = rec.frames;
    const remaining = (n - this.playhead) / HZ;
    const speed = this.reduced ? 1.6 : remaining < 0.6 ? 0.72 : 0.92;
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
