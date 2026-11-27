/**
 * Pre-simulated dice physics.
 * A throw is simulated in full (gravity, friction, bounces, dice-to-dice and wall
 * collisions) before anything is shown. The trajectory is validated, then the dice faces
 * are "re-labelled" once (a cube symmetry on the visual mesh) so the face that physically
 * lands on top is the server's official result. Playback is the untouched physics.
 *
 * Pure module (no DOM): runs in Node tests, in a Web Worker and on the main thread.
 */
import * as CANNON from 'cannon-es';

export const DIE = 1;
export const G = 30;
export const HZ = 120;          // physics step rate
export const FPS = 60;          // recorded frame rate (every 2nd step)
// Material groups of BoxGeometry: +x, -x, +y, -y, +z, -z  → pip values (opposites sum to 7)
export const FACE_VALUES = [3, 4, 1, 6, 2, 5];
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const normalOf = (value) => FACE_NORMALS[FACE_VALUES.indexOf(value)];

// Preferred roll length (recorded frames at 60 fps). Long enough for suspense, short enough to stay lively.
const PREFER_MIN = 135, PREFER_MAX = 330, HARD_MIN = 95;
/** Rejection counters (diagnostics for tests / tuning). */
export const stats = {};
const reject = (why) => { stats[why] = (stats[why] || 0) + 1; return null; };

/** Chamfered cube: real dice have rounded edges, so they tumble and roll instead of stopping dead. */
function chamferedBox(h, c) {
  const verts = [], faces = [];
  const a = h, b = h - c;
  // 24 vertices: for each corner (sx,sy,sz) three points pulled in along each axis
  const idx = {};
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const key = `${sx}${sy}${sz}`;
    idx[key] = verts.length;
    verts.push(new CANNON.Vec3(sx * a, sy * b, sz * b), new CANNON.Vec3(sx * b, sy * a, sz * b), new CANNON.Vec3(sx * b, sy * b, sz * a));
  }
  const V = (sx, sy, sz, axis) => idx[`${sx}${sy}${sz}`] + axis;
  // 6 main faces (octagon-free: each main face is a quad of the inset points)
  const quad = (axis, s) => {
    const o = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    return o.map(([u, v]) => {
      const c3 = [0, 0, 0]; c3[axis] = s;
      const others = [0, 1, 2].filter((k) => k !== axis);
      c3[others[0]] = u; c3[others[1]] = v;
      return V(c3[0], c3[1], c3[2], axis);
    });
  };
  for (let axis = 0; axis < 3; axis++) for (const s of [-1, 1]) faces.push(quad(axis, s));
  // 12 edge faces (quads) between adjacent main faces
  for (let a1 = 0; a1 < 3; a1++) for (let a2 = a1 + 1; a2 < 3; a2++) {
    const a3 = 3 - a1 - a2;
    for (const s1 of [-1, 1]) for (const s2 of [-1, 1]) {
      const pt = (s3, ax) => { const c3 = [0, 0, 0]; c3[a1] = s1; c3[a2] = s2; c3[a3] = s3; return V(c3[0], c3[1], c3[2], ax); };
      faces.push([pt(-1, a1), pt(1, a1), pt(1, a2), pt(-1, a2)]);
    }
  }
  // 8 corner triangles
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) faces.push([V(sx, sy, sz, 0), V(sx, sy, sz, 1), V(sx, sy, sz, 2)]);
  // orient every face outward (CCW seen from outside)
  const centroid = (f) => f.reduce((acc, i) => acc.vadd(verts[i]), new CANNON.Vec3()).scale(1 / f.length);
  faces.forEach((f, k) => {
    const p0 = verts[f[0]], p1 = verts[f[1]], p2 = verts[f[2]];
    const n = p1.vsub(p0).cross(p2.vsub(p0));
    if (n.dot(centroid(f)) < 0) faces[k] = f.slice().reverse();
  });
  return new CANNON.ConvexPolyhedron({ vertices: verts, faces });
}

