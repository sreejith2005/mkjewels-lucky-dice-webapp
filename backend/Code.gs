/**
 * MK JEWELS – LUCKY DOUBLE DICE
 * Google Apps Script backend (bind this script to your Google Sheet).
 *
 * All official dice results, coupons, QR tokens, claims, bookings and
 * redemptions are created here — never in the browser.
 * Every write runs under LockService so a phone number can only play once
 * and a coupon can only be redeemed once, even with simultaneous requests.
 *
 * First-time setup: run `setup()` once from the Apps Script editor,
 * then Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 */

/* =========================== CONFIGURATION =========================== */
const CONFIG = {
  CAMPAIGN_ID: 'LDD-2026',
  CAMPAIGN_NAME: 'MK JEWELS LUCKY DOUBLE DICE',
  CAMPAIGN_ACTIVE: true,
  CAMPAIGN_START: '2026-11-01',          // YYYY-MM-DD (IST)
  CAMPAIGN_END: '2027-03-31',            // YYYY-MM-DD (IST), inclusive
  COUPON_VALIDITY_DAYS: 30,              // coupon valid for N days from the roll
  COUPON_PREFIX: 'MKLD',
  CUSTOMER_START: 100001,                // first Customer_ID → MKC-100001
  SOURCE: 'MK JEWELS LUCKY DOUBLE DICE',

  // Official discount table (dice total → % off making charges). Do not edit mid-campaign.
  OFFER_TABLE: { 2: 20, 3: 22, 4: 24, 5: 26, 6: 28, 7: 30, 8: 33, 9: 36, 10: 40, 11: 45, 12: 50 },

  BRANCHES: [
    { id: 'BANDRA',        name: 'Bandra',             city: 'Mumbai' },
    { id: 'ANDHERI',       name: 'Andheri',            city: 'Mumbai' },
    { id: 'ZAVERI',        name: 'Zaveri Bazaar',      city: 'Mumbai' },
    { id: 'CGROAD',        name: 'C.G. Road',          city: 'Ahmedabad' },
    { id: 'SINDHUBHAVAN',  name: 'Sindhu Bhavan Road', city: 'Ahmedabad' }
  ],
  STORE_SLOTS: ['11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'],
  SLOT_CAPACITY: 4,                      // max bookings per branch per slot
  BOOKING_DAYS_AHEAD: 30,
  CLOSED_WEEKDAYS: [],                   // 0 = Sunday … 6 = Saturday
  MIN_LEAD_MINUTES: 60,                  // same-day slots must be at least this far ahead

  ONLINE_TIME_WINDOWS: ['10:00 – 12:00', '12:00 – 16:00', '16:00 – 20:00'],
  CONTACT_METHODS: ['WhatsApp', 'Phone call', 'Video call'],
  PRODUCT_INTERESTS: ['Gold Jewellery', 'Diamond Jewellery', 'Bridal Jewellery', 'Necklace', 'Earrings',
    'Bangles', 'Bracelet', 'Rings', 'Pendant', 'Mangalsutra', 'Other'],

  STAFF_SESSION_HOURS: 12,
  TZ_OFFSET_MIN: 330                     // IST
};

const SHEETS = {
  PARTICIPANTS: { name: 'Participants', headers: ['Customer_ID', 'Registered_At', 'Updated_At', 'Full_Name', 'Country_Code', 'Mobile', 'Normalized_Mobile', 'City', 'PINCODE', 'State', 'Country', 'Birthday', 'Anniversary', 'Terms_Accepted_At', 'Marketing_Consent', 'Campaign_ID', 'Source', 'Game_ID', 'Dice_1', 'Dice_2', 'Dice_Total', 'Offer_Percent', 'Is_Jackpot', 'Rolled_At', 'Coupon_Code', 'Coupon_Issue_Date', 'Coupon_Expiry_Date', 'Coupon_Status', 'Online_QR_ID', 'Online_Token_Hash', 'Store_QR_ID', 'Store_Token_Hash', 'Online_Claim_Status', 'Store_Visit_Status', 'Visited_At', 'Redeemed_At', 'Redeemed_By', 'Referral_Code', 'Referred_By_Code', 'Referred_By_Customer_ID', 'Referred_By_Name', 'Referred_By_Mobile'] },
  ONLINE: { name: 'Online_Claims', headers: ['Online_Claim_ID', 'Submitted_At', 'Updated_At', 'Customer_ID', 'Full_Name', 'Mobile', 'City', 'PINCODE', 'Coupon_Code', 'Offer_Percent', 'Coupon_Expiry_Date', 'Product_Interest', 'Contact_Method', 'Preferred_Date', 'Preferred_Time', 'Notes', 'Claim_Status', 'Lead_Status', 'Assigned_To', 'Follow_Up_Notes'] },
  STORE: { name: 'Store_Visits', headers: ['Appointment_ID', 'Booked_At', 'Updated_At', 'Customer_ID', 'Full_Name', 'Mobile', 'City', 'Coupon_Code', 'Offer_Percent', 'Coupon_Expiry_Date', 'Branch_ID', 'Branch', 'Branch_City', 'Appointment_Date', 'Appointment_Time', 'Product_Interest', 'Notes', 'Appointment_Status', 'Reschedule_Count', 'Visit_ID', 'Visited_At', 'Checked_In_By', 'Assigned_To', 'Follow_Up_Notes'] },
  REDEMPTIONS: { name: 'Redemptions', headers: ['Redemption_ID', 'Redeemed_At', 'Coupon_Code', 'Customer_ID', 'Full_Name', 'Mobile', 'Offer_Percent', 'Channel', 'Branch', 'Invoice_No', 'Jewellery_Category', 'Salesperson', 'Original_Making_Charges', 'Discount_Amount', 'Final_Making_Charges', 'Invoice_Value', 'Redeemed_By'] },
  STAFF: { name: 'Staff', headers: ['Staff_ID', 'Name', 'PIN', 'Role', 'Branch', 'Active'] },
  AUDIT: { name: 'Audit_Log', headers: ['Timestamp', 'Actor', 'Action', 'Reference', 'Details'] }
};

