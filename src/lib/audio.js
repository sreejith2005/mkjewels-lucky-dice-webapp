/**
 * Synthesised, sample-free sound design (no audio files to download):
 * metallic dice clicks, muffled velvet landings, gold-rim pings, reveal chimes, jackpot fanfare.
 * Audio starts only after a user gesture.
 */
let ctx = null, master = null, wet = null, noise = null;
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
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      // small hall reverb
      const conv = ctx.createConvolver();
      const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      conv.buffer = ir;
      wet = ctx.createGain(); wet.gain.value = 0.32;
      wet.connect(conv).connect(master);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* audio unavailable */ }
}

const ready = () => enabled && ctx && ctx.state === 'running';

function burst({ t, dur, gain, type = 'bandpass', freq, q = 1, reverb = 0 }) {
  const src = ctx.createBufferSource(); src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(wet); }
  src.start(t, Math.random() * 0.5, dur + 0.05);
}

function ping({ t, f0, partials, dur, gain, reverb = 0.15 }) {
  partials.forEach(([ratio, amp, decay], i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * ratio * (1 + (Math.random() - 0.5) * 0.006);
    const g = ctx.createGain(); const d = dur * decay;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain * amp, t + 0.0015 + i * 0.0005); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(master);
    if (reverb) { const s = ctx.createGain(); s.gain.value = reverb; g.connect(s).connect(wet); }
    o.start(t); o.stop(t + d + 0.05);
  });
}

const METAL = [[1, 1, 1], [2.32, 0.55, 0.7], [4.25, 0.32, 0.45], [6.63, 0.18, 0.3]];

/** Physics impact → sound. kind: floor | wall | die ; strength: impact velocity */
export function impact({ kind, strength }) {
  if (!ready()) return;
  const s = Math.min(1, Math.max(0.06, strength / 11));
  const t = ctx.currentTime + 0.005;
  if (kind === 'floor') {
    burst({ t, dur: 0.09, gain: 0.55 * s, type: 'lowpass', freq: 700 + 500 * s, q: 0.8 });          // velvet thud
    burst({ t, dur: 0.025, gain: 0.08 * s, type: 'bandpass', freq: 3800, q: 2 });                     // corner tick
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    g.gain.setValueAtTime(0.32 * s, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1); o.connect(g).connect(master); o.start(t); o.stop(t + 0.12);
  } else if (kind === 'wall') {
    burst({ t, dur: 0.02, gain: 0.25 * s, type: 'highpass', freq: 2500, q: 0.7 });
    ping({ t, f0: 1650 + Math.random() * 500, partials: METAL, dur: 0.55, gain: 0.16 * s, reverb: 0.25 });
  } else {
    burst({ t, dur: 0.018, gain: 0.3 * s, type: 'highpass', freq: 3000, q: 0.7 });
    ping({ t, f0: 2700 + Math.random() * 600, partials: METAL, dur: 0.22, gain: 0.13 * s, reverb: 0.12 });
  }
}

export function rattle(strength = 0.6) {
  if (!ready()) return;
  const t = ctx.currentTime;
  impact({ kind: 'die', strength: 4 * strength });
  if (Math.random() < 0.6) {
    const t2 = t + 0.03 + Math.random() * 0.04;
    burst({ t: t2, dur: 0.015, gain: 0.12 * strength, type: 'highpass', freq: 3500 });
    ping({ t: t2, f0: 3000 + Math.random() * 500, partials: METAL.slice(0, 2), dur: 0.12, gain: 0.06 * strength });
  }
}

function note(t, f, dur, gain, type = 'sine', rev = 0.5) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); const s = ctx.createGain(); s.gain.value = rev; g.connect(s).connect(wet);
  o.start(t); o.stop(t + dur + 0.05);
}

export function reveal() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { note(t + i * 0.085, f, 1.8, 0.09); note(t + i * 0.085, f * 2.01, 0.9, 0.025); });
  [261.6, 329.6, 392].forEach((f) => note(t, f, 2.4, 0.045, 'triangle', 0.7));
  burst({ t: t + 0.1, dur: 1.4, gain: 0.03, type: 'highpass', freq: 7000, reverb: 0.6 });
}

export function jackpot() {
  if (!ready()) return;
  const t = ctx.currentTime + 0.02;
  const seq = [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093, 2637];
  seq.forEach((f, i) => { note(t + i * 0.07, f, 2.2, 0.085); note(t + i * 0.07, f * 1.5, 1.2, 0.02); });
  [130.8, 196, 261.6, 329.6].forEach((f) => note(t, f, 3.2, 0.06, 'triangle', 0.8));
  for (let k = 0; k < 6; k++) burst({ t: t + 0.6 + k * 0.22, dur: 0.6, gain: 0.05, type: 'bandpass', freq: 5000 + Math.random() * 3000, q: 3, reverb: 0.7 });
  [2093, 2637, 3136].forEach((f, i) => note(t + 0.9 + i * 0.12, f, 1.6, 0.05));
}

export function tap() {
  if (!ready()) return;
  const t = ctx.currentTime;
  ping({ t, f0: 2400, partials: METAL.slice(0, 2), dur: 0.12, gain: 0.04, reverb: 0.05 });
}
