import { planThrow, handAnchor, upFace, stats, STRIDE, HZ } from '../src/dice/physics.js';
const trays = [{ w: 6.2, d: 8.8 }, { w: 9.5, d: 6.4 }];
let failed = 0;
for (const tray of trays) {
  let ok = 0, att = 0, frames = 0, t0 = performance.now(), worst = 0, hits = 0, minF = 1e9, maxF = 0;
  const N = 150;
  for (let i = 0; i < N; i++) {
    const swipe = i % 3 === 0 ? [Math.random() * 8 - 4, 0, -(9 + Math.random() * 10)] : null;
    const s = performance.now();
    const r = planThrow(tray, handAnchor(tray), swipe, { power: Math.random() });
    worst = Math.max(worst, performance.now() - s);
    if (!r) continue;
    ok++; att += r.attempts; frames += r.frameCount; hits += r.hits.length; minF = Math.min(minF, r.frameCount); maxF = Math.max(maxF, r.frameCount);
    const o = (r.frameCount - 1) * STRIDE;
    [0, 7].forEach((k, d) => { const u = upFace(r.frames[o + k + 3], r.frames[o + k + 4], r.frames[o + k + 5], r.frames[o + k + 6]); if (u.index !== r.finals[d].index || u.dot < 0.985) { failed++; console.log('face mismatch'); } });
  }
  if (ok < N) failed++;
  console.log(`tray ${tray.w}x${tray.d}: ${ok}/${N} ok, avg attempts ${(att / ok).toFixed(2)}, roll ${(frames / ok / HZ).toFixed(2)}s (min ${(minF / HZ).toFixed(2)} max ${(maxF / HZ).toFixed(2)}), avg hits ${(hits / ok).toFixed(1)}, avg plan ${((performance.now() - t0) / N).toFixed(0)}ms, worst ${worst.toFixed(0)}ms`);
}
console.log('rejections', JSON.stringify(stats));
if (failed) { console.error('physics test FAILED'); process.exit(1); }
console.log('physics ok');