/* =========================== HTTP ENTRY POINTS =========================== */
function doGet() {
  return json_({ ok: true, service: CONFIG.CAMPAIGN_NAME, time: nowStr_() });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Invalid request.' }); }
  return json_(handleRequest_(body.action, body.payload || {}));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

const ACTIONS = {
  config: actConfig_, register: actRegister_, restore: actRestore_, roll: actRoll_,
  resolve: actResolve_, submitOnline: actSubmitOnline_, availability: actAvailability_,
  bookStore: actBookStore_, cancelStore: actCancelStore_, referrer: actReferrer_,
  staffLogin: actStaffLogin_, staffLookup: actStaffLookup_, staffVisit: actStaffVisit_, staffRedeem: actStaffRedeem_
};

function handleRequest_(action, p) {
  const fn = ACTIONS[action];
  if (!fn) return { ok: false, error: 'Unknown action.' };
  try {
    const data = fn(p || {});
    return Object.assign({ ok: true }, data);
  } catch (err) {
    if (err && err.userFacing) return { ok: false, error: err.message, code: err.code || 'ERROR' };
    console.error(err && err.stack || err);
    return { ok: false, error: 'Something went wrong. Please try again.', code: 'SERVER' };
  }
}

function fail_(msg, code) { const e = new Error(msg); e.userFacing = true; e.code = code; throw e; }

/* =========================== PUBLIC ACTIONS =========================== */
function actConfig_() {
  return { config: publicConfig_() };
}

function publicConfig_() {
  return {
    campaignId: CONFIG.CAMPAIGN_ID, campaignName: CONFIG.CAMPAIGN_NAME,
    active: campaignOpen_(), offerTable: CONFIG.OFFER_TABLE, branches: CONFIG.BRANCHES,
    storeSlots: CONFIG.STORE_SLOTS, bookingDaysAhead: CONFIG.BOOKING_DAYS_AHEAD, closedWeekdays: CONFIG.CLOSED_WEEKDAYS,
    onlineWindows: CONFIG.ONLINE_TIME_WINDOWS, contactMethods: CONFIG.CONTACT_METHODS, interests: CONFIG.PRODUCT_INTERESTS,
    couponValidityDays: CONFIG.COUPON_VALIDITY_DAYS, today: todayStr_()
  };
}

function actRegister_(p) {
  if (!campaignOpen_()) fail_('This campaign is not active right now.', 'CLOSED');
  const v = validateRegistration_(p);
  rateLimit_('reg:' + v.normalized, 8, 600, 'Too many attempts. Please wait a few minutes and try again.');

  return withLock_(function () {
    const sh = sheet_(SHEETS.PARTICIPANTS);
    const table = readTable_(sh);
    const idx = table.findIndex(function (r) { return r.Normalized_Mobile === v.normalized && r.Campaign_ID === CONFIG.CAMPAIGN_ID; });
    const now = nowStr_();
    let row, isNew = false;
    if (idx >= 0 && table[idx].Game_ID) {
      audit_('CUSTOMER', 'REGISTER_BLOCKED_ALREADY_PLAYED', table[idx].Customer_ID, '');
      fail_('This mobile number has already played. Please use a different mobile number.', 'ALREADY_PLAYED');
    }
    if (idx >= 0) {
      row = table[idx];
      // Update permitted details, keep history (IDs, game, coupon) untouched.
      Object.assign(row, {
        Updated_At: now, Full_Name: v.name, City: v.city, PINCODE: v.pincode, State: v.state || row.State,
        Country: v.country || row.Country, Birthday: v.birthday || row.Birthday, Anniversary: v.anniversary || row.Anniversary,
        Marketing_Consent: v.marketing ? 'YES' : (row.Marketing_Consent || 'NO')
      });
      writeRow_(sh, row._row, row);
      audit_('CUSTOMER', 'REGISTER_RETURNING', row.Customer_ID, '');
    } else {
      isNew = true;
      // Reuse the Customer_ID if this mobile exists from an earlier campaign.
      const prior = table.find(function (r) { return r.Normalized_Mobile === v.normalized; });
      const customerId = prior ? prior.Customer_ID : 'MKC-' + nextSeq_('CUSTOMER', CONFIG.CUSTOMER_START);
      row = {
        Customer_ID: customerId, Registered_At: now, Updated_At: now, Full_Name: v.name, Country_Code: '+' + v.cc,
        Mobile: v.phone, Normalized_Mobile: v.normalized, City: v.city, PINCODE: v.pincode, State: v.state, Country: v.country,
        Birthday: v.birthday, Anniversary: v.anniversary, Terms_Accepted_At: v.terms ? now : '', Marketing_Consent: v.marketing ? 'YES' : 'NO',
        Campaign_ID: CONFIG.CAMPAIGN_ID, Source: v.source || CONFIG.SOURCE,
        Referral_Code: referralCode_(customerId)
      };
      // Who invited this player (referral link ?ref=CODE). Self-referrals and unknown codes are ignored.
      if (v.ref) {
        const referrer = table.find(function (r) { return r.Campaign_ID === CONFIG.CAMPAIGN_ID && referralCodeOf_(r) === v.ref; });
        if (referrer && referrer.Normalized_Mobile !== v.normalized) {
          Object.assign(row, { Referred_By_Code: v.ref, Referred_By_Customer_ID: referrer.Customer_ID, Referred_By_Name: referrer.Full_Name, Referred_By_Mobile: referrer.Country_Code + ' ' + referrer.Mobile });
          audit_('CUSTOMER', 'REFERRED', customerId, 'by ' + referrer.Customer_ID + ' (' + v.ref + ')');
        }
      }
      appendRow_(sh, row);
      audit_('CUSTOMER', 'REGISTER', customerId, v.marketing ? 'marketing consent: yes' : 'marketing consent: no');
    }
    return {
      session: signSession_(row.Customer_ID),
      firstName: firstName_(row.Full_Name),
      returning: !isNew,
      result: row.Game_ID ? buildResult_(row) : null
    };
  });
}

/** Public: first name of the person behind a referral code (for "Priya invited you"). */
function actReferrer_(p) {
  const code = String(p.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,10}$/.test(code)) fail_('This invite link is not valid.', 'BAD_REF');
  const r = findParticipant_(function (x) { return x.Campaign_ID === CONFIG.CAMPAIGN_ID && referralCodeOf_(x) === code; });
  if (!r) fail_('This invite link is not valid.', 'BAD_REF');
  return { firstName: firstName_(r.Full_Name) };
}

function actRestore_(p) {
  const customerId = verifySession_(p.session);
  const found = findParticipant_(function (r) { return r.Customer_ID === customerId && r.Campaign_ID === CONFIG.CAMPAIGN_ID; });
  if (!found) fail_('Session expired. Please register again.', 'NO_SESSION');
  return { firstName: firstName_(found.Full_Name), result: found.Game_ID ? buildResult_(found) : null };
}

