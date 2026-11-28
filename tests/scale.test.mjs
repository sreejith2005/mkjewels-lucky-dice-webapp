// Scale test: 20,000 participants in the sheet, then the hot paths must stay correct (and fast).
// Benchmark another backend version with:  CODE_GS=path/to/old/Code.gs node tests/scale.test.mjs
import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import { createGasRuntime } from '../src/gas-shim.js';

const file = process.env.CODE_GS || new URL('../backend/Code.gs', import.meta.url);
const N = Number(process.env.SCALE_N || 20000);
const src = readFileSync(file, 'utf8');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.error('  ✗ ' + msg); } };

const rt = createGasRuntime(src);
rt.setup();
const call = (a, p) => rt.handleRequest_(a, p);
const S = rt.state.sheets, CAMPAIGN = rt.CONFIG.CAMPAIGN_ID, secret = rt.state.props.SECRET;
const hmac = (m) => createHmac('sha256', secret).update(m).digest('base64url');   // == base64EncodeWebSafe without '='
const sha = (m) => createHash('sha256').update(m).digest('hex');
const qrToken = (kind, coupon) => hmac('qr|' + kind + '|' + coupon).slice(0, 32);
const refCode = (id) => hmac('ref|' + CAMPAIGN + '|' + id).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
const session = (id) => id + '.' + hmac('session|' + CAMPAIGN + '|' + id);
const pad = (n, w) => String(n).padStart(w, '0');

/* ---------- build N participants (every 10th registered but not rolled), plus claims and bookings ---------- */
const t0 = performance.now();
const PH = S.Participants[0], OH = S.Online_Claims[0], SH = S.Store_Visits[0];
const today = call('config', {}).config.today;
const expiry = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
const year = today.slice(0, 4);
const people = [];
for (let i = 0; i < N; i++) {
  const id = 'MKC-' + (100001 + i), phone = String(7000000000 + i * 7 + 1), played = i % 10 !== 9;
  const o = {
    Customer_ID: id, Registered_At: today + ' 10:00:00', Updated_At: today + ' 10:00:00', Full_Name: 'Guest ' + i, Country_Code: '+91',
    Mobile: phone, Normalized_Mobile: '91' + phone, City: 'Mumbai', PINCODE: '400050', Country: 'India', Marketing_Consent: 'NO',
    Campaign_ID: CAMPAIGN, Source: 'scale', Referral_Code: refCode(id)
  };
  if (played) {
    const seq = i + 1, coupon = 'MKLD-' + year + '-' + pad(seq, 6), d1 = (i % 6) + 1, d2 = ((i >> 3) % 6) + 1;
    Object.assign(o, {
      Game_ID: 'G-' + pad(seq, 6), Dice_1: d1, Dice_2: d2, Dice_Total: d1 + d2, Offer_Percent: rt.offerFor_(d1, d2), Is_Jackpot: d1 + d2 === 12 ? 'YES' : 'NO',
      Rolled_At: today + ' 10:01:00', Coupon_Code: coupon, Coupon_Issue_Date: today, Coupon_Expiry_Date: expiry, Coupon_Status: 'ACTIVE',
      Online_QR_ID: 'QRO-' + pad(seq, 6), Online_Token_Hash: sha(qrToken('ONLINE', coupon)), Store_QR_ID: 'QRS-' + pad(seq, 6),
      Store_Token_Hash: sha(qrToken('STORE', coupon)), Online_Claim_Status: 'NOT_CLAIMED', Store_Visit_Status: 'NOT_BOOKED'
    });
  }
  people.push(o);
  S.Participants.push(PH.map((h) => (o[h] === undefined ? '' : String(o[h]))));
}
let appts = 0;
people.forEach((o, i) => {
  if (!o.Coupon_Code) return;
  if (i % 7 === 0) S.Online_Claims.push(OH.map((h) => String({ Online_Claim_ID: 'OC-' + pad(i, 6), Customer_ID: o.Customer_ID, Coupon_Code: o.Coupon_Code, Claim_Status: 'ONLINE_CLAIMED' }[h] ?? '')));
  if (i % 4 === 0) {
    appts++;
    S.Store_Visits.push(SH.map((h) => String({ Appointment_ID: 'APT-' + pad(appts, 6), Customer_ID: o.Customer_ID, Coupon_Code: o.Coupon_Code, Branch_ID: 'BANDRA', Branch: 'Bandra', Appointment_Date: expiry, Appointment_Time: '11:00', Appointment_Status: 'CANCELLED' }[h] ?? '')));
  }
});
Object.assign(rt.state.props, { SEQ_CUSTOMER: String(100000 + N), SEQ_COUPON: String(N), SEQ_APPOINTMENT: String(appts) });
const buildMs = performance.now() - t0;

