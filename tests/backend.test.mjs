// Runs the real backend/Code.gs inside the Apps Script emulator and checks every business rule.
import { readFileSync } from 'node:fs';
import { createGasRuntime } from '../src/gas-shim.js';

const src = readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8');
let passed = 0, failed = 0;
const ok = (cond, msg) => { if (cond) { passed++; } else { failed++; console.error('  ✗ ' + msg); } };
const section = (t) => console.log('\n■ ' + t);

const rt = createGasRuntime(src);
rt.setup();
const call = (a, p) => rt.handleRequest_(a, p);
const sheet = (n) => rt.state.sheets[n];
const staffPin = sheet('Staff')[1][2];

section('Discount table — all 36 combinations');
const expected = { 2: 20, 3: 22, 4: 24, 5: 26, 6: 28, 7: 30, 8: 33, 9: 36, 10: 40, 11: 45, 12: 50 };
let fifty = 0;
for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
  const o = rt.offerFor_(a, b);
  ok(o === expected[a + b], `${a}+${b} → ${o}`);
  ok(o >= 20 && o <= 50, `range ${a}+${b}`);
  if (o === 50) { fifty++; ok(a === 6 && b === 6, '50% only on double six'); }
}
ok(fifty === 1, 'exactly one combination gives 50%');
console.log('  36/36 combinations map correctly; 50% only for 6+6');

section('Secure dice are fair (60,000 rolls)');
const freq = [0, 0, 0, 0, 0, 0, 0];
for (let i = 0; i < 60000; i++) freq[rt.secureDie_()]++;
for (let f = 1; f <= 6; f++) ok(Math.abs(freq[f] - 10000) < 450, `face ${f} frequency ${freq[f]}`);
console.log('  frequencies', freq.slice(1).join(' / '));

section('Registration validation');
const base = { name: '  Priya   Shah ', cc: '91', phone: '98765 43210', city: 'mumbai', pincode: '400050' };
const bad = [
  [{ phone: '12345' }, 'PHONE'], [{ phone: '5876543210' }, 'PHONE'], [{ phone: '9999999999' }, 'PHONE'],
  [{ name: '12345' }, 'NAME'], [{ name: '' }, 'NAME'], [{ pincode: '04005' }, 'PIN'], [{ pincode: '40005A' }, 'PIN'],
  [{ city: '' }, 'CITY'], [{ birthday: '2099-01-01' }, 'DOB'], [{ birthday: '2025-02-30' }, 'DATE'],
  [{ anniversary: '2999-01-01' }, 'ANNIV']
];
bad.forEach(([patch, code]) => { const r = call('register', { ...base, ...patch }); ok(!r.ok && r.code === code, `rejects ${JSON.stringify(patch)} (${r.code})`); });
const reg = call('register', { ...base, birthday: '1992-04-18' });
ok(reg.ok && reg.firstName === 'Priya' && !reg.returning && reg.result === null, 'valid registration accepted');
const p1 = sheet('Participants')[1];
const H = sheet('Participants')[0];
const col = (row, name) => row[H.indexOf(name)];
ok(col(p1, 'Customer_ID') === 'MKC-100001', 'Customer_ID MKC-100001');
ok(col(p1, 'Normalized_Mobile') === '919876543210', 'mobile normalized');
ok(col(p1, 'Full_Name') === 'Priya Shah' && col(p1, 'City') === 'Mumbai', 'name/city cleaned');
ok(col(p1, 'Birthday') === '1992-04-18' && col(p1, 'Anniversary') === '', 'dates stored, blank anniversary');
ok(col(p1, 'Marketing_Consent') === 'NO', 'marketing not pre-selected');
ok(col(p1, 'Terms_Accepted_At') === '', 'no terms checkbox → no acceptance timestamp recorded');