function actRoll_(p) {
  const customerId = verifySession_(p.session);
  if (!campaignOpen_()) fail_('This campaign is not active right now.', 'CLOSED');
  return withLock_(function () {
    const sh = sheet_(SHEETS.PARTICIPANTS);
    const row = readTable_(sh).find(function (r) { return r.Customer_ID === customerId && r.Campaign_ID === CONFIG.CAMPAIGN_ID; });
    if (!row) fail_('Please register before rolling.', 'NO_SESSION');
    if (row.Game_ID) return { result: buildResult_(row), existing: true };   // one roll per mobile per campaign

    const d1 = secureDie_(), d2 = secureDie_();
    const total = d1 + d2;
    const offer = offerFor_(d1, d2);
    const now = new Date();
    const seq = nextSeq_('COUPON', 1);
    const year = istParts_(now).y;
    const coupon = CONFIG.COUPON_PREFIX + '-' + year + '-' + pad_(seq, 6);
    const expiry = addDays_(todayStr_(), CONFIG.COUPON_VALIDITY_DAYS);

    Object.assign(row, {
      Updated_At: nowStr_(), Game_ID: 'G-' + pad_(seq, 6), Dice_1: d1, Dice_2: d2, Dice_Total: total, Offer_Percent: offer,
      Is_Jackpot: (d1 === 6 && d2 === 6) ? 'YES' : 'NO', Rolled_At: nowStr_(), Coupon_Code: coupon,
      Coupon_Issue_Date: todayStr_(), Coupon_Expiry_Date: expiry, Coupon_Status: 'ACTIVE',
      Online_QR_ID: 'QRO-' + pad_(seq, 6), Online_Token_Hash: sha256Hex_(qrToken_('ONLINE', coupon)),
      Store_QR_ID: 'QRS-' + pad_(seq, 6), Store_Token_Hash: sha256Hex_(qrToken_('STORE', coupon)),
      Online_Claim_Status: 'NOT_CLAIMED', Store_Visit_Status: 'NOT_BOOKED'
    });
    writeRow_(sh, row._row, row);
    audit_('CUSTOMER', 'GAME_COMPLETED', row.Customer_ID, coupon + ' | ' + d1 + '+' + d2 + '=' + total + ' → ' + offer + '%');
    return { result: buildResult_(row), existing: false };
  });
}

function actResolve_(p) {
  const ctx = participantByToken_(p.token);
  return {
    kind: ctx.kind,
    reward: publicReward_(ctx.row),
    onlineClaim: ctx.kind === 'ONLINE' ? publicOnline_(findBy_(SHEETS.ONLINE, 'Coupon_Code', ctx.row.Coupon_Code)) : null,
    appointment: ctx.kind === 'STORE' ? publicAppt_(findBy_(SHEETS.STORE, 'Coupon_Code', ctx.row.Coupon_Code)) : null,
    config: publicConfig_()
  };
}

function actSubmitOnline_(p) {
  const ctx = participantByToken_(p.token, 'ONLINE');
  assertUsable_(ctx.row);
  const interests = cleanList_(p.interests, CONFIG.PRODUCT_INTERESTS, 'Please choose at least one jewellery interest.');
  const method = oneOf_(p.method, CONFIG.CONTACT_METHODS, 'Please choose how we should contact you.');
  const date = validDate_(p.date, 'Please choose a preferred day.');
  if (date < todayStr_() || date > addDays_(todayStr_(), CONFIG.BOOKING_DAYS_AHEAD)) fail_('Please choose a day within the next ' + CONFIG.BOOKING_DAYS_AHEAD + ' days.', 'DATE');
  const time = oneOf_(p.time, CONFIG.ONLINE_TIME_WINDOWS, 'Please choose a preferred time.');
  const notes = cleanText_(p.notes, 500);

  return withLock_(function () {
    const sh = sheet_(SHEETS.ONLINE);
    const existing = readTable_(sh).find(function (r) { return r.Coupon_Code === ctx.row.Coupon_Code; });
    const now = nowStr_();
    let row;
    if (existing) {
      row = Object.assign(existing, { Updated_At: now, Product_Interest: interests.join(', '), Contact_Method: method, Preferred_Date: date, Preferred_Time: time, Notes: notes });
      writeRow_(sh, row._row, row);
      audit_('CUSTOMER', 'ONLINE_ENQUIRY_UPDATED', row.Online_Claim_ID, '');
    } else {
      row = {
        Online_Claim_ID: 'OC-' + pad_(nextSeq_('ONLINE', 1), 6), Submitted_At: now, Updated_At: now,
        Customer_ID: ctx.row.Customer_ID, Full_Name: ctx.row.Full_Name, Mobile: ctx.row.Normalized_Mobile, City: ctx.row.City,
        PINCODE: ctx.row.PINCODE, Coupon_Code: ctx.row.Coupon_Code, Offer_Percent: ctx.row.Offer_Percent,
        Coupon_Expiry_Date: ctx.row.Coupon_Expiry_Date, Product_Interest: interests.join(', '), Contact_Method: method,
        Preferred_Date: date, Preferred_Time: time, Notes: notes, Claim_Status: 'ONLINE_CLAIMED', Lead_Status: 'NEW_CAMPAIGN_LEAD'
      };
      appendRow_(sh, row);
      updateParticipant_(ctx.row, { Online_Claim_Status: 'ONLINE_CLAIMED' });
      audit_('CUSTOMER', 'ONLINE_ENQUIRY_SUBMITTED', row.Online_Claim_ID, ctx.row.Coupon_Code);
    }
    return { onlineClaim: publicOnline_(row) };
  });
}

function actAvailability_(p) {
  const ctx = participantByToken_(p.token, 'STORE');
  const branch = branch_(p.branchId);
  const date = validDate_(p.date, 'Please choose a date.');
  return { date: date, branchId: branch.id, slots: slotsFor_(branch.id, date, ctx.row.Coupon_Code) };
}

