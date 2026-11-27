/**
 * Synthesised dice sound design (no audio files): ringing gold clinks when the dice meet, ticks
 * off the gold rails, velvet thuds, a whoosh on release, a rattle in the hand, and reveal chimes.
 * Ported from the approved motion study and mixed louder. Audio starts only after a user gesture.
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

/** Dice against dice: a bright gold clink. */
export function clink(strength, pan = 0) {
  if (!ready()) return;
  const now = performance.now(); if (now - lastHit < 35) return; lastHit = now;
  const s = Math.min(1, strength / 9);
  bell(1650 + Math.random() * 700, [1, 2.76, 5.4, 8.93], 0.18 + s * 0.35, 0.09 + s * 0.33, 0, pan);
  noiseBurst('highpass', 3000, 0.7, 0.03, 0.06 + s * 0.12);
}
/** Dice landing on velvet. */
export function thud(strength) {
  if (!ready()) return;
  const s = Math.min(1, strength / 10);
  noiseBurst('lowpass', 260 + s * 300, 0.7, 0.07 + s * 0.05, 0.25 + s * 0.6);
  noiseBurst('bandpass', 2400, 1.4, 0.02, 0.03 + s * 0.08);
}
/** Dice off the gold rail. */
export function tick(strength, pan = 0) {
  if (!ready()) return;
  const s = Math.min(1, strength / 9);
  bell(2900 + Math.random() * 600, [1, 2.3, 4.1], 0.09 + s * 0.12, 0.07 + s * 0.24, 0, pan);
  noiseBurst('bandpass', 1800, 2, 0.04, 0.08 + s * 0.16);
}
/** Physics impact → sound. */
export function impact({ kind, strength, pan = 0 }) {
  if (kind === 'dice') clink(strength, pan);
  else if (kind === 'wall') tick(strength, pan);
  else thud(strength);
}
/** The release. */
export function whoosh() { if (ready()) noiseBurst('bandpass', 380, 1.2, 0.55, 0.3, 0, 1400); }
/** Dice knocking together in the hand. */
export function rattle(strength = 0.6) {
  if (!ready()) return;
  bell(2100 + Math.random() * 500, [1, 2.76, 5.4], 0.12, 0.06 + strength * 0.08, 0, (Math.random() - 0.5) * 0.4);
  if (Math.random() < 0.6) bell(2500 + Math.random() * 600, [1, 2.76], 0.08, 0.04 + strength * 0.05, 0.02 + Math.random() * 0.03);
  noiseBurst('lowpass', 500, 0.7, 0.03, 0.05 + strength * 0.08);
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
