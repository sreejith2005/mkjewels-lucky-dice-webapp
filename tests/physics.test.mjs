import { planThrow, upFace } from '../src/dice/physics.js';
const trays = [{ w: 5.4, d: 7.2 }, { w: 9, d: 5.6 }];
for (const tray of trays) {
  let ok = 0, att = 0, frames = 0, t0 = performance.now(), worst = 0, evts = 0;
  const N = 150;
  for (let i = 0; i < N; i++) {
    const hand = [{ p: [-0.65, 2.0, tray.d / 2 - 1.3], q: [0, 0, 0, 1] }, { p: [0.65, 2.0, tray.d / 2 - 1.2], q: [0, 0, 0, 1] }];
    const vel = i % 2 ? null : [Math.random() * 10 - 5, -Math.random() * 14 - 2];
    const s = performance.now();
    const r = planThrow(tray, hand, vel);
    worst = Math.max(worst, performance.now() - s);
    if (r) { ok++; att += r.attempts; frames += r.frameCount; evts += r.events.length; }
  }
  console.log(`tray ${tray.w}x${tray.d}: ${ok}/${N} ok, avg attempts ${(att / ok).toFixed(2)}, avg duration ${(frames / ok / 60).toFixed(2)}s, avg sound events ${(evts/ok).toFixed(1)}, avg plan ${((performance.now() - t0) / N).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
}