function actBookStore_(p) {
  const ctx = participantByToken_(p.token, 'STORE');
  assertUsable_(ctx.row);
  const branch = branch_(p.branchId);
  const date = validDate_(p.date, 'Please choose a date.');
  const time = oneOf_(p.time, CONFIG.STORE_SLOTS, 'Please choose a time slot.');
  const interests = cleanList_(p.interests || [], CONFIG.PRODUCT_INTERESTS, null);
  const notes = cleanText_(p.notes, 500);

  return withLock_(function () {
    const slot = slotsFor_(branch.id, date, ctx.row.Coupon_Code).find(function (s) { return s.time === time; });
    if (!slot || !slot.available) fail_('That slot was just taken. Please choose another time.', 'SLOT_FULL');

    const sh = sheet_(SHEETS.STORE);
    const existing = readTable_(sh).find(function (r) { return r.Coupon_Code === ctx.row.Coupon_Code && r.Appointment_Status !== 'WALK_IN'; });
    const now = nowStr_();
    let row, event;
    if (existing) {
      if (existing.Appointment_Status === 'VISITED') fail_('Your store visit has already been completed.', 'VISITED');
      const wasCancelled = existing.Appointment_Status === 'CANCELLED';
      row = Object.assign(existing, {
        Updated_At: now, Branch_ID: branch.id, Branch: branch.name, Branch_City: branch.city, Appointment_Date: date,
        Appointment_Time: time, Product_Interest: interests.join(', '), Notes: notes, Appointment_Status: 'CONFIRMED',
        Reschedule_Count: wasCancelled ? (Number(existing.Reschedule_Count) || 0) : (Number(existing.Reschedule_Count) || 0) + 1
      });
      writeRow_(sh, row._row, row);
      event = wasCancelled ? 'APPOINTMENT_REBOOKED' : 'APPOINTMENT_RESCHEDULED';
    } else {
      row = {
        Appointment_ID: 'APT-' + pad_(nextSeq_('APPOINTMENT', 1), 6), Booked_At: now, Updated_At: now,
        Customer_ID: ctx.row.Customer_ID, Full_Name: ctx.row.Full_Name, Mobile: ctx.row.Normalized_Mobile, City: ctx.row.City,
        Coupon_Code: ctx.row.Coupon_Code, Offer_Percent: ctx.row.Offer_Percent, Coupon_Expiry_Date: ctx.row.Coupon_Expiry_Date,
        Branch_ID: branch.id, Branch: branch.name, Branch_City: branch.city, Appointment_Date: date, Appointment_Time: time,
        Product_Interest: interests.join(', '), Notes: notes, Appointment_Status: 'CONFIRMED', Reschedule_Count: 0
      };
      appendRow_(sh, row);
      event = 'APPOINTMENT_BOOKED';
    }
    updateParticipant_(ctx.row, { Store_Visit_Status: 'STORE_VISIT_BOOKED' });
    audit_('CUSTOMER', event, row.Appointment_ID, branch.name + ' ' + date + ' ' + time);
    return { appointment: publicAppt_(row) };
  });
}

function actCancelStore_(p) {
  const ctx = participantByToken_(p.token, 'STORE');
  return withLock_(function () {
    const sh = sheet_(SHEETS.STORE);
    const row = readTable_(sh).find(function (r) { return r.Coupon_Code === ctx.row.Coupon_Code && r.Appointment_Status === 'CONFIRMED'; });
    if (!row) fail_('No active appointment to cancel.', 'NO_APPT');
    Object.assign(row, { Updated_At: nowStr_(), Appointment_Status: 'CANCELLED' });
    writeRow_(sh, row._row, row);
    updateParticipant_(ctx.row, { Store_Visit_Status: 'CANCELLED' });
    audit_('CUSTOMER', 'APPOINTMENT_CANCELLED', row.Appointment_ID, '');
    return { appointment: publicAppt_(row) };
  });
}

/* =========================== STAFF ACTIONS =========================== */
function actStaffLogin_(p) {
  const id = String(p.staffId || '').trim().toUpperCase();
  const pin = String(p.pin || '').trim();
  if (!id || !pin) fail_('Enter your Staff ID and PIN.', 'AUTH');
  rateLimit_('login:' + id, 6, 900, 'Too many attempts. Try again in 15 minutes.');
  const staff = readTable_(sheet_(SHEETS.STAFF)).find(function (r) { return String(r.Staff_ID).toUpperCase() === id; });
  if (!staff || String(staff.PIN) !== pin || String(staff.Active).toUpperCase() !== 'YES') {
    audit_(id, 'STAFF_LOGIN_FAILED', id, '');
    fail_('Staff ID or PIN is incorrect.', 'AUTH');
  }
  const payload = { id: staff.Staff_ID, name: staff.Name, role: staff.Role, branch: staff.Branch || 'ALL', exp: Date.now() + CONFIG.STAFF_SESSION_HOURS * 3600000 };
  const body = b64url_(JSON.stringify(payload));
  audit_(staff.Staff_ID, 'STAFF_LOGIN', staff.Staff_ID, '');
  return { token: body + '.' + hmac_('staff|' + body), staff: payload, branches: CONFIG.BRANCHES };
}

function actStaffLookup_(p) {
  const staff = verifyStaff_(p.staffToken);
  const q = String(p.query || '').trim();
  if (!q) fail_('Scan a QR code or enter a coupon code, mobile number or ID.', 'QUERY');
  let row = null, via = '';
  const tokenMatch = q.match(/[?&]t=([A-Za-z0-9_-]{16,64})/);
  if (tokenMatch || /^[A-Za-z0-9_-]{32}$/.test(q)) {
    const ctx = participantByToken_(tokenMatch ? tokenMatch[1] : q);
    row = ctx.row; via = ctx.kind === 'STORE' ? 'Store Visit QR' : 'Online Claim QR';
  } else if (/^MKLD-/i.test(q)) {
    row = findParticipant_(function (r) { return String(r.Coupon_Code).toUpperCase() === q.toUpperCase(); }); via = 'Coupon code';
  } else if (/^MKC-/i.test(q)) {
    row = findParticipant_(function (r) { return String(r.Customer_ID).toUpperCase() === q.toUpperCase() && r.Campaign_ID === CONFIG.CAMPAIGN_ID; }); via = 'Customer ID';
  } else if (/^APT-/i.test(q)) {
    const appt = findBy_(SHEETS.STORE, 'Appointment_ID', q.toUpperCase());
    if (appt) row = findParticipant_(function (r) { return r.Coupon_Code === appt.Coupon_Code; }); via = 'Appointment ID';
  } else {
    let digits = q.replace(/\D/g, '');
    if (digits.length === 10) digits = '91' + digits;
    row = findParticipant_(function (r) { return r.Normalized_Mobile === digits && r.Campaign_ID === CONFIG.CAMPAIGN_ID; }); via = 'Mobile number';
  }
  if (!row) fail_('No matching customer or coupon found.', 'NOT_FOUND');
  audit_(staff.id, 'STAFF_LOOKUP', row.Coupon_Code || row.Customer_ID, via);
  return { record: staffRecord_(row), via: via };
}