let dieShape = null;
function buildWorld(tray) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
  world.allowSleep = true;
  world.solver.iterations = 14;
  world.broadphase = new CANNON.NaiveBroadphase();
  const mDie = new CANNON.Material('die'), mFloor = new CANNON.Material('floor'), mWall = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mFloor, { friction: 0.27, restitution: 0.32 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mWall, { friction: 0.08, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mDie, { friction: 0.14, restitution: 0.45 }));

  const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const hw = tray.w / 2, hd = tray.d / 2;
  const walls = [[-hw, 0, Math.PI / 2], [hw, 0, -Math.PI / 2], [0, -hd, 0], [0, hd, Math.PI]].map(([x, z, ry]) => {
    const b = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Plane() });
    b.position.set(x, 0, z); b.quaternion.setFromEuler(0, ry, 0);
    world.addBody(b); return b;
  });
  dieShape ||= chamferedBox(DIE / 2, 0.1);
  const dice = [0, 1].map(() => {
    const b = new CANNON.Body({ mass: 1, material: mDie, shape: dieShape,
      linearDamping: 0.06, angularDamping: 0.06, allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.3 });
    // inertia of a solid cube (the convex hull estimate is close, but make it exact)
    const I = (1 / 6) * DIE * DIE;
    b.inertia.set(I, I, I); b.invInertia.set(1 / I, 1 / I, 1 / I); b.updateInertiaWorld(true);
    world.addBody(b); return b;
  });
  return { world, floor, walls, dice };
}

/** Returns {value, dot, axis:index} for the face currently pointing up. */
export function upFace(q) {
  let best = -2, idx = 0;
  FACE_NORMALS.forEach(([x, y, z], i) => {
    // y-component of q * n
    const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
    const wy = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    if (wy > best) { best = wy; idx = i; }
  });
  return { value: FACE_VALUES[idx], dot: best, axis: idx };
}

/**
 * Simulate one throw. start: [{p:[x,y,z], q:[x,y,z,w], v:[..], w:[..]}] ×2
 * Returns null if the trajectory fails validation.
 */