section('Duplicate prevention');
const reg2 = call('register', { ...base, phone: '+91 98765-43210'.replace('+91', ''), name: 'Priya S Shah' });
ok(reg2.ok && reg2.returning, 'same mobile recognised as returning');
ok(sheet('Participants').length === 2, 'no duplicate customer row');
ok(call('roll', { session: 'MKC-100001.forged' }).code === 'NO_SESSION', 'forged session rejected');
const roll1 = call('roll', { session: reg.session });
ok(roll1.ok && !roll1.existing, 'first roll succeeds');
const R = roll1.result;
ok(R.offer === expected[R.dice[0] + R.dice[1]] && R.total === R.dice[0] + R.dice[1], 'stored offer matches dice');
ok(/^MKLD-\d{4}-000001$/.test(R.couponCode), 'coupon code format ' + R.couponCode);
ok(R.onlineToken !== R.storeToken && R.onlineToken.length === 32, 'two distinct QR tokens');
const roll2 = call('roll', { session: reg.session });
ok(roll2.existing && roll2.result.couponCode === R.couponCode && roll2.result.dice.join() === R.dice.join(), 'second roll returns SAME result');
const reg3 = call('register', base);
ok(!reg3.ok && reg3.code === 'ALREADY_PLAYED', 'a mobile that already played cannot register again (' + reg3.code + ')');
ok(!JSON.stringify(reg3).includes(R.couponCode), 're-registering never reveals the existing coupon');
ok(call('restore', { session: reg.session }).result.onlineToken === R.onlineToken, 'refresh restores identical QR tokens');
const rawRow = sheet('Participants')[1].join('|');
ok(!rawRow.includes(R.onlineToken) && !rawRow.includes(R.storeToken), 'raw tokens are never stored (hash only)');

section('Referrals');
ok(/^[A-Z0-9]{8}$/.test(R.referralCode), 'every result carries a referral code ' + R.referralCode);
ok(call('referrer', { code: R.referralCode }).firstName === 'Priya', 'invite code resolves to the referrer first name');
ok(call('referrer', { code: 'NOPE1234' }).code === 'BAD_REF' && call('referrer', { code: '<x>' }).code === 'BAD_REF', 'unknown or malformed invite codes rejected');
const friend = call('register', { ...base, name: 'Anil Mehta', phone: '91234 56780', ref: R.referralCode.toLowerCase() });
ok(friend.ok, 'invited friend registers');
const PH = sheet('Participants')[0], prow = (name) => sheet('Participants').find((r) => r[PH.indexOf('Full_Name')] === name);
const fr = prow('Anil Mehta');
ok(fr[PH.indexOf('Referred_By_Customer_ID')] === 'MKC-100001' && fr[PH.indexOf('Referred_By_Name')].startsWith('Priya') && fr[PH.indexOf('Referred_By_Code')] === R.referralCode, 'friend is linked to the referrer');
ok(/^[A-Z0-9]{8}$/.test(fr[PH.indexOf('Referral_Code')]) && fr[PH.indexOf('Referral_Code')] !== R.referralCode, 'friend gets an own referral code');
call('register', { ...base, name: 'Ravi Self', phone: '90000 11122', ref: 'ZZZZ9999' });
ok(prow('Ravi Self')[PH.indexOf('Referred_By_Customer_ID')] === '', 'unknown invite code is ignored at registration');

section('QR tokens');
ok(call('resolve', { token: 'x'.repeat(32) }).code === 'BAD_TOKEN', 'invalid token rejected');
ok(call('resolve', { token: '../../etc' }).code === 'BAD_TOKEN', 'malformed token rejected');
const ro = call('resolve', { token: R.onlineToken }); const rs = call('resolve', { token: R.storeToken });
ok(ro.kind === 'ONLINE' && rs.kind === 'STORE', 'tokens resolve to their own workflow');
ok(ro.reward.couponCode === rs.reward.couponCode && !JSON.stringify(ro).includes('98765'), 'same coupon; no phone exposed');
ok(call('submitOnline', { token: R.storeToken, interests: ['Rings'], method: 'WhatsApp', date: ro.config.today, time: '10:00 – 12:00' }).code === 'WRONG_QR', 'store QR cannot submit online claim');

section('Online claim');
const today = ro.config.today;
ok(call('submitOnline', { token: R.onlineToken, interests: [], method: 'WhatsApp', date: today, time: '10:00 – 12:00' }).code === 'LIST', 'needs an interest');
ok(call('submitOnline', { token: R.onlineToken, interests: ['Rings'], method: 'Pigeon', date: today, time: '10:00 – 12:00' }).code === 'CHOICE', 'rejects unknown method');
ok(call('submitOnline', { token: R.onlineToken, interests: ['Rings'], method: 'WhatsApp', date: '2020-01-01', time: '10:00 – 12:00' }).code === 'DATE', 'rejects past date');
const oc = call('submitOnline', { token: R.onlineToken, interests: ['Rings', 'Hacked'], method: 'WhatsApp', date: today, time: '16:00 – 20:00', notes: '=HYPERLINK("x") <b>hi</b>' });
ok(oc.ok && oc.onlineClaim.id === 'OC-000001', 'online claim saved');
const ocRow = sheet('Online_Claims')[1]; const OH = sheet('Online_Claims')[0];
ok(ocRow[OH.indexOf('Product_Interest')] === 'Rings', 'unknown interests stripped');
ok(!ocRow[OH.indexOf('Notes')].startsWith('=') && !ocRow[OH.indexOf('Notes')].includes('<'), 'formula / HTML injection neutralised');
ok(ocRow[OH.indexOf('Lead_Status')] === 'NEW_CAMPAIGN_LEAD' && ocRow[OH.indexOf('Claim_Status')] === 'ONLINE_CLAIMED', 'claim + lead status set');
call('submitOnline', { token: R.onlineToken, interests: ['Necklace'], method: 'Phone call', date: today, time: '10:00 – 12:00' });
ok(sheet('Online_Claims').length === 2, 'resubmission updates, no duplicate lead');
ok(col(sheet('Participants')[1], 'Store_Visit_Status') !== 'VISITED', 'online claim does not mark visited');

