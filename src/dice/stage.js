import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { planThrow, normalOf, FACE_VALUES, FACE_NORMALS } from './physics.js';
import { faceTextures, velvetTextures, glowSprite, contactShadow } from './textures.js';

const HOLD_Y = 1.75;
const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Jeweller's lightbox: black room with warm softboxes → deep, contrasty gold reflections. */
function studioEnvironment() {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.BackSide })));
  const panel = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); env.add(m);
  };
  panel(20, 10, 0xfff1dc, 2.4, [0, 16, 3], [0, 0, 0]);
  panel(30, 30, 0x2a1d0e, 1.0, [0, 22, 0], [0, 0, 0]);        // warm ceiling wash        // overhead softbox
  panel(5, 12, 0xffe2b0, 1.6, [-15, 5, 4], [0, 0, 0]);        // left strip
  panel(5, 12, 0xfff6e6, 1.25, [15, 6, -3], [0, 0, 0]);       // right strip
  panel(18, 3, 0xffd9a0, 0.9, [0, 3, -16], [0, 0, 0]);        // back rim
  panel(12, 3, 0xfff3df, 0.55, [0, 6, 15], [0, 0, 0]);        // front softbox (lifts camera-facing tops)       // front kicker
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

export class DiceStage {
  constructor({ quality = 'high', reducedMotion = false, logoUrl } = {}) {
    this.quality = quality;
    this.reduced = reducedMotion;
    this.listeners = {};
    const hi = quality === 'high';

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, hi ? 2 : 1.5));
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.18;
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

    // ---- lighting: warm key spot (shadows), cool-warm rim, gentle fill
    const key = this.key = new THREE.SpotLight(0xfff0d6, 420, 0, 0.5, 0.85, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.025; key.shadow.radius = 5;
    key.shadow.camera.near = 4; key.shadow.camera.far = 30;
    scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0xffd8a0, 1.6); rim.position.set(-6, 3.2, -7); scene.add(rim);
    const rim2 = new THREE.DirectionalLight(0xfff4e0, 0.7); rim2.position.set(7, 2.5, -3); scene.add(rim2);
    scene.add(new THREE.HemisphereLight(0xfff3e0, 0x150f08, 0.12));

    // ---- dice
    const texSize = hi ? 512 : 256;
    const aniso = Math.min(8, r.capabilities.getMaxAnisotropy());
    this.dieMaterials = FACE_VALUES.map((v) => {
      const t = faceTextures(v, texSize, aniso);
      return new THREE.MeshPhysicalMaterial({
        color: 0xf4d8a2, map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1.15, 1.15),
        roughnessMap: t.rmMap, metalnessMap: t.rmMap, roughness: 1, metalness: 1,
        clearcoat: hi ? 0.3 : 0, clearcoatRoughness: 0.1, envMapIntensity: 1.0
      });
    });
    const geo = new RoundedBoxGeometry(1, 1, 1, hi ? 6 : 4, 0.12);
    const blobTex = contactShadow();
    this.dice = [0, 1].map((i) => {
      const outer = new THREE.Group();
      const inner = new THREE.Mesh(geo, this.dieMaterials);
      inner.castShadow = true; inner.receiveShadow = true;
      outer.add(inner); scene.add(outer);
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.5 }));
      blob.rotation.x = -Math.PI / 2; blob.renderOrder = 1; scene.add(blob);
      return { outer, inner, blob, spin: new THREE.Vector3(0.3 + i * 0.1, 0.55 - i * 0.2, 0.15), hold: new THREE.Vector3() };
    });

    // ---- particles
    this.particles = null;
    this.particleCount = hi ? 110 : 45;
    this.glow = glowSprite();

    // ---- state
    this.trayDims = null;
    this.mode = 'showcase';
    this.time = 0;
    this.shake = 0;
    this.handTarget = new THREE.Vector3(0, HOLD_Y, 0);
    this.samples = [];
    this.enabled = true;
    this.logoImg = null;
    this.camState = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.camGoal = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.base = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
    this.raycaster = new THREE.Raycaster();
    this.holdPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOLD_Y);

    if (logoUrl) {
      const img = new Image();
      img.onload = () => { this.logoImg = img; (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => this.trayDims && this.buildTray(this.trayDims.aspectClass, true)); };
      img.src = logoUrl;
    }

    this.bindPointer();
    this.clock = new THREE.Clock();
    this.visible = true;
    document.addEventListener('visibilitychange', () => { this.clock.getDelta(); });
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
    this.io = new IntersectionObserver((e) => { this.visible = e[0].isIntersecting; }, { threshold: 0 });
    this.io.observe(host);
    this.resize();
  }

  resize() {
    if (!this.host) return;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%'; this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    const aspect = w / h;
    const cls = aspect < 0.85 ? 'portrait' : aspect < 1.3 ? 'square' : 'wide';
    if (!this.trayDims || (this.trayDims.aspectClass !== cls && this.mode !== 'rolling' && this.mode !== 'hold')) this.buildTray(cls);
    this.fitCamera(true);
  }

  buildTray(cls, keepDice) {
    const dims = cls === 'portrait' ? { w: 5.4, d: 7.0 } : cls === 'square' ? { w: 7, d: 6 } : { w: 9.2, d: 5.6 };
    dims.aspectClass = cls;
    if (this.tray) { this.scene.remove(this.tray); this.tray.traverse((o) => { o.geometry && o.geometry.dispose(); }); }
    this.trayDims = dims;
    const g = this.tray = new THREE.Group();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const vt = velvetTextures(dims.w, dims.d, this.logoImg, aniso);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(dims.w, dims.d), new THREE.MeshPhysicalMaterial({
      map: vt.map, bumpMap: vt.bump, bumpScale: 1.2, roughness: 0.94, metalness: 0,
      color: 0x9a9088, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x3a2a16), envMapIntensity: 0.25
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
    const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 5, curveSegments: 20 });
    const gold = new THREE.MeshPhysicalMaterial({ color: 0xe6c88e, metalness: 1, roughness: 0.2, clearcoat: 0.25, clearcoatRoughness: 0.15, envMapIntensity: 1.0 });
    const frame = new THREE.Mesh(frameGeo, gold);
    frame.rotation.x = -Math.PI / 2; frame.position.y = -0.02; frame.castShadow = true; frame.receiveShadow = true; g.add(frame);

    const plinth = new THREE.Mesh(new RoundedBoxGeometry(dims.w + t * 2 + 0.3, 0.5, dims.d + t * 2 + 0.3, 4, 0.18),
      new THREE.MeshPhysicalMaterial({ color: 0x050505, roughness: 0.4, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.6 }));
    plinth.position.y = -0.27; plinth.receiveShadow = true; g.add(plinth);
    this.scene.add(g);

    // key light & shadow frustum
    this.key.position.set(dims.w * 0.18, 12.5, dims.d * 0.32);
    this.key.target.position.set(0, 0, -0.2);

    this.buildParticles();
    if (!keepDice) this.placeForMode();
    this.fitCamera(true);
  }

  buildParticles() {
    if (this.particles) { this.scene.remove(this.particles); this.particles.geometry.dispose(); }
    const n = this.particleCount, { w, d } = this.trayDims;
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * (w + 2); pos[i * 3 + 1] = Math.random() * 4.2 + 0.2; pos[i * 3 + 2] = (Math.random() - 0.5) * (d + 2);
      vel[i * 3] = (Math.random() - 0.5) * 0.05; vel[i * 3 + 1] = 0.05 + Math.random() * 0.12; vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.pVel = vel;
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.07, map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffd894, opacity: 0.85, sizeAttenuation: true
    }));
    this.scene.add(this.particles);
  }

  /* ------------------------------------------------------------- camera */
  fitCamera(snap) {
    if (!this.trayDims) return;
    const cam = this.camera, { w, d } = this.trayDims;
    const elev = THREE.MathUtils.degToRad(this.trayDims.aspectClass === 'wide' ? 50 : 58);
    const target = new THREE.Vector3(0, 0, 0.15);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    const hw = w / 2 + 0.6, hd = d / 2 + 0.6;
    const pts = [];
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => { pts.push(new THREE.Vector3(sx * hw, 0.5, sz * hd), new THREE.Vector3(sx * hw, -0.5, sz * hd)); }));
    cam.updateProjectionMatrix();
    let lo = 4, hi = 80;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(target).addScaledVector(dir, mid); cam.lookAt(target); cam.updateMatrixWorld();
      const fits = pts.every((p) => { const q = p.clone().project(cam); return Math.abs(q.x) < 0.97 && Math.abs(q.y) < 0.93; });
      if (fits) hi = mid; else lo = mid;
    }
    this.base.pos.copy(target).addScaledVector(dir, hi);
    this.base.target.copy(target);
    this.baseDir = dir; this.baseDist = hi;
    if (this.mode === 'result') { this.revealCamera(!this.camInit); this.camInit = true; return; }
    if (snap || !this.camInit) {
      this.camState.pos.copy(this.base.pos); this.camState.target.copy(this.base.target);
      this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target);
      this.camInit = true;
    }
  }

  /* ------------------------------------------------------------- modes */
  setMode(mode) {
    this.mode = mode;
    this.placeForMode(true);
  }

  restPose(i) {
    const { d } = this.trayDims;
    return new THREE.Vector3(i ? 0.82 : -0.82, 0.5, Math.min(d * 0.22, 1.6) + (i ? 0.12 : -0.1));
  }

  placeForMode(animated) {
    if (!this.trayDims) return;
    const m = this.mode;
    if (m === 'showcase') {
      this.dice.forEach((die, i) => {
        const goal = new THREE.Vector3(i ? 0.92 : -0.92, 1.45, 0.25);
        this.tweenDie(die, goal, null, animated ? 0.7 : 0);
      });
    } else if (m === 'idle') {
      this.dice.forEach((die, i) => {
        const q = new THREE.Quaternion().setFromAxisAngle(UP, (i ? 0.35 : -0.25));
        die.inner.quaternion.identity();
        const faceUp = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normalOf(i ? 5 : 3)), UP);
        this.tweenDie(die, this.restPose(i), q.multiply(faceUp), animated ? 0.75 : 0);
      });
      this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target);
    }
  }

  tweenDie(die, pos, quat, dur) {
    const from = { p: die.outer.position.clone(), q: die.outer.quaternion.clone() };
    if (!dur) { die.outer.position.copy(pos); if (quat) die.outer.quaternion.copy(quat); die.tween = null; return; }
    die.tween = { from, to: { p: pos.clone(), q: quat ? quat.clone() : null }, t: 0, dur };
  }

  /** Static final display (restored results). */
  showResult(values) {
    this.mode = 'result';
    this.dice.forEach((die, i) => {
      die.inner.quaternion.identity();
      const yaw = new THREE.Quaternion().setFromAxisAngle(UP, (i ? 0.28 : -0.22));
      const q = yaw.multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normalOf(values[i])), UP));
      this.tweenDie(die, new THREE.Vector3(i ? 0.78 : -0.78, 0.5, 0.2), q, 0);
    });
    this.revealCamera(true);
  }

  revealCamera(snap) {
    const c = new THREE.Vector3();
    this.dice.forEach((d) => c.add(d.outer.position)); c.multiplyScalar(0.5); c.y = 0.35;
    const elev = THREE.MathUtils.degToRad(66);
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev));
    // fit both dice (with breathing room) inside ~62% of the frame, whatever its aspect ratio
    const pts = [];
    this.dice.forEach((d) => { const p = d.outer.position; [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => [0, 1.1].forEach((y) => pts.push(new THREE.Vector3(p.x + sx * 1.05, y, p.z + sz * 1.05))))); });
    const cam = this.camera.clone(); cam.updateProjectionMatrix();
    let lo = 3, hi = 60;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(c).addScaledVector(dir, mid); cam.lookAt(c); cam.updateMatrixWorld();
      if (pts.every((p) => { const q = p.clone().project(cam); return Math.abs(q.x) < 0.62 && Math.abs(q.y) < 0.62; })) hi = mid; else lo = mid;
    }
    const dist = Math.min(hi, this.baseDist * 1.05);
    this.camGoal.target.copy(c);
    this.camGoal.pos.copy(c).addScaledVector(dir, dist);
    if (snap || this.reduced) { this.camState.pos.copy(this.camGoal.pos); this.camState.target.copy(this.camGoal.target); }
  }

  resetCamera() { this.camGoal.pos.copy(this.base.pos); this.camGoal.target.copy(this.base.target); }

  /* ------------------------------------------------------------- hold & throw */
  clampHand(v) {
    const { w, d } = this.trayDims;
    v.x = THREE.MathUtils.clamp(v.x, -w / 2 + 1.35, w / 2 - 1.35);
    v.z = THREE.MathUtils.clamp(v.z, -d / 2 + 0.9, d / 2 - 0.9);
    v.y = HOLD_Y;
    return v;
  }

  /** Lift the dice into the "hand" and shake them (button-triggered roll). */
  beginHold(shaking = true) {
    this.mode = 'hold';
    this.shaking = shaking;
    this.releasedAt = null;
    this.handTarget.set(0, HOLD_Y, this.trayDims.d * 0.18);
    this.clampHand(this.handTarget);
    this.dice.forEach((die) => { die.tween = null; die.spinV = new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9); });
    this.resetCamera();
    this.lastRattle = 0;
  }

  cancelHold() { this.mode = 'idle'; this.placeForMode(true); }

  /** Run a validated physics throw that lands on `values` ([d1, d2]). */
  throwTo(values, velocity) {
    const hand = this.dice.map((die) => ({ p: die.outer.position.toArray(), q: die.outer.quaternion.toArray() }));
    const plan = planThrow(this.trayDims, hand, velocity);
    return new Promise((resolve) => {
      if (!plan) { this.showResult(values); resolve(); return; }
      this.dice.forEach((die, i) => {
        const a = new THREE.Vector3(...FACE_NORMALS[plan.finals[i].axis]);
        const n = new THREE.Vector3(...normalOf(values[i]));
        die.inner.quaternion.setFromUnitVectors(n, a);   // relabel faces (cube symmetry)
        die.tween = null;
      });
      this.play = { plan, t: 0, fired: 0, resolve, done: false };
      this.mode = 'rolling';
      this.emit('throw', plan);
    });
  }

  /* ------------------------------------------------------------- pointer */
  bindPointer() {
    const c = this.canvas;
    const ndc = (e) => { const r = c.getBoundingClientRect(); return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const worldAt = (e) => { this.raycaster.setFromCamera(ndc(e), this.camera); const v = new THREE.Vector3(); return this.raycaster.ray.intersectPlane(this.holdPlane, v) ? this.clampHand(v) : null; };
    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this.mode === 'showcase') { this.drag = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); return; }
      if (this.mode !== 'idle') return;
      const p = worldAt(e); if (!p) return;
      c.setPointerCapture(e.pointerId);
      this.beginHold(false);
      this.handTarget.copy(p);
      this.grab = { t0: performance.now(), start: p.clone(), moved: 0 };
      this.samples = [{ t: performance.now(), p: p.clone() }];
      this.emit('grab');
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag && this.mode === 'showcase') {
        const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y; this.drag = { x: e.clientX, y: e.clientY };
        this.dice.forEach((d) => { d.spin.y += dx * 0.012; d.spin.x += dy * 0.012; });
        return;
      }
      if (!this.grab || this.mode !== 'hold') return;
      const p = worldAt(e); if (!p) return;
      this.grab.moved += p.distanceTo(this.handTarget);
      this.handTarget.copy(p);
      const now = performance.now();
      this.samples.push({ t: now, p: p.clone() });
      while (this.samples.length > 2 && now - this.samples[0].t > 110) this.samples.shift();
    });
    const up = (e) => {
      if (this.drag) { this.drag = null; return; }
      if (!this.grab) return;
      const g = this.grab; this.grab = null;
      const s = this.samples, now = performance.now();
      let vel = null;
      if (s.length >= 2 && g.moved > 0.35) {
        const a = s[0], b = s[s.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
        const vx = (b.p.x - a.p.x) / dt, vz = (b.p.z - a.p.z) / dt;
        if (Math.hypot(vx, vz) > 2.5 && now - b.t < 120) vel = [vx * 0.9, vz * 0.9];
      }
      this.shaking = !vel;
      this.releasedAt = now;
      this.emit('release', { velocity: vel });
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
  }

  /* ------------------------------------------------------------- frame loop */
  loop() {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 1 / 20);
    if (!this.visible || document.hidden || !this.trayDims) return;
    this.time += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }

  update(dt) {
    const t = this.time;
    // tweens
    this.dice.forEach((die) => {
      if (!die.tween) return;
      const tw = die.tween; tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = easeInOut(tw.t);
      die.outer.position.lerpVectors(tw.from.p, tw.to.p, k);
      if (tw.to.q) die.outer.quaternion.slerpQuaternions(tw.from.q, tw.to.q, k);
      if (tw.t >= 1) die.tween = null;
    });

    if (this.mode === 'showcase') {
      this.dice.forEach((die, i) => {
        if (die.tween) return;
        die.spin.lerp(tmpV.set(0.32 + i * 0.12, 0.55 - i * 0.18, 0.2), damp(1.2, dt));
        tmpQ.setFromEuler(new THREE.Euler(die.spin.x * dt, die.spin.y * dt, die.spin.z * dt));
        die.outer.quaternion.premultiply(tmpQ);
        die.outer.position.y = 1.45 + Math.sin(t * 1.3 + i * 1.7) * 0.12;
      });
    } else if (this.mode === 'hold') {
      const shakeAmt = this.shaking ? 1 : 0.35;
      let fastest = 0;
      this.dice.forEach((die, i) => {
        const off = tmpV2.set(i ? 0.9 : -0.9, 0, i ? 0.08 : -0.08);
        const j = this.reduced ? 0 : shakeAmt;
        off.x += Math.sin(t * 31 + i * 2) * 0.09 * j; off.y += Math.sin(t * 27 + i) * 0.12 * j; off.z += Math.cos(t * 29 + i * 3) * 0.08 * j;
        const goal = tmpV.copy(this.handTarget).add(off);
        const before = die.outer.position.clone();
        die.outer.position.lerp(goal, damp(16, dt));
        fastest = Math.max(fastest, before.distanceTo(die.outer.position) / dt);
        die.spinV.lerp(tmpV.set(Math.sin(t * 7 + i) * 10, Math.cos(t * 6 + i * 2) * 12, Math.sin(t * 5 + i * 4) * 9).multiplyScalar(0.4 + shakeAmt * 0.6), damp(3, dt));
        tmpQ.setFromEuler(new THREE.Euler(die.spinV.x * dt, die.spinV.y * dt, die.spinV.z * dt));
        die.outer.quaternion.premultiply(tmpQ);
      });
      const interval = this.shaking ? 0.13 : 0.22;
      if ((this.shaking || fastest > 4) && t - this.lastRattle > interval * (0.7 + Math.random() * 0.6)) { this.lastRattle = t; this.emit('rattle', { strength: this.shaking ? 0.7 : 0.4 }); }
    } else if (this.mode === 'rolling' && this.play) {
      this.updatePlayback(dt);
    }

    // contact shadows
    this.dice.forEach((die) => {
      const p = die.outer.position;
      die.blob.position.set(p.x, 0.004, p.z);
      const s = 1.55 + Math.max(0, p.y - 0.5) * 0.45; die.blob.scale.set(s, s, s);
      die.blob.material.opacity = THREE.MathUtils.clamp(0.6 - (p.y - 0.5) * 0.25, 0.08, 0.6);
    });

    // particles
    if (this.particles && !this.reduced) {
      const a = this.particles.geometry.attributes.position, v = this.pVel, { w, d } = this.trayDims;
      for (let i = 0; i < a.count; i++) {
        a.array[i * 3] += v[i * 3] * dt + Math.sin(t * 0.6 + i) * 0.0012;
        a.array[i * 3 + 1] += v[i * 3 + 1] * dt;
        a.array[i * 3 + 2] += v[i * 3 + 2] * dt;
        if (a.array[i * 3 + 1] > 4.6) { a.array[i * 3 + 1] = 0.15; a.array[i * 3] = (Math.random() - 0.5) * (w + 2); a.array[i * 3 + 2] = (Math.random() - 0.5) * (d + 2); }
      }
      a.needsUpdate = true;
      this.particles.material.opacity = 0.6 + Math.sin(t * 2.1) * 0.15;
    }

    // camera
    const k = damp(this.mode === 'result' ? 2.2 : 3, dt);
    this.camState.pos.lerp(this.camGoal.pos, k);
    this.camState.target.lerp(this.camGoal.target, k);
    this.camera.position.copy(this.camState.pos);
    if (this.shake > 0.0005 && !this.reduced) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 12);
    }
    this.camera.lookAt(this.camState.target);
  }

  updatePlayback(dt) {
    const P = this.play, { frames, events, settleFrame, frameCount } = P.plan;
    const slowStart = settleFrame - 36;
    let speed = 1;
    if (!this.reduced && P.t > slowStart) speed = 1 - 0.42 * Math.min(1, (P.t - slowStart) / 18);
    P.t = Math.min(frameCount - 1, P.t + dt * 60 * speed);
    const f0 = Math.floor(P.t), a = P.t - f0, f1 = Math.min(frameCount - 1, f0 + 1);
    const centroid = tmpV2.set(0, 0, 0);
    this.dice.forEach((die, i) => {
      const A = frames[i][f0], B = frames[i][f1];
      die.outer.position.set(A[0] + (B[0] - A[0]) * a, A[1] + (B[1] - A[1]) * a, A[2] + (B[2] - A[2]) * a);
      die.outer.quaternion.set(A[3], A[4], A[5], A[6]).slerp(tmpQ.set(B[3], B[4], B[5], B[6]), a);
      centroid.add(die.outer.position);
    });
    centroid.multiplyScalar(0.5);
    while (P.fired < events.length && events[P.fired].frame <= P.t) {
      const ev = events[P.fired++];
      this.shake = Math.min(0.07, this.shake + ev.strength * 0.0035);
      this.emit('impact', ev);
    }
    // cinematic follow: drift toward the dice and push in slightly
    const follow = tmpV.copy(centroid).multiplyScalar(0.45); follow.y = 0.2;
    this.camGoal.target.copy(this.base.target).lerp(follow, 0.6);
    this.camGoal.pos.copy(this.camGoal.target).addScaledVector(this.baseDir, this.baseDist * 0.9);
    if (P.t >= frameCount - 1 && !P.done) {
      P.done = true;
      this.mode = 'result';
      this.revealCamera(false);
      this.emit('settled');
      setTimeout(P.resolve, this.reduced ? 100 : 650);
    }
  }

  setEnabled(v) { this.enabled = v; }
}
