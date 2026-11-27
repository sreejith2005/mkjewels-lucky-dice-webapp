import './styles/app.css';
import { api } from './api.js';
import { PREVIEW, claimUrl, PUBLIC_URL } from './config.js';
import { $, $$, esc, toast, copyText, calendar, chips, countUp, prettyDate, addDays, istToday, time12, monthNames, googleCalendarUrl, icsFile } from './lib/ui.js';
import { countryOptions, validatePhone } from './lib/phone.js';
import { qrCanvas } from './lib/qr.js';
import { couponPng, qrCardPng, downloadBlob, shareImage } from './lib/keepsakes.js';
import * as sfx from './lib/audio.js';
import { haptic, hapticPattern } from './lib/haptics.js';
import { confetti, fireworks, sparkle } from './lib/fx.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SESSION_KEY = 'mk_ldd_session';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* */ } }
};
const DEFAULT_CONFIG = {
  branches: [
    { id: 'BANDRA', name: 'Bandra', city: 'Mumbai' }, { id: 'ANDHERI', name: 'Andheri', city: 'Mumbai' }, { id: 'ZAVERI', name: 'Zaveri Bazaar', city: 'Mumbai' },
    { id: 'CGROAD', name: 'C.G. Road', city: 'Ahmedabad' }, { id: 'SINDHUBHAVAN', name: 'Sindhu Bhavan Road', city: 'Ahmedabad' }],
  storeSlots: ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
  bookingDaysAhead: 30, closedWeekdays: [], onlineWindows: ['10:00 – 12:00', '12:00 – 16:00', '16:00 – 20:00'],
  contactMethods: ['WhatsApp', 'Phone call', 'Video call'],
  interests: ['Gold Jewellery', 'Diamond Jewellery', 'Bridal Jewellery', 'Necklace', 'Earrings', 'Bangles', 'Bracelet', 'Rings', 'Pendant', 'Mangalsutra', 'Other'],
  today: istToday()
};

const S = { config: DEFAULT_CONFIG, session: store.get(SESSION_KEY), firstName: '', result: null, stage: null, rolling: false, claim: null };

/* ================================================================ loader */
const loader = { el: $('#loader'), msg: $('.ld-msg'), bar: $('.ld-bar i') };
function progress(p, msg) { loader.bar.style.setProperty('--p', `${p}%`); if (msg) loader.msg.textContent = msg; }
function hideLoader() { progress(100); setTimeout(() => loader.el.classList.add('done'), 250); }

/* ================================================================ views */
const views = $$('.view');
let current = null;
function go(name, { scroll = true } = {}) {
  views.forEach((v) => { v.hidden = v.dataset.view !== name; });
  current = name;
  const host = { welcome: '#stage-welcome', play: '#stage-play' }[name];
  if (host && S.stage) S.stage.mount($(host));
  if (S.stage && S.stage.setEnabled) S.stage.setEnabled(name === 'play' || name === 'welcome');
  if (scroll) window.scrollTo(0, 0);
  document.title = { welcome: 'MK Jewels – Lucky Double Dice', register: 'Register · MK Jewels Lucky Double Dice', play: 'The Golden Roll · MK Jewels', online: 'Claim online · MK Jewels', store: 'Book your store visit · MK Jewels' }[name] || document.title;
}

function showMessage(title, body, cta) {
  $('#msg-title').textContent = title; $('#msg-body').textContent = body;
  if (cta) { $('#msg-cta').textContent = cta.label; $('#msg-cta').href = cta.href; }
  go('message');
}

/* ================================================================ sound & haptics */
const soundBtn = $('.sound-toggle');
function paintSound() {
  const on = sfx.soundEnabled();
  soundBtn.innerHTML = `<svg class="icon"><use href="#i-${on ? 'sound' : 'mute'}"/></svg>`;
  soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.setAttribute('aria-label', on ? 'Sound on — tap to mute' : 'Sound off — tap to unmute');
}
soundBtn.addEventListener('click', () => { sfx.setSound(!sfx.soundEnabled()); paintSound(); sfx.tap(); });
paintSound();
addEventListener('pointerdown', () => sfx.unlockAudio(), { capture: true });
addEventListener('keydown', () => sfx.unlockAudio(), { capture: true });

let lastHaptic = 0;
function wireStage(stage) {
  stage.on('impact', (e) => {
    sfx.impact(e);
    const now = performance.now();
    if (e.strength > 2.2 && now - lastHaptic > 55) { lastHaptic = now; haptic(e.kind === 'floor' ? Math.min(22, 6 + e.strength * 1.4) : 9); }
  });
  stage.on('rattle', (e) => { sfx.rattle(e.strength); const now = performance.now(); if (now - lastHaptic > 90) { lastHaptic = now; haptic(5); } });
  stage.on('grab', () => startRoll('drag'));
  stage.on('release', ({ velocity }) => { S.throwVelocity = velocity; S.released = true; S.tryThrow && S.tryThrow(); });
}