section('Store booking');
const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
const av = call('availability', { token: R.storeToken, branchId: 'BANDRA', date: tomorrow });
ok(av.ok && av.slots.length === 9 && av.slots.every(s => s.available), 'all slots open tomorrow');
ok(call('availability', { token: R.storeToken, branchId: 'BANDRA', date: '2020-01-01' }).slots.every(s => !s.available), 'past dates closed');
ok(call('bookStore', { token: R.storeToken, branchId: 'NOWHERE', date: tomorrow, time: '11:00' }).code === 'BRANCH', 'unknown branch rejected');
const bk = call('bookStore', { token: R.storeToken, branchId: 'BANDRA', date: tomorrow, time: '11:00', interests: ['Bridal Jewellery'] });
ok(bk.ok && bk.appointment.status === 'CONFIRMED' && bk.appointment.id === 'APT-000001', 'appointment confirmed');
const bk2 = call('bookStore', { token: R.storeToken, branchId: 'CGROAD', date: tomorrow, time: '15:00' });
ok(bk2.appointment.id === 'APT-000001' && bk2.appointment.reschedules === 1 && bk2.appointment.branch === 'C.G. Road', 'reschedule keeps same appointment ID');
ok(sheet('Store_Visits').length === 2, 'reschedule does not duplicate');
ok(call('resolve', { token: R.storeToken }).appointment.time === '15:00', 'same Store QR resolves to latest appointment');
// capacity: fill CGROAD 12:00 with 4 other customers
const others = [];
for (let i = 0; i < 5; i++) {
  const r = call('register', { ...base, phone: '91234567' + (10 + i), name: 'Guest ' + 'ABCDE'[i] });
  others.push(call('roll', { session: r.session }).result);
}
for (let i = 0; i < 4; i++) ok(call('bookStore', { token: others[i].storeToken, branchId: 'CGROAD', date: tomorrow, time: '12:00' }).ok, 'capacity booking ' + (i + 1));
ok(call('bookStore', { token: others[4].storeToken, branchId: 'CGROAD', date: tomorrow, time: '12:00' }).code === 'SLOT_FULL', 'overbooking prevented');
ok(call('availability', { token: others[4].storeToken, branchId: 'CGROAD', date: tomorrow }).slots.find(s => s.time === '12:00').available === false, 'full slot shown unavailable');
const cn = call('cancelStore', { token: others[0].storeToken });
ok(cn.appointment.status === 'CANCELLED', 'cancellation works');
ok(call('bookStore', { token: others[4].storeToken, branchId: 'CGROAD', date: tomorrow, time: '12:00' }).ok, 'cancelled slot frees capacity');