/* ---------- timing helper ---------- */
const timings = [];
function timed(label, fn) {
  const t = performance.now();
  const r = fn();
  timings.push([label, performance.now() - t]);
  return r;
}

/* ---------- correctness at scale ---------- */
const mid = people[Math.floor(N / 2)], lastP = people[N - 2], unplayed = people[N - 1];
ok(!!mid.Coupon_Code && !unplayed.Coupon_Code, 'fixture: middle row played, last row not played');

const newReg = timed('register (new number)', () => call('register', { name: 'Scale New', cc: '91', phone: '98989 89898', city: 'Pune', pincode: '411001' }));
ok(newReg.ok && !newReg.returning && newReg.session.startsWith('MKC-' + (100001 + N) + '.'), 'new player gets the next Customer_ID ' + (newReg.session || '').split('.')[0]);
ok(S.Participants.length === N + 2, 'one row appended');

const blocked = timed('register (already played)', () => call('register', { name: 'Again', cc: '91', phone: mid.Mobile, city: 'Mumbai', pincode: '400050' }));
ok(blocked.code === 'ALREADY_PLAYED', 'mobile in the middle of 20k rows is blocked (' + blocked.code + ')');

const ret = timed('register (returning, not rolled)', () => call('register', { name: 'Last Guest', cc: '91', phone: unplayed.Mobile, city: 'Surat', pincode: '395001' }));
ok(ret.ok && ret.returning && ret.session === session(unplayed.Customer_ID), 'registered-but-not-rolled number may register again');
ok(S.Participants[N][PH.indexOf('City')] === 'Surat' && S.Participants.length === N + 2, 'details updated in place on the last row, no duplicate');

const roll = timed('roll (first)', () => call('roll', { session: ret.session }));
ok(roll.ok && !roll.existing && roll.result.couponCode === 'MKLD-' + year + '-' + pad(N + 1, 6), 'roll issues the next coupon ' + (roll.result && roll.result.couponCode));
const roll2 = timed('roll (repeat)', () => call('roll', { session: ret.session }));
ok(roll2.existing && roll2.result.couponCode === roll.result.couponCode && roll2.result.dice.join() === roll.result.dice.join(), 'repeat roll returns the same result');
const rollNew = call('roll', { session: newReg.session });
ok(rollNew.ok && rollNew.result.couponCode === 'MKLD-' + year + '-' + pad(N + 2, 6), 'second new roll gets the following coupon');

const restore = timed('restore', () => call('restore', { session: session(mid.Customer_ID) }));
ok(restore.ok && restore.result.couponCode === mid.Coupon_Code && restore.result.storeToken === qrToken('STORE', mid.Coupon_Code), 'restore finds the middle row with identical QR tokens');

const res = timed('resolve (Store QR)', () => call('resolve', { token: qrToken('STORE', lastP.Coupon_Code) }));
ok(res.ok && res.kind === 'STORE' && res.reward.couponCode === lastP.Coupon_Code, 'Store QR of a row near the end resolves');
ok(call('resolve', { token: qrToken('ONLINE', people[3].Coupon_Code) }).kind === 'ONLINE', 'Online QR near the top resolves');

const refr = timed('referrer', () => call('referrer', { code: mid.Referral_Code }));
ok(refr.ok && refr.firstName === 'Guest', 'invite code resolves');
const friend = call('register', { name: 'Ref Friend', cc: '91', phone: '98989 12121', city: 'Pune', pincode: '411001', ref: mid.Referral_Code });
const fRow = S.Participants[S.Participants.length - 1];
ok(friend.ok && fRow[PH.indexOf('Referred_By_Customer_ID')] === mid.Customer_ID, 'friend linked to the referrer in the middle of the sheet');

