import './styles/app.css';
import { api } from './api.js';
import { claimUrl, PUBLIC_URL } from './config.js';
import { $, $$, esc, toast, copyText, calendar, datePicker, chips, countUp, prettyDate, addDays, istToday, time12, googleCalendarUrl } from './lib/ui.js';
import { countryOptions, validatePhone } from './lib/phone.js';
import { qrCanvas } from './lib/qr.js';
import { couponPng, downloadBlob } from './lib/keepsakes.js';
import * as sfx from './lib/audio.js';
import { haptic, hapticPattern } from './lib/haptics.js';
import { confetti } from './lib/fx.js';
import { motionSupported, motionNeedsPermission, motionPermission, requestMotion, shakeDetector } from './lib/motion.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SESSION_KEY = 'mk_ldd_session', REF_KEY = 'mk_ldd_ref', THEME_KEY = 'mk_theme';
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
const OFFERS = { 2: 20, 3: 22, 4: 24, 5: 26, 6: 28, 7: 30, 8: 33, 9: 36, 10: 40, 11: 45, 12: 50 };

const S = { config: DEFAULT_CONFIG, session: store.get(SESSION_KEY), firstName: '', result: null, claim: null, game: null, fun: false, stageMod: null, ref: '' };

/* ================================================================ theme */
const themeBtn = $('.theme-toggle');
function paintTheme() {
  const t = document.documentElement.dataset.theme;
  themeBtn.innerHTML = `<svg class="icon"><use href="#i-${t === 'light' ? 'moon' : 'sun'}"/></svg>`;
  themeBtn.setAttribute('aria-label', t === 'light' ? 'Switch to dark mode' : 'Switch to light mode');
  $('meta[name="theme-color"]').setAttribute('content', t === 'light' ? '#fbf8f2' : '#131210');
}
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next; store.set(THEME_KEY, next); paintTheme(); haptic(6);
});
paintTheme();

/* ================================================================ loader */
const loader = { el: $('#loader'), bar: $('.ld-bar i') };
function progress(p) { loader.bar.style.setProperty('--p', `${p}%`); }
function hideLoader() { progress(100); setTimeout(() => loader.el.classList.add('done'), 200); }

/* ================================================================ views & 3D stages */
const views = $$('.view');
let current = null;
function go(name, { scroll = true } = {}) {
  views.forEach((v) => { v.hidden = v.dataset.view !== name; });
  current = name;
  if (name === 'welcome') film.show(); else film.leave();
  if (name !== 'play') disposeGame();
  if (scroll) window.scrollTo(0, 0);
  document.title = { welcome: 'MK Jewels – Lucky Double Dice', register: 'Your details · MK Jewels', play: 'Your roll · MK Jewels', online: 'Shop online · MK Jewels', store: 'Book a store visit · MK Jewels' }[name] || document.title;
}

function makeStage(host, mode) {
  const M = S.stageMod;
  if (M && M.webglAvailable()) {
    try { return new M.DiceStage(host, { mode, quality: M.detectQuality(), reducedMotion: reduced }); } catch (e) { /* fall through */ }
  }
  return S.Fallback ? new S.Fallback(host) : null;
}
/* ---------------------------------------------------------------- campaign film (home screen) */
const film = (() => {
  const v = $('#film-video'), soundBtn = $('#film-sound'), playBtn = $('#film-play');
  const conn = navigator.connection || {};
  const saveData = !!conn.saveData || /(^|-)2g$/.test(conn.effectiveType || '');
  const autoplay = !reduced && !saveData;
  let loaded = false;
  const load = () => {
    if (loaded) return; loaded = true;
    const big = Math.min(innerWidth, 1400) * (devicePixelRatio || 1) >= 1500 && !saveData;
    v.src = big ? '/film/jiyo-saj-ke-1080.mp4' : '/film/jiyo-saj-ke-720.mp4';
  };
  const paint = () => {
    const on = !v.muted && !v.paused;
    soundBtn.setAttribute('aria-pressed', String(on));
    soundBtn.setAttribute('aria-label', on ? 'Mute the film' : 'Play the film with sound');
    $('use', soundBtn).setAttribute('href', on ? '#i-sound' : '#i-mute');
    if (!v.paused) playBtn.hidden = true;
  };
  const play = () => { load(); const p = v.play(); if (p && p.catch) p.catch(() => { playBtn.hidden = false; }); };
  const setSound = (on) => {
    v.muted = !on;
    if (on) { play(); playBtn.hidden = true; }
    paint();
  };
  soundBtn.addEventListener('click', (e) => { e.stopPropagation(); sfx.unlockAudio(); setSound(v.muted || v.paused); });
  v.addEventListener('click', () => setSound(v.muted || v.paused));
  playBtn.addEventListener('click', () => { playBtn.hidden = true; setSound(true); });
  ['play', 'pause', 'volumechange'].forEach((ev) => v.addEventListener(ev, paint));
  return {
    /** Home screen: play silently (sound only when asked). */
    show() { if (autoplay) { v.muted = true; play(); } else { playBtn.hidden = false; } paint(); },
    /** Leaving home: stop the film so it never plays over the dice. */
    leave() { if (!v.paused) v.pause(); v.muted = true; paint(); }
  };
})();

function disposeGame() { if (document.getElementById('howto').open) document.getElementById('howto').close(); if (S.game) { S.game.dispose(); S.game = null; } roll = null; S.rolling = false; S.fun = false; S.funReady = false; funShake = null; shake.stop(); }
function ensureGame() {
  disposeGame();
  S.game = makeStage($('#stage-play'), 'game');
  if (S.game) wireGame(S.game);
  return S.game;
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
  soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.setAttribute('aria-label', on ? 'Sound on, tap to mute' : 'Sound off, tap to unmute');
}
soundBtn.addEventListener('click', () => { sfx.setSound(!sfx.soundEnabled()); paintSound(); sfx.tap(); });
paintSound();
addEventListener('pointerdown', () => sfx.unlockAudio(), { capture: true });
addEventListener('keydown', () => sfx.unlockAudio(), { capture: true });