function actStaffVisit_(p) {
  const staff = verifyStaff_(p.staffToken);
  const code = String(p.couponCode || '').trim().toUpperCase();
  return withLock_(function () {
    const row = findParticipant_(function (r) { return r.Coupon_Code === code; });
    if (!row) fail_('Coupon not found.', 'NOT_FOUND');
    const branch = (staff.branch && staff.branch !== 'ALL') ? branch_(staff.branch) : branch_(p.branchId);
    const sh = sheet_(SHEETS.STORE);
    const appts = readTable_(sh).filter(function (r) { return r.Coupon_Code === code; });
    if (appts.some(function (r) { return r.Appointment_Status === 'VISITED' || r.Appointment_Status === 'WALK_IN'; })) fail_('This customer has already been checked in.', 'VISITED');
    const visitId = 'V-' + pad_(nextSeq_('VISIT', 1), 6);
    const now = nowStr_();
    let appt = appts.find(function (r) { return r.Appointment_Status === 'CONFIRMED'; });
    if (appt) {
      Object.assign(appt, { Updated_At: now, Appointment_Status: 'VISITED', Visit_ID: visitId, Visited_At: now, Checked_In_By: staff.id + ' (' + staff.name + ')' });
      if (appt.Branch_ID !== branch.id) appt.Notes = (appt.Notes ? appt.Notes + ' | ' : '') + 'Checked in at ' + branch.name;
      writeRow_(sh, appt._row, appt);
    } else {
      appt = {
        Appointment_ID: 'WALKIN-' + pad_(nextSeq_('APPOINTMENT', 1), 6), Booked_At: now, Updated_At: now, Customer_ID: row.Customer_ID,
        Full_Name: row.Full_Name, Mobile: row.Normalized_Mobile, City: row.City, Coupon_Code: row.Coupon_Code, Offer_Percent: row.Offer_Percent,
        Coupon_Expiry_Date: row.Coupon_Expiry_Date, Branch_ID: branch.id, Branch: branch.name, Branch_City: branch.city,
        Appointment_Date: todayStr_(), Appointment_Time: nowStr_().slice(11, 16), Appointment_Status: 'WALK_IN', Reschedule_Count: 0,
        Visit_ID: visitId, Visited_At: now, Checked_In_By: staff.id + ' (' + staff.name + ')'
      };
      appendRow_(sh, appt);
    }
    updateParticipant_(row, { Store_Visit_Status: 'VISITED', Visited_At: now });
    audit_(staff.id, 'CUSTOMER_VISITED', visitId, code + ' @ ' + branch.name);
    return { record: staffRecord_(findParticipant_(function (r) { return r.Coupon_Code === code; })) };
  });
}

function actStaffRedeem_(p) {
  const staff = verifyStaff_(p.staffToken);
  const code = String(p.couponCode || '').trim().toUpperCase();
  const mc = p.makingCharges === '' || p.makingCharges == null ? null : Number(p.makingCharges);
  const inv = p.invoiceValue === '' || p.invoiceValue == null ? null : Number(p.invoiceValue);
  if (mc !== null && !(mc > 0 && mc < 1e9)) fail_('Enter valid making charges.', 'AMOUNT');
  if (inv !== null && !(inv > 0 && inv < 1e10)) fail_('Enter a valid invoice value.', 'AMOUNT');
  const channel = p.channel === 'ONLINE' ? 'ONLINE' : 'STORE';

  return withLock_(function () {
    const row = findParticipant_(function (r) { return r.Coupon_Code === code; });
    if (!row) fail_('Coupon not found.', 'NOT_FOUND');
    const status = couponStatus_(row);
    if (status === 'REDEEMED') fail_('This coupon was already redeemed on ' + row.Redeemed_At + ' by ' + row.Redeemed_By + '.', 'REDEEMED');
    if (status === 'EXPIRED') fail_('This coupon expired on ' + row.Coupon_Expiry_Date + '.', 'EXPIRED');
    const offer = Number(row.Offer_Percent);
    const discount = mc === null ? '' : round2_(mc * offer / 100);
    const finalMc = mc === null ? '' : round2_(mc - discount);
    const branch = channel === 'ONLINE' ? { name: 'Online' } : ((staff.branch && staff.branch !== 'ALL') ? branch_(staff.branch) : (p.branchId ? branch_(p.branchId) : { name: '' }));
    const now = nowStr_();
    const red = {
      Redemption_ID: 'R-' + pad_(nextSeq_('REDEMPTION', 1), 6), Redeemed_At: now, Coupon_Code: code, Customer_ID: row.Customer_ID,
      Full_Name: row.Full_Name, Mobile: row.Normalized_Mobile, Offer_Percent: offer, Channel: channel, Branch: branch.name,
      Invoice_No: cleanText_(p.invoiceNo, 60), Jewellery_Category: cleanText_(p.category, 60), Salesperson: cleanText_(p.salesperson, 60),
      Original_Making_Charges: mc === null ? '' : mc, Discount_Amount: discount, Final_Making_Charges: finalMc,
      Invoice_Value: inv === null ? '' : inv, Redeemed_By: staff.id + ' (' + staff.name + ')'
    };
    appendRow_(sheet_(SHEETS.REDEMPTIONS), red);
    updateParticipant_(row, { Coupon_Status: 'REDEEMED', Redeemed_At: now, Redeemed_By: red.Redeemed_By });
    audit_(staff.id, 'COUPON_REDEEMED', code, red.Redemption_ID + ' ' + channel + (mc === null ? '' : ' MC ' + mc + ' → ' + finalMc));
    return { redemption: red, record: staffRecord_(findParticipant_(function (r) { return r.Coupon_Code === code; })) };
  });
}

/* =========================== DOMAIN HELPERS =========================== */
function offerFor_(d1, d2) {
  if (!(d1 >= 1 && d1 <= 6 && d2 >= 1 && d2 <= 6)) throw new Error('bad dice');
  return CONFIG.OFFER_TABLE[d1 + d2];
}

/** Unbiased 1–6 from a cryptographically secure UUID (rejection sampling). */
function secureDie_() {
  for (;;) {
    const hex = uuid_().replace(/-/g, '').slice(0, 12);  // first 6 bytes are fully random in a v4 UUID
    for (let i = 0; i < 12; i += 2) {
      const b = parseInt(hex.substr(i, 2), 16);
      if (b < 252) return (b % 6) + 1;
    }
  }
}