const lg = call('staffLogin', { staffId: 'ADMIN01', pin: S.Staff[1][2] });
const st = lg.token;
const lkC = timed('staffLookup (coupon)', () => call('staffLookup', { staffToken: st, query: mid.Coupon_Code.toLowerCase() }));
ok(lkC.ok && lkC.record.customerId === mid.Customer_ID, 'lookup by coupon (any case)');
const lkM = timed('staffLookup (mobile)', () => call('staffLookup', { staffToken: st, query: lastP.Mobile }));
ok(lkM.ok && lkM.record.customerId === lastP.Customer_ID, 'lookup by mobile');
const lkI = timed('staffLookup (customer ID)', () => call('staffLookup', { staffToken: st, query: mid.Customer_ID.toLowerCase() }));
ok(lkI.ok && lkI.record.couponCode === mid.Coupon_Code, 'lookup by customer ID');
const lkQ = timed('staffLookup (QR URL)', () => call('staffLookup', { staffToken: st, query: 'https://x.in/?c=store&t=' + qrToken('STORE', mid.Coupon_Code) }));
ok(lkQ.ok && lkQ.via === 'Store Visit QR' && lkQ.record.customerId === mid.Customer_ID, 'lookup by scanned QR');
const withAppt = people.find((o, i) => i > N / 2 && i % 4 === 0 && o.Coupon_Code);
const aptId = S.Store_Visits.find((r) => r[SH.indexOf('Coupon_Code')] === withAppt.Coupon_Code)[0];
ok(call('staffLookup', { staffToken: st, query: aptId }).record.customerId === withAppt.Customer_ID, 'lookup by appointment ID');
ok(call('staffLookup', { staffToken: st, query: '9000099999' }).code === 'NOT_FOUND', 'unknown mobile → NOT_FOUND');
ok(lkC.record.onlineClaim === null && call('staffLookup', { staffToken: st, query: people[7 * 1000].Coupon_Code }).record.onlineClaim.id === 'OC-' + pad(7000, 6), 'online claim attached to staff record');

const vis = timed('staffVisit', () => call('staffVisit', { staffToken: st, couponCode: mid.Coupon_Code, branchId: 'BANDRA' }));
ok(vis.ok && vis.record.visitStatus === 'VISITED' && vis.record.appointments.some((a) => a.status === 'WALK_IN'), 'check-in at 20k rows');
ok(call('staffVisit', { staffToken: st, couponCode: mid.Coupon_Code, branchId: 'BANDRA' }).code === 'VISITED', 'double check-in blocked');
const red = timed('staffRedeem', () => call('staffRedeem', { staffToken: st, couponCode: mid.Coupon_Code, makingCharges: 10000, channel: 'STORE', branchId: 'BANDRA' }));
ok(red.ok && red.record.couponStatus === 'REDEEMED' && red.redemption.Discount_Amount === 100 * mid.Offer_Percent, 'redemption maths at 20k rows');
ok(call('staffRedeem', { staffToken: st, couponCode: mid.Coupon_Code, channel: 'ONLINE' }).code === 'REDEEMED', 'second redemption blocked');
const midRow = S.Participants[Math.floor(N / 2) + 1];
ok(midRow[PH.indexOf('Coupon_Status')] === 'REDEEMED' && midRow[PH.indexOf('Customer_ID')] === mid.Customer_ID, 'the right row was updated');
ok(S.Participants.length === N + 3, 'no stray rows written');

/* ---------- report ---------- */
const total = timings.reduce((s, [, ms]) => s + ms, 0);
console.log(`\n■ Scale (${N.toLocaleString('en-IN')} participants, built in ${buildMs.toFixed(0)} ms) — ${process.env.CODE_GS ? 'CODE_GS=' + process.env.CODE_GS : 'backend/Code.gs'}`);
timings.forEach(([l, ms]) => console.log('  ' + l.padEnd(34) + ms.toFixed(1).padStart(8) + ' ms'));
console.log('  ' + 'total'.padEnd(34) + total.toFixed(1).padStart(8) + ' ms');
console.log(`\n${failed ? '✗' : '✓'} ${passed} scale checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
