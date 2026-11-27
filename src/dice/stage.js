import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { planThrow, launchPose, normalOf, FACE_NORMALS } from './physics.js';
import { faceTextures, velvetTextures, contactShadow } from './textures.js';

const HOLD_Y = 1.8;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const HAND_OFFSETS = [new THREE.Vector3(-0.58, 0, 0.06), new THREE.Vector3(0.58, 0.12, -0.08)];
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Jeweller's lightbox: dark room with warm softboxes → deep, contrasty gold reflections. */
function studioEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 24, 12), new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.BackSide })));
  const panel = (w, h, color, intensity, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(20, 10, 0xfff1dc, 2.4, [0, 16, 3]);       // overhead softbox
  panel(30, 30, 0x2a1d0e, 1.0, [0, 22, 0]);       // warm ceiling wash
  panel(5, 12, 0xffe2b0, 1.6, [-15, 5, 4]);       // left strip
  panel(5, 12, 0xfff6e6, 1.25, [15, 6, -3]);      // right strip
  panel(18, 3, 0xffd9a0, 0.9, [0, 3, -16]);       // back rim
  panel(12, 3, 0xfff3df, 0.55, [0, 6, 15]);       // front kicker
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: 0x1a130a }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -2; env.add(floor);
  return env;
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

export function detectQuality() {
  const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 8;
  const small = Math.min(screen.width, screen.height) < 400;
  return (mem <= 3 || cores <= 4 || (small && mem <= 4)) ? 'low' : 'high';
}