function validateRegistration_(p) {
  const name = String(p.name || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(name)) fail_('Please enter your full name (letters only).', 'NAME');
  const cc = String(p.cc || '91').replace(/\D/g, '');
  if (!/^\d{1,4}$/.test(cc)) fail_('Please choose a valid country code.', 'CC');
  let phone = String(p.phone || '').replace(/\D/g, '');
  if (cc === '91') {
    if (phone.length === 11 && phone[0] === '0') phone = phone.slice(1);
    if (!/^[6-9]\d{9}$/.test(phone)) fail_('Please enter a valid 10-digit Indian mobile number.', 'PHONE');
  } else if (!/^\d{5,14}$/.test(phone) || /^0+$/.test(phone)) fail_('Please enter a valid mobile number.', 'PHONE');
  if (/^(\d)\1+$/.test(phone)) fail_('Please enter a valid mobile number.', 'PHONE');
  const city = titleCase_(String(p.city || '').replace(/\s+/g, ' ').trim());
  if (city.length < 2 || city.length > 50 || !/^[\p{L}\p{M}][\p{L}\p{M} .'()-]*$/u.test(city)) fail_('Please enter your city.', 'CITY');
  const pincode = String(p.pincode || '').trim().toUpperCase();
  if (cc === '91') { if (!/^[1-9]\d{5}$/.test(pincode)) fail_('Please enter a valid 6-digit PIN code.', 'PIN'); }
  else if (!/^[A-Z0-9][A-Z0-9 -]{1,9}$/.test(pincode)) fail_('Please enter a valid postal code.', 'PIN');
  const today = todayStr_();
  let birthday = '', anniversary = '';
  if (p.birthday) { birthday = validDate_(p.birthday, 'Please choose a valid birthday.'); if (birthday > today || birthday < '1900-01-01') fail_('Birthday cannot be in the future.', 'DOB'); }
  if (p.anniversary) { anniversary = validDate_(p.anniversary, 'Please choose a valid anniversary.'); if (anniversary > today || anniversary < '1930-01-01') fail_('Anniversary cannot be in the future.', 'ANNIV'); }
  return {
    name: name, cc: cc, phone: phone, normalized: cc + phone, city: city, pincode: pincode,
    state: cleanText_(p.state, 40), country: cleanText_(p.country, 40) || (cc === '91' ? 'India' : ''),
    birthday: birthday, anniversary: anniversary, terms: p.terms === true, marketing: p.marketing === true, source: cleanText_(p.source, 40),
    ref: /^[A-Za-z0-9]{6,10}$/.test(String(p.ref || '')) ? String(p.ref).toUpperCase() : ''
  };
}

function couponStatus_(row) {
  if (!row.Coupon_Code) return 'NONE';
  if (row.Coupon_Status === 'REDEEMED') return 'REDEEMED';
  if (row.Coupon_Expiry_Date && todayStr_() > row.Coupon_Expiry_Date) return 'EXPIRED';
  return 'ACTIVE';
}

function assertUsable_(row) {
  const s = couponStatus_(row);
  if (s === 'REDEEMED') fail_('This reward has already been redeemed.', 'REDEEMED');
  if (s === 'EXPIRED') fail_('This reward expired on ' + prettyDate_(row.Coupon_Expiry_Date) + '.', 'EXPIRED');
}

function buildResult_(row) {
  return Object.assign(publicReward_(row), {
    customerId: row.Customer_ID,
    referralCode: referralCodeOf_(row),
    onlineToken: qrToken_('ONLINE', row.Coupon_Code),
    storeToken: qrToken_('STORE', row.Coupon_Code),
    onlineClaim: publicOnline_(findBy_(SHEETS.ONLINE, 'Coupon_Code', row.Coupon_Code)),
    appointment: publicAppt_(findBy_(SHEETS.STORE, 'Coupon_Code', row.Coupon_Code))
  });
}

function publicReward_(row) {
  return {
    firstName: firstName_(row.Full_Name), name: row.Full_Name,
    dice: [Number(row.Dice_1), Number(row.Dice_2)], total: Number(row.Dice_Total), offer: Number(row.Offer_Percent),
    jackpot: row.Is_Jackpot === 'YES', couponCode: row.Coupon_Code, issuedOn: row.Coupon_Issue_Date,
    expiresOn: row.Coupon_Expiry_Date, status: couponStatus_(row), gameId: row.Game_ID
  };
}

function publicOnline_(r) {
  if (!r) return null;
  return { id: r.Online_Claim_ID, interests: r.Product_Interest ? String(r.Product_Interest).split(', ') : [], method: r.Contact_Method, date: r.Preferred_Date, time: r.Preferred_Time, notes: r.Notes, status: r.Claim_Status, submittedAt: r.Submitted_At };
}

function publicAppt_(r) {
  if (!r) return null;
  return { id: r.Appointment_ID, branchId: r.Branch_ID, branch: r.Branch, city: r.Branch_City, date: r.Appointment_Date, time: r.Appointment_Time, status: r.Appointment_Status, interests: r.Product_Interest ? String(r.Product_Interest).split(', ') : [], notes: r.Notes, reschedules: Number(r.Reschedule_Count) || 0 };
}

function staffRecord_(row) {
  const online = findBy_(SHEETS.ONLINE, 'Coupon_Code', row.Coupon_Code);
  const appts = row.Coupon_Code ? readTable_(sheet_(SHEETS.STORE)).filter(function (r) { return r.Coupon_Code === row.Coupon_Code; }) : [];
  const red = row.Coupon_Code ? findBy_(SHEETS.REDEMPTIONS, 'Coupon_Code', row.Coupon_Code) : null;
  return {
    customerId: row.Customer_ID, name: row.Full_Name, mobile: '+' + row.Normalized_Mobile, city: row.City, pincode: row.PINCODE,
    birthday: row.Birthday, anniversary: row.Anniversary, registeredAt: row.Registered_At, campaign: CONFIG.CAMPAIGN_NAME,
    played: !!row.Game_ID, dice: row.Game_ID ? [Number(row.Dice_1), Number(row.Dice_2)] : null, total: Number(row.Dice_Total) || null,
    offer: Number(row.Offer_Percent) || null, jackpot: row.Is_Jackpot === 'YES', couponCode: row.Coupon_Code, issuedOn: row.Coupon_Issue_Date,
    expiresOn: row.Coupon_Expiry_Date, couponStatus: couponStatus_(row), visitStatus: row.Store_Visit_Status, visitedAt: row.Visited_At,
    redeemedAt: row.Redeemed_At, redeemedBy: row.Redeemed_By,
    onlineClaim: online ? { id: online.Online_Claim_ID, interests: online.Product_Interest, method: online.Contact_Method, date: online.Preferred_Date, time: online.Preferred_Time, notes: online.Notes, status: online.Claim_Status, submittedAt: online.Submitted_At } : null,
    appointments: appts.map(function (a) { return { id: a.Appointment_ID, branch: a.Branch, branchId: a.Branch_ID, date: a.Appointment_Date, time: a.Appointment_Time, status: a.Appointment_Status, reschedules: Number(a.Reschedule_Count) || 0, visitedAt: a.Visited_At, checkedInBy: a.Checked_In_By }; }),
    redemption: red ? { id: red.Redemption_ID, at: red.Redeemed_At, channel: red.Channel, branch: red.Branch, invoiceNo: red.Invoice_No, makingCharges: red.Original_Making_Charges, discount: red.Discount_Amount, finalMakingCharges: red.Final_Making_Charges, by: red.Redeemed_By } : null
  };
}

function participantByToken_(token, requiredKind) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) fail_('This QR code is not valid.', 'BAD_TOKEN');
  const hash = sha256Hex_(token);
  const row = findParticipant_(function (r) { return r.Online_Token_Hash === hash || r.Store_Token_Hash === hash; });
  if (!row) fail_('This QR code is not valid.', 'BAD_TOKEN');
  const kind = row.Online_Token_Hash === hash ? 'ONLINE' : 'STORE';
  if (requiredKind && kind !== requiredKind) fail_('This QR code is for ' + (kind === 'ONLINE' ? 'online claims' : 'store visits') + '.', 'WRONG_QR');
  return { row: row, kind: kind };
}