let lastBuzz = 0;
const buzz = (ms, gap = 40) => { const now = performance.now(); if (now - lastBuzz < gap) return; lastBuzz = now; haptic(Math.round(ms)); };
function wireGame(stage) {
  stage.on('impact', (e) => {
    sfx.impact(e);
    if (e.kind === 'floor' && e.strength > 2) buzz(Math.min(30, 6 + e.strength * 2.2));
    else if (e.kind === 'dice' && e.strength > 1.5) buzz(Math.min(28, 6 + e.strength * 3));
    else if (e.kind === 'wall' && e.strength > 1.5) buzz(Math.min(24, 5 + e.strength * 2.5));
  });
  stage.on('rattle', (e) => { sfx.rattle(e.strength); buzz(6 + e.strength * 10, 55); });
  stage.on('throw', () => { sfx.whoosh(); buzz(14, 0); });
  stage.on('settled', () => buzz(22, 0));
  stage.on('grab', () => { sfx.unlockAudio(); buzz(6, 0); setHint('Now swipe up and let go'); });
  stage.on('pick', () => { if (S.result && !S.fun) { prepareFun(); haptic(6); } });
  stage.on('swipe', ({ velocity }) => { if (S.result) funRoll('swipe', { velocity }); else startRoll('swipe', { velocity }); });
}

/* ================================================================ shake to roll */
const shake = shakeDetector({
  enabled: () => current === 'play' && !S.rolling && (S.result ? S.funReady && !S.fun : playView.dataset.state === 'ready'),
  onStart: () => { if (S.result) funRoll('shake'); else startRoll('shake'); },
  onMove: (x, y, z) => S.game && S.game.shakeInput(x, y, z),
  onEnd: ({ power }) => releaseShake(power)
});

const readyHint = () => (motionSupported() && motionPermission() === 'granted' ? 'Shake your phone, or swipe the dice up' : 'Swipe the dice up to throw them');
function setHint(text) { $('#play-hint').textContent = text; }
function paintPlayHint() {
  const mbtn = $('#btn-motion');
  if (motionSupported() && motionPermission() === 'granted') { mbtn.hidden = true; shake.start(); }
  else mbtn.hidden = !(motionNeedsPermission() && motionPermission() === 'unknown');
  if (playView.dataset.state === 'ready') setHint(readyHint());
}
$('#btn-motion').addEventListener('click', () => {
  requestMotion().then((p) => { if (p !== 'granted') toast('Shake is off. You can still swipe the dice or tap Roll.'); paintPlayHint(); });
});

