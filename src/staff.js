import './styles/app.css';
import './styles/staff.css';
import { api } from './api.js';
import { PREVIEW } from './config.js';
import { $, $$, esc, toast, prettyDate, time12 } from './lib/ui.js';
import { installErrorReporting } from './lib/errors.js';

installErrorReporting('staff');

const KEY = 'mk_staff_session';
let session = (() => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch (e) { return null; } })();
let scanner = null, scanning = false, lastScan = { text: '', at: 0 }, record = null;
const inr = (n) => (n === '' || n == null || isNaN(n) ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

if (PREVIEW) {
  const r = $('#preview-ribbon'); r.hidden = false;
  r.innerHTML = 'Preview mode · demo logins: <b>ADMIN01 / 246810</b> · <b>STORE01 / 135790</b> (Bandra) · <b>ONLINE01 / 112233</b>';
}

function show() {
  const on = !!session;
  $('#s-login').hidden = on; $('#s-work').hidden = !on; $('#logout').hidden = !on;
  $('#who').textContent = on ? `${session.staff.name} · ${session.staff.branch === 'ALL' ? 'All branches' : branchName(session.staff.branch)}` : 'STAFF PORTAL';
}
const branchName = (id) => ((session && session.branches) || []).find((b) => b.id === id)?.name || id;

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('button[type=submit]', e.target); btn.disabled = true; $('#login-err').textContent = '';
  try {
    const res = await api('staffLogin', { staffId: $('#l-id').value, pin: $('#l-pin').value });
    session = { token: res.token, staff: res.staff, branches: res.branches };
    sessionStorage.setItem(KEY, JSON.stringify(session));
    $('#l-pin').value = '';
    show();
  } catch (err) { $('#login-err').textContent = err.message; } finally { btn.disabled = false; }
});
$('#logout').addEventListener('click', () => { stopCam(); session = null; sessionStorage.removeItem(KEY); record = null; renderEmpty(); show(); });

async function call(action, payload) {
  try { return await api(action, { staffToken: session.token, ...payload }); } catch (err) {
    if (err.code === 'STAFF_AUTH') { toast(err.message, 'error'); session = null; sessionStorage.removeItem(KEY); show(); }
    throw err;
  }
}

/* ---------------- camera ---------------- */
async function startCam() {
  const { default: QrScanner } = await import('qr-scanner');
  if (!scanner) {
    scanner = new QrScanner($('#video'), (res) => {
      const text = res.data || res;
      const now = Date.now();
      if (text === lastScan.text && now - lastScan.at < 4000) return;
      lastScan = { text, at: now };
      if (navigator.vibrate) navigator.vibrate(30);
      lookup(text, true);
    }, { returnDetailedScanResult: true, preferredCamera: 'environment', maxScansPerSecond: 8, highlightScanRegion: false });
  }
  try {
    await scanner.start(); scanning = true;
    $('#scanner').classList.add('live'); $('#cam-btn .lbl').textContent = 'Stop camera';
  } catch (e) { toast('Camera unavailable. Allow camera access or search manually.', 'error'); }
}
function stopCam() { if (scanner) scanner.stop(); scanning = false; $('#scanner').classList.remove('live'); $('#cam-btn .lbl').textContent = 'Start camera'; }
$('#cam-btn').addEventListener('click', () => (scanning ? stopCam() : startCam()));

$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) lookup(q); });

async function lookup(query, fromScan) {
  $('#record').innerHTML = '<div class="card empty-rec"><span class="spinner big"></span><p class="hint">Looking up…</p></div>';
  try {
    const res = await call('staffLookup', { query });
    record = res.record; render(res.via);
    if (fromScan && window.innerWidth < 960) $('#record').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    $('#record').innerHTML = `<div class="card empty-rec bad"><svg class="icon big-ic"><use href="#i-x"/></svg><p class="display">Not recognised</p><p class="hint">${esc(err.message)}</p></div>`;
  }
}

function renderEmpty() { $('#record').innerHTML = '<div class="card empty-rec"><p class="display gold-text">Ready to welcome</p><p class="hint">Scan a Store Visit or Online Claim QR, or search by coupon code or mobile number.</p></div>'; }

const statusMeta = {
  ACTIVE: ['ok', 'Valid — ready to redeem'],
  REDEEMED: ['bad', 'Already redeemed — cannot be claimed again'],
  EXPIRED: ['bad', 'Expired — cannot be redeemed'],
  NONE: ['warn', 'Registered — has not rolled the dice yet']
};