function slotsFor_(branchId, date, ownCoupon) {
  const today = todayStr_();
  const maxDate = addDays_(today, CONFIG.BOOKING_DAYS_AHEAD);
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const closed = date < today || date > maxDate || CONFIG.CLOSED_WEEKDAYS.indexOf(weekday) >= 0;
  const counts = {};
  readTable_(sheet_(SHEETS.STORE)).forEach(function (r) {
    if (r.Branch_ID === branchId && r.Appointment_Date === date && r.Appointment_Status === 'CONFIRMED' && r.Coupon_Code !== ownCoupon) {
      counts[r.Appointment_Time] = (counts[r.Appointment_Time] || 0) + 1;
    }
  });
  const nowMin = date === today ? (function () { const t = istParts_(new Date()); return t.h * 60 + t.mi + CONFIG.MIN_LEAD_MINUTES; })() : -1;
  return CONFIG.STORE_SLOTS.map(function (t) {
    const m = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const left = CONFIG.SLOT_CAPACITY - (counts[t] || 0);
    return { time: t, available: !closed && m >= nowMin && left > 0, left: Math.max(0, left) };
  });
}

function branch_(id) {
  const b = CONFIG.BRANCHES.find(function (x) { return x.id === id; });
  if (!b) fail_('Please choose a branch.', 'BRANCH');
  return b;
}

function campaignOpen_() {
  const t = todayStr_();
  return CONFIG.CAMPAIGN_ACTIVE && t >= CONFIG.CAMPAIGN_START && t <= CONFIG.CAMPAIGN_END;
}

/* =========================== SECURITY HELPERS =========================== */
function secret_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SECRET');
  if (!s) { s = uuid_() + uuid_() + uuid_(); props.setProperty('SECRET', s); }
  return s;
}
function hmac_(msg) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(msg, secret_())).replace(/=+$/, ''); }
function sha256Hex_(msg) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, msg, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function uuid_() { return Utilities.getUuid(); }
function b64url_(s) { return Utilities.base64EncodeWebSafe(s, Utilities.Charset.UTF_8).replace(/=+$/, ''); }
function b64urlDecode_(s) {
  while (s.length % 4) s += '=';
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(s, Utilities.Charset.UTF_8)).getDataAsString();
}
/** QR tokens are derived (HMAC) so the raw token is never stored; only its SHA-256 hash is. */
/** Short, stable, unguessable referral code per customer (derived, so older rows get one too). */
function referralCode_(customerId) { return hmac_('ref|' + CONFIG.CAMPAIGN_ID + '|' + customerId).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase(); }
function referralCodeOf_(row) { return row.Referral_Code || referralCode_(row.Customer_ID); }
function qrToken_(kind, coupon) { return hmac_('qr|' + kind + '|' + coupon).slice(0, 32); }
function signSession_(customerId) { return customerId + '.' + hmac_('session|' + CONFIG.CAMPAIGN_ID + '|' + customerId); }
function verifySession_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEq_(hmac_('session|' + CONFIG.CAMPAIGN_ID + '|' + parts[0]), parts[1])) fail_('Your session has expired. Please register again.', 'NO_SESSION');
  return parts[0];
}
function verifyStaff_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !safeEq_(hmac_('staff|' + parts[0]), parts[1])) fail_('Please sign in again.', 'STAFF_AUTH');
  const payload = JSON.parse(b64urlDecode_(parts[0]));
  if (!(payload.exp > Date.now())) fail_('Your staff session expired. Please sign in again.', 'STAFF_AUTH');
  const st = readTable_(sheet_(SHEETS.STAFF)).find(function (r) { return r.Staff_ID === payload.id; });
  if (!st || String(st.Active).toUpperCase() !== 'YES') fail_('Staff access has been revoked.', 'STAFF_AUTH');
  return payload;
}
function safeEq_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function rateLimit_(key, max, seconds, msg) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), seconds);
  if (n > max) fail_(msg, 'RATE_LIMIT');
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) fail_('We are very busy right now. Please try again in a moment.', 'BUSY');
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
function nextSeq_(name, start) {
  const props = PropertiesService.getScriptProperties();
  const cur = Number(props.getProperty('SEQ_' + name) || (start - 1));
  props.setProperty('SEQ_' + name, String(cur + 1));
  return cur + 1;
}

/* =========================== SHEET HELPERS =========================== */
function sheet_(def) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(def.name);
  if (!sh) { sh = ss.insertSheet(def.name); initSheet_(sh, def); }
  else ensureHeaders_(sh, def);
  return sh;
}
/** Append any headers added in a newer version of this script (once per execution per sheet). */
const checkedHeaders_ = {};
function ensureHeaders_(sh, def) {
  if (checkedHeaders_[def.name]) return;
  checkedHeaders_[def.name] = true;
  const have = headersOf_(sh);
  const missing = def.headers.filter(function (h) { return have.indexOf(h) < 0; });
  if (!missing.length) return;
  sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
}
function initSheet_(sh, def) {
  sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
    .setFontWeight('bold').setBackground('#101010').setFontColor('#D4B477');
  sh.getRange(1, 1, sh.getMaxRows(), def.headers.length).setNumberFormat('@');  // keep phones/IDs as text
  sh.setFrozenRows(1);
}
function readTable_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = sh.getLastColumn();
  const values = sh.getRange(1, 1, last, width).getValues();
  const headers = values[0];
  const out = [];
  for (let i = 1; i < values.length; i++) {
    const o = { _row: i + 1 };
    for (let c = 0; c < headers.length; c++) o[headers[c]] = values[i][c] === null ? '' : (values[i][c] instanceof Date ? values[i][c].toISOString() : String(values[i][c]));
    out.push(o);
  }
  return out;
}
function headersOf_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; }
function writeRow_(sh, rowNum, obj) {
  const h = headersOf_(sh);
  sh.getRange(rowNum, 1, 1, h.length).setValues([h.map(function (k) { return cell_(obj[k]); })]);
}
function appendRow_(sh, obj) {
  const h = headersOf_(sh);
  sh.appendRow(h.map(function (k) { return cell_(obj[k]); }));
}
/** Store everything as text so Sheets never converts phones, IDs or dates. */
function cell_(v) {
  if (v === undefined || v === null || v === '') return '';
  v = String(v);
  return /^[\d+\-=@.]/.test(v) ? "'" + v : v;
}
function findBy_(def, col, value) {
  if (!value) return null;
  return readTable_(sheet_(def)).find(function (r) { return r[col] === value; }) || null;
}
function findParticipant_(pred) { return readTable_(sheet_(SHEETS.PARTICIPANTS)).find(pred) || null; }
function updateParticipant_(row, patch) {
  const sh = sheet_(SHEETS.PARTICIPANTS);
  const fresh = readTable_(sh).find(function (r) { return r.Customer_ID === row.Customer_ID && r.Campaign_ID === row.Campaign_ID; });
  Object.assign(fresh, patch, { Updated_At: nowStr_() });
  writeRow_(sh, fresh._row, fresh);
  Object.assign(row, patch);
}
function audit_(actor, action, ref, details) {
  try { appendRow_(sheet_(SHEETS.AUDIT), { Timestamp: nowStr_(), Actor: actor, Action: action, Reference: ref, Details: details }); } catch (e) { console.error(e); }
}