/* ================================================================ registration */
let resetRegistration = () => {};
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
    $('#f-pin').placeholder = india ? '6 digits' : 'Postal code';
    $('#f-pin').inputMode = india ? 'numeric' : 'text';
    $('#f-phone').placeholder = india ? '10-digit number' : 'Mobile number';
    $('#f-phone').maxLength = india ? 11 : 15;
  };
  sel.addEventListener('change', syncCc); syncCc();

  const cities = ['Mumbai', 'Ahmedabad', 'Thane', 'Navi Mumbai', 'Pune', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar', 'Delhi', 'New Delhi', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata',
    'Jaipur', 'Lucknow', 'Indore', 'Nagpur', 'Nashik', 'Bhopal', 'Kalyan', 'Vasai-Virar', 'Mira-Bhayandar', 'Bhiwandi', 'Panvel', 'Anand', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Mehsana',
    'Vapi', 'Valsad', 'Bharuch', 'Navsari', 'Udaipur', 'Jodhpur', 'Chandigarh', 'Ludhiana', 'Amritsar', 'Kochi', 'Coimbatore', 'Goa', 'Aurangabad', 'Kolhapur', 'Dubai', 'Abu Dhabi', 'London', 'New York', 'Singapore'];
  cityCombo($('#f-city'), $('#city-list'), cities);
  $('#city-quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-city]'); if (!b) return;
    $('#f-city').value = b.dataset.city; $('#f-city').dispatchEvent(new Event('input', { bubbles: true })); $('#city-list').hidden = true; haptic(6);
  });

  const today = istToday(), year = Number(today.slice(0, 4));
  const dob = datePicker($('#dob'), { label: 'Birthday', min: `${year - 100}-01-01`, max: today, startView: `${year - 30}-01-01`, onChange: () => setErr('birthday', '') });
  const ann = datePicker($('#anniv'), { label: 'Anniversary', min: `${year - 75}-01-01`, max: today, startView: `${year - 5}-01-01`, onChange: () => setErr('anniversary', '') });

  // PIN → city/state suggestion (India Post public directory, best-effort)
  const pinMeta = { state: '' };
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
      if (!po) { pinHint.hidden = false; pinHint.className = 'hint'; pinHint.textContent = 'We could not find this PIN code. Please check it.'; return; }
      pinMeta.state = po.State;
      const city = po.District === 'Mumbai Suburban' || po.District === 'Mumbai City' ? 'Mumbai' : po.District;
      const cityInput = $('#f-city');
      if (!cityInput.value.trim()) cityInput.value = city;
      pinHint.hidden = false; pinHint.className = 'hint ok';
      pinHint.textContent = `${po.Name}, ${city}, ${po.State}`;
    } catch (err) { pinHint.hidden = true; }
  });

  const fields = {
    name: () => { const v = $('#f-name').value.replace(/\s+/g, ' ').trim(); if (v.length < 2) return 'Please enter your full name'; if (!/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v)) return 'Please use letters only'; return ''; },
    phone: () => { const r = validatePhone(sel.value, $('#f-phone').value); return r.ok ? '' : r.error; },
    city: () => { const v = $('#f-city').value.trim(); if (v.length < 2) return 'Please enter your city'; if (!/^[\p{L}\p{M}][\p{L}\p{M} .'()-]*$/u.test(v)) return 'Please enter a valid city name'; return ''; },
    pincode: () => { const v = $('#f-pin').value.trim(); if (sel.value === 'IN') return /^[1-9]\d{5}$/.test(v) ? '' : 'Enter a valid 6-digit PIN code'; return /^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(v) ? '' : 'Enter a valid postal code'; },
    birthday: () => (dob.value && dob.value > istToday() ? 'Birthday cannot be in the future' : ''),
    anniversary: () => (ann.value && ann.value > istToday() ? 'Anniversary cannot be in the future' : '')
  };
  const fieldEl = (k) => $(`[data-f="${k}"]`);
  const setErr = (k, msg) => { const f = fieldEl(k); if (!f) return; f.classList.toggle('invalid', !!msg); $('.err', f).textContent = msg; };
  ['name', 'phone', 'city', 'pincode'].forEach((k) => {
    const f = fieldEl(k);
    f.addEventListener('focusout', () => { if (f.dataset.touched) setErr(k, fields[k]()); });
    f.addEventListener('input', () => { f.dataset.touched = '1'; if (f.classList.contains('invalid')) setErr(k, fields[k]()); });
  });
  $('#f-phone').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^\d\s-]/g, ''); });

  resetRegistration = () => {
    $('#reg-form').reset(); sel.value = 'IN'; syncCc(); dob.clear(); ann.clear(); pinHint.hidden = true; pinMeta.state = '';
    Object.keys(fields).forEach((k) => { setErr(k, ''); delete fieldEl(k).dataset.touched; });
    $('#reg-error').textContent = '';
  };

  $('#reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    let first = null;
    Object.keys(fields).forEach((k) => { const m = fields[k](); setErr(k, m); if (m && !first) first = k; });
    if (first) { const el = $('input, button', fieldEl(first)); if (el) el.focus({ preventScroll: true }); fieldEl(first).scrollIntoView({ behavior: 'smooth', block: 'center' }); haptic(20); return; }
    // iOS only allows the motion prompt from inside a tap, so ask now (shake to roll on the next screen)
    const phone = validatePhone(sel.value, $('#f-phone').value);
    const btn = $('#btn-register'); setBusy(btn, true, 'Please wait');
    $('#reg-error').textContent = '';
    try {
      const res = await api('register', {
        name: $('#f-name').value, cc: phone.cc, phone: phone.national, city: $('#f-city').value, pincode: $('#f-pin').value,
        state: pinMeta.state, country: sel.value === 'IN' ? 'India' : sel.selectedOptions[0].textContent.replace(/\s*\(\+\d+\)$/, ''),
        birthday: dob.value || '', anniversary: ann.value || '', ref: S.ref,
        source: new URLSearchParams(location.search).get('src') || (S.ref ? 'referral' : '')
      });
      S.session = res.session; S.firstName = res.firstName; S.result = res.result || null; store.set(SESSION_KEY, res.session);
      haptic(12); sfx.tap();
      enterPlay();
    } catch (err) {
      if (err.code === 'ALREADY_PLAYED' || err.code === 'PHONE') {
        setErr('phone', err.message); fieldEl('phone').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#f-phone').focus({ preventScroll: true }); haptic(20);
      } else { $('#reg-error').textContent = err.message; toast(err.message, 'error'); }
    } finally { setBusy(btn, false); }
  });
}

/** Small autocomplete: at most 5 suggestions, only after typing. */
function cityCombo(input, list, cities) {
  let items = [], active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
  const pick = (v) => { input.value = v; close(); input.dispatchEvent(new Event('input', { bubbles: true })); };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { close(); return; }
    const starts = cities.filter((c) => c.toLowerCase().startsWith(q)), has = cities.filter((c) => !c.toLowerCase().startsWith(q) && c.toLowerCase().includes(q));
    items = [...starts, ...has].slice(0, 5);
    if (!items.length || (items.length === 1 && items[0].toLowerCase() === q)) { close(); return; }
    list.innerHTML = items.map((c, i) => `<li role="option" id="city-opt-${i}" data-v="${esc(c)}" class="${i === active ? 'on' : ''}">${esc(c)}</li>`).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('input', (e) => { if (e.isTrusted) { active = -1; paint(); } });
  input.addEventListener('focus', paint);
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); input.setAttribute('aria-activedescendant', `city-opt-${active}`); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
    else if (e.key === 'Escape') close();
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('[data-v]'); if (li) { e.preventDefault(); pick(li.dataset.v); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
}

function setBusy(btn, busy, label) {
  const lbl = $('.lbl', btn);
  if (busy) { btn.dataset.label = lbl.textContent; lbl.textContent = label || 'Please wait'; btn.disabled = true; btn.insertAdjacentHTML('afterbegin', '<span class="spinner" aria-hidden="true"></span>'); }
  else { if (btn.dataset.label) lbl.textContent = btn.dataset.label; btn.disabled = false; const s = $('.spinner', btn); if (s) s.remove(); }
}

/* ================================================================ play */
const playView = $('#v-play');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function enterPlay({ returning = false } = {}) {
  $('#dice-readout').classList.remove('on');
  playView.dataset.state = S.result ? 'won' : 'ready';
  go('play');
  ensureGame();
  if (S.result) {
    if (S.game) S.game.showResult(S.result.dice);
    revealResult(S.result, { animate: false, returning });
  } else {
    $('#play-eyebrow').textContent = 'The golden tray';
    $('#play-greeting').textContent = S.firstName ? `Good luck, ${S.firstName}` : 'Your roll';
    $('#btn-roll').disabled = false;
    paintPlayHint();
    showHowTo();
  }
}