function render(via) {
  const r = record;
  const [tone, label] = statusMeta[r.couponStatus] || statusMeta.NONE;
  const visited = ['VISITED'].includes(r.visitStatus) || r.appointments.some((a) => a.status === 'VISITED' || a.status === 'WALK_IN');
  const active = r.appointments.find((a) => a.status === 'CONFIRMED');
  const branchOpts = (session.branches || []).map((b) => `<option value="${b.id}" ${active && active.branchId === b.id ? 'selected' : ''}>${esc(b.name)} · ${esc(b.city)}</option>`).join('');
  const needsBranch = session.staff.branch === 'ALL';
  $('#record').innerHTML = `
    <div class="status-banner ${tone}"><svg class="icon"><use href="#i-${tone === 'ok' ? 'check' : 'x'}"/></svg><div><b>${label}</b>${r.couponStatus === 'REDEEMED' ? `<span>Redeemed ${esc(r.redeemedAt)} by ${esc(r.redeemedBy)}${r.redemption ? ` · ${esc(r.redemption.channel)}${r.redemption.invoiceNo ? ' · Invoice ' + esc(r.redemption.invoiceNo) : ''}` : ''}</span>` : `<span>Found via ${esc(via || 'search')}</span>`}</div></div>
    <div class="card rec-card">
      <div class="rec-head">
        <div><p class="eyebrow dim">${esc(r.customerId)}</p><h2 class="display">${esc(r.name)}</h2>
          <p class="rec-sub"><a href="tel:${esc(r.mobile)}">${esc(r.mobile)}</a> · ${esc(r.city)} ${esc(r.pincode)}</p></div>
        ${r.played ? `<div class="rec-offer"><span class="gold-text">${r.offer}%</span><small>off making<br/>charges</small></div>` : ''}
      </div>
      ${r.played ? `<div class="kv">
        <div><span>Coupon</span><b class="mono">${esc(r.couponCode)}</b></div>
        <div><span>Dice</span><b>${r.dice[0]} + ${r.dice[1]} = ${r.total}${r.jackpot ? ' · JACKPOT' : ''}</b></div>
        <div><span>Valid until</span><b>${esc(prettyDate(r.expiresOn))}</b></div>
        <div><span>Store visit</span><b>${visited ? 'Visited' : active ? 'Booked' : '—'}</b></div>
        ${r.birthday ? `<div><span>Birthday</span><b>${esc(prettyDate(r.birthday))}</b></div>` : ''}
        ${r.anniversary ? `<div><span>Anniversary</span><b>${esc(prettyDate(r.anniversary))}</b></div>` : ''}
      </div>` : ''}
      ${r.appointments.length ? `<p class="eyebrow">Appointments</p><ul class="timeline">${r.appointments.map((a) => `<li><b>${esc(a.branch)}</b> · ${esc(prettyDate(a.date, true))} ${a.time ? esc(time12(a.time)) : ''}<span class="pill ${a.status.toLowerCase()}">${esc(a.status.replace('_', '-'))}</span>${a.reschedules ? `<small>Rescheduled ${a.reschedules}×</small>` : ''}${a.checkedInBy ? `<small>Checked in ${esc(a.visitedAt)} by ${esc(a.checkedInBy)}</small>` : ''}<small class="mono">${esc(a.id)}</small></li>`).join('')}</ul>` : ''}
      ${r.onlineClaim ? `<p class="eyebrow">Online enquiry</p><ul class="timeline"><li><b>${esc(r.onlineClaim.method)}</b> · ${esc(prettyDate(r.onlineClaim.date, true))} · ${esc(r.onlineClaim.time)}<small>${esc(r.onlineClaim.interests)}</small>${r.onlineClaim.notes ? `<small>“${esc(r.onlineClaim.notes)}”</small>` : ''}<small class="mono">${esc(r.onlineClaim.id)}</small></li></ul>` : ''}
    </div>

    ${r.played && !visited && r.couponStatus !== 'EXPIRED' ? `
    <div class="card act-card">
      <p class="eyebrow">Customer arrival</p>
      ${needsBranch ? `<div class="field"><label for="v-branch">Branch</label><select class="select" id="v-branch">${branchOpts}</select></div>` : ''}
      <button class="btn btn-ghost btn-block" id="btn-visit" type="button"><svg class="icon"><use href="#i-check"/></svg>${active ? 'Mark customer as visited' : 'Register walk-in visit'}</button>
    </div>` : ''}

    ${r.couponStatus === 'ACTIVE' ? `
    <form class="card act-card" id="redeem-form" novalidate>
      <p class="eyebrow">Redeem coupon · ${r.offer}% off making charges</p>
      <div class="seg" id="r-channel"><button type="button" class="on" data-ch="STORE">In store</button><button type="button" data-ch="ONLINE">Online sale</button></div>
      ${needsBranch ? `<div class="field" id="r-branch-f"><label for="r-branch">Branch</label><select class="select" id="r-branch">${branchOpts}</select></div>` : ''}
      <div class="row2">
        <div class="field"><label for="r-inv">Invoice no.</label><input class="input" id="r-inv" maxlength="60" placeholder="INV-…" /></div>
        <div class="field"><label for="r-sp">Salesperson</label><input class="input" id="r-sp" maxlength="60" placeholder="Name" /></div>
      </div>
      <div class="field"><label for="r-cat">Jewellery category</label><select class="select" id="r-cat"><option value="">Select</option>${['Gold Jewellery', 'Diamond Jewellery', 'Bridal Jewellery', 'Necklace', 'Earrings', 'Bangles', 'Bracelet', 'Rings', 'Pendant', 'Mangalsutra', 'Chain', 'Other'].map((c) => `<option>${c}</option>`).join('')}</select></div>
      <div class="row2">
        <div class="field"><label for="r-mc">Original making charges (₹)</label><input class="input" id="r-mc" inputmode="decimal" placeholder="0" /></div>
        <div class="field"><label for="r-iv">Invoice value (₹)</label><input class="input" id="r-iv" inputmode="decimal" placeholder="0" /></div>
      </div>
      <div class="calc" id="calc"></div>
      <p class="err form-err" id="redeem-err"></p>
      <button class="btn btn-gold btn-lg btn-block" type="submit"><span class="lbl">Redeem coupon</span></button>
    </form>` : ''}`;

  const vb = $('#btn-visit');
  if (vb) vb.onclick = async () => {
    vb.disabled = true;
    try { const res = await call('staffVisit', { couponCode: r.couponCode, branchId: $('#v-branch') ? $('#v-branch').value : '' }); record = res.record; toast('Customer marked as visited'); render(via); }
    catch (err) { toast(err.message, 'error'); vb.disabled = false; }
  };
  const form = $('#redeem-form');
  if (form) {
    let channel = 'STORE';
    $('#r-channel').onclick = (e) => { const b = e.target.closest('[data-ch]'); if (!b) return; channel = b.dataset.ch; $$('#r-channel button').forEach((x) => x.classList.toggle('on', x === b)); const bf = $('#r-branch-f'); if (bf) bf.hidden = channel === 'ONLINE'; };
    const calc = () => {
      const mc = parseFloat($('#r-mc').value.replace(/,/g, ''));
      $('#calc').innerHTML = mc > 0 ? `<div><span>Making charges</span><b>${inr(mc)}</b></div><div><span>Discount ${r.offer}%</span><b>− ${inr(Math.round(mc * r.offer) / 100)}</b></div><div class="tot"><span>Final making charges</span><b>${inr(Math.round((mc - mc * r.offer / 100) * 100) / 100)}</b></div>` : '<p class="hint">Enter making charges to calculate the discount. The discount applies to making charges only.</p>';
    };
    $('#r-mc').addEventListener('input', calc); calc();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const mc = $('#r-mc').value.replace(/,/g, '').trim(), iv = $('#r-iv').value.replace(/,/g, '').trim();
      if ((mc && !(parseFloat(mc) > 0)) || (iv && !(parseFloat(iv) > 0))) { $('#redeem-err').textContent = 'Please enter valid amounts.'; return; }
      const ok = await confirm(`Redeem ${r.couponCode}?`, `${r.name} · ${r.offer}% off making charges${mc ? ` · discount ${inr(Math.round(parseFloat(mc) * r.offer) / 100)}` : ''}. This cannot be undone.`);
      if (!ok) return;
      const btn = $('button[type=submit]', form); btn.disabled = true;
      try {
        const res = await call('staffRedeem', { couponCode: r.couponCode, channel, branchId: $('#r-branch') ? $('#r-branch').value : '', invoiceNo: $('#r-inv').value, salesperson: $('#r-sp').value, category: $('#r-cat').value, makingCharges: mc, invoiceValue: iv });
        record = res.record; render(via); toast('Coupon redeemed successfully');
        if (navigator.vibrate) navigator.vibrate([20, 60, 30]);
      } catch (err) { $('#redeem-err').textContent = err.message; btn.disabled = false; if (err.code === 'REDEEMED') lookup(r.couponCode); }
    };
  }
}

/* ---------------- confirm sheet ---------------- */
const sheet = $('#sheet');
function confirm(title, body) {
  return new Promise((resolve) => {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = `<p>${esc(body)}</p><div class="done-actions" style="margin-top:20px"><button class="btn btn-ghost" data-no type="button">Cancel</button><button class="btn btn-gold" data-yes type="button">Confirm</button></div>`;
    sheet.showModal();
    const done = (v) => { sheet.close(); resolve(v); };
    $('[data-no]', sheet).onclick = () => done(false);
    $('[data-yes]', sheet).onclick = () => done(true);
    $('[data-close]', sheet).onclick = () => done(false);
  });
}

show();
