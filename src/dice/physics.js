/**
 * Pre-simulated dice physics.
 * A throw is simulated in full (real gravity, friction, bounces, dice-to-dice and wall
 * collisions) before anything is shown. The trajectory is validated, then the dice faces
 * are "re-labelled" once (a cube symmetry on the visual mesh) so the face that physically
 * lands on top is the server's official result. Playback is the untouched physics.
 */
import * as CANNON from 'cannon-es';

export const DIE = 1;
export const G = 38;
// Material groups of BoxGeometry: +x, -x, +y, -y, +z, -z  → pip values (opposites sum to 7)
export const FACE_VALUES = [3, 4, 1, 6, 2, 5];
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const normalOf = (value) => FACE_NORMALS[FACE_VALUES.indexOf(value)];

function buildWorld(tray) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -G, 0) });
  world.allowSleep = true;
  world.solver.iterations = 16;
  const mDie = new CANNON.Material('die'), mFloor = new CANNON.Material('floor'), mWall = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mFloor, { friction: 0.34, restitution: 0.32 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mWall, { friction: 0.08, restitution: 0.5 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mDie, { friction: 0.18, restitution: 0.42 }));

  const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const hw = tray.w / 2, hd = tray.d / 2;
  const walls = [[-hw, 0, 0, Math.PI / 2], [hw, 0, 0, -Math.PI / 2], [0, 0, -hd, 0], [0, 0, hd, Math.PI]].map(([x, , z, ry]) => {
    const b = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Plane() });
    b.position.set(x, 0, z); b.quaternion.setFromEuler(0, ry, 0);
    world.addBody(b); return b;
  });
  const dice = [0, 1].map(() => {
    const b = new CANNON.Body({ mass: 1, material: mDie, shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)),
      linearDamping: 0.06, angularDamping: 0.05, allowSleep: true, sleepSpeedLimit: 0.14, sleepTimeLimit: 0.22 });
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
export function simulate(tray, start, maxSeconds = 7, strict = false) {
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
    if (strength < 0.6 || f - lastEvt[slot] < 3) return;
    lastEvt[slot] = f;
    events.push({ frame: f, kind, die: i, strength });
  }));
  const record = () => dice.forEach((b, i) => frames[i].push([b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w]));
  record();
  const maxSteps = maxSeconds * 120;
  let restSteps = 0;
  for (step = 1; step <= maxSteps; step++) {
    world.step(1 / 120);
    if (step % 2 === 0) record();
    const asleep = dice.every(b => b.sleepState === CANNON.Body.SLEEPING);
    if (asleep) { if (++restSteps > 20) break; } else restSteps = 0;
  }
  if (step > maxSteps || highWallHit) return null;
  const margin = strict ? 1.05 : 0.45;
  const hw = tray.w / 2 - margin, hd = tray.d / 2 - margin;
  const finals = dice.map(b => ({ p: b.position, face: upFace(b.quaternion) }));
  if (finals.some(f => f.face.dot < 0.985 || Math.abs(f.p.x) > hw || Math.abs(f.p.z) > hd || f.p.y > 0.56)) return null;
  const frameCount = frames[0].length;
  if (frameCount < 60) return null;                   // too short to feel like a roll
  // Last frame with noticeable motion → used for slow-motion landing.
  let settleFrame = frameCount - 1;
  for (let f = frameCount - 1; f > 0; f--) {
    const moving = frames.some(fr => {
      const a = fr[f], b = fr[f - 1];
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.004 || Math.abs(a[6] - b[6]) + Math.abs(a[3] - b[3]) > 0.002;
    });
    if (moving) { settleFrame = f; break; }
  }
  return { frames, events, finals: finals.map(f => f.face), settleFrame, frameCount };
}

/** Deterministic-free PRNG helpers */
const rnd = (a, b) => a + Math.random() * (b - a);
function randomUnit() { const u = rnd(-1, 1), t = rnd(0, Math.PI * 2), s = Math.sqrt(1 - u * u); return [s * Math.cos(t), u, s * Math.sin(t)]; }

/**
 * Find a validated trajectory for a throw.
 * hand: [{p,q}] current positions/orientations of the dice in the hand.
 * velocity: [vx, vz] horizontal throw velocity (world units / s) or null for an automatic throw.
 */
export function planThrow(tray, hand, velocity, attempts = 48) {
  for (let a = 0; a < attempts; a++) {
    let vx, vz;
    if (velocity) {
      const jitter = 1 + a * 0.03;
      vx = velocity[0] * rnd(0.9, 1.1) * (a > 20 ? 0.7 : 1) + rnd(-1, 1) * jitter;
      vz = velocity[1] * rnd(0.9, 1.1) * (a > 20 ? 0.7 : 1) + rnd(-1, 1) * jitter;
    } else {
      const ang = rnd(-0.55, 0.55) - Math.PI / 2;  // toward the back of the tray
      const sp = rnd(9, 14);
      vx = Math.cos(ang) * sp; vz = Math.sin(ang) * sp;
    }
    const sp = Math.hypot(vx, vz);
    const lim = Math.min(Math.max(sp, 5), 20) / (sp || 1);
    vx *= lim; vz *= lim;
    const start = hand.map((h, i) => {
      const axis = randomUnit(), spin = rnd(14, 24);
      return {
        p: [h.p[0], h.p[1], h.p[2]], q: h.q,
        v: [vx + rnd(-1.2, 1.2) + (i ? 0.6 : -0.6), rnd(-4.5, -1.5), vz + rnd(-1.2, 1.2)],
        w: axis.map(c => c * spin)
      };
    });
    const res = simulate(tray, start, 7, a < attempts * 0.6);   // prefer landings away from the rim
    if (res) return { ...res, start, attempts: a + 1 };
  }
  return null;
}
