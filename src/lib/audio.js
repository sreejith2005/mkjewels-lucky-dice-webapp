/**
 * Synthesised, sample-free dice sound design (no audio files to download):
 * hard dice clacks, muffled landings on velvet, short knocks on the metal rim, a continuous
 * rolling texture while the dice tumble, a rattle while they are shaken, and a soft reveal chime.
 * Audio starts only after a user gesture.
 */
let ctx = null, master = null, wet = null, noise = null;
let rollGain = null, rollFilter = null;
let enabled = (() => { try { return localStorage.getItem('mk_sound') !== 'off'; } catch (e) { return true; } })();

export const soundEnabled = () => enabled;
export function setSound(on) {
  enabled = on;
  try { localStorage.setItem('mk_sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  if (on) unlockAudio();
  if (master) master.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.05);
}

export function unlockAudio() {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
      master = ctx.createGain(); master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 3; comp.attack.value = 0.002;
      master.connect(comp).connect(ctx.destination);
      // small, dry room
      const conv = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 0.45), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
      conv.buffer = ir;
      wet = ctx.createGain(); wet.gain.value = 0.18;
      wet.connect(conv).connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // continuous rolling bed (felt friction), silent until dice move
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      rollFilter = ctx.createBiquadFilter(); rollFilter.type = 'bandpass'; rollFilter.frequency.value = 700; rollFilter.Q.value = 0.7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      rollGain = ctx.createGain(); rollGain.gain.value = 0;
      src.connect(rollFilter).connect(lp).connect(rollGain).connect(master);
      src.start();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* audio unavailable */ }
}

const ready = () => enabled && ctx && ctx.state === 'running';
const jitter = (x, amt = 0.08) => x * (1 + (Math.random() - 0.5) * 2 * amt);

function burst({ t, dur, gain, type = 'bandpass', freq, q = 1, reverb = 0 }) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(wet); }
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

/** Struck-object resonance: a few damped sine modes. */
function modes({ t, freqs, decays, gain, reverb = 0 }) {
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = jitter(f, 0.04);
    const g = ctx.createGain(); const d = decays[i];
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain / (1 + i * 0.6), t + 0.001); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(master);
    if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(wet); }
    o.start(t); o.stop(t + d + 0.03);
  });
}

function clack(t, s) {   // die against die: hard, bright, very short
  burst({ t, dur: 0.012, gain: 0.32 * s, type: 'highpass', freq: 2400, q: 0.7 });
  modes({ t, freqs: [jitter(3300), jitter(5200), jitter(7600)], decays: [0.045, 0.03, 0.018], gain: 0.11 * s, reverb: 0.25 });
}

/** Physics impact → sound. kind: floor | wall | die ; strength: impact velocity */
export function impact({ kind, strength }) {
  if (!ready()) return;
  const s = Math.min(1, Math.max(0.05, strength / 10));
  const t = ctx.currentTime + 0.004;
  if (kind === 'floor') {
    burst({ t, dur: 0.05 + 0.04 * s, gain: 0.6 * s, type: 'lowpass', freq: jitter(420 + 380 * s), q: 0.9 });      // velvet thud
    burst({ t, dur: 0.008, gain: 0.07 * s, type: 'bandpass', freq: jitter(3200), q: 1.4 });                        // corner tick through the pile
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(jitter(140), t); o.frequency.exponentialRampToValueAtTime(65, t + 0.07);
    g.gain.setValueAtTime(0.28 * s, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(master); o.start(t); o.stop(t + 0.1);
  } else if (kind === 'wall') {
    burst({ t, dur: 0.01, gain: 0.3 * s, type: 'bandpass', freq: jitter(2600), q: 0.9 });
    modes({ t, freqs: [jitter(1750), jitter(2900), jitter(4400)], decays: [0.11, 0.07, 0.045], gain: 0.1 * s, reverb: 0.3 });
  } else clack(t, s);
}

/** Dice knocking together in the hand while being shaken. */
export function rattle(strength = 0.6) {
  if (!ready()) return;
  const t = ctx.currentTime + 0.002, s = 0.35 + strength * 0.65;
  clack(t, 0.55 * s);
  if (Math.random() < 0.75) clack(t + 0.012 + Math.random() * 0.03, 0.3 * s);
  burst({ t, dur: 0.03, gain: 0.12 * s, type: 'lowpass', freq: 500, q: 0.7 });   // palm
}

/** Continuous rolling texture, 0..1. Call every frame while dice are moving. */
export function rolling(level) {
  if (!ctx || !rollGain) return;
  const l = enabled ? Math.max(0, Math.min(1, level)) : 0;
  rollGain.gain.setTargetAtTime(l * 0.16, ctx.currentTime, 0.04);
  rollFilter.frequency.setTargetAtTime(500 + l * 600, ctx.currentTime, 0.06);
  // tiny edge ticks as the dice tip over the pile
  if (ready() && l > 0.15 && Math.random() < l * 0.3) burst({ t: ctx.currentTime + 0.002, dur: 0.006, gain: 0.05 * l, type: 'bandpass', freq: jitter(2600, 0.25), q: 1.2 });
}

function note(t, f, dur, gain, type = 'sine', rev = 0.5) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(wet);
  o.start(t); o.stop(t + dur + 0.05);
}

export function reveal() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  [1318.5, 1975.5].forEach((f, i) => { note(t + i * 0.11, f, 1.6, 0.07); note(t + i * 0.11, f * 2.005, 0.6, 0.015); });
}

export function jackpot() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { note(t + i * 0.1, f, 2, 0.07); note(t + i * 0.1, f * 2.005, 0.7, 0.014); });
  [261.6, 392].forEach((f) => note(t, f, 2.4, 0.035, 'triangle', 0.6));
}

export function tap() {
  if (!ready()) return;
  modes({ t: ctx.currentTime, freqs: [2600], decays: [0.04], gain: 0.03 });
}