section('Staff portal');
ok(call('staffLookup', { staffToken: 'nope', query: R.couponCode }).code === 'STAFF_AUTH', 'unauthenticated staff blocked');
ok(call('staffLogin', { staffId: 'ADMIN01', pin: '000000' }).code === 'AUTH', 'wrong PIN rejected');
const lg = call('staffLogin', { staffId: 'admin01', pin: staffPin });
ok(lg.ok && lg.token, 'staff login');
const tampered = lg.token.replace(/^./, c => (c === 'a' ? 'b' : 'a'));
ok(call('staffLookup', { staffToken: tampered, query: R.couponCode }).code === 'STAFF_AUTH', 'tampered staff token rejected');
const scanUrl = `https://example.com/?c=store&t=${R.storeToken}`;
const lk = call('staffLookup', { staffToken: lg.token, query: scanUrl });
ok(lk.ok && lk.via === 'Store Visit QR' && lk.record.mobile === '+919876543210', 'staff scan of Store QR shows customer');
ok(lk.record.visitStatus !== 'VISITED' && lk.record.appointments[0].status === 'CONFIRMED', 'scanning alone does NOT mark visited');
ok(call('staffLookup', { staffToken: lg.token, query: '9876543210' }).record.couponCode === R.couponCode, 'mobile search');
ok(call('staffLookup', { staffToken: lg.token, query: 'APT-000001' }).ok, 'appointment ID search');
ok(call('staffLookup', { staffToken: lg.token, query: 'mkc-100001' }).ok, 'customer ID search');
const vs = call('staffVisit', { staffToken: lg.token, couponCode: R.couponCode, branchId: 'CGROAD' });
ok(vs.ok && vs.record.visitStatus === 'VISITED' && vs.record.appointments[0].status === 'VISITED', 'staff check-in marks VISITED');
ok(call('staffVisit', { staffToken: lg.token, couponCode: R.couponCode, branchId: 'CGROAD' }).code === 'VISITED', 'double check-in blocked');
const walk = call('staffVisit', { staffToken: lg.token, couponCode: others[1].couponCode.replace('', ''), branchId: 'ANDHERI' });
ok(walk.ok, 'check-in with appointment elsewhere works');
const w2 = call('staffVisit', { staffToken: lg.token, couponCode: others[3].couponCode, branchId: 'ZAVERI' });
ok(w2.ok, 'visit ok');
// walk-in without any appointment
const walkReg = call('register', { ...base, phone: '9000000001', name: 'Walk In' });
const walkRoll = call('roll', { session: walkReg.session }).result;
const wi = call('staffVisit', { staffToken: lg.token, couponCode: walkRoll.couponCode, branchId: 'ANDHERI' });
ok(wi.ok && wi.record.appointments[0].status === 'WALK_IN', 'walk-in registration');

section('Redemption');
ok(call('staffRedeem', { staffToken: lg.token, couponCode: R.couponCode, makingCharges: '-5' }).code === 'AMOUNT', 'negative amount rejected');
const rd = call('staffRedeem', { staffToken: lg.token, couponCode: R.couponCode, makingCharges: 20000, invoiceValue: 185000, invoiceNo: 'INV-77', channel: 'STORE', branchId: 'CGROAD' });
ok(rd.ok && rd.redemption.Discount_Amount === Math.round(20000 * R.offer) / 100 && rd.redemption.Final_Making_Charges === 20000 - Math.round(20000 * R.offer) / 100, 'discount maths on making charges only');
ok(rd.record.couponStatus === 'REDEEMED', 'coupon marked REDEEMED');
const again = call('staffRedeem', { staffToken: lg.token, couponCode: R.couponCode, channel: 'ONLINE' });
ok(!again.ok && again.code === 'REDEEMED', 'second redemption blocked (any channel)');
ok(call('submitOnline', { token: R.onlineToken, interests: ['Rings'], method: 'WhatsApp', date: today, time: '10:00 – 12:00' }).code === 'REDEEMED', 'redeemed coupon cannot be claimed again');
ok(call('bookStore', { token: R.storeToken, branchId: 'BANDRA', date: tomorrow, time: '11:00' }).code === 'REDEEMED', 'redeemed coupon cannot book again');
ok(sheet('Redemptions').length === 2, 'single redemption row');

section('Expiry');
const ex = others[2];
const rowIdx = sheet('Participants').findIndex(r => r[H.indexOf('Coupon_Code')] === ex.couponCode);
sheet('Participants')[rowIdx][H.indexOf('Coupon_Expiry_Date')] = '2020-01-01';
ok(call('staffRedeem', { staffToken: lg.token, couponCode: ex.couponCode }).code === 'EXPIRED', 'expired coupon cannot be redeemed');
ok(call('resolve', { token: ex.onlineToken }).reward.status === 'EXPIRED', 'expired status shown');

section('Rate limiting & staff revocation');
let limited = false;
for (let i = 0; i < 10; i++) { const r = call('staffLogin', { staffId: 'GHOST', pin: '1' }); if (r.code === 'RATE_LIMIT') limited = true; }
ok(limited, 'login brute force rate-limited');
sheet('Staff')[1][5] = 'NO';
ok(call('staffLookup', { staffToken: lg.token, query: R.couponCode }).code === 'STAFF_AUTH', 'deactivated staff token stops working');

section('Audit');
const actions = sheet('Audit_Log').slice(1).map(r => r[2]);
['REGISTER', 'GAME_COMPLETED', 'ONLINE_ENQUIRY_SUBMITTED', 'APPOINTMENT_BOOKED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_CANCELLED', 'STAFF_LOOKUP', 'CUSTOMER_VISITED', 'COUPON_REDEEMED', 'STAFF_LOGIN_FAILED']
  .forEach(a => ok(actions.includes(a), 'audit has ' + a));

