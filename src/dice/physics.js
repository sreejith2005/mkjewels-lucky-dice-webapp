/**
 * Pre-simulated dice physics (cannon-es), tuned to match the approved "golden tray" motion study.
 * A throw is simulated in full before it is shown: gravity, felt friction, bounces off solid
 * rails and dice-to-dice hits. The trajectory is validated, then the stage re-labels the faces once
 * (a cube symmetry) so the face that physically lands on top is the server's official result.
 *
 * Pure module (no DOM): runs in Node tests, in a Web Worker and on the main thread.
 */
import * as CANNON from 'cannon-es';

export const DIE = 1;
export const HZ = 120;                       // simulation and recording rate (frames per second)
export const STRIDE = 14;                    // floats per frame: 2 dice × (x, y, z, qx, qy, qz, qw)
// Material groups of BoxGeometry: +x, -x, +y, -y, +z, -z  → pip values (opposites sum to 7)
export const FACE_VALUES = [3, 4, 1, 6, 2, 5];
export const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const normalOf = (value) => FACE_NORMALS[FACE_VALUES.indexOf(value)];

/** Tray size for a stage of the given pixel size (portrait phones get a deeper tray). */
export function trayFor(width, height) {
  return height > width * 1.05 ? { w: 6.2, d: 8.8 } : { w: 9.5, d: 6.4 };
}
/** Where the two dice float "in the hand" before a throw (front of the tray). */
export function handAnchor(tray) {
  return [[-1, 2.2, tray.d / 2 - 1.4], [1, 2.35, tray.d / 2 - 1.2]];
}

/** Rejection counters (diagnostics for tests / tuning). */
export const stats = {};
const reject = (why) => { stats[why] = (stats[why] || 0) + 1; };

function buildWorld(tray) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -32, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase();
  world.solver.iterations = 14;
  const mDie = new CANNON.Material('dice'), mFloor = new CANNON.Material('floor'), mWall = new CANNON.Material('wall');
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mFloor, { friction: 0.32, restitution: 0.32 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mWall, { friction: 0.08, restitution: 0.55 }));
  world.addContactMaterial(new CANNON.ContactMaterial(mDie, mDie, { friction: 0.12, restitution: 0.42 }));

  const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const t = 0.5, { w, d } = tray;
  const wall = (x, z, hx, hz) => {
    const b = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Box(new CANNON.Vec3(hx, 8, hz)) });
    b.position.set(x, 8, z); world.addBody(b); return b;
  };
  const walls = [wall(w / 2 + t, 0, t, d / 2 + 1), wall(-w / 2 - t, 0, t, d / 2 + 1), wall(0, d / 2 + t, w / 2 + 1, t), wall(0, -d / 2 - t, w / 2 + 1, t)];
  const ceiling = new CANNON.Body({ mass: 0, material: mWall, shape: new CANNON.Plane() });
  ceiling.quaternion.setFromEuler(Math.PI / 2, 0, 0); ceiling.position.set(0, 9, 0);
  world.addBody(ceiling);
  const dice = [0, 1].map(() => {
    const b = new CANNON.Body({ mass: 1, material: mDie, shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)),
      linearDamping: 0.08, angularDamping: 0.12, allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.35 });
    world.addBody(b); return b;
  });
  return { world, floor, walls, dice };
}

/** {index, dot} of the face pointing up for quaternion (x, y, z, w). */
export function upFace(qx, qy, qz, qw) {
  let best = -2, idx = 0;
  FACE_NORMALS.forEach(([x, y, z], i) => {
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    const wy = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    if (wy > best) { best = wy; idx = i; }
  });
  return { index: idx, dot: best };
}

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function randomQuat() {
  const u1 = Math.random(), u2 = Math.random() * Math.PI * 2, u3 = Math.random() * Math.PI * 2;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

/**
 * Plan a validated throw.
 * hand: [[x,y,z],[x,y,z]] release positions. velocity: [vx, vy, vz] from a swipe, or null.
 * power: 0..1 for automatic throws (button / phone shake).
 * Returns { frames: Float32Array(frameCount*STRIDE), frameCount, hits, finals:[{index,x}], attempts } or null.
 */
export function planThrow(tray, hand, velocity = null, { power = 0.5, attempts = 40 } = {}) {
  for (let a = 0; a < attempts; a++) {
    const { world, floor, walls, dice } = buildWorld(tray);
    const base = velocity ? [velocity[0], 0, velocity[2]] : [rnd(-2, 2), 0, -(10 + power * 4 + Math.random() * 2.5)];
    const vx = clamp(base[0] * 0.9 + (Math.random() - 0.5) * (a > 5 ? 2 : 0.6), -6, 6);
    const vz = clamp(Math.min(base[2] * 0.9, -7), -19, -7);
    const vy = 2.5 + Math.random() * 2.5;
    dice.forEach((b, i) => {
      b.velocity.set(vx + (i ? 0.6 : -0.6), vy + Math.random(), vz + (Math.random() - 0.5) * 1.5);
      const spin = 14 + Math.random() * 12;
      b.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
      b.position.set(hand[i][0], Math.max(hand[i][1], 1.6), Math.min(hand[i][2], tray.d / 2 - 0.7));
      const q = randomQuat(); b.quaternion.set(q[0], q[1], q[2], q[3]);
    });

    const maxFrames = HZ * 9;
    const buf = new Float32Array((maxFrames + 1) * STRIDE);
    let n = 0;
    const record = () => {
      const o = n * STRIDE;
      dice.forEach((b, i) => {
        const k = o + i * 7;
        buf[k] = b.position.x; buf[k + 1] = b.position.y; buf[k + 2] = b.position.z;
        buf[k + 3] = b.quaternion.x; buf[k + 4] = b.quaternion.y; buf[k + 5] = b.quaternion.z; buf[k + 6] = b.quaternion.w;
      });
      n++;
    };
    const hits = [], last = new Map();
    dice.forEach((b, i) => b.addEventListener('collide', (e) => {
      const strength = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (strength < 0.8) return;
      const kind = e.body === floor ? 'floor' : walls.includes(e.body) ? 'wall' : 'dice';
      if (kind === 'dice' && i === 1) return;
      const key = kind + i, f = n;
      if ((last.get(key) ?? -99) > f - 6) return;
      last.set(key, f);
      hits.push({ frame: f, kind, strength, x: b.position.x / (tray.w / 2) });
    }));

    record();
    let still = 0;
    for (let f = 0; f < maxFrames; f++) {
      world.step(1 / HZ);
      record();
      const resting = dice.every((b) => b.sleepState === CANNON.Body.SLEEPING || (b.velocity.length() < 0.03 && b.angularVelocity.length() < 0.03));
      still = resting ? still + 1 : 0;
      if (still > HZ * 0.25) break;
    }
    if (still === 0) { reject('timeout'); continue; }
    const o = (n - 1) * STRIDE;
    const u0 = upFace(buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6]), u1 = upFace(buf[o + 10], buf[o + 11], buf[o + 12], buf[o + 13]);
    if (u0.dot < 0.985 || u1.dot < 0.985 || buf[o + 1] > 0.56 || buf[o + 8] > 0.56) { reject('cocked'); continue; }
    if (Math.abs(buf[o]) > tray.w / 2 || Math.abs(buf[o + 7]) > tray.w / 2) { reject('escaped'); continue; }
    if (n < HZ * 0.8) { reject('short'); continue; }
    return {
      frames: buf.slice(0, n * STRIDE), frameCount: n, hits, attempts: a + 1,
      finals: [{ index: u0.index, x: buf[o] }, { index: u1.index, x: buf[o + 7] }]
    };
  }
  return null;
}
