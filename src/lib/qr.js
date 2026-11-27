import QRCode from 'qrcode';

const logo = new Image();
logo.src = import.meta.env.BASE_URL + 'brand/mk-logo-sm.png';
const ready = new Promise((r) => { logo.onload = r; logo.onerror = r; });

/** Scannable QR (error-correction H) with the MK monogram in the centre. */
export async function qrCanvas(text, size = 520) {
  await ready;
  const c = document.createElement('canvas');
  await QRCode.toCanvas(c, text, { errorCorrectionLevel: 'H', margin: 2, width: size, color: { dark: '#0b0a08', light: '#fff8e7' } });
  if (logo.naturalWidth) {
    const g = c.getContext('2d');
    const box = size * 0.2;
    const x = (size - box) / 2, y = (size - box) / 2;
    g.fillStyle = '#0b0a08';
    roundRect(g, x, y, box, box, box * 0.18); g.fill();
    // top (monogram) part of the logo only
    const sh = logo.naturalHeight * 0.72;
    const lw = box * 0.62, lh = lw * sh / logo.naturalWidth;
    const h = Math.min(lh, box * 0.8), w = h * logo.naturalWidth / sh;
    g.drawImage(logo, 0, 0, logo.naturalWidth, sh, (size - w) / 2, (size - h) / 2, w, h);
  }
  return c;
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
