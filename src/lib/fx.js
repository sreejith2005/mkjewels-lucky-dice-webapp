/** Golden confetti & fireworks on a lightweight 2D overlay canvas. */
let canvas, g, parts = [], raf = 0, last = 0;
const GOLDS = ['#f6e3b4', '#e8cc8d', '#d4b477', '#c9a45c', '#d4af37', '#fff8e7', '#b8924f'];
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensure() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  g = canvas.getContext('2d');
  const size = () => { const d = Math.min(2, devicePixelRatio || 1); canvas.width = innerWidth * d; canvas.height = innerHeight * d; g.setTransform(d, 0, 0, d, 0, 0); };
  size(); addEventListener('resize', size);
}

function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0.016); last = now;
  g.clearRect(0, 0, innerWidth, innerHeight);
  parts = parts.filter((p) => p.life > 0);
  for (const p of parts) {
    p.life -= dt;
    p.vy += p.grav * dt; p.vx *= Math.pow(p.drag, dt * 60); p.vy *= Math.pow(p.drag, dt * 60);
    p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    const a = Math.min(1, p.life / p.fade);
    g.save(); g.globalAlpha = a; g.translate(p.x, p.y);
    if (p.kind === 'flake') {
      g.rotate(p.rot); g.scale(1, Math.abs(Math.cos(p.rot * 1.7)) + 0.15);
      g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
    } else {
      g.globalCompositeOperation = 'lighter';
      const r = p.size * (0.6 + a * 0.6);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r * 3);
      gr.addColorStop(0, p.color); gr.addColorStop(0.3, p.color + '88'); gr.addColorStop(1, p.color + '00');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r * 3, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }
  if (parts.length) raf = requestAnimationFrame(tick); else { raf = 0; g.clearRect(0, 0, innerWidth, innerHeight); }
}
function start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

export function confetti(amount = 140, origin = { x: innerWidth / 2, y: innerHeight * 0.35 }) {
  if (reduce) amount = Math.round(amount / 4);
  ensure();
  for (let i = 0; i < amount; i++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2, sp = 260 + Math.random() * 520;
    parts.push({ kind: 'flake', x: origin.x + (Math.random() - 0.5) * 60, y: origin.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      grav: 520, drag: 0.965, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, size: 6 + Math.random() * 8,
      color: GOLDS[(Math.random() * GOLDS.length) | 0], life: 2.6 + Math.random() * 1.6, fade: 0.8 });
  }
  start();
}

export function sparkle(amount = 60, origin = { x: innerWidth / 2, y: innerHeight * 0.35 }) {
  ensure();
  for (let i = 0; i < amount; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 160;
    parts.push({ kind: 'spark', x: origin.x, y: origin.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 30, grav: 30, drag: 0.97,
      rot: 0, vr: 0, size: 1.2 + Math.random() * 2, color: '#ffe8b0', life: 0.8 + Math.random() * 0.9, fade: 0.6 });
  }
  start();
}

export function fireworks(bursts = 7) {
  ensure();
  const n = reduce ? 2 : bursts;
  for (let b = 0; b < n; b++) {
    setTimeout(() => {
      const cx = innerWidth * (0.15 + Math.random() * 0.7), cy = innerHeight * (0.12 + Math.random() * 0.35);
      const color = ['#ffe6a8', '#f6d27a', '#fff8e7', '#e9c46a'][(Math.random() * 4) | 0];
      const count = 70 + ((Math.random() * 40) | 0);
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + Math.random() * 0.1, sp = 120 + Math.random() * 190;
        parts.push({ kind: 'spark', x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, grav: 90, drag: 0.955,
          rot: 0, vr: 0, size: 1.4 + Math.random() * 1.8, color, life: 1.3 + Math.random() * 0.8, fade: 0.9 });
      }
      start();
    }, b * 380 + Math.random() * 200);
  }
}