/** Throw planning in a Web Worker (falls back to the main thread). */
class Planner {
  constructor() {
    this.seq = 0; this.pending = new Map();
    try {
      this.worker = new Worker(new URL('./physics.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => { const p = this.pending.get(e.data.id); if (p) { this.pending.delete(e.data.id); clearTimeout(p.timer); p.resolve(e.data.plan); } };
      this.worker.onerror = () => { this.worker = null; this.pending.forEach((p) => { clearTimeout(p.timer); p.resolve(this.local(p.args)); }); this.pending.clear(); };
    } catch (e) { this.worker = null; }
  }
  local({ tray, hand, velocity, power }) { return planThrow(tray, hand, velocity, { power }); }
  plan(tray, hand, velocity, power = 0.6) {
    const args = { tray: { w: tray.w, d: tray.d }, hand, velocity, power };
    if (!this.worker) return new Promise((r) => setTimeout(() => r(this.local(args)), 0));
    return new Promise((resolve) => {
      const id = ++this.seq;
      const timer = setTimeout(() => { if (this.pending.delete(id)) resolve(this.local(args)); }, 3000);
      this.pending.set(id, { resolve, args, timer });
      this.worker.postMessage({ id, ...args });
    });
  }
}

export class DiceStage {
  constructor({ quality = 'high', reducedMotion = false, logoUrl } = {}) {
    this.quality = quality;
    this.reduced = reducedMotion;
    this.listeners = {};
    const hi = quality === 'high';

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const dpr = window.devicePixelRatio || 1;
    this.dpr = Math.min(dpr, hi ? 1.75 : 1.25);
    r.setPixelRatio(this.dpr);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.16;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = r.domElement;
    this.canvas.className = 'dice-canvas';

    const scene = this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
    const pmrem = new THREE.PMREMGenerator(r);
    scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
    scene.environmentIntensity = 1.15;
    pmrem.dispose();

    const key = this.key = new THREE.SpotLight(0xfff0d6, 420, 0, 0.5, 0.85, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(hi ? 1024 : 512, hi ? 1024 : 512);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025;
    key.shadow.camera.near = 4; key.shadow.camera.far = 30;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xffd8a0, 1.6); rim.position.set(-6, 3.2, -7); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xfff4e0, 0.7); rim2.position.set(7, 2.5, -3); scene.add(rim2);
    scene.add(new THREE.HemisphereLight(0xfff3e0, 0x150f08, 0.12));

    // ---- dice
    const texSize = hi ? 512 : 256;
    const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.dieMaterials = [3, 4, 1, 6, 2, 5].map((v) => {
      const t = faceTextures(v, texSize, aniso);
      return new THREE.MeshStandardMaterial({
        color: 0xf4d8a2, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
        roughnessMap: t.rmMap, metalnessMap: t.rmMap, roughness: 1, metalness: 1, envMapIntensity: 1.0
      });
    });
    const geo = new RoundedBoxGeometry(1, 1, 1, hi ? 5 : 3, 0.1);
    const blobTex = contactShadow();
    this.dice = [0, 1].map(() => {
      const outer = new THREE.Group();
      const inner = new THREE.Mesh(geo, this.dieMaterials);
      inner.castShadow = true; inner.receiveShadow = true;
      outer.add(inner); scene.add(outer);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.45 }));
      blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
      return { outer, inner, blob, spinV: new THREE.Vector3(), tween: null };
    });

    this.planner = new Planner();
    this.trayDims = null;
    this.velvetCache = {};
    this.mode = 'idle';
    this.restValues = [6, 6];
    this.enabled = true;
    this.dirty = true;
    this.handTarget = new THREE.Vector3(0, HOLD_Y, 0);
    this.samples = [];
    this.logoImg = null;
    this.camState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.base = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.raycaster = new THREE.Raycaster();
    this.holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOLD_Y);
    this.perf = { frames: 0, time: 0, warm: 0 };

    if (logoUrl) {
      const img = new Image();
      img.onload = () => {
        this.logoImg = img; this.velvetCache = {};
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => { if (this.trayDims && this.mode !== 'rolling') this.buildTray(this.trayDims.aspectClass, true); });
      };
      img.src = logoUrl;
    }

    this.bindPointer();
    this.clock = new THREE.Clock();
    this.visible = true;
    document.addEventListener('visibilitychange', () => { this.clock.getDelta(); this.dirty = true; });
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, data) { (this.listeners[ev] || []).forEach((fn) => fn(data)); }

  /* ------------------------------------------------------------- mounting */
  mount(host) {
    if (this.host === host) return;
    this.host = host;
    host.appendChild(this.canvas);
    if (this.ro) this.ro.disconnect();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    if (this.io) this.io.disconnect();
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; this.dirty = true; }, { threshold: 0 });
    this.io.observe(host);
    this.resize();
  }

  resize() {
    if (!this.host) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    if (this.size && this.size.w === w && this.size.h === h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    const aspect = w / h;
    const cls = aspect < 0.85 ? 'portrait' : aspect < 1.3 ? 'square' : 'wide';
    const busy = this.mode === 'rolling' || this.mode === 'hold' || this.mode === 'launch';
    if (!this.trayDims || (this.trayDims.aspectClass !== cls && !busy)) this.buildTray(cls);
    this.fitCamera(true);
    this.dirty = true;
  }

  buildTray(cls, keepDice) {
    const dims = cls === 'portrait' ? { w: 5.4, d: 7.0 } : cls === 'square' ? { w: 7, d: 6 } : { w: 9.2, d: 5.6 };
    dims.aspectClass = cls;
    if (this.tray) { this.scene.remove(this.tray); this.tray.traverse((o) => { o.geometry && o.geometry.dispose(); }); }
    this.trayDims = dims;
    const g = this.tray = new THREE.Group();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const vt = this.velvetCache[cls] ||= velvetTextures(dims.w, dims.d, this.logoImg, aniso, this.quality === 'high' ? 1024 : 640);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(dims.w, dims.d), new THREE.MeshStandardMaterial({
      map: vt.map, bumpMap: vt.bump, bumpScale: 1.2, roughness: 0.95, metalness: 0, color: 0x9a9088, envMapIntensity: 0.25
    }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);

    const t = 0.26;
    const rr = (s, w, d, rad) => {
      const x = -w / 2, y = -d / 2;
      s.moveTo(x + rad, y); s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad);
      s.lineTo(x + w, y + d - rad); s.quadraticCurveTo(x + w, y + d, x + w - rad, y + d);
      s.lineTo(x + rad, y + d); s.quadraticCurveTo(x, y + d, x, y + d - rad); s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
      return s;
    };
    const outer = rr(new THREE.Shape(), dims.w + t * 2, dims.d + t * 2, 0.6);
    outer.holes.push(rr(new THREE.Path(), dims.w, dims.d, 0.28));
    const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 4, curveSegments: 14 });
    this.frameMat ||= new THREE.MeshStandardMaterial({ color: 0xe6c88e, metalness: 1, roughness: 0.22, envMapIntensity: 1.0 });
    const frame = new THREE.Mesh(frameGeo, this.frameMat);
    frame.rotation.x = -Math.PI / 2; frame.position.y = -0.02; frame.castShadow = true; frame.receiveShadow = true; g.add(frame);

    this.plinthMat ||= new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.35, metalness: 0.1, envMapIntensity: 0.6 });
    const plinth = new THREE.Mesh(new RoundedBoxGeometry(dims.w + t * 2 + 0.3, 0.5, dims.d + t * 2 + 0.3, 3, 0.18), this.plinthMat);
    plinth.position.y = -0.27; plinth.receiveShadow = true; g.add(plinth);
    this.scene.add(g);

    this.key.position.set(dims.w * 0.18, 12.5, dims.d * 0.32);
    this.key.target.position.set(0, 0, -0.2);

    if (!keepDice && this.mode !== 'result') this.rest(this.restValues, false);
    this.fitCamera(true);
    this.dirty = true;
  }

  /* ------------------------------------------------------------- camera */
  fitCamera(snap) {
    if (!this.trayDims) return;
    const cam = this.camera, { w, d } = this.trayDims;
    const elev = THREE.MathUtils.degToRad(this.trayDims.aspectClass === 'wide' ? 50 : 58);
    const target = new THREE.Vector3(0, 0, 0.15);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const hw = w / 2 + 0.55, hd = d / 2 + 0.55;
    const pts = [];
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => { pts.push(new THREE.Vector3(sx * hw, 0.5, sz * hd), new THREE.Vector3(sx * hw, -0.5, sz * hd)); }));
    cam.updateProjectionMatrix();
    let lo = 4, hi = 80;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, mid); cam.lookAt(target); cam.updateMatrixWorld();
      const fits = pts.every((p) => { const q = _v.copy(p).project(cam); return Math.abs(q.x) < 0.97 && Math.abs(q.y) < 0.93; });
      if (fits) hi = mid; else lo = mid;
    }
    this.base.pos.copy(target).addScaledVector(dir, hi);
    this.base.target.copy(target);
    this.baseDir = dir; this.baseDist = hi;
    if (this.mode === 'result') { this.revealCamera(this.finalPositions(), snap); return; }
    if (this.mode !== 'rolling') { this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target); }
    if (snap) { this.camState.pos.copy(this.camGoal.pos); this.camState.target.copy(this.camGoal.target); }
  }

  finalPositions() { return this.dice.map((d) => d.outer.position.clone()); }

  /** Camera that frames both resting dice from a little higher. Writes into camGoal (or `out`). */
  revealCamera(positions, snap, out = this.camGoal) {
    const c = new THREE.Vector3();
    positions.forEach((p) => c.add(p)); c.multiplyScalar(0.5 * 0.55); c.y = 0.35;   // lean toward the dice, keep the tray in view
    const elev = THREE.MathUtils.degToRad(64);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const pts = [];
    positions.forEach((p) => { [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [0, 1.1].forEach((y) => pts.push(new THREE.Vector3(p.x + sx * 1.05, y, p.z + sz * 1.05))))); });
    const cam = this.camera.clone(); cam.updateProjectionMatrix();
    let lo = 3, hi = 60;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(c).addScaledVector(dir, mid); cam.lookAt(c); cam.updateMatrixWorld();
      if (pts.every((p) => { const q = _v.copy(p).project(cam); return Math.abs(q.x) < 0.6 && Math.abs(q.y) < 0.6; })) hi = mid; else lo = mid;
    }
    const dist = THREE.MathUtils.clamp(hi * 1.12, this.baseDist * 0.72, this.baseDist * 1.02);
    out.target.copy(c);
    out.pos.copy(c).addScaledVector(dir, dist);
    if (snap || this.reduced) { this.camState.pos.copy(out.pos); this.camState.target.copy(out.target); }
    this.dirty = true;
    return out;
  }

  /* ------------------------------------------------------------- resting states */
  restPos(i) {
    const { d } = this.trayDims;
    return new THREE.Vector3(i ? 0.85 : -0.85, 0.5, Math.min(d * 0.16, 1.2) + (i ? 0.14 : -0.1));
  }

  faceUpQuat(value, yaw) {
    return new THREE.Quaternion().setFromAxisAngle(UP, yaw).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normalOf(value)), UP));
  }

  /** Dice resting in the tray showing `values`. */
  rest(values = this.restValues, animated = false) {
    this.restValues = values;
    this.mode = 'idle'; this.play = null; this.hold = null; this.launch = null; this.prePlan = null;
    if (!this.trayDims) return;
    this.dice.forEach((die, i) => {
      // fold any face relabelling into the outer pose so nothing visibly jumps
      die.outer.quaternion.multiply(die.inner.quaternion); die.inner.quaternion.identity();
      this.tweenDie(die, this.restPos(i), this.faceUpQuat(values[i], i ? 0.32 : -0.24), animated ? 0.7 : 0);
    });
    this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target);
    this.dirty = true;
  }
  setMode() { this.rest(this.restValues, true); }

  /** Static final display (restored results). */
  showResult(values) {
    this.mode = 'result'; this.play = null; this.hold = null; this.launch = null;
    if (!this.trayDims) return;
    const pos = [new THREE.Vector3(-0.78, 0.5, 0.2), new THREE.Vector3(0.78, 0.5, 0.2)];
    this.dice.forEach((die, i) => {
      die.inner.quaternion.identity();
      this.tweenDie(die, pos[i], this.faceUpQuat(values[i], i ? 0.28 : -0.22), 0);
    });
    this.revealCamera(pos, true);
  }

  tweenDie(die, pos, quat, dur) {
    if (!dur) { die.outer.position.copy(pos); if (quat) die.outer.quaternion.copy(quat); die.tween = null; this.dirty = true; return; }
    die.tween = { from: { p: die.outer.position.clone(), q: die.outer.quaternion.clone() }, to: { p: pos.clone(), q: quat ? quat.clone() : null }, t: 0, dur };
  }

  /* ------------------------------------------------------------- hold (dice in the hand) */
  clampHand(v) {
    const { w, d } = this.trayDims;
    v.x = THREE.MathUtils.clamp(v.x, -w / 2 + 1.3, w / 2 - 1.3);
    v.z = THREE.MathUtils.clamp(v.z, -d / 2 + 0.95, d / 2 - 0.9);
    v.y = HOLD_Y;
    return v;
  }

  /**
   * Pick the dice up. kind: 'auto' (button: procedural shake), 'shake' (driven by the phone's
   * accelerometer via shakeInput) or 'drag' (follows the pointer).
   */
  beginHold(kind = 'auto') {
    if (!this.trayDims) return;
    this.mode = 'hold';
    this.hold = { kind, t: 0, offset: new THREE.Vector3(), input: new THREE.Vector3(), prev: null, dir: new THREE.Vector3(), peak: 0, lastKnock: 0, amp: kind === 'auto' ? 1 : 0.6 };
    if (kind !== 'drag') {
      this.launchHand = launchPose(this.trayDims);
      this.handTarget.set((this.launchHand[0].p[0] + this.launchHand[1].p[0]) / 2, HOLD_Y, (this.launchHand[0].p[2] + this.launchHand[1].p[2]) / 2);
      this.prePlan = this.planner.plan(this.trayDims, this.launchHand, null, 0.6);
    } else this.prePlan = null;
    this.dice.forEach((die) => {
      die.tween = null;
      die.outer.quaternion.multiply(die.inner.quaternion); die.inner.quaternion.identity();
      die.spinV.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5);
    });
    this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target);
  }

  /** Phone acceleration (m/s², gravity removed) in device axes while shaking. */
  shakeInput(ax, ay, az) {
    if (!this.hold || this.hold.kind !== 'shake') return;
    this.hold.input.set(ax, az * 0.4, -ay).multiplyScalar(0.032).clampLength(0, 0.55);
  }

  /** Drag released without a throw yet (waiting for the server): keep the dice rattling gently. */
  idleShake() {
    if (!this.hold) return;
    this.hold.kind = 'auto'; this.hold.amp = 0.55;
    this.launchHand = launchPose(this.trayDims);
    this.prePlan = this.planner.plan(this.trayDims, this.launchHand, null, 0.6);
  }

  cancelHold() { this.rest(this.restValues, true); }

  knock(strength) {
    this.emit('rattle', { strength });
    this.dice.forEach((die) => {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(5 + strength * 9);
      die.spinV.add(_v).clampLength(0, 16);
    });
  }

  updateHold(dt) {
    const H = this.hold;
    H.t += dt;
    const target = _v.set(0, 0, 0);
    if (H.kind === 'auto' && !this.reduced) {
      const f = 3.0, ph = H.t * f * Math.PI * 2, ramp = smooth(H.t / 0.3) * H.amp;
      target.set(Math.sin(ph) * 0.36, Math.abs(Math.cos(ph)) * 0.14 + 0.04, Math.sin(ph * 0.5) * 0.12).multiplyScalar(ramp);
    } else if (H.kind === 'shake') target.copy(H.input);
    H.offset.lerp(target, damp(H.kind === 'shake' ? 16 : 34, dt));

    // hand position → dice; detect direction reversals (the dice knock against each other and the palm)
    const hand = _v2.copy(this.handTarget).add(H.offset);
    if (H.prev) {
      const vel = _v3.copy(hand).sub(H.prev).divideScalar(Math.max(dt, 1e-3));
      const sp = vel.length();
      if (sp > 1.4) {
        vel.divideScalar(sp);
        if (H.dir.lengthSq() && vel.dot(H.dir) < -0.25 && H.peak > 1.6 && H.t - H.lastKnock > 0.07) { this.knock(clamp01(H.peak / 7)); H.lastKnock = H.t; H.peak = 0; }
        H.dir.copy(vel); H.peak = Math.max(H.peak, sp);
      }
      H.prev.copy(hand);
    } else H.prev = hand.clone();

    this.dice.forEach((die, i) => {
      const goal = _v3.copy(hand).add(HAND_OFFSETS[i]);
      die.outer.position.lerp(goal, damp(i ? 15 : 20, dt));
      const mag = die.spinV.length();
      die.spinV.multiplyScalar(Math.exp(-(H.kind === 'drag' ? 2.5 : 1.4) * dt));
      if (mag > 1e-4) {
        _q.setFromAxisAngle(_v.copy(die.spinV).divideScalar(mag), mag * dt);
        die.outer.quaternion.premultiply(_q).normalize();
      }
    });
  }

  /* ------------------------------------------------------------- throw */
  /**
   * Throw the dice so they land on `values` ([d1, d2]). With `velocity` ([vx, vz]) the dice are
   * flung from where they are (pointer flick); otherwise they are thrown from the hand.
   * Resolves once the dice have settled.
   */
  throwTo(values, { velocity = null } = {}) {
    return new Promise((resolve) => {
      if (!this.trayDims) { resolve(); return; }
      if (this.mode !== 'hold') this.beginHold('auto');
      const L = this.launch = { values, resolve, t: 0, plan: null, flick: null };
      if (velocity && !this.reduced) {
        // keep moving with the flick while the trajectory is computed, then hand over to physics
        const { w, d } = this.trayDims;
        const lead = 0.16;
        const from = this.dice.map((die) => die.outer.position.clone());
        const to = from.map((p) => new THREE.Vector3(
          THREE.MathUtils.clamp(p.x + velocity[0] * lead, -w / 2 + 0.8, w / 2 - 0.8),
          Math.max(1.2, p.y - 0.25),
          THREE.MathUtils.clamp(p.z + velocity[1] * lead, -d / 2 + 0.8, d / 2 - 0.8)));
        L.flick = { from, to, dur: lead };
        this.mode = 'launch';
        this.planner.plan(this.trayDims, to.map((p, i) => ({ p: p.toArray(), q: this.dice[i].outer.quaternion.toArray() })), velocity, 0.6).then((plan) => this.onPlan(plan));
      } else {
        (this.prePlan || this.planner.plan(this.trayDims, this.launchHand = launchPose(this.trayDims), null, 0.6)).then((plan) => this.onPlan(plan));
      }
    });
  }

  onPlan(plan) {
    const L = this.launch;
    if (!L || L.plan) return;
    if (!plan) { this.showResult(L.values); this.emit('settled'); setTimeout(L.resolve, 300); this.launch = null; return; }
    L.plan = plan;
    // Relabel faces (a cube symmetry R on the inner mesh) so the physically-up face shows the
    // official value, and pre-multiply the outer pose by R⁻¹ so the dice do not visibly change.
    this.dice.forEach((die, i) => {
      const a = new THREE.Vector3(...FACE_NORMALS[plan.finals[i].axis]);
      const n = new THREE.Vector3(...normalOf(L.values[i]));
      const R = new THREE.Quaternion().setFromUnitVectors(n, a);
      die.outer.quaternion.multiply(die.inner.quaternion).multiply(R.clone().invert());
      die.inner.quaternion.copy(R);
      die.tween = null;
    });
    L.t0 = L.t;
    L.from = this.dice.map((die) => die.outer.position.clone());
    L.qFrom = this.dice.map((die) => die.outer.quaternion.clone());
    L.start = plan.start.map((s) => ({ p: new THREE.Vector3(...s.p), q: new THREE.Quaternion(...s.q), v: new THREE.Vector3(...s.v) }));
    if (!L.flick) {
      // gather into a short back-swing, then accelerate into the release so velocity is continuous
      L.tg = this.reduced ? 0.05 : 0.3; L.tl = this.reduced ? 0.05 : 0.2;
      L.back = L.start.map((s) => s.p.clone().addScaledVector(s.v, -L.tl / 2));
      this.mode = 'launch';
    } else {
      L.qDur = Math.max(0.08, L.flick.dur - L.t);
    }
  }

  updateLaunch(dt) {
    const L = this.launch;
    L.t += dt;
    if (L.flick) {
      const F = L.flick, k = clamp01(L.t / F.dur);
      this.dice.forEach((die, i) => die.outer.position.lerpVectors(F.from[i], F.to[i], k));
      if (!L.plan) {
        this.dice.forEach((die) => { const m = die.spinV.length(); if (m > 1e-4) { _q.setFromAxisAngle(_v.copy(die.spinV).divideScalar(m), m * dt); die.outer.quaternion.premultiply(_q); } });
        return;
      }
      const w = smooth((L.t - L.t0) / L.qDur);
      this.dice.forEach((die, i) => die.outer.quaternion.slerpQuaternions(L.qFrom[i], L.start[i].q, w));
      if (k >= 1 && w >= 1) this.startPlayback();
      return;
    }
    if (!L.plan) { this.updateHold(dt); return; }
    const t = L.t - L.t0, total = L.tg + L.tl;
    this.dice.forEach((die, i) => {
      if (t < L.tg) die.outer.position.lerpVectors(L.from[i], L.back[i], easeInOut(t / L.tg));
      else { const k = clamp01((t - L.tg) / L.tl); die.outer.position.lerpVectors(L.back[i], L.start[i].p, k * k); }
      die.outer.quaternion.slerpQuaternions(L.qFrom[i], L.start[i].q, smooth(t / total));
    });
    if (t >= total) this.startPlayback();
  }

  startPlayback() {
    const L = this.launch, plan = L.plan;
    this.launch = null; this.hold = null; this.prePlan = null;
    const { frames, frameCount } = plan;
    // rolling-noise level per frame: dice moving while in contact with the felt
    const roll = new Float32Array(frameCount);
    for (let f = 1; f < frameCount; f++) {
      let lvl = 0;
      for (const fr of frames) {
        const a = fr[f], b = fr[f - 1];
        if (a[1] > 0.66) continue;
        const sp = Math.hypot(a[0] - b[0], a[2] - b[2]) * 60;
        const dq = Math.abs(a[3] - b[3]) + Math.abs(a[4] - b[4]) + Math.abs(a[5] - b[5]) + Math.abs(a[6] - b[6]);
        lvl += Math.min(1, sp / 7 + dq * 6);
      }
      roll[f] = Math.min(1, lvl / 1.4);
    }
    const finals = frames.map((fr) => new THREE.Vector3(fr[frameCount - 1][0], fr[frameCount - 1][1], fr[frameCount - 1][2]));
    const reveal = this.revealCamera(finals, false, { pos: new THREE.Vector3(), target: new THREE.Vector3() });
    this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target);
    this.play = { plan, t: 0, fired: 0, resolve: L.resolve, done: false, roll, reveal, centroid: new THREE.Vector3(0, 0.3, 0), lastRoll: -1 };
    this.mode = 'rolling';
    this.perf.warm = 0;
    this.emit('throw', plan);
  }

  updatePlayback(dt) {
    const P = this.play, { frames, events, settleFrame, frameCount } = P.plan;
    // real-time tumble, then ease into slow motion for the final topple
    const slowStart = settleFrame - 54;
    const speed = this.reduced ? 1.6 : 1 - 0.52 * smooth((P.t - slowStart) / 34);
    P.t = Math.min(frameCount - 1, P.t + dt * 60 * speed);
    const f0 = Math.floor(P.t), a = P.t - f0, f1 = Math.min(frameCount - 1, f0 + 1);
    const centroid = _v2.set(0, 0, 0);
    this.dice.forEach((die, i) => {
      const A = frames[i][f0], B = frames[i][f1];
      die.outer.position.set(A[0] + (B[0] - A[0]) * a, A[1] + (B[1] - A[1]) * a, A[2] + (B[2] - A[2]) * a);
      die.outer.quaternion.set(A[3], A[4], A[5], A[6]).slerp(_q.set(B[3], B[4], B[5], B[6]), a);
      centroid.add(die.outer.position);
    });
    centroid.multiplyScalar(0.5);
    while (P.fired < events.length && events[P.fired].frame <= P.t) this.emit('impact', events[P.fired++]);
    const lvl = P.roll[f0] + (P.roll[f1] - P.roll[f0]) * a;
    if (Math.abs(lvl - P.lastRoll) > 0.02) { P.lastRoll = lvl; this.emit('roll', { level: lvl * Math.min(1, speed * 1.1) }); }

    // camera: a calm, low-passed follow, then a slow push-in onto the final resting place
    P.centroid.lerp(centroid, damp(2.2, dt));
    const w = smooth((P.t - (settleFrame - 80)) / 80);
    _v.copy(this.base.target).lerp(_v3.copy(P.centroid).setY(0.25), 0.22);
    this.camGoal.target.copy(_v).lerp(P.reveal.target, w);
    _v.addScaledVector(this.baseDir, this.baseDist);
    this.camGoal.pos.copy(_v).lerp(P.reveal.pos, w);

    if (P.t >= frameCount - 1 && !P.done) {
      P.done = true;
      this.mode = 'result';
      this.camGoal.pos.copy(P.reveal.pos); this.camGoal.target.copy(P.reveal.target);
      this.emit('roll', { level: 0 });
      this.emit('settled');
      setTimeout(P.resolve, this.reduced ? 100 : 650);
    }
  }

  /* ------------------------------------------------------------- pointer */
  bindPointer() {
    const c = this.canvas;
    const ndc = new THREE.Vector2();
    const worldAt = (e) => {
      const r = c.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const v = new THREE.Vector3();
      return this.raycaster.ray.intersectPlane(this.holdPlane, v) ? this.clampHand(v) : null;
    };
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.mode !== 'idle' || !this.trayDims) return;
      const p = worldAt(e); if (!p) return;
      c.setPointerCapture(e.pointerId);
      this.beginHold('drag');
      this.handTarget.copy(p);
      this.grab = { moved: 0 };
      this.samples = [{ t: performance.now(), p: p.clone() }];
      this.emit('grab');
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.grab || this.mode !== 'hold') return;
      const p = worldAt(e); if (!p) return;
      this.grab.moved += p.distanceTo(this.handTarget);
      this.handTarget.copy(p);
      const now = performance.now();
      this.samples.push({ t: now, p });
      while (this.samples.length > 2 && now - this.samples[0].t > 100) this.samples.shift();
    });
    const up = () => {
      if (!this.grab) return;
      const g = this.grab; this.grab = null;
      const s = this.samples, now = performance.now();
      let vel = null;
      if (s.length >= 2 && g.moved > 0.35) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
        const vx = (b.p.x - a.p.x) / dt, vz = (b.p.z - a.p.z) / dt;
        if (Math.hypot(vx, vz) > 2.5 && now - b.t < 120) vel = [vx * 0.9, vz * 0.9];
      }
      this.emit('release', { velocity: vel });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  /* ------------------------------------------------------------- frame loop (renders only when something changes) */
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (!this.visible || document.hidden || !this.trayDims || !this.host) return;
    const active = this.update(dt);
    if (active || this.dirty) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
      if (active) this.adapt(dt);
    }
  }

  /** Lower the resolution once if the device cannot keep up during animation. */
  adapt(dt) {
    const P = this.perf;
    if (++P.warm < 12) return;
    P.frames++; P.time += dt;
    if (P.frames >= 40) {
      const avg = P.time / P.frames;
      P.frames = 0; P.time = 0;
      if (avg > 0.024 && this.dpr > 1) {
        this.dpr = Math.max(1, this.dpr - 0.25);
        this.renderer.setPixelRatio(this.dpr);
        if (this.size) this.renderer.setSize(this.size.w, this.size.h, false);
        if (this.dpr <= 1.25) this.key.shadow.mapSize.set(512, 512);
      }
    }
  }

  update(dt) {
    let active = false;
    this.dice.forEach((die) => {
      if (!die.tween) return;
      active = true;
      const tw = die.tween; tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = easeInOut(tw.t);
      die.outer.position.lerpVectors(tw.from.p, tw.to.p, k);
      if (tw.to.q) die.outer.quaternion.slerpQuaternions(tw.from.q, tw.to.q, k);
      if (tw.t >= 1) die.tween = null;
    });

    if (this.mode === 'hold' && this.hold) { this.updateHold(dt); active = true; }
    else if (this.mode === 'launch' && this.launch) { this.updateLaunch(dt); active = true; }
    else if (this.mode === 'rolling' && this.play) { this.updatePlayback(dt); active = true; }

    if (active) {
      this.dice.forEach((die) => {
        const p = die.outer.position;
        die.blob.position.set(p.x, 0.004, p.z);
        const s = 1.5 + Math.max(0, p.y - 0.5) * 0.45; die.blob.scale.set(s, s, s);
        die.blob.material.opacity = THREE.MathUtils.clamp(0.5 - (p.y - 0.5) * 0.22, 0.06, 0.5);
      });
    } else if (this.dirty) {
      this.dice.forEach((die) => { const p = die.outer.position; die.blob.position.set(p.x, 0.004, p.z); die.blob.scale.setScalar(1.5); die.blob.material.opacity = 0.5; });
    }

    // camera (critically damped follow toward its goal)
    const cs = this.camState, cg = this.camGoal;
    const moving = cs.pos.distanceToSquared(cg.pos) > 1e-6 || cs.target.distanceToSquared(cg.target) > 1e-6;
    if (moving) {
      const k = damp(this.mode === 'result' ? 2.4 : 3.2, dt);
      cs.pos.lerp(cg.pos, k); cs.target.lerp(cg.target, k);
      active = true;
    }
    this.camera.position.copy(cs.pos);
    this.camera.lookAt(cs.target);
    return active;
  }

  setEnabled(v) { this.enabled = v; }
}
