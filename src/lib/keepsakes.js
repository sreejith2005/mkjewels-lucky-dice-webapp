/** Downloadable, shareable PNGs: the coupon card and branded QR cards. */
import { qrCanvas, roundRect } from './qr.js';
import { prettyDate } from './ui.js';

const logo = new Image();
logo.src = import.meta.env.BASE_URL + 'brand/mk-logo.png';
const logoReady = new Promise((r) => { logo.onload = r; logo.onerror = r; });
const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = '"Jost", "Helvetica Neue", Arial, sans-serif';

function goldGradient(g, x0, y0, x1, y1) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#f6e3b4'); gr.addColorStop(0.45, '#d4b477'); gr.addColorStop(0.7, '#e9cf95'); gr.addColorStop(1, '#a8803e');
  return gr;
}
function spaced(g, text, x, y, spacing) {
  if ('letterSpacing' in g) { g.letterSpacing = spacing + 'px'; g.fillText(text, x + spacing / 2, y); g.letterSpacing = '0px'; return; }
  g.fillText(text.split('').join(' '), x, y);
}
function frame(g, W, H) {
  const bg = g.createRadialGradient(W / 2, H * 0.3, 50, W / 2, H * 0.4, H * 0.9);
  bg.addColorStop(0, '#1e1810'); bg.addColorStop(0.55, '#0d0b09'); bg.addColorStop(1, '#060606');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = goldGradient(g, 0, 0, W, H); g.lineWidth = 3; roundRect(g, 36, 36, W - 72, H - 72, 22); g.stroke();
  g.globalAlpha = 0.45; g.lineWidth = 1; roundRect(g, 52, 52, W - 104, H - 104, 14); g.stroke(); g.globalAlpha = 1;
}
function drawLogo(g, cx, y, h) {
  if (!logo.naturalWidth) return y;
  const w = h * logo.naturalWidth / logo.naturalHeight;
  g.drawImage(logo, cx - w / 2, y, w, h);
  return y + h;
}
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

export async function couponPng(r) {
  await logoReady; if (document.fonts) await document.fonts.ready;
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  frame(g, W, H);
  let y = drawLogo(g, W / 2, 110, 230) + 70;
  g.fillStyle = '#d4b477'; g.font = `500 26px ${SANS}`; spaced(g, 'LUCKY DOUBLE DICE', W / 2, y, 10);
  y += 78;
  g.fillStyle = '#fff8e7'; g.font = `italic 500 52px ${SERIF}`; g.fillText(`Congratulations, ${r.firstName}`, W / 2, y);
  y += 175;
  g.fillStyle = goldGradient(g, 0, y - 150, 0, y);
  g.font = `600 190px ${SERIF}`; g.fillText(`${r.offer}% OFF`, W / 2, y);
  y += 62; g.fillStyle = '#e8d6ae'; g.font = `500 30px ${SANS}`; spaced(g, 'ON MAKING CHARGES', W / 2, y, 9);
  if (r.jackpot) { y += 58; g.fillStyle = '#d4af37'; g.font = `600 28px ${SANS}`; spaced(g, '✦ DOUBLE SIX JACKPOT ✦', W / 2, y, 8); }
  y += 70;
  g.strokeStyle = 'rgba(212,180,119,0.55)'; g.setLineDash([10, 10]); g.lineWidth = 2;
  roundRect(g, 170, y, W - 340, 170, 18); g.stroke(); g.setLineDash([]);
  g.fillStyle = '#a89878'; g.font = `500 22px ${SANS}`; spaced(g, 'COUPON CODE', W / 2, y + 52, 8);
  g.fillStyle = '#fff8e7'; g.font = `600 58px ${SANS}`; spaced(g, r.couponCode, W / 2, y + 125, 4);
  y += 230;
  g.fillStyle = '#cdbb95'; g.font = `400 28px ${SANS}`;
  g.fillText(`Dice ${r.dice[0]} + ${r.dice[1]} = ${r.total}   ·   Valid until ${prettyDate(r.expiresOn)}`, W / 2, y);
  y += 60;
  g.fillStyle = '#8a7d63'; g.font = `400 21px ${SANS}`;
  g.fillText('Applicable on making charges only. Single use. Verification required at redemption.', W / 2, y);
  g.fillText('Present this coupon at any MK Jewels store or to our online consultant.', W / 2, y + 34);
  g.fillStyle = '#d4b477'; g.font = `500 22px ${SANS}`; spaced(g, 'MUMBAI  |  AHMEDABAD  ·  SINCE 1999', W / 2, H - 96, 6);
  return toBlob(c);
}

export async function qrCardPng({ title, subtitle, url, r }) {
  await logoReady; if (document.fonts) await document.fonts.ready;
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.textAlign = 'center';
  frame(g, W, H);
  let y = drawLogo(g, W / 2, 96, 170) + 76;
  g.fillStyle = goldGradient(g, 0, y - 50, 0, y); g.font = `600 58px ${SERIF}`; g.fillText(title, W / 2, y);
  y += 50; g.fillStyle = '#cdbb95'; g.font = `400 27px ${SANS}`; g.fillText(subtitle, W / 2, y);
  y += 44;
  const q = await qrCanvas(url, 560);
  g.fillStyle = '#fff8e7'; roundRect(g, (W - 600) / 2, y, 600, 600, 26); g.fill();
  g.drawImage(q, (W - 560) / 2, y + 20, 560, 560);
  y += 680;
  g.fillStyle = '#fff8e7'; g.font = `600 44px ${SERIF}`; g.fillText(`${r.offer}% OFF on making charges`, W / 2, y);
  y += 52; g.fillStyle = '#a89878'; g.font = `500 26px ${SANS}`; spaced(g, r.couponCode, W / 2, y, 5);
  y += 44; g.font = `400 23px ${SANS}`; g.fillText(`Valid until ${prettyDate(r.expiresOn)}`, W / 2, y);
  g.fillStyle = '#d4b477'; g.font = `500 22px ${SANS}`; spaced(g, 'MK JEWELS · SINCE 1999', W / 2, H - 96, 6);
  return toBlob(c);
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Native share sheet with the image where supported, else WhatsApp text share. */
export async function shareImage(blob, name, text) {
  try {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return true; }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  return false;
}