/* =========================== SMALL UTILITIES =========================== */
function istParts_(d) {
  const t = new Date(d.getTime() + CONFIG.TZ_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() };
}
function pad_(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
function todayStr_() { const p = istParts_(new Date()); return p.y + '-' + pad_(p.m) + '-' + pad_(p.d); }
function nowStr_() { const p = istParts_(new Date()); return p.y + '-' + pad_(p.m) + '-' + pad_(p.d) + ' ' + pad_(p.h) + ':' + pad_(p.mi) + ':' + pad_(p.s); }
function addDays_(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function validDate_(s, msg) {
  s = String(s || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail_(msg, 'DATE');
  const d = new Date(s + 'T00:00:00Z');
  if (isNaN(d) || d.toISOString().slice(0, 10) !== s) fail_(msg, 'DATE');
  return s;
}
function prettyDate_(ymd) { const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; const p = String(ymd).split('-'); return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0]; }
function firstName_(n) { return String(n || '').split(' ')[0]; }
function titleCase_(s) { return s.toLowerCase().replace(/(^|[\s.'(-])(\p{L})/gu, function (m, a, b) { return a + b.toUpperCase(); }); }
function cleanText_(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, max); }
function cleanList_(arr, allowed, msg) {
  const list = (Array.isArray(arr) ? arr : []).filter(function (x, i, a) { return allowed.indexOf(x) >= 0 && a.indexOf(x) === i; });
  if (msg && !list.length) fail_(msg, 'LIST');
  return list;
}
function oneOf_(v, allowed, msg) { if (allowed.indexOf(v) < 0) fail_(msg, 'CHOICE'); return v; }
function round2_(n) { return Math.round(n * 100) / 100; }

/* =========================== ONE-TIME SETUP =========================== */
/** Run once from the editor: creates all tabs, a sample staff login and the Dashboard. */
function setup() {
  Object.keys(SHEETS).forEach(function (k) { sheet_(SHEETS[k]); });
  secret_();
  const staffSh = sheet_(SHEETS.STAFF);
  if (staffSh.getLastRow() < 2) {
    appendRow_(staffSh, { Staff_ID: 'ADMIN01', Name: 'Admin', PIN: String(100000 + Math.floor(Math.random() * 900000)), Role: 'ADMIN', Branch: 'ALL', Active: 'YES' });
  }
  buildDashboard_();
  return 'Setup complete. Check the Staff tab for the first admin PIN.';
}

function buildDashboard_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Dashboard') || ss.insertSheet('Dashboard', 0);
  sh.clear();
  const P = SHEETS.PARTICIPANTS, O = SHEETS.ONLINE, S = SHEETS.STORE, R = SHEETS.REDEMPTIONS;
  const col = function (def, name) { return "'" + def.name + "'!" + colLetter_(def.headers.indexOf(name) + 1) + '2:' + colLetter_(def.headers.indexOf(name) + 1); };
  const rows = [
    ['MK JEWELS – LUCKY DOUBLE DICE', ''],
    ['Live campaign summary (updates automatically)', ''],
    ['', ''],
    ['Registered customers', '=COUNTA(' + col(P, 'Customer_ID') + ')'],
    ['Dice games completed', '=COUNTA(' + col(P, 'Game_ID') + ')'],
    ['Coupons issued', '=COUNTA(' + col(P, 'Coupon_Code') + ')'],
    ['Jackpot winners (6 + 6)', '=COUNTIF(' + col(P, 'Is_Jackpot') + ',"YES")'],
    ['Players who came via an invite', '=COUNTA(' + col(P, 'Referred_By_Customer_ID') + ')'],
    ['Online enquiries', '=COUNTA(' + col(O, 'Online_Claim_ID') + ')'],
    ['Store visits booked (confirmed)', '=COUNTIF(' + col(S, 'Appointment_Status') + ',"CONFIRMED")'],
    ['Store visits cancelled', '=COUNTIF(' + col(S, 'Appointment_Status') + ',"CANCELLED")'],
    ['Customers visited (incl. walk-ins)', '=COUNTIF(' + col(S, 'Appointment_Status') + ',"VISITED")+COUNTIF(' + col(S, 'Appointment_Status') + ',"WALK_IN")'],
    ['Coupons redeemed', '=COUNTA(' + col(R, 'Redemption_ID') + ')'],
    ['Total invoice value (₹)', '=SUM(' + col(R, 'Invoice_Value') + ')'],
    ['Total making-charges discount (₹)', '=SUM(' + col(R, 'Discount_Amount') + ')'],
    ['', ''],
    ['Discount distribution', 'Coupons']
  ];
  const offers = [20, 22, 24, 26, 28, 30, 33, 36, 40, 45, 50];
  offers.forEach(function (o) { rows.push([o + '% OFF', '=COUNTIF(' + col(P, 'Offer_Percent') + ',"' + o + '")']); });
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange(1, 1).setFontSize(16).setFontWeight('bold').setFontColor('#C9A45C');
  sh.getRange(4, 1, 12, 1).setFontWeight('bold');
  sh.getRange(17, 1, 1, 2).setFontWeight('bold').setBackground('#101010').setFontColor('#D4B477');
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 140);
  // Top referrers: who invited how many players (updates live)
  const refId = colLetter_(P.headers.indexOf('Referred_By_Customer_ID') + 1), refName = colLetter_(P.headers.indexOf('Referred_By_Name') + 1);
  const q = 'select ' + refId + ', ' + refName + ', count(' + refId + ') where ' + refId + ' is not null group by ' + refId + ', ' + refName +
    ' order by count(' + refId + ') desc label ' + refId + " 'Customer ID', " + refName + " 'Referrer', count(" + refId + ") 'Players invited'";
  sh.getRange(1, 4, 2, 1).setValues([['Top referrers'], ['=IFERROR(QUERY(\'' + P.name + '\'!' + refId + '2:' + refName + ', "' + q + '", 0), "No referrals yet")']]);
  sh.getRange(1, 4).setFontSize(13).setFontWeight('bold').setFontColor('#C9A45C');
  sh.setColumnWidth(4, 130); sh.setColumnWidth(5, 220); sh.setColumnWidth(6, 130);
}
function colLetter_(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