/* ================================================================ how-to-roll popup (shown before every roll) */
const howto = $('#howto');
function showHowTo() {
  const phone = motionSupported() && motionPermission() !== 'denied';
  $$('[data-way="shake"]', howto).forEach((el) => { el.hidden = !phone; });
  const touch = matchMedia('(pointer: coarse)').matches;
  $('#howto-title').textContent = phone ? 'Two ways to throw' : 'How to throw';
  $('#howto-drag-title').textContent = touch ? 'Hold and throw the dice' : 'Grab and throw the dice';
  $('#howto-drag-text').textContent = touch ? 'Touch the dice, swipe up and let go. Or simply tap Roll.' : 'Drag the dice upward and let go. Or simply press Roll.';
  if (S.game) S.game.setLocked(true);
  try { howto.showModal(); } catch (e) { howto.setAttribute('open', ''); }
}
function closeHowTo() {
  if (!howto.open) return;
  try { howto.close(); } catch (e) { howto.open = false; }
}
howto.addEventListener('close', () => { if (S.game && !S.rolling) S.game.setLocked(false); paintPlayHint(); });
$('#howto-go').addEventListener('click', () => {
  sfx.unlockAudio(); sfx.tap(); haptic(10);
  // this tap is the user gesture iOS needs before it allows motion access
  if (motionNeedsPermission() && motionPermission() === 'unknown') requestMotion().then(() => paintPlayHint());
  closeHowTo();
});

let roll = null;
function startRoll(source, { velocity = null } = {}) {
  if (S.rolling || S.result || current !== 'play' || !S.game) return false;
  S.rolling = true;
  const r = roll = { source, velocity, power: 0.55, released: source !== 'shake', minDone: false, res: null, thrown: false };
  playView.dataset.state = 'rolling';
  S.game.setLocked(true);
  sfx.unlockAudio(); haptic(10);
  S.game.beginAwait(source === 'shake' ? 'shake' : 'auto');
  setHint(source === 'shake' ? 'Keep shaking…' : 'Rolling…');
  setTimeout(() => { r.minDone = true; tryThrow(r); }, source === 'button' ? (reduced ? 200 : 700) : source === 'swipe' ? 250 : 0);
  api('roll', { session: S.session })
    .then((res) => { if (roll !== r) return; r.res = res; tryThrow(r); })
    .catch((err) => { if (roll === r) failRoll(err); });
  return true;
}

function releaseShake(power) {
  if (S.fun && funShake) { const f = funShake; funShake = null; f(Math.max(0.3, power)); return; }
  const r = roll;
  if (!r || r.source !== 'shake' || r.released) return;
  r.released = true; r.power = Math.max(0.3, power);
  tryThrow(r);
}

async function tryThrow(r) {
  if (r !== roll || r.thrown || !r.res || !r.released || !r.minDone) return;
  r.thrown = true;
  const res = r.res;
  S.result = res.result;
  if (res.existing) toast('This number has already played. Here is its reward.');
  setHint('');
  await S.game.throw(res.result.dice, { velocity: r.velocity, power: r.power });
  if (r !== roll) return;
  await delay(reduced ? 150 : 650);
  roll = null;
  revealResult(res.result, { animate: !res.existing });
}

function failRoll(err) {
  roll = null;
  S.rolling = false;
  if (S.game) { S.game.cancelAwait(); S.game.setLocked(false); }
  playView.dataset.state = 'ready'; $('#btn-roll').disabled = false; setHint(readyHint());
  toast(err.message, 'error');
  if (err.code === 'NO_SESSION') { store.del(SESSION_KEY); S.session = null; setTimeout(() => { resetRegistration(); go('register'); }, 1200); }
}

/* ================================================================ fun rolls (after the real one) */
// The reward is fixed by the first, server-decided roll. Extra rolls are local, random and only for fun:
// they never call the server and never change the coupon.
let funShake = null;
function funValues() { const d = () => 1 + Math.floor(Math.random() * 6); return [d(), d()]; }
function prepareFun() {
  if (!S.game || S.fun) return;
  S.funReady = true;
  $('#dice-readout').classList.remove('on');
  S.game.reset(); S.game.setLocked(false);
  $('#fun-note').innerHTML = `Swipe the dice, shake your phone or tap again. Your <b>${S.result.offer}%</b> reward is locked in.`;
  $('.lbl', $('#btn-fun')).textContent = 'Roll for fun';
  if (motionSupported() && motionPermission() === 'granted') shake.start();
}
async function funRoll(source, { velocity = null } = {}) {
  if (!S.game || S.fun || !S.result || current !== 'play') return;
  if (!S.funReady) { prepareFun(); await delay(reduced ? 100 : 600); }
  S.fun = true; S.funReady = false;
  const btn = $('#btn-fun'); btn.disabled = true;
  S.game.setLocked(true); sfx.unlockAudio(); haptic(10);
  S.game.beginAwait(source === 'shake' ? 'shake' : 'auto');
  let power = 0.55;
  if (source === 'shake') power = await new Promise((res) => { funShake = res; setTimeout(() => { if (funShake === res) { funShake = null; res(0.6); } }, 2500); });
  else await delay(source === 'button' ? (reduced ? 150 : 650) : 150);
  const v = funValues();
  await S.game.throw(v, { velocity, power });
  if (!S.game) { S.fun = false; return; }
  $('#dice-readout').innerHTML = `<span>Fun roll · ${v[0]} + ${v[1]} = <b>${v[0] + v[1]}</b></span>`;
  $('#dice-readout').classList.add('on');
  $('#fun-note').innerHTML = `Just for fun. Your reward stays <b>${S.result.offer}%</b>, set by your first roll.`;
  $('.lbl', btn).textContent = 'Roll again for fun';
  btn.disabled = false; S.fun = false;
  if (v[0] === 6 && v[1] === 6) toast('Double six, just for fun!');
}

