import * as THREE from 'three';

const PIPS = {
  1: [[0.5, 0.5]],
  2: [[0.31, 0.31], [0.69, 0.69]],
  3: [[0.31, 0.31], [0.5, 0.5], [0.69, 0.69]],
  4: [[0.31, 0.31], [0.69, 0.31], [0.31, 0.69], [0.69, 0.69]],
  5: [[0.31, 0.31], [0.69, 0.31], [0.5, 0.5], [0.31, 0.69], [0.69, 0.69]],
  6: [[0.31, 0.29], [0.31, 0.5], [0.31, 0.71], [0.69, 0.29], [0.69, 0.5], [0.69, 0.71]]
};

/**
 * Procedural PBR maps for one die face: engraved, polished-black pips in brushed gold.
 * Returns { map, normalMap, rmMap } (rmMap: G = roughness, B = metalness).
 */
export function faceTextures(value, size, anisotropy) {
  const r = value === 1 ? 0.105 : 0.078;
  const pips = PIPS[value];
  const N = size;
  const height = new Float32Array(N * N);
  const pipMask = new Float32Array(N * N);
  const rimW = 0.012;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N, v = (y + 0.5) / N;
      let h = 0, m = 0;
      for (const [px, py] of pips) {
        const d = Math.hypot(u - px, v - py);
        if (d < r + rimW) {
          if (d < r) {
            const t = d / r;
            h = Math.min(h, -Math.sqrt(1 - t * t) * 0.9 - 0.1);   // spherical bowl
            m = Math.max(m, 1);
          } else {
            const t = (d - r) / rimW;                              // soft chamfered rim
            h = Math.min(h, -0.1 * (1 - t) * (1 - t));
            m = Math.max(m, (1 - t) * 0.35);
          }
        }
      }
      height[y * N + x] = h;
      pipMask[y * N + x] = m;
    }
  }
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = N; return c; };
  const cColor = mk(), cNormal = mk(), cRM = mk();
  const gC = cColor.getContext('2d'), gN = cNormal.getContext('2d'), gR = cRM.getContext('2d');
  const iC = gC.createImageData(N, N), iN = gN.createImageData(N, N), iR = gR.createImageData(N, N);
  const strength = N * 0.018;
  // seeded noise for a faint brushed finish
  let seed = value * 9301 + 49297;
  const rand = () => ((seed = (seed * 233280 + 49297) % 2147483647) / 2147483647);
  const brush = new Float32Array(N);
  for (let y = 0; y < N; y++) brush[y] = rand();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, o = i * 4;
      const hL = height[y * N + Math.max(0, x - 1)], hR = height[y * N + Math.min(N - 1, x + 1)];
      const hU = height[Math.max(0, y - 1) * N + x], hD = height[Math.min(N - 1, y + 1) * N + x];
      let nx = (hL - hR) * strength, ny = (hD - hU) * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      iN.data[o] = (nx * 0.5 + 0.5) * 255; iN.data[o + 1] = (ny * 0.5 + 0.5) * 255; iN.data[o + 2] = (nz * 0.5 + 0.5) * 255; iN.data[o + 3] = 255;
      const m = pipMask[i];
      const depth = -height[i];
      // colour: gold (white tint, material colour supplies the gold) → deep black lacquer in pips
      const g = 255 * (1 - m) + (14 + 10 * (1 - depth)) * m;
      iC.data[o] = g; iC.data[o + 1] = g; iC.data[o + 2] = g; iC.data[o + 3] = 255;
      const rough = (0.19 + brush[y] * 0.035 + ((x * 7 + y * 13) % 11) / 400) * (1 - m) + 0.22 * m;
      const metal = 1 - m;
      iR.data[o] = 0; iR.data[o + 1] = rough * 255; iR.data[o + 2] = metal * 255; iR.data[o + 3] = 255;
    }
  }
  gC.putImageData(iC, 0, 0); gN.putImageData(iN, 0, 0); gR.putImageData(iR, 0, 0);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: tex(cColor, true), normalMap: tex(cNormal, false), rmMap: tex(cRM, false) };
}

/** Black velvet with fine fibres, a soft vignette and the MK Jewels logo pressed into the pile. */
export function velvetTextures(w, d, logoImg, anisotropy, size = 1024) {
  const W = size, H = Math.round(size * d / w);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0a09'; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    img.data[i] += n; img.data[i + 1] += n * 0.92; img.data[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);
  const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.7);
  vg.addColorStop(0, 'rgba(70,52,26,0.16)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);

  // bump canvas (logo + lettering pressed into the velvet)
  const b = document.createElement('canvas'); b.width = W; b.height = H;
  const gb = b.getContext('2d');
  gb.fillStyle = '#808080'; gb.fillRect(0, 0, W, H);

  const drawBrand = (ctx, mode) => {
    if (logoImg) {
      const lh = H * (H > W ? 0.3 : 0.42), lw = lh * logoImg.width / logoImg.height;
      ctx.save();
      if (mode === 'color') { ctx.globalAlpha = 0.085; ctx.drawImage(logoImg, (W - lw) / 2, (H - lh) / 2, lw, lh); }
      else { ctx.filter = 'brightness(0)'; ctx.globalAlpha = 0.55; ctx.drawImage(logoImg, (W - lw) / 2, (H - lh) / 2, lw, lh); }
      ctx.restore();
    }
    const fs = Math.round(Math.min(W, H) * 0.032);
    ctx.save();
    ctx.font = `500 ${fs}px "Jost", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${fs * 0.9}px`;
    ctx.fillStyle = mode === 'color' ? 'rgba(212,180,119,0.34)' : 'rgba(0,0,0,0.5)';
    ctx.fillText('MK JEWELS', W / 2 + fs * 0.45, H - fs * 2.2);
    ctx.restore();
  };
  drawBrand(g, 'color');
  drawBrand(gb, 'bump');
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = anisotropy;
  const bump = new THREE.CanvasTexture(b); bump.anisotropy = anisotropy;
  return { map, bump };
}

export function glowSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(240,200,120,0.55)'); gr.addColorStop(1, 'rgba(212,175,55,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function contactShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