export function simulate(tray, start, { maxSeconds = 8, strictRim = false, preferLength = false } = {}) {
  const { world, floor, walls, dice } = buildWorld(tray);
  start.forEach((s, i) => {
    const b = dice[i];
    b.position.set(...s.p); b.quaternion.set(...s.q); b.velocity.set(...s.v); b.angularVelocity.set(...s.w);
  });
  const frames = [[], []], events = [];
  let step = 0, highWallHit = false;
  const lastEvt = [-99, -99, -99];
  dice.forEach((b, i) => b.addEventListener('collide', (e) => {
    const other = e.body;
    const kind = other === floor ? 'floor' : walls.includes(other) ? 'wall' : 'die';
    if (kind === 'die' && i === 1) return;
    const strength = Math.abs(e.contact.getImpactVelocityAlongNormal());
    const f = step >> 1;
    if (kind === 'wall' && b.position.y > 1.25) highWallHit = true;   // would look like an invisible wall
    const slot = kind === 'die' ? 2 : i;
    if (strength < 0.45 || f - lastEvt[slot] < 3) return;
    lastEvt[slot] = f;
    events.push({ frame: f, kind, die: i, strength });
  }));
  const record = () => dice.forEach((b, i) => frames[i].push([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
  record();
  const maxSteps = maxSeconds * HZ;
  let restSteps = 0;
  for (step = 1; step <= maxSteps; step++) {
    world.step(1 / HZ);
    if (step % 2 === 0) record();
    if (highWallHit) return reject('highWall');
    const asleep = dice.every((b) => b.sleepState === CANNON.Body.SLEEPING);
    if (asleep) { if (++restSteps > 24) break; } else restSteps = 0;
  }
  if (step > maxSteps) return reject('timeout');
  const margin = strictRim ? 0.85 : 0.5;
  const hw = tray.w / 2 - margin, hd = tray.d / 2 - margin;
  const finals = dice.map((b) => ({ p: b.position, face: upFace(b.quaternion) }));
  if (finals.some((f) => f.face.dot < 0.985 || f.p.y > 0.56)) return reject('cocked');
  if (finals.some((f) => Math.abs(f.p.x) > hw || Math.abs(f.p.z) > hd)) return reject(strictRim ? 'rim' : 'escaped');
  const frameCount = frames[0].length;
  if (frameCount < HARD_MIN) return reject('short');
  if (preferLength && frameCount < PREFER_MIN) return reject('preferShort');
  if (preferLength && frameCount > PREFER_MAX) return reject('preferLong');
  // the dice should not end up stacked or touching edge-to-edge in an ugly way
  if (Math.hypot(finals[0].p.x - finals[1].p.x, finals[0].p.z - finals[1].p.z) < 1.05) return reject('touching');
  // Last frame with noticeable motion → used for the slow-motion landing.
  let settleFrame = frameCount - 1;
  for (let f = frameCount - 1; f > 0; f--) {
    const moving = frames.some((fr) => {
      const a = fr[f], b = fr[f - 1];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.003 || Math.abs(a[6] - b[6]) + Math.abs(a[3] - b[3]) + Math.abs(a[4] - b[4]) > 0.002;
    });
    if (moving) { settleFrame = f; break; }
  }
  return { frames, events, finals: finals.map((f) => f.face), settleFrame, frameCount };
}

const rnd = (a, b) => a + Math.random() * (b - a);
function randomUnit() { const u = rnd(-1, 1), t = rnd(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return [s * Math.cos(t), u, s * Math.sin(t)]; }
function randomQuat() {
  const u1 = Math.random(), u2 = Math.random() * Math.PI * 2, u3 = Math.random() * Math.PI * 2;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/** Where the dice sit in the "hand" just before an automatic throw (front of the tray). */
export function launchPose(tray) {
  const z = tray.d / 2 - 1.25;
  return [{ p: [-0.62, 1.8, z], q: randomQuat() }, { p: [0.62, 1.95, z - 0.12], q: randomQuat() }];
}

/**
 * Find a validated trajectory for a throw.
 * hand: [{p,q}] launch positions/orientations of the dice.
 * velocity: [vx, vz] horizontal throw velocity (world units / s) or null for an automatic throw.
 * power: 0..1 scales an automatic throw (e.g. how hard the phone was shaken).
 */
export function planThrow(tray, hand, velocity, { attempts = 60, power = 0.6 } = {}) {
  for (let a = 0; a < attempts; a++) {
    let vx, vz;
    if (velocity) {
      const jitter = 1 + a * 0.03;
      const k = a > 30 ? 0.75 : 1;
      vx = velocity[0] * rnd(0.9, 1.1) * k + rnd(-1, 1) * jitter;
      vz = velocity[1] * rnd(0.9, 1.1) * k + rnd(-1, 1) * jitter;
    } else {
      const ang = rnd(-0.42, 0.42) - Math.PI / 2;          // toward the back of the tray
      const sp = rnd(7.5, 10) + power * 3.5;
      vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp;
    }
    const sp = Math.hypot(vx, vz);
    const lim = Math.min(Math.max(sp, 6), 15) / (sp || 1);
    vx *= lim; vz *= lim;
    const start = hand.map((h, i) => {
      const axis = randomUnit(), spin = rnd(16, 26);
      return {
        p: [h.p[0], h.p[1], h.p[2]], q: h.q,
        v: [vx + rnd(-0.8, 0.8) + (i ? 0.45 : -0.45), rnd(-3.5, -0.5), vz + rnd(-0.8, 0.8)],
        w: axis.map((c) => c * spin)
      };
    });
    const strict = a < attempts * 0.4;
    const res = simulate(tray, start, { strictRim: strict, preferLength: a < attempts * 0.6 });
    if (res) return { ...res, start, attempts: a + 1 };
  }
  return null;
}
