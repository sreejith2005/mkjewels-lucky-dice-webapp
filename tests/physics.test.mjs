import { planThrow, launchPose, upFace, stats } from '../src/dice/physics.js';
const trays = [{ w: 5.4, d: 7.0 }, { w: 7, d: 6 }, { w: 9.2, d: 5.6 }];
let failed = 0;
for (const tray of trays) {
  let ok = 0, att = 0, frames = 0, t0 = performance.now(), worst = 0, evts = 0, minF = 1e9, maxF = 0;
  const N = 150;
  for (let i = 0; i < N; i++) {
    const drag = i % 3 === 0;
    const hand = drag ? [{ p: [-0.65, 1.75, tray.d / 2 - 1.3], q: [0, 0, 0, 1] }, { p: [0.65, 1.75, tray.d / 2 - 1.2], q: [0, 0, 0, 1] }] : launchPose(tray);
    const vel = drag ? [Math.random() * 10 - 5, -Math.random() * 14 - 2] : null;
    const s = performance.now();
    const r = planThrow(tray, hand, vel, { power: Math.random() });
    worst = Math.max(worst, performance.now() - s);
    if (r) {
      ok++; att += r.attempts; frames += r.frameCount; evts += r.events.length; minF = Math.min(minF, r.frameCount); maxF = Math.max(maxF, r.frameCount);
      const last = r.frames.map((f) => f[f.length - 1]);
      last.forEach((L, k) => { const u = upFace({ x: L[3], y: L[4], z: L[5], w: L[6] }); if (u.axis !== r.finals[k].axis || u.dot < 0.985) { failed++; console.log('face mismatch'); } });
    }
  }
  if (ok < N) failed++;
  console.log(`tray ${tray.w}x${tray.d}: ${ok}/${N} ok, avg attempts ${(att / ok).toFixed(2)}, duration avg ${(frames / ok / 60).toFixed(2)}s (min ${(minF / 60).toFixed(2)} max ${(maxF / 60).toFixed(2)}), avg sound events ${(evts / ok).toFixed(1)}, avg plan ${((performance.now() - t0) / N).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
}
console.log("rejections", JSON.stringify(stats));
if (failed) { console.error('physics test FAILED'); process.exit(1); }
console.log('physics ok');
