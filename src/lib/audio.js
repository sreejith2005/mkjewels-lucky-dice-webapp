/**
 * Synthesised dice sound design (no audio files). Impacts use short modal "knocks" (dry resin
 * clacks between dice, muffled toks on the velvet, firmer knocks off the rails, quick ticks while
 * the dice tumble) instead of ringing bells. Reveal chimes are kept. Audio starts only after a user gesture.
 */
let ctx = null, master = null, noise = null, lastHit = 0;
let enabled = (() => { try { return localStorage.getItem('mk_sound') !== 'off'; } catch (e) { return true; } })();

export const soundEnabled = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem('mk_sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  if (on) unlockAudio();
}

export function unlockAudio() {
  if (!enabled || typeof window === 'undefined') return;
  try {
    // iOS 17+: play like a game, even when the ringer/silent switch is on
    if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
  } catch (e) { /* not supported */ }
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
      const makeup = ctx.createGain(); makeup.gain.value = 1.6;
      master = ctx.createGain(); master.gain.value = 1;
      master.connect(comp).connect(makeup).connect(ctx.destination);
      const n = ctx.sampleRate * 1.2;
      noise = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch (e) { /* audio unavailable */ }
}

const ready = () => enabled && ctx && master && ctx.state === 'running';

function bell(freq, partials, dur, gain, delay = 0, pan = 0) {
  const t = ctx.currentTime + delay, g = ctx.createGain(), p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (p) { p.pan.value = pan; g.connect(p).connect(master); } else g.connect(master);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  partials.forEach((m, i) => {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = 'sine'; o.frequency.value = freq * m; og.gain.value = 1 / (i + 1.4);
    o.connect(og).connect(g); o.start(t); o.stop(t + dur + 0.05);
  });
}

function noiseBurst(type, freq, q, dur, gain, delay = 0, sweepTo) {
  const t = ctx.currentTime + delay, src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}

/**
 * A short modal "knock": a few inharmonic resonances that die away in tens of milliseconds plus a
 * filtered noise transient. This is what a hard resin die sounds like (a dry clack, not a bell).
 */
function knock(modes, decay, gain, { noiseType = 'bandpass', noiseF = 3000, noiseQ = 0.9, noiseDur = 0.012, noiseGain = 1, pan = 0, delay = 0 } = {}) {
  const t = ctx.currentTime + delay + Math.random() * 0.004;
  const out = ctx.createGain(); out.gain.value = gain;
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p).connect(master); } else out.connect(master);
  const jitter = 0.92 + Math.random() * 0.16;
  modes.forEach(([f, a, dk = 1]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(), d = decay * dk;
    o.type = 'sine'; o.frequency.value = f * jitter;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(a, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(out); o.start(t); o.stop(t + d + 0.02);
  });
  const src = ctx.createBufferSource(); src.buffer = noise;
  const f = ctx.createBiquadFilter(); f.type = noiseType; f.frequency.value = noiseF * jitter; f.Q.value = noiseQ;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(noiseGain, t + 0.001); ng.gain.exponentialRampToValueAtTime(0.0001, t + noiseDur);
  src.connect(f).connect(ng).connect(out); src.start(t, Math.random() * 0.8); src.stop(t + noiseDur + 0.02);
}

let lastFloor = 0;
/** Die against die: the sharp, dry "clack" of two resin dice. */
export function clink(strength, pan = 0) {
  if (!ready()) return;
  const now = performance.now(); if (now - lastHit < 30) return; lastHit = now;
  const s = Math.min(1, strength / 8);
  knock([[2650, 0.5], [4120, 0.35, 0.8], [6300, 0.22, 0.6], [8900, 0.12, 0.45]], 0.035 + s * 0.03, 0.22 + s * 0.55,
    { noiseF: 4200, noiseQ: 0.8, noiseDur: 0.01 + s * 0.008, noiseGain: 0.9, pan });
}
/** Die landing on the velvet: a muffled "tok", with a little click from the hard corner. */
export function thud(strength, pan = 0) {
  if (!ready()) return;
  const now = performance.now(); if (now - lastFloor < 22) return; lastFloor = now;
  const s = Math.min(1, strength / 9);
  knock([[180 + s * 60, 0.6, 1.6], [520, 0.25], [1350, 0.18, 0.6], [2900, 0.08 * (0.4 + s), 0.4]], 0.03 + s * 0.035, 0.12 + s * 0.75,
    { noiseType: 'lowpass', noiseF: 900 + s * 1600, noiseQ: 0.6, noiseDur: 0.02 + s * 0.02, noiseGain: 1 });
}
/** Die off the gold rail: a firmer, brighter knock. */
export function tick(strength, pan = 0) {
  if (!ready()) return;
  const s = Math.min(1, strength / 8);
  knock([[1150, 0.4], [2350, 0.4, 0.8], [3900, 0.25, 0.6], [6100, 0.12, 0.5]], 0.04 + s * 0.04, 0.2 + s * 0.6,
    { noiseF: 2600, noiseQ: 0.9, noiseDur: 0.012 + s * 0.01, noiseGain: 0.8, pan });
}
/** Physics impact → sound. */
export function impact({ kind, strength, pan = 0 }) {
  if (kind === 'dice') clink(strength, pan);
  else if (kind === 'wall') tick(strength, pan);
  else thud(strength, pan);
}
/** The release: a soft air movement, barely there. */
export function whoosh() { if (ready()) noiseBurst('bandpass', 500, 0.9, 0.28, 0.12, 0, 1600); }
/** Dice knocking together in a cupped hand. */
export function rattle(strength = 0.6) {
  if (!ready()) return;
  const pan = (Math.random() - 0.5) * 0.3;
  knock([[2500, 0.45], [3900, 0.3, 0.8], [6000, 0.18, 0.6]], 0.03, 0.12 + strength * 0.22, { noiseF: 3800, noiseDur: 0.008, noiseGain: 0.8, pan });
  if (Math.random() < 0.55) knock([[2800, 0.4], [4500, 0.25, 0.7]], 0.025, 0.08 + strength * 0.14, { noiseF: 4200, noiseDur: 0.007, noiseGain: 0.7, pan: -pan, delay: 0.025 + Math.random() * 0.03 });
  // skin and palm: a soft low knock
  knock([[220, 0.5, 1.4], [640, 0.2]], 0.03, 0.05 + strength * 0.08, { noiseType: 'lowpass', noiseF: 700, noiseDur: 0.02, noiseGain: 0.6 });
}

export function reveal() {
  if (!ready()) return;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => bell(f * 2, [1, 2.01, 3, 4.2], 1.8, 0.2, i * 0.13, (i - 1.5) * 0.25));
  const t = ctx.currentTime;
  [261.63, 329.63, 392].forEach((f) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.07, t + 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g).connect(master); o.start(t); o.stop(t + 2.7);
  });
}
export function jackpot() {
  if (!ready()) return;
  reveal();
  for (let i = 0; i < 14; i++) bell(2200 + Math.random() * 2600, [1, 2.76, 5.4], 0.6, 0.07, 0.5 + i * 0.09, Math.random() * 1.6 - 0.8);
  [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => bell(f, [1, 2, 3, 4.1], 2.6, 0.14, 1.6 + i * 0.05));
}
export function tap() { if (ready()) bell(2100, [1, 2.76], 0.08, 0.04); }
