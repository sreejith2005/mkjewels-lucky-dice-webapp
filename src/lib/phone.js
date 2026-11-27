import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js/max';

let names;
try { names = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { names = null; }

export function countryOptions() {
  const pinned = ['IN', 'AE', 'US', 'GB', 'CA', 'AU', 'SG', 'SA', 'QA', 'KW', 'OM', 'BH', 'NZ', 'HK'];
  const all = getCountries().map((c) => ({ iso: c, code: getCountryCallingCode(c), name: (names && names.of(c)) || c }));
  const top = pinned.map((p) => all.find((a) => a.iso === p)).filter(Boolean);
  const rest = all.filter((a) => !pinned.includes(a.iso)).sort((a, b) => a.name.localeCompare(b.name));
  return { top, rest };
}

/** Returns { ok, national, cc, error } */
export function validatePhone(iso, raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  const cc = getCountryCallingCode(iso);
  if (digits.startsWith(cc) && digits.length > 10 && iso === 'IN') digits = digits.slice(cc.length);
  if (iso === 'IN') {
    if (digits.length === 11 && digits[0] === '0') digits = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(digits) || /^(\d)\1+$/.test(digits)) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
  }
  const p = parsePhoneNumberFromString(digits, iso);
  if (!p || !p.isValid()) return { ok: false, error: 'Enter a valid mobile number for the selected country' };
  const type = p.getType();
  if (type && !['MOBILE', 'FIXED_LINE_OR_MOBILE', 'PERSONAL_NUMBER'].includes(type)) return { ok: false, error: 'Please use a mobile number' };
  return { ok: true, national: String(p.nationalNumber), cc };
}