/* ================================================================ reveal */
const inviteLink = (r) => `${PUBLIC_URL}/${r && r.referralCode ? `?ref=${encodeURIComponent(r.referralCode)}` : ''}`;

function revealResult(r, { animate, returning } = {}) {
  S.rolling = false;
  shake.stop();
  playView.dataset.state = 'won';
  const done = r.status === 'REDEEMED' || r.status === 'EXPIRED';
  $('#play-eyebrow').textContent = returning ? 'Welcome back' : 'Your result';
  $('#play-greeting').textContent = returning ? `${r.firstName}, here is your reward` : `Well rolled, ${r.firstName}`;
  $('#r-eyebrow').textContent = `You rolled ${r.dice[0]} and ${r.dice[1]}`;
  $('#r-jackpot').hidden = !r.jackpot;
  $('#dice-readout').innerHTML = `<span>${r.dice[0]} + ${r.dice[1]} = <b>${r.total}</b></span>`;
  requestAnimationFrame(() => $('#dice-readout').classList.add('on'));
  $('#r-code').textContent = r.couponCode;
  $('#r-valid').textContent = r.status === 'REDEEMED' ? 'Redeemed' : r.status === 'EXPIRED' ? `Expired on ${prettyDate(r.expiresOn)}` : `Valid until ${prettyDate(r.expiresOn)}`;
  $('#coupon').classList.toggle('is-done', done);
  $('#r-stamp').hidden = !done; $('#r-stamp').textContent = r.status === 'EXPIRED' ? 'Expired' : 'Redeemed';
  $$('[data-claim]').forEach((b) => { b.disabled = done; });
  const offerEl = $('#r-offer');
  if (animate) {
    countUp(offerEl, 20, r.offer, 1100);
    if (r.jackpot) { sfx.jackpot(); hapticPattern([30, 60, 30, 60, 80, 100, 160]); confetti(160); }
    else { sfx.reveal(); hapticPattern([18, 70, 30]); confetti(70); }
    setTimeout(() => {
      const el = $('.reward'), y = el.getBoundingClientRect().top + scrollY - innerHeight * 0.28;
      if (y > scrollY + 40 && innerWidth < 1024) window.scrollTo({ top: y, behavior: reduced ? 'auto' : 'smooth' });
    }, 900);
  } else offerEl.textContent = r.offer;
  S.fun = false; S.funReady = false;
  if (S.game) S.game.setLocked(false);
  $('#btn-fun').disabled = false; $('.lbl', $('#btn-fun')).textContent = 'Roll again for fun';
  $('#fun-note').innerHTML = `Just for fun. Your <b>${r.offer}%</b> reward is locked in and won't change.`;
  paintClaimStatus(r);
  // The coupon code, QR and claim options stay hidden until the coupon has been downloaded once
  showCoupon(returning || done || store.get(revealKey(r)) === '1', false);
  paintMyReward();
}

const revealKey = (r) => `mk_ldd_revealed_${r.couponCode}`;
function showCoupon(open, scroll) {
  $('#unlock').hidden = open;
  $('#revealed').hidden = !open;
  if (open) {
    drawQr();
    if (scroll) setTimeout(() => $('#coupon').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 80);
  }
}

let qrFor = null;
async function drawQr() {
  const r = S.result;
  if (!r || qrFor === r.couponCode) return;
  qrFor = r.couponCode;
  const q = await qrCanvas(claimUrl('STORE', r.storeToken), 360);
  q.setAttribute('role', 'img'); q.setAttribute('aria-label', 'Your MK Jewels coupon QR code');
  $('#qr-store').replaceChildren(q);
}

async function downloadCoupon() {
  const r = S.result;
  const blob = await couponPng(r, claimUrl('STORE', r.storeToken));
  downloadBlob(blob, `MK-Jewels-${r.couponCode}.png`);
}

function paintClaimStatus(r) {
  const o = $('#online-status'), s = $('#store-status');
  if (r.onlineClaim) {
    o.textContent = `Enquiry sent · ${r.onlineClaim.method}, ${prettyDate(r.onlineClaim.date, true)}`; o.classList.add('ok');
  } else { o.textContent = 'A consultant shows you pieces on WhatsApp or video'; o.classList.remove('ok'); }
  const a = r.appointment;
  if (a && a.status === 'CONFIRMED') { s.textContent = `Booked · ${a.branch}, ${prettyDate(a.date, true)}, ${time12(a.time)}`; s.classList.add('ok'); }
  else if (a && (a.status === 'VISITED' || a.status === 'WALK_IN')) { s.textContent = `Visited ${a.branch}`; s.classList.add('ok'); }
  else { s.textContent = 'Book a time at a Mumbai or Ahmedabad branch'; s.classList.remove('ok'); }
}