/* ================================================================ registration */
function buildRegistration() {
  const sel = $('#f-cc');
  const { top, rest } = countryOptions();
  const opt = (c) => `<option value="${c.iso}" ${c.iso === 'IN' ? 'selected' : ''}>${esc(c.name)} (+${c.code})</option>`;
  sel.innerHTML = `<optgroup label="Popular">${top.map(opt).join('')}</optgroup><optgroup label="All countries">${rest.map(opt).join('')}</optgroup>`;
  const syncCc = () => {
    const c = [...top, ...rest].find((x) => x.iso === sel.value);
    $('#cc-label').textContent = `+${c.code}`;
    const india = sel.value === 'IN';
    $('#pin-label').textContent = india ? 'PIN code' : 'Postal code';
    $('#f-pin').placeholder = india ? 'Enter your PIN code' : 'Enter your postal code';
    $('#f-pin').inputMode = india ? 'numeric' : 'text';
    $('#f-phone').maxLength = india ? 11 : 15;
  };
  sel.addEventListener('change', syncCc); syncCc();

  const cities = ['Mumbai', 'Ahmedabad', 'Thane', 'Navi Mumbai', 'Pune', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar', 'Delhi', 'New Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata',
    'Jaipur', 'Lucknow', 'Indore', 'Nagpur', 'Nashik', 'Bhopal', 'Kalyan', 'Vasai-Virar', 'Mira-Bhayandar', 'Bhiwandi', 'Panvel', 'Anand', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Mehsana',
    'Vapi', 'Valsad', 'Bharuch', 'Navsari', 'Udaipur', 'Jodhpur', 'Chandigarh', 'Ludhiana', 'Amritsar', 'Kochi', 'Coimbatore', 'Goa', 'Aurangabad', 'Kolhapur', 'Dubai', 'Abu Dhabi', 'London', 'New York', 'Singapore'];
  $('#city-list').innerHTML = cities.map((c) => `<option value="${c}">`).join('');

  const year = Number(istToday().slice(0, 4));
  const dmy = (host, minY, maxY) => {
    host.innerHTML = `
      <select class="select" aria-label="Day"><option value="">Day</option>${Array.from({ length: 31 }, (_, i) => `<option>${i + 1}</option>`).join('')}</select>
      <select class="select" aria-label="Month"><option value="">Month</option>${monthNames.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select>
      <select class="select" aria-label="Year"><option value="">Year</option>${Array.from({ length: maxY - minY + 1 }, (_, i) => `<option>${maxY - i}</option>`).join('')}</select>`;
    const [d, m, y] = $$('select', host);
    return {
      value() {
        if (!d.value && !m.value && !y.value) return '';
        if (!d.value || !m.value || !y.value) return 'PARTIAL';
        const s = `${y.value}-${String(m.value).padStart(2, '0')}-${String(d.value).padStart(2, '0')}`;
        const dt = new Date(s + 'T00:00:00Z');
        return dt.toISOString().slice(0, 10) === s ? s : 'INVALID';
      },
      clear() { d.value = m.value = y.value = ''; }
    };
  };
  const dob = dmy($('#dob'), year - 100, year - 10);
  const ann = dmy($('#anniv'), year - 75, year);
  $('#anniv-na').addEventListener('change', (e) => { $('#anniv').classList.toggle('disabled', e.target.checked); if (e.target.checked) ann.clear(); setErr('anniversary', ''); });

  // PIN → city/state suggestion (India Post public directory, best-effort)
  let pinMeta = { state: '', country: 'India' };
  const pinHint = $('#pin-hint');
  $('#f-pin').addEventListener('input', async (e) => {
    const v = e.target.value.replace(/\s/g, '');
    if (sel.value !== 'IN') { pinHint.hidden = true; return; }
    e.target.value = v.replace(/\D/g, '').slice(0, 6);
    if (!/^[1-9]\d{5}$/.test(e.target.value)) { pinHint.hidden = true; pinMeta.state = ''; return; }
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(`https://api.postalpincode.in/pincode/${e.target.value}`, { signal: ctrl.signal }); clearTimeout(t);
      const data = await res.json();
      const po = data && data[0] && data[0].Status === 'Success' && data[0].PostOffice && data[0].PostOffice[0];
      if (!po) { pinHint.hidden = false; pinHint.className = 'hint'; pinHint.textContent = 'We could not verify this PIN code — please double-check it.'; return; }
      pinMeta.state = po.State;
      const city = po.District === 'Mumbai Suburban' || po.District === 'Mumbai City' ? 'Mumbai' : po.District;
      const cityInput = $('#f-city');
      if (!cityInput.value.trim()) cityInput.value = city;
      pinHint.hidden = false; pinHint.className = 'hint ok';
      pinHint.textContent = `✓ ${po.Name}, ${city}, ${po.State}`;
    } catch (err) { pinHint.hidden = true; }
  });

  const fields = {
    name: () => { const v = $('#f-name').value.replace(/\s+/g, ' ').trim(); if (v.length < 2) return 'Please enter your full name'; if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v)) return 'Please use letters only'; return ''; },
    phone: () => { const r = validatePhone(sel.value, $('#f-phone').value); return r.ok ? '' : r.error; },
    city: () => { const v = $('#f-city').value.trim(); if (v.length < 2) return 'Please enter your city'; if (!/^[\p{L}\p{M}][\p{L}\p{M} .'()-]*$/u.test(v)) return 'Please enter a valid city name'; return ''; },
    pincode: () => { const v = $('#f-pin').value.trim(); if (sel.value === 'IN') return /^[1-9]\d{5}$/.test(v) ? '' : 'Enter a valid 6-digit PIN code'; return /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(v) ? '' : 'Enter a valid postal code'; },
    birthday: () => { const v = dob.value(); if (v === 'PARTIAL') return 'Please complete day, month and year — or leave all blank'; if (v === 'INVALID') return 'That date does not exist'; if (v && v > istToday()) return 'Birthday cannot be in the future'; return ''; },
    anniversary: () => { if ($('#anniv-na').checked) return ''; const v = ann.value(); if (v === 'PARTIAL') return 'Please complete day, month and year — or choose Not applicable'; if (v === 'INVALID') return 'That date does not exist'; if (v && v > istToday()) return 'Anniversary cannot be in the future'; return ''; }
  };
  const fieldEl = (k) => $(`[data-f="${k}"]`);
  const setErr = (k, msg) => { const f = fieldEl(k); if (!f) return; f.classList.toggle('invalid', !!msg); $('.err', f).textContent = msg; };
  Object.keys(fields).forEach((k) => {
    const f = fieldEl(k);
    f.addEventListener('focusout', () => { if (f.dataset.touched) setErr(k, fields[k]()); });
    f.addEventListener('input', () => { f.dataset.touched = '1'; if (f.classList.contains('invalid')) setErr(k, fields[k]()); });
    f.addEventListener('change', () => { f.dataset.touched = '1'; if (f.classList.contains('invalid') || k === 'birthday' || k === 'anniversary') setErr(k, fields[k]()); });
  });
  $('#f-phone').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d\s-]/g, ''); });

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let first = null;
    Object.keys(fields).forEach((k) => { const m = fields[k](); setErr(k, m); if (m && !first) first = k; });
    const terms = $('#c-terms').checked;
    $('#err-terms').textContent = terms ? '' : 'Please accept the Terms & Conditions to continue';
    if (first) { const el = $('input, select', fieldEl(first)); el && el.focus({ preventScroll: true }); fieldEl(first).scrollIntoView({ behavior: 'smooth', block: 'center' }); haptic(20); return; }
    if (!terms) { haptic(20); return; }
    const phone = validatePhone(sel.value, $('#f-phone').value);
    const btn = $('#btn-register'); setBusy(btn, true, 'Unlocking your exclusive reward…');
    $('#reg-error').textContent = '';
    try {
      const res = await api('register', {
        name: $('#f-name').value, cc: phone.cc, phone: phone.national, city: $('#f-city').value, pincode: $('#f-pin').value,
        state: pinMeta.state, country: sel.value === 'IN' ? 'India' : sel.selectedOptions[0].textContent.replace(/\s*\(\+\d+\)$/, ''),
        birthday: dob.value() || '', anniversary: $('#anniv-na').checked ? '' : (ann.value() || ''),
        terms: true, marketing: $('#c-mkt').checked, source: new URLSearchParams(location.search).get('src') || ''
      });
      S.session = res.session; S.firstName = res.firstName; store.set(SESSION_KEY, res.session);
      haptic(14); sfx.tap();
      if (res.result) { S.result = res.result; enterPlay({ restored: true, returning: true }); }
      else enterPlay();
    } catch (err) {
      $('#reg-error').textContent = err.message; toast(err.message, 'error');
    } finally { setBusy(btn, false); }
  });
}