section('Health check');
const hc = JSON.parse(rt.doGet().getContent());
ok(hc.ok === true && hc.service === rt.CONFIG.CAMPAIGN_NAME && typeof hc.campaignActive === 'boolean' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(hc.time), 'doGet returns ok/service/campaignActive/time');
ok(hc.version === rt.VERSION && /^\d{4}\.\d{2}\.\d{2}-\d+$/.test(hc.version), 'doGet reports VERSION ' + hc.version);

section('Client error reporting');
const auditLen = () => sheet('Audit_Log').length;
const before = auditLen();
const longMsg = 'TypeError: x is undefined <script>' + 'y'.repeat(600);
ok(call('logClientError', { sid: 'pageAAAA1111', message: longMsg, page: 'customer', source: 'https://x/assets/main.js', line: 12 }).ok, 'client error accepted');
const last = sheet('Audit_Log')[auditLen() - 1];
ok(last[2] === 'CLIENT_ERROR' && last[1] === 'CLIENT' && last[3] === 'sid:pageAAAA1111', 'written to Audit_Log as CLIENT_ERROR');
const msgPart = last[4].split(' || ')[0];
ok(msgPart.length === 300 && !last[4].includes('<'), 'message trimmed to 300 characters and HTML stripped');
ok(call('logClientError', { session: reg.session, message: 'boom' }).ok && sheet('Audit_Log')[auditLen() - 1][3] === 'MKC-100001', 'valid customer session is used as the reference');
let errLimited = false;
for (let i = 0; i < 8; i++) if (call('logClientError', { sid: 'pageBBBB2222', message: 'loop ' + i }).code === 'RATE_LIMIT') errLimited = true;
ok(errLimited && auditLen() - before === 2 + 5, 'rate-limited per session (5 per 10 minutes)');
ok(call('logClientError', { session: 'MKC-1.forged', sid: '<bad>', message: 'x' }).ok, 'forged session / bad sid still logs as anonymous');

section('resetForLaunch');
const secretBefore = rt.state.props.SECRET;
const staffBefore = JSON.stringify(sheet('Staff'));
let refused = '';
try { rt.resetForLaunch(); } catch (e) { refused = e.message; }
ok(/CONFIRM_RESET/.test(refused) && sheet('Participants').length > 2, 'refuses without CONFIRM_RESET = YES (data untouched)');
rt.state.props.CONFIRM_RESET = 'no';
try { rt.resetForLaunch(); refused = ''; } catch (e) { refused = e.message; }
ok(refused && sheet('Participants').length > 2, 'refuses unless the value is exactly YES');
rt.state.props.CONFIRM_RESET = 'YES';
const msg = rt.resetForLaunch();
ok(/Reset complete/.test(msg), 'reset runs with CONFIRM_RESET = YES');
const dataRows = (n) => sheet(n).slice(1).filter((r) => r.some((v) => v !== '' && v != null)).length;
['Participants', 'Online_Claims', 'Store_Visits', 'Redemptions'].forEach((n) => ok(dataRows(n) === 0 && sheet(n)[0][0], n + ' emptied, headers kept'));
ok(dataRows('Audit_Log') === 1 && sheet('Audit_Log')[1][2] === 'RESET_FOR_LAUNCH', 'Audit_Log emptied except the reset record');
ok(rt.state.props.SECRET === secretBefore, 'SECRET untouched');
ok(JSON.stringify(sheet('Staff')) === staffBefore, 'Staff tab untouched');
ok(!('CONFIRM_RESET' in rt.state.props), 'CONFIRM_RESET deleted after running');
ok(!Object.keys(rt.state.props).some((k) => k.startsWith('SEQ_')), 'ID counters reset');
let again2 = '';
try { rt.resetForLaunch(); } catch (e) { again2 = e.message; }
ok(/CONFIRM_RESET/.test(again2), 'cannot run twice without setting CONFIRM_RESET again');
const fresh = call('register', { ...base, phone: '98111 22233', name: 'First Launch' });
ok(fresh.ok && sheet('Participants')[1][0] === 'MKC-100001', 'first player after reset gets MKC-100001 in row 2');
const fr1 = call('roll', { session: fresh.session });
ok(/-000001$/.test(fr1.result.couponCode), 'coupon counter restarts at 000001');
ok(call('register', base).ok, 'a number that played before the reset can play again');

console.log(`\n${failed ? '✗' : '✓'} ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