function bindResultActions() {
  $('#btn-fun').addEventListener('click', () => { sfx.tap(); funRoll('button'); });
  $('#btn-roll').addEventListener('click', () => startRoll('button'));
  $('#btn-copy').addEventListener('click', async () => {
    if (!(await copyText(S.result.couponCode))) return;
    const l = $('#btn-copy .lbl'); l.textContent = 'Copied'; haptic(8); setTimeout(() => { l.textContent = 'Copy'; }, 1600);
  });
  $('#btn-get-coupon').addEventListener('click', async () => {
    const btn = $('#btn-get-coupon'); setBusy(btn, true, 'Preparing your coupon');
    try { await downloadCoupon(); } catch (e) { /* still reveal on screen */ } finally { setBusy(btn, false); }
    store.set(revealKey(S.result), '1');
    sfx.tap(); haptic(12);
    showCoupon(true, true);
    toast('Coupon saved to your phone');
  });
  $('#btn-dl-coupon').addEventListener('click', async () => { await downloadCoupon(); toast('Coupon saved'); });
  $('#btn-share-wa').addEventListener('click', () => {
    const r = S.result;
    const text = `I just won ${r.offer}% off making charges at MK Jewels with Lucky Double Dice. Roll the golden dice for your own reward: ${inviteLink(r)}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });
  $('#btn-share-copy').addEventListener('click', async () => {
    const link = inviteLink(S.result);
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'MK Jewels Lucky Double Dice', text: 'Roll the golden dice and win up to 50% off making charges at MK Jewels.', url: link }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (await copyText(link)) { const l = $('#btn-share-copy .lbl'); l.textContent = 'Link copied'; haptic(8); setTimeout(() => { l.textContent = 'Copy link'; }, 1800); }
  });
  $$('[data-claim]').forEach((b) => b.addEventListener('click', () => {
    const online = b.dataset.claim === 'online';
    openClaim(online ? 'ONLINE' : 'STORE', online ? S.result.onlineToken : S.result.storeToken, true);
  }));
}

/* ================================================================ claim flows */
function rewardStrip(reward) {
  return `<span class="rs-off">${reward.offer}%</span><span class="rs-meta">off making charges<b>${esc(reward.couponCode)}</b></span><span class="rs-status">Until ${esc(prettyDate(reward.expiresOn))}</span>`;
}

async function openClaim(kind, token, push) {
  if (push) history.pushState({}, '', `?c=${kind === 'ONLINE' ? 'online' : 'store'}&t=${encodeURIComponent(token)}`);
  progress(30);
  let ctx;
  try { ctx = await api('resolve', { token }); } catch (err) {
    hideLoader();
    showMessage(err.code === 'BAD_TOKEN' ? 'This link is not valid' : 'We could not open your reward', err.code === 'BAD_TOKEN' ? 'Please scan the QR code from your MK Jewels reward again, or open your reward on the phone you played on.' : err.message);
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
    showDone(root, `<div class="card done-card"><h3 class="display">${status === 'REDEEMED' ? 'Reward redeemed' : 'Reward expired'}</h3>
      <p class="lede small">${status === 'REDEEMED' ? 'This coupon has already been used. Thank you for shopping with MK Jewels.' : `This coupon expired on ${esc(prettyDate(ctx.reward.expiresOn))}.`}</p></div>`);
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
  const f = {
    interests: chips(freshHost('#o-interests'), C.interests, { multi: true, value: prev.interests || [], onChange: () => formErr(root, 'interests') }),
    method: chips(freshHost('#o-method'), C.contactMethods, { value: prev.method || null, render: (m) => `<svg class="icon"><use href="#${icons[m] || 'i-phone'}"/></svg>${esc(m)}`, onChange: () => formErr(root, 'method') }),
    cal: calendar(freshHost('#o-cal'), { min: C.today, max: addDays(C.today, C.bookingDaysAhead), value: prev.date && prev.date >= C.today ? prev.date : null, onChange: () => formErr(root, 'date') }),
    time: chips(freshHost('#o-time'), C.onlineWindows, { value: prev.time || null, onChange: () => formErr(root, 'time') })
  };
  $('#o-notes').value = prev.notes || '';
  const form = $('#online-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const errs = { interests: f.interests.value.length ? '' : 'Choose at least one', method: f.method.value ? '' : 'Choose how we should reach you', date: f.cal.value ? '' : 'Choose a day', time: f.time.value ? '' : 'Choose a time' };
    Object.entries(errs).forEach(([k, v]) => formErr(root, k, v));
    if (Object.values(errs).some(Boolean)) { haptic(20); return; }
    const btn = $('button[type=submit]', form); setBusy(btn, true, 'Sending'); formErr(root, 'form', '');
    try {
      const res = await api('submitOnline', { token: S.claim.token, interests: f.interests.value, method: f.method.value, date: f.cal.value, time: f.time.value, notes: $('#o-notes').value });
      S.claim.onlineClaim = res.onlineClaim;
      if (S.result && S.result.onlineToken === S.claim.token) { S.result.onlineClaim = res.onlineClaim; paintClaimStatus(S.result); }
      sfx.reveal(); hapticPattern([15, 50, 25]);
      showOnlineDone(root, res.onlineClaim);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { formErr(root, 'form', err.message); toast(err.message, 'error'); } finally { setBusy(btn, false); }
  };
}

/** Calendars bind listeners on their host, so give each rebuild a fresh element. */
function freshHost(sel) { const old = $(sel), el = old.cloneNode(false); old.replaceWith(el); return el; }

function showOnlineDone(root, c) {
  showDone(root, `<div class="card done-card">
    <div class="done-mark"><svg class="icon"><use href="#i-check"/></svg></div>
    <h3 class="display">Enquiry sent</h3>
    <p class="lede small">We'll contact you on ${esc(c.method)} on ${esc(prettyDate(c.date, true))}, ${esc(c.time)}.</p>
    <div class="summary">
      <div><span>Reference</span><b>${esc(c.id)}</b></div>
      <div><span>Looking for</span><b>${esc((c.interests || []).join(', '))}</b></div>
    </div>
    <div class="done-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-edit>Edit enquiry</button>
      <a class="btn btn-ghost btn-sm" href="https://www.mkjewels.in" target="_blank" rel="noopener">Browse mkjewels.in</a>
    </div></div>`);
  $('[data-edit]', root).onclick = () => { buildOnlineForm(root); showForm(root); };
}

function buildStoreForm(root) {
  const C = S.config, prev = S.claim.appointment && S.claim.appointment.status === 'CONFIRMED' ? S.claim.appointment : {};
  const cities = [...new Set(C.branches.map((b) => b.city))];
  const st = { city: prev.city || cities[0], branchId: prev.branchId || null, date: prev.date && prev.date >= C.today ? prev.date : null, time: prev.time || null };
  const seg = $('#s-city');
  const drawSeg = () => { seg.innerHTML = cities.map((c) => `<button type="button" role="tab" aria-selected="${c === st.city}" class="${c === st.city ? 'on' : ''}" data-city="${esc(c)}">${esc(c)}</button>`).join(''); };
  const drawBranches = () => {
    $('#s-branches').innerHTML = C.branches.filter((b) => b.city === st.city).map((b) => `
      <button type="button" class="branch ${b.id === st.branchId ? 'on' : ''}" data-b="${b.id}" aria-pressed="${b.id === st.branchId}">
        <span><b>${esc(b.name)}</b><small>${esc(b.city)}</small></span><span class="radio"></span></button>`).join('');
  };
  seg.onclick = (e) => { const b = e.target.closest('[data-city]'); if (!b) return; st.city = b.dataset.city; st.branchId = null; st.time = null; drawSeg(); drawBranches(); loadSlots(); haptic(6); };
  $('#s-branches').onclick = (e) => { const b = e.target.closest('[data-b]'); if (!b) return; st.branchId = b.dataset.b; st.time = null; drawBranches(); formErr(root, 'branch'); loadSlots(); haptic(6); };
  calendar(freshHost('#s-cal'), { min: C.today, max: addDays(C.today, C.bookingDaysAhead), closedWeekdays: C.closedWeekdays, value: st.date, onChange: (v) => { st.date = v; st.time = null; formErr(root, 'date'); loadSlots(); } });
  const slotsEl = $('#s-slots');
  let slotReq = 0;
  async function loadSlots() {
    if (!st.branchId || !st.date) { slotsEl.innerHTML = '<p class="hint">Choose a branch and date to see times.</p>'; return; }
    const id = ++slotReq;
    slotsEl.innerHTML = C.storeSlots.map(() => '<span class="slot skeleton"></span>').join('');
    try {
      const res = await api('availability', { token: S.claim.token, branchId: st.branchId, date: st.date });
      if (id !== slotReq) return;
      const any = res.slots.some((s) => s.available);
      slotsEl.innerHTML = any ? res.slots.map((s) => `<button type="button" class="slot ${s.time === st.time ? 'on' : ''}" data-t="${s.time}" ${s.available ? '' : 'disabled'} aria-pressed="${s.time === st.time}">${time12(s.time)}${s.available && s.left <= 2 ? `<small>${s.left} left</small>` : ''}</button>`).join('')
        : '<p class="hint">No times left on this day. Please choose another date.</p>';
    } catch (err) { slotsEl.innerHTML = `<p class="hint">${esc(err.message)}</p>`; }
  }
  slotsEl.onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b || b.disabled) return; st.time = b.dataset.t; $$('.slot', slotsEl).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); formErr(root, 'time'); haptic(6); };
  const interests = chips(freshHost('#s-interests'), C.interests, { multi: true, value: prev.interests || [] });
  $('#s-notes').value = prev.notes || '';
  drawSeg(); drawBranches(); loadSlots();
  $('button[type=submit] .lbl', $('#store-form')).textContent = prev.id ? 'Confirm new time' : 'Confirm visit';
  $('#store-form').onsubmit = async (e) => {
    e.preventDefault();
    const errs = { branch: st.branchId ? '' : 'Choose a branch', date: st.date ? '' : 'Choose a date', time: st.time ? '' : 'Choose a time' };
    Object.entries(errs).forEach(([k, v]) => formErr(root, k, v));
    if (Object.values(errs).some(Boolean)) { haptic(20); return; }
    const btn = $('button[type=submit]', $('#store-form')); setBusy(btn, true, 'Booking'); formErr(root, 'form', '');
    try {
      const res = await api('bookStore', { token: S.claim.token, branchId: st.branchId, date: st.date, time: st.time, interests: interests.value, notes: $('#s-notes').value });
      S.claim.appointment = res.appointment;
      if (S.result && S.result.storeToken === S.claim.token) { S.result.appointment = res.appointment; paintClaimStatus(S.result); }
      sfx.reveal(); hapticPattern([15, 50, 25]);
      showStoreDone(root, res.appointment);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { formErr(root, 'form', err.message); toast(err.message, 'error'); if (err.code === 'SLOT_FULL') loadSlots(); } finally { setBusy(btn, false); }
  };
}

async function showStoreDone(root, a) {
  const visited = a.status !== 'CONFIRMED';
  const loc = `MK Jewels ${a.branch}, ${a.city}`;
  const details = `MK Jewels Lucky Double Dice: ${S.claim.reward.offer}% off making charges.\nCoupon: ${S.claim.reward.couponCode}\nAppointment: ${a.id}\nShow your Store Visit QR at the store.`;
  showDone(root, `<div class="card done-card">
    <div class="done-mark"><svg class="icon"><use href="#i-check"/></svg></div>
    <h3 class="display">${visited ? 'Thank you for visiting' : 'Visit booked'}</h3>
    <div class="summary">
      <div><span>Branch</span><b>${esc(a.branch)}, ${esc(a.city)}</b></div>
      <div><span>When</span><b>${esc(prettyDate(a.date, true))}, ${esc(time12(a.time))}</b></div>
      <div><span>Reference</span><b>${esc(a.id)}</b></div>
    </div>
    ${visited ? '' : `<div class="done-qr"><div class="qr" id="appt-qr"></div><p class="hint">Show this at the store.</p></div>
    <div class="done-actions">
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(googleCalendarUrl({ title: 'MK Jewels store visit', ymd: a.date, hhmm: a.time, details, location: loc }))}"><svg class="icon"><use href="#i-cal"/></svg>Add to calendar</a>
      <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/${encodeURIComponent(loc)}"><svg class="icon"><use href="#i-pin"/></svg>Directions</a>
      <button class="btn btn-quiet" type="button" data-resched>Change time</button>
      <button class="btn btn-quiet" type="button" data-cancel>Cancel visit</button>
    </div>`}</div>`);
  if (visited) return;
  const q = await qrCanvas(claimUrl('STORE', S.claim.token), 360); $('#appt-qr').replaceChildren(q);
  $('[data-resched]', root).onclick = () => { buildStoreForm(root); showForm(root); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('[data-cancel]', root).onclick = async () => {
    if (!(await confirmSheet('Cancel your visit?', 'Your reward stays valid. You can book again or shop online before it expires.', 'Cancel visit'))) return;
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
    <ul>
      <li>The offer applies <b>only to making charges</b>. It does not apply to the metal value, stones, taxes or the full invoice.</li>
      <li>Your discount is set by the official dice result recorded by MK Jewels: totals of 2 → 20%, 3 → 22%, 4 → 24%, 5 → 26%, 6 → 28%, 7 → 30%, 8 → 33%, 9 → 36%, 10 → 40%, 11 → 45%, and 12 (double six) → 50%.</li>
      <li>Every roll wins at least 20%. The 50% reward applies only to a double six.</li>
      <li>One participation per mobile number per campaign.</li>
      <li>The coupon is valid until the expiry date shown on it and can be redeemed once, either online or in store.</li>
      <li>MK Jewels staff will verify the registered mobile number and coupon at redemption.</li>
      <li>Store appointments are subject to availability.</li>
      <li>The coupon cannot be exchanged for cash, combined with other offers unless stated, or transferred.</li>
      <li>Any product exclusions will be shared before purchase. MK Jewels' decision on campaign matters is final.</li>
    </ul>`],
  privacy: ['Privacy', `
    <p>We collect your name, mobile number, city and PIN code to issue and verify your reward. Your birthday and anniversary are optional.</p>
    <h4>How we use it</h4><ul><li>To issue your coupon and prevent duplicate entries.</li><li>To contact you about your online enquiry or store appointment.</li><li>If someone joins through your invite link, we note that you invited them.</li></ul>
    <h4>What we never do</h4><ul><li>We never sell your data.</li><li>Your QR codes contain no personal details, only a secure reference.</li></ul>
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

/* ================================================================ home, navigation */
function paintOdds() {
  $('#odds').innerHTML = Object.entries(OFFERS).map(([t, o]) => `<li${t === '12' ? ' class="jack"' : ''}><span>${t === '12' ? '6 + 6' : t} →</span><b>${o}%</b></li>`).join('');
}

/** "View my reward" on the home screen when this device already has a player. */
function paintMyReward() {
  const b = $('#btn-my-reward');
  b.hidden = !S.session;
  b.textContent = S.result ? 'View my reward' : 'Continue my roll';
}

function goHome() {
  if (location.search && !/[?&]ref=/.test(location.search)) history.pushState({}, '', location.pathname);
  go('welcome');
  paintMyReward();
}

$('#btn-play').addEventListener('click', () => {
  sfx.tap(); haptic(8);
  resetRegistration();
  go('register'); setTimeout(() => $('#f-name').focus({ preventScroll: true }), 300);
});
$('#btn-my-reward').addEventListener('click', async () => {
  sfx.tap(); haptic(8);
  if (await restoreSession()) enterPlay({ returning: !!S.result });
});
$$('[data-home]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); goHome(); }));
$$('[data-back]').forEach((b) => b.addEventListener('click', () => { history.pushState({}, '', location.pathname); if (S.session) { restoreSession().then((ok) => (ok ? enterPlay({ returning: true }) : goHome())); } else goHome(); }));
addEventListener('popstate', () => route());

async function restoreSession() {
  if (!S.session) return false;
  try {
    const res = await api('restore', { session: S.session });
    S.firstName = res.firstName; S.result = res.result;
    paintMyReward();
    return true;
  } catch (err) {
    if (err.code === 'NO_SESSION') { store.del(SESSION_KEY); S.session = null; S.result = null; }
    paintMyReward();
    return false;
  }
}

/** Invite links: ?ref=CODE credits the person who shared it. */
function readReferral() {
  const q = new URLSearchParams(location.search), ref = q.get('ref');
  if (ref && /^[A-Za-z0-9]{6,10}$/.test(ref)) {
    store.set(REF_KEY, ref.toUpperCase());
    q.delete('ref');
    history.replaceState({}, '', location.pathname + (q.toString() ? `?${q}` : ''));
  }
  S.ref = store.get(REF_KEY) || '';
  if (!S.ref) return;
  api('referrer', { code: S.ref }).then((r) => {
    const el = $('#invite'); $('span', el).textContent = `${r.firstName} invited you to play`; el.hidden = false;
  }).catch((err) => { if (err.code === 'BAD_REF') { store.del(REF_KEY); S.ref = ''; } });
}

async function route() {
  const q = new URLSearchParams(location.search);
  const c = q.get('c'), t = q.get('t');
  if (c && t) { await openClaim(c === 'online' ? 'ONLINE' : 'STORE', t, false); return; }
  go('welcome');
  paintMyReward();
  hideLoader();
  restoreSession();
}

/* ================================================================ boot */
async function boot() {
  progress(15);
  paintOdds();
  readReferral();
  buildRegistration();
  bindResultActions();
  api('config').then((r) => { S.config = { ...DEFAULT_CONFIG, ...r.config }; }).catch(() => {});
  progress(35);
  try { S.stageMod = await import('./dice/stage.js'); } catch (e) { S.stageMod = null; }
  try { S.Fallback = (await import('./dice/fallback.js')).FallbackStage; } catch (e) { /* */ }
  progress(70);
  if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1200))]);
  progress(85);
  await route();
}
if (import.meta.env.DEV) window.__mk = S;
boot();
