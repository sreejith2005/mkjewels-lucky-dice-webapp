/** CSS-3D dice for devices without WebGL. Same surface API as DiceStage (subset). */
const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, 90], 4: [0, -90], 5: [90, 0], 6: [180, 0] };
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACES = [[1, 'translateZ(37px)'], [6, 'rotateY(180deg) translateZ(37px)'], [2, 'rotateX(90deg) translateZ(37px)'], [5, 'rotateX(-90deg) translateZ(37px)'], [3, 'rotateY(-90deg) translateZ(37px)'], [4, 'rotateY(90deg) translateZ(37px)']];

export class FallbackStage {
  constructor(host) {
    this.listeners = {}; this.state = 'idle';
    this.el = document.createElement('div'); this.el.className = 'fb-stage';
    this.dice = [0, 1].map(() => {
      const d = document.createElement('div'); d.className = 'fb-die';
      d.innerHTML = FACES.map(([v, t]) => `<div class="fb-face" style="transform:${t}">${Array.from({ length: 9 }, (_, i) => (PIPS[v].includes(i + 1) ? '<i></i>' : '<span></span>')).join('')}</div>`).join('');
      this.el.appendChild(d); return d;
    });
    this.spins = [0, 0];
    this.set([6, 6], 0);
    host.appendChild(this.el);
  }
  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
  emit(ev, d) { (this.listeners[ev] || []).forEach((f) => f(d)); }
  set(values, turns) {
    this.dice.forEach((d, i) => {
      this.spins[i] += turns;
      const [x, y] = FACE_ROT[values[i]];
      d.style.transform = `rotateX(${-x + 360 * this.spins[i] - 18}deg) rotateY(${-y + 360 * this.spins[i] + (i ? 14 : -14)}deg)`;
    });
  }
  setLocked() {}
  shakeInput() {}
  beginAwait() {
    if (this.state !== 'idle') return;
    this.state = 'awaiting';
    this.dice.forEach((d) => { d.style.transition = 'transform .35s'; });
    this.set([2, 4], 1);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.emit('rattle', { strength: 0.6 }), 160);
  }
  cancelAwait() { clearInterval(this.timer); this.state = 'idle'; }
  reset() { this.cancelAwait(); this.set([6, 6], 0); }
  showResult(values) { this.set(values, 0); this.state = 'settled'; }
  throw(values) {
    clearInterval(this.timer); this.state = 'rolling';
    this.dice.forEach((d) => { d.style.transition = ''; });
    this.set(values, 3); this.emit('throw');
    [300, 650, 1000, 1350, 1700].forEach((t, i) => setTimeout(() => this.emit('impact', { kind: ['floor', 'dice', 'wall'][i % 3], strength: 8 - i * 1.2, pan: 0 }), t));
    return new Promise((r) => setTimeout(() => { this.state = 'settled'; this.emit('settled'); r(); }, 2100));
  }
  dispose() { clearInterval(this.timer); this.el.remove(); }
}