function setBusy(btn, busy, label) {
  const lbl = $('.lbl', btn);
  if (busy) { btn.dataset.label = lbl.textContent; lbl.textContent = label || 'Please wait…'; btn.disabled = true; btn.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>'); }
  else { if (btn.dataset.label) lbl.textContent = btn.dataset.label; btn.disabled = false; const s = $('.spinner', btn); s && s.remove(); }
}

/* ================================================================ play */
const playView = $('#v-play');
const rollMsg = $('#roll-msg');
let msgTimer;
function rollStatus(text) {
  clearTimeout(msgTimer);
  rollMsg.classList.remove('on');
  if (!text) return;
  msgTimer = setTimeout(() => { rollMsg.textContent = text; rollMsg.classList.add('on'); }, 120);
}

function enterPlay({ restored = false, returning = false } = {}) {
  $('#play-greeting').textContent = `Welcome, ${S.firstName}. Your golden moment has arrived.`;
  if (S.result) {
    playView.dataset.state = 'won';
    go('play');
    if (S.stage) S.stage.showResult(S.result.dice);
    revealResult(S.result, { animate: false, returning });
  } else {
    playView.dataset.state = 'ready';
    go('play');
    if (S.stage) S.stage.setMode('idle');
    rollStatus('');
    $('#btn-roll').disabled = false;
  }
  if (!restored) window.scrollTo({ top: 0 });
}

function startRoll(source) {
  if (S.rolling || S.result || current !== 'play') return;
  S.rolling = true; S.released = source === 'button'; S.throwVelocity = null;
  playView.dataset.state = 'rolling';
  $('#btn-roll').disabled = true;
  haptic(10);
  rollStatus(source === 'drag' ? 'Your fortune is in your hands…' : 'Your fortune is in motion…');
  if (source === 'button') S.stage.beginHold(true);
  const minHold = new Promise((r) => setTimeout(r, source === 'button' ? (reduced ? 300 : 1050) : 0));
  const req = api('roll', { session: S.session });
  let thrown = false;
  S.tryThrow = async () => {
    if (thrown || !S.released) return;
    thrown = true;
    try {
      const [res] = await Promise.all([req, minHold]);
      rollStatus('');
      S.result = res.result;
      if (res.existing) toast('You have already played — here is your reward.');
      await S.stage.throwTo(res.result.dice, S.throwVelocity);
      rollStatus('');
      revealResult(res.result, { animate: !res.existing });
    } catch (err) {
      rollStatus('');
      S.rolling = false;
      S.stage.cancelHold && S.stage.cancelHold();
      playView.dataset.state = 'ready'; $('#btn-roll').disabled = false;
      toast(err.message, 'error');
      if (err.code === 'NO_SESSION') { store.del(SESSION_KEY); S.session = null; setTimeout(() => go('register'), 1200); }
    }
  };
  req.catch(() => { /* handled in tryThrow */ });
  if (source === 'drag') req.then(() => { if (!thrown && !S.released) rollStatus('Release to throw the dice'); }).catch(() => { if (!thrown) { S.released = true; S.tryThrow(); } });
  S.tryThrow();
}

/* ================================================================ reveal */
async function revealResult(r, { animate, returning } = {}) {
  S.rolling = false;
  playView.dataset.state = 'won';
  const done = r.status === 'REDEEMED' || r.status === 'EXPIRED';
  $('#r-name').textContent = r.firstName;
  $('#r-eyebrow').textContent = returning ? 'Welcome back — your golden reward' : 'Your golden reward is ready';
  $('#r-jackpot').hidden = !r.jackpot;
  $('#r-dice').innerHTML = `Dice 1: <b>${r.dice[0]}</b> &nbsp;·&nbsp; Dice 2: <b>${r.dice[1]}</b> &nbsp;·&nbsp; Total: <b>${r.total}</b>`;
  $('#dice-readout').innerHTML = `<span>Dice 1:<b>${r.dice[0]}</b></span><span>Dice 2:<b>${r.dice[1]}</b></span><span>Total:<b>${r.total}</b></span>`;
  setTimeout(() => $('#dice-readout').classList.add('on'), animate ? 200 : 0);
  $('#r-code').textContent = r.couponCode;
  $('#r-issued').textContent = prettyDate(r.issuedOn);
  $('#r-expiry').textContent = prettyDate(r.expiresOn);
  $('#r-status').textContent = { ACTIVE: 'Active', REDEEMED: 'Redeemed', EXPIRED: 'Expired' }[r.status] || r.status;
  $('#coupon').classList.toggle('is-done', done);
  $('#r-stamp').hidden = !done; $('#r-stamp').textContent = r.status === 'EXPIRED' ? 'Expired' : 'Redeemed';
  $$('[data-claim]').forEach((b) => { b.disabled = done; });
  const offerEl = $('#r-offer');
  if (animate) {
    countUp(offerEl, 0, r.offer, 1500);
    if (r.jackpot) {
      sfx.jackpot(); hapticPattern([30, 60, 30, 60, 80, 100, 160]); fireworks(9); setTimeout(() => confetti(220), 500);
    } else {
      sfx.reveal(); hapticPattern([18, 70, 30]); confetti(150);
    }
    const hero = $('.reward-hero');
    setTimeout(() => { const y = hero.getBoundingClientRect().top + scrollY - (innerHeight * 0.18); if (y > scrollY + 40) window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' }); }, 1400);
  } else offerEl.textContent = r.offer;

  paintClaimStatus(r);
  // QR codes (generated client-side from server-issued tokens; identical on every visit)
  const online = claimUrl('ONLINE', r.onlineToken), storeU = claimUrl('STORE', r.storeToken);
  const [qo, qs] = await Promise.all([qrCanvas(online, 420), qrCanvas(storeU, 420)]);
  $('#qr-online').replaceChildren(qo); $('#qr-store').replaceChildren(qs);
  qo.setAttribute('role', 'img'); qo.setAttribute('aria-label', 'Online claim QR code');
  qs.setAttribute('role', 'img'); qs.setAttribute('aria-label', 'Store visit QR code');
  $('[data-qr-open="online"]').href = online; $('[data-qr-open="store"]').href = storeU;
}

function paintClaimStatus(r) {
  const o = $('#online-status'), s = $('#store-status');
  if (r.onlineClaim) {
    o.hidden = false;
    o.innerHTML = `<svg class="icon"><use href="#i-check"/></svg><span>Enquiry received. Our consultant will reach you on <b>${esc(r.onlineClaim.method)}</b>, ${esc(prettyDate(r.onlineClaim.date, true))} · ${esc(r.onlineClaim.time)}.</span>`;
    $('[data-claim="online"] .lbl').textContent = 'View or edit enquiry';
  } else o.hidden = true;
  const a = r.appointment;
  if (a && (a.status === 'CONFIRMED' || a.status === 'VISITED' || a.status === 'WALK_IN')) {
    s.hidden = false;
    s.innerHTML = a.status === 'CONFIRMED'
      ? `<svg class="icon"><use href="#i-check"/></svg><span>Visit booked at <b>${esc(a.branch)}</b>, ${esc(prettyDate(a.date, true))} · ${esc(time12(a.time))}.</span>`
      : `<svg class="icon"><use href="#i-check"/></svg><span>Thank you for visiting MK Jewels ${esc(a.branch)}.</span>`;
    $('[data-claim="store"] .lbl').textContent = a.status === 'CONFIRMED' ? 'View or reschedule visit' : 'View visit';
  } else s.hidden = true;
}

function bindResultActions() {
  $('#btn-roll').addEventListener('click', () => startRoll('button'));
  $('#btn-copy').addEventListener('click', async () => { if (await copyText(S.result.couponCode)) { toast('Coupon code copied'); haptic(10); sparkle(30, (() => { const b = $('#btn-copy').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()); } });
  $('#btn-dl-coupon').addEventListener('click', async () => { const b = await couponPng(S.result); downloadBlob(b, `MK-Jewels-${S.result.couponCode}.png`); toast('Coupon saved'); });
  $('#btn-wa-coupon').addEventListener('click', () => {
    const r = S.result;
    const text = `✨ I just won ${r.offer}% OFF on making charges at MK Jewels with the Lucky Double Dice!\nCoupon: ${r.couponCode}\nValid until ${prettyDate(r.expiresOn)}.\nTry your luck: ${PUBLIC_URL}/`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
  $$('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    const kind = b.dataset.claim;
    openClaim(kind === 'online' ? 'ONLINE' : 'STORE', kind === 'online' ? S.result.onlineToken : S.result.storeToken, true);
  }));
  $$('[data-qr-dl]').forEach((b) => b.addEventListener('click', async () => {
    const online = b.dataset.qrDl === 'online';
    const blob = await qrCardPng({ title: online ? 'Claim Online' : 'Visit Our Store', subtitle: online ? 'Scan to submit your online purchase enquiry' : 'Scan to choose your branch, date & time', url: claimUrl(online ? 'ONLINE' : 'STORE', online ? S.result.onlineToken : S.result.storeToken), r: S.result });
    downloadBlob(blob, `MK-Jewels-${online ? 'Online-Claim' : 'Store-Visit'}-QR.png`); toast('QR saved');
  }));
  $$('[data-qr-share]').forEach((b) => b.addEventListener('click', async () => {
    const online = b.dataset.qrShare === 'online';
    const url = claimUrl(online ? 'ONLINE' : 'STORE', online ? S.result.onlineToken : S.result.storeToken);
    const blob = await qrCardPng({ title: online ? 'Claim Online' : 'Visit Our Store', subtitle: online ? 'Scan to submit your online purchase enquiry' : 'Scan to choose your branch, date & time', url, r: S.result });
    await shareImage(blob, 'MK-Jewels-QR.png', `My MK Jewels reward — ${S.result.offer}% OFF on making charges. ${online ? 'Claim online' : 'Book a store visit'}: ${url}`);
  }));
}

/* ================================================================ claim flows */
function rewardStrip(reward) {
  return `<span class="rs-off gold-text">${reward.offer}%</span><span class="rs-meta">OFF on making charges<b>${esc(reward.couponCode)}</b></span><span class="rs-status">Valid till ${esc(prettyDate(reward.expiresOn))}</span>`;
}

async function openClaim(kind, token, push) {
  if (push) history.pushState({}, '', `?c=${kind === 'ONLINE' ? 'online' : 'store'}&t=${encodeURIComponent(token)}`);
  progress(30, 'Unlocking your exclusive reward…');
  let ctx;
  try { ctx = await api('resolve', { token }); } catch (err) {
    hideLoader();
    showMessage(err.code === 'BAD_TOKEN' ? 'This link is not valid' : 'We could not open your reward', err.code === 'BAD_TOKEN' ? 'Please scan the QR code from your MK Jewels reward again, or open your reward on the device you played on.' : err.message);
    return;
  }
  S.config = { ...DEFAULT_CONFIG, ...ctx.config };
  S.claim = { kind: ctx.kind, token, reward: ctx.reward, onlineClaim: ctx.onlineClaim, appointment: ctx.appointment };
  const view = ctx.kind === 'ONLINE' ? 'online' : 'store';
  go(view);
  hideLoader();
  const root = $(`#v-${view}`);
  $('[data-strip]', root).innerHTML = rewardStrip(ctx.reward);
  $('[data-back]', root).hidden = !S.session;
  const status = ctx.reward.status;
  if (status !== 'ACTIVE') {
    showDone(root, `<div class="card done-card"><img class="brand-logo sm" src="/brand/mk-logo.png" alt="" /><h3 class="display gold-text">${status === 'REDEEMED' ? 'Reward redeemed' : 'Reward expired'}</h3>
      <p class="lede small">${status === 'REDEEMED' ? 'This coupon has already been used. Thank you for celebrating with MK Jewels.' : `This coupon expired on ${esc(prettyDate(ctx.reward.expiresOn))}.`}</p></div>`);
    return;
  }
  if (ctx.kind === 'ONLINE') { buildOnlineForm(root); if (ctx.onlineClaim) showOnlineDone(root, ctx.onlineClaim); else showForm(root); }
  else { buildStoreForm(root); const a = ctx.appointment; if (a && ['CONFIRMED', 'VISITED', 'WALK_IN'].includes(a.status)) showStoreDone(root, a); else showForm(root); }
}
const showForm = (root) => { $('[data-pane="form"]', root).hidden = false; $('[data-pane="done"]', root).hidden = true; };
const showDone = (root, html) => { $('[data-pane="form"]', root).hidden = true; const d = $('[data-pane="done"]', root); d.hidden = false; d.innerHTML = html; };
const formErr = (root, key, msg) => { const e = $(`[data-e="${key}"]`, root); if (e) e.textContent = msg || ''; };

function buildOnlineForm(root) {
  const C = S.config, prev = S.claim.onlineClaim || {};
  const icons = { WhatsApp: 'i-wa', 'Phone call': 'i-phone', 'Video call': 'i-video' };
  const f = S.onlineForm = {
    interests: chips($('#o-interests'), C.interests, { multi: true, value: prev.interests || [], onChange: () => formErr(root, 'interests') }),
    method: chips($('#o-method'), C.contactMethods, { value: prev.method || null, render: (m) => `<svg class="icon"><use href="#${icons[m] || 'i-phone'}"/></svg>${esc(m)}`, onChange: () => formErr(root, 'method') }),
    cal: calendar($('#o-cal'), { min: C.today, max: addDays(C.today, C.bookingDaysAhead), value: prev.date && prev.date >= C.today ? prev.date : null, onChange: () => formErr(root, 'date') }),
    time: chips($('#o-time'), C.onlineWindows, { value: prev.time || null, onChange: () => formErr(root, 'time') })
  };
  $('#o-notes').value = prev.notes || '';
  const form = $('#online-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const errs = { interests: f.interests.value.length ? '' : 'Choose at least one', method: f.method.value ? '' : 'Choose how we should reach you', date: f.cal.value ? '' : 'Choose a day', time: f.time.value ? '' : 'Choose a time' };
    Object.entries(errs).forEach(([k, v]) => formErr(root, k, v));
    if (Object.values(errs).some(Boolean)) { haptic(20); return; }
    const btn = $('button[type=submit]', form); setBusy(btn, true, 'Sending…'); formErr(root, 'form', '');
    try {
      const res = await api('submitOnline', { token: S.claim.token, interests: f.interests.value, method: f.method.value, date: f.cal.value, time: f.time.value, notes: $('#o-notes').value });
      S.claim.onlineClaim = res.onlineClaim;
      if (S.result && S.result.onlineToken === S.claim.token) { S.result.onlineClaim = res.onlineClaim; paintClaimStatus(S.result); }
      sfx.reveal(); hapticPattern([15, 50, 25]); confetti(70);
      showOnlineDone(root, res.onlineClaim);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { formErr(root, 'form', err.message); toast(err.message, 'error'); } finally { setBusy(btn, false); }
  };
}

function showOnlineDone(root, c) {
  showDone(root, `<div class="card done-card">
    <div class="done-mark"><svg class="icon"><use href="#i-check"/></svg></div>
    <p class="eyebrow">Enquiry received</p>
    <h3 class="display gold-text">Your consultant will be in touch</h3>
    <p class="lede small">We'll reach you on <b>${esc(c.method)}</b> on ${esc(prettyDate(c.date, true))}, between ${esc(c.time)}, with pieces chosen for you and your reward applied.</p>
    <div class="summary">
      <div><span>Reference</span><b>${esc(c.id)}</b></div>
      <div><span>Interested in</span><b>${esc((c.interests || []).join(', '))}</b></div>
      <div><span>Coupon</span><b>${esc(S.claim.reward.couponCode)} · ${S.claim.reward.offer}% off</b></div>
    </div>
    <div class="done-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-edit><svg class="icon"><use href="#i-cal"/></svg>Edit enquiry</button>
      <a class="btn btn-ghost btn-sm" href="https://www.mkjewels.in" target="_blank" rel="noopener"><svg class="icon"><use href="#i-link"/></svg>Browse jewellery</a>
    </div></div>`);
  $('[data-edit]', root).onclick = () => { buildOnlineForm(root); showForm(root); };
}

function buildStoreForm(root) {
  const C = S.config, prev = S.claim.appointment && S.claim.appointment.status === 'CONFIRMED' ? S.claim.appointment : {};
  const cities = [...new Set(C.branches.map((b) => b.city))];
  const st = S.storeForm = { city: prev.city || cities[0], branchId: prev.branchId || null, date: prev.date && prev.date >= C.today ? prev.date : null, time: prev.time || null };
  const seg = $('#s-city');
  const drawSeg = () => { seg.innerHTML = cities.map((c) => `<button type="button" role="tab" aria-selected="${c === st.city}" class="${c === st.city ? 'on' : ''}" data-city="${esc(c)}">${esc(c)}</button>`).join(''); };
  const drawBranches = () => {
    $('#s-branches').innerHTML = C.branches.filter((b) => b.city === st.city).map((b) => `
      <button type="button" class="branch ${b.id === st.branchId ? 'on' : ''}" data-b="${b.id}" aria-pressed="${b.id === st.branchId}">
        <span class="claim-ic"><svg class="icon"><use href="#i-store"/></svg></span>
        <span><b>${esc(b.name)}</b><small>MK Jewels · ${esc(b.city)}</small></span><span class="radio"></span></button>`).join('');
  };
  seg.onclick = (e) => { const b = e.target.closest('[data-city]'); if (!b) return; st.city = b.dataset.city; st.branchId = null; st.time = null; drawSeg(); drawBranches(); loadSlots(); haptic(6); };
  $('#s-branches').onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; st.branchId = b.dataset.b; st.time = null; drawBranches(); formErr(root, 'branch'); loadSlots(); haptic(6); };
  const cal = calendar($('#s-cal'), { min: C.today, max: addDays(C.today, C.bookingDaysAhead), closedWeekdays: C.closedWeekdays, value: st.date, onChange: (v) => { st.date = v; st.time = null; formErr(root, 'date'); loadSlots(); } });
  const slotsEl = $('#s-slots');
  let slotReq = 0;
  async function loadSlots() {
    if (!st.branchId || !st.date) { slotsEl.innerHTML = '<p class="hint">Choose a branch and date to see available times.</p>'; return; }
    const id = ++slotReq;
    slotsEl.innerHTML = C.storeSlots.map(() => '<span class="slot skeleton"></span>').join('');
    try {
      const res = await api('availability', { token: S.claim.token, branchId: st.branchId, date: st.date });
      if (id !== slotReq) return;
      const any = res.slots.some((s) => s.available);
      slotsEl.innerHTML = any ? res.slots.map((s) => `<button type="button" class="slot ${s.time === st.time ? 'on' : ''}" data-t="${s.time}" ${s.available ? '' : 'disabled'} aria-pressed="${s.time === st.time}">${time12(s.time)}${s.available && s.left <= 2 ? `<small>${s.left} left</small>` : ''}</button>`).join('')
        : '<p class="hint">No times left on this day — please choose another date.</p>';
    } catch (err) { slotsEl.innerHTML = `<p class="hint">${esc(err.message)}</p>`; }
  }
  slotsEl.onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b || b.disabled) return; st.time = b.dataset.t; $$('.slot', slotsEl).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); formErr(root, 'time'); haptic(6); };
  const interests = chips($('#s-interests'), C.interests, { multi: true, value: prev.interests || [] });
  $('#s-notes').value = prev.notes || '';
  drawSeg(); drawBranches(); loadSlots();
  $('button[type=submit] .lbl', $('#store-form')).textContent = prev.id ? 'Confirm new time' : 'Confirm my visit';
  $('#store-form').onsubmit = async (e) => {
    e.preventDefault();
    const errs = { branch: st.branchId ? '' : 'Choose a branch', date: st.date ? '' : 'Choose a date', time: st.time ? '' : 'Choose a time' };
    Object.entries(errs).forEach(([k, v]) => formErr(root, k, v));
    if (Object.values(errs).some(Boolean)) { haptic(20); return; }
    const btn = $('button[type=submit]', $('#store-form')); setBusy(btn, true, 'Reserving…'); formErr(root, 'form', '');
    try {
      const res = await api('bookStore', { token: S.claim.token, branchId: st.branchId, date: st.date, time: st.time, interests: interests.value, notes: $('#s-notes').value });
      S.claim.appointment = res.appointment;
      if (S.result && S.result.storeToken === S.claim.token) { S.result.appointment = res.appointment; paintClaimStatus(S.result); }
      sfx.reveal(); hapticPattern([15, 50, 25]); confetti(70);
      showStoreDone(root, res.appointment);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { formErr(root, 'form', err.message); toast(err.message, 'error'); if (err.code === 'SLOT_FULL') loadSlots(); } finally { setBusy(btn, false); }
  };
}

async function showStoreDone(root, a) {
  const visited = a.status !== 'CONFIRMED';
  const loc = `MK Jewels ${a.branch}, ${a.city}`;
  const details = `Your MK Jewels Lucky Double Dice reward: ${S.claim.reward.offer}% OFF on making charges.\nCoupon: ${S.claim.reward.couponCode}\nAppointment: ${a.id}\nShow your Store Visit QR at the store.`;
  showDone(root, `<div class="card done-card">
    <div class="done-mark"><svg class="icon"><use href="#i-check"/></svg></div>
    <p class="eyebrow">${visited ? 'Visit completed' : 'Appointment confirmed'}</p>
    <h3 class="display gold-text">${visited ? 'Thank you for visiting' : 'We look forward to welcoming you'}</h3>
    <div class="summary">
      <div><span>Appointment</span><b>${esc(a.id)}</b></div>
      <div><span>Branch</span><b>${esc(a.branch)}, ${esc(a.city)}</b></div>
      <div><span>Date</span><b>${esc(prettyDate(a.date, true))}</b></div>
      <div><span>Time</span><b>${esc(time12(a.time))}</b></div>
      <div><span>Reward</span><b>${S.claim.reward.offer}% off making charges</b></div>
    </div>
    ${visited ? '' : `<div class="done-qr"><div class="qr" id="appt-qr"></div><p class="qr-cap">Show this QR at the store — our team will scan it to welcome you.</p></div>
    <div class="done-actions">
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(googleCalendarUrl({ title: 'MK Jewels store visit', ymd: a.date, hhmm: a.time, details, location: loc }))}"><svg class="icon"><use href="#i-cal"/></svg>Google Calendar</a>
      <button class="btn btn-ghost btn-sm" type="button" data-ics><svg class="icon"><use href="#i-down"/></svg>Calendar file</button>
      <button class="btn btn-ghost btn-sm" type="button" data-wa><svg class="icon"><use href="#i-wa"/></svg>Share</button>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(loc)}"><svg class="icon"><use href="#i-pin"/></svg>Directions</a>
      <button class="btn btn-gold btn-sm full" type="button" data-resched>Reschedule</button>
      <button class="btn btn-quiet full" type="button" data-cancel>Cancel visit</button>
    </div>`}</div>`);
  if (visited) return;
  const q = await qrCanvas(claimUrl('STORE', S.claim.token), 420); $('#appt-qr').replaceChildren(q);
  $('[data-ics]', root).onclick = () => downloadBlob(icsFile({ title: 'MK Jewels store visit', ymd: a.date, hhmm: a.time, details, location: loc, uid: a.id }), `MK-Jewels-${a.id}.ics`);
  $('[data-wa]', root).onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(`My MK Jewels store visit is confirmed ✨\n${a.branch}, ${a.city}\n${prettyDate(a.date, true)} at ${time12(a.time)}\nAppointment ${a.id}`)}`, '_blank', 'noopener');
  $('[data-resched]', root).onclick = () => { buildStoreForm(root); showForm(root); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('[data-cancel]', root).onclick = async () => {
    if (!(await confirmSheet('Cancel your visit?', 'Your reward stays valid — you can book again or claim online any time before it expires.', 'Yes, cancel visit'))) return;
    try {
      const res = await api('cancelStore', { token: S.claim.token });
      S.claim.appointment = res.appointment;
      if (S.result && S.result.storeToken === S.claim.token) { S.result.appointment = res.appointment; paintClaimStatus(S.result); }
      toast('Your visit has been cancelled'); buildStoreForm(root); showForm(root);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ================================================================ sheets: terms, privacy, confirm */
const sheet = $('#sheet');
const SHEETS = {
  terms: ['Terms & Conditions', `
    <p>MK Jewels Lucky Double Dice campaign. By participating you agree to the following:</p>
    <ul>
      <li>The offer applies <b>only to making charges</b>. It does not apply to the metal value, stones, taxes or the full invoice.</li>
      <li>Your discount is determined solely by the official dice result recorded by MK Jewels: totals of 2 → 20%, 3 → 22%, 4 → 24%, 5 → 26%, 6 → 28%, 7 → 30%, 8 → 33%, 9 → 36%, 10 → 40%, 11 → 45%, and 12 (double six) → 50%.</li>
      <li>Every roll wins a minimum of 20%. The 50% jackpot applies only to a double six.</li>
      <li>One successful participation per verified mobile number per campaign.</li>
      <li>The coupon is valid until the expiry date shown on it and can be redeemed only once — either online or in store.</li>
      <li>Redemption requires verification of the registered mobile number and coupon by MK Jewels staff.</li>
      <li>Store appointments are subject to availability.</li>
      <li>The coupon cannot be exchanged for cash, combined with other offers unless stated, or transferred.</li>
      <li>Any product exclusions will be communicated by MK Jewels before purchase. MK Jewels' decision on campaign matters is final.</li>
    </ul>`],
  privacy: ['Privacy', `
    <p>We collect your name, mobile number, city and PIN code to issue and verify your reward, and — only if you choose — your birthday and anniversary so we can celebrate with you.</p>
    <h4>How we use it</h4><ul><li>To issue your coupon and prevent duplicate participation.</li><li>To contact you about your online enquiry or store appointment.</li><li>To send promotional offers <b>only</b> if you ticked the marketing consent box.</li></ul>
    <h4>What we never do</h4><ul><li>We never sell your data.</li><li>Your QR codes contain no personal details — only a secure random reference.</li></ul>
    <p>To update or delete your details, contact MK Jewels at any store or via <a href="https://www.mkjewels.in" target="_blank" rel="noopener">mkjewels.in</a>.</p>`]
};
function openSheet(title, html) { $('#sheet-title').textContent = title; $('#sheet-body').innerHTML = html; if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', ''); }
function closeSheet() { if (sheet.close) sheet.close(); else sheet.removeAttribute('open'); }
sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('click', (e) => { const a = e.target.closest('[data-open]'); if (!a) return; e.preventDefault(); const [t, h] = SHEETS[a.dataset.open]; openSheet(t, h); });
function confirmSheet(title, body, ok) {
  return new Promise((resolve) => {
    openSheet(title, `<p>${esc(body)}</p><div class="done-actions" style="margin-top:20px"><button class="btn btn-ghost" data-no>Keep it</button><button class="btn btn-gold" data-yes>${esc(ok)}</button></div>`);
    $('[data-no]', sheet).onclick = () => { closeSheet(); resolve(false); };
    $('[data-yes]', sheet).onclick = () => { closeSheet(); resolve(true); };
    sheet.addEventListener('close', () => resolve(false), { once: true });
  });
}

/* ================================================================ navigation */
$('#btn-unlock').addEventListener('click', () => {
  sfx.tap(); haptic(10);
  if (S.session) { restoreSession(); return; }
  go('register'); setTimeout(() => $('#f-name').focus({ preventScroll: true }), 350);
});
$$('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { history.pushState({}, '', location.pathname); route(); }));
addEventListener('popstate', () => route());

async function restoreSession() {
  try {
    const res = await api('restore', { session: S.session });
    S.firstName = res.firstName; S.result = res.result;
    enterPlay({ restored: true, returning: !!res.result });
    return true;
  } catch (err) {
    if (err.code === 'NO_SESSION') { store.del(SESSION_KEY); S.session = null; }
    go('welcome');
    return false;
  }
}

async function route() {
  const q = new URLSearchParams(location.search);
  const c = q.get('c'), t = q.get('t');
  if (c && t) { await openClaim(c === 'online' ? 'ONLINE' : 'STORE', t, false); return; }
  if (S.session) { progress(70, 'Unlocking your exclusive reward…'); await restoreSession(); hideLoader(); return; }
  go('welcome'); if (S.stage) S.stage.setMode('showcase');
  hideLoader();
}

/* ================================================================ boot */
async function boot() {
  if (PREVIEW) $('#preview-ribbon').hidden = false;
  progress(15);
  buildRegistration();
  bindResultActions();
  api('config').then((r) => { S.config = { ...DEFAULT_CONFIG, ...r.config }; }).catch(() => {});
  progress(35, 'Preparing your golden experience…');
  try {
    const mod = await import('./dice/stage.js');
    progress(65);
    if (mod.webglAvailable()) {
      S.stage = new mod.DiceStage({ quality: mod.detectQuality(), reducedMotion: reduced, logoUrl: '/brand/mk-logo.png' });
    } else throw new Error('no webgl');
  } catch (e) {
    const { FallbackStage } = await import('./dice/fallback.js');
    S.stage = new FallbackStage();
  }
  wireStage(S.stage);
  if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  progress(85);
  await route();
}
boot();
