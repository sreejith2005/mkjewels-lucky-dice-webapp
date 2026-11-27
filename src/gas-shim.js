/**
 * Minimal Google Apps Script runtime emulator.
 * Runs the real backend/Code.gs unchanged — used for automated tests and for
 * the clearly-labelled browser preview mode when no Sheets API URL is configured.
 */

/* ---------- SHA-256 / HMAC (sync, dependency-free) ---------- */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

function sha256(bytes) {
  const l = bytes.length, bitLen = l * 8;
  const withPad = new Uint8Array(((l + 9 + 63) >> 6) << 6);
  withPad.set(bytes); withPad[l] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 4, bitLen >>> 0); dv.setUint32(withPad.length - 8, Math.floor(bitLen / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32); const odv = new DataView(out.buffer);
  H.forEach((v, i) => odv.setUint32(i * 4, v));
  return out;
}
function hmacSha256(keyBytes, msgBytes) {
  if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
  const k = new Uint8Array(64); k.set(keyBytes);
  const ipad = k.map(b => b ^ 0x36), opad = k.map(b => b ^ 0x5c);
  const inner = new Uint8Array(64 + msgBytes.length); inner.set(ipad); inner.set(msgBytes, 64);
  const ih = sha256(inner);
  const outer = new Uint8Array(96); outer.set(opad); outer.set(ih, 64);
  return sha256(outer);
}
const enc = s => new TextEncoder().encode(String(s));
const toSigned = u8 => Array.from(u8, b => (b > 127 ? b - 256 : b));
const toU8 = arr => (arr instanceof Uint8Array ? arr : Uint8Array.from(arr, b => b & 0xff));
function b64(u8) { let s = ''; u8.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }

function uuid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ---------- Spreadsheet emulation ---------- */
function makeSpreadsheet(state, save) {
  const strip = v => (typeof v === 'string' && v.startsWith("'") ? v.slice(1) : v);
  function makeSheet(name) {
    const rows = () => state.sheets[name];
    const ensure = (r, c) => { const d = rows(); while (d.length < r) d.push([]); d.forEach(row => { while (row.length < c) row.push(''); }); };
    const range = (r, c, nr = 1, nc = 1) => {
      const api = {
        getValues() { ensure(r + nr - 1, c + nc - 1); return rows().slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)); },
        setValues(vals) { ensure(r + nr - 1, c + nc - 1); vals.forEach((row, i) => row.forEach((v, j) => { rows()[r - 1 + i][c - 1 + j] = strip(v); })); save(); return api; },
        setFormula(f) { return api.setValues([[f]]); },
        setFontWeight() { return api; }, setBackground() { return api; }, setFontColor() { return api; },
        setNumberFormat() { return api; }, setFontSize() { return api; }
      };
      return api;
    };
    return {
      getName: () => name,
      getLastRow() { const d = rows(); let n = d.length; while (n > 0 && d[n - 1].every(v => v === '' || v == null)) n--; return n; },
      getLastColumn() { return rows().reduce((m, r) => { let n = r.length; while (n > 0 && (r[n - 1] === '' || r[n - 1] == null)) n--; return Math.max(m, n); }, 0); },
      getMaxRows() { return Math.max(1000, rows().length); },
      getRange: range,
      appendRow(arr) { const n = this.getLastRow(); rows().splice(n, 0, arr.map(strip)); save(); return this; },
      setFrozenRows() {}, setColumnWidth() {}, clear() { state.sheets[name] = []; save(); }
    };
  }
  const cache = {};
  return {
    getSheetByName(name) { if (!state.sheets[name]) return null; return cache[name] || (cache[name] = makeSheet(name)); },
    insertSheet(name) { state.sheets[name] = []; save(); return (cache[name] = makeSheet(name)); }
  };
}

/**
 * Create an isolated Apps Script runtime around Code.gs source.
 * @param {string} source  contents of backend/Code.gs
 * @param {{load?:()=>object, save?:(state)=>void, now?:()=>number}} opts
 */
export function createGasRuntime(source, opts = {}) {
  const state = (opts.load && opts.load()) || { sheets: {}, props: {}, cache: {} };
  state.sheets ||= {}; state.props ||= {}; state.cache ||= {};
  const save = () => opts.save && opts.save(state);
  const ss = makeSpreadsheet(state, save);

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    getUuid: uuid,
    computeDigest: (_alg, s) => toSigned(sha256(enc(s))),
    computeHmacSha256Signature: (value, key) => toSigned(hmacSha256(enc(key), enc(value))),
    base64EncodeWebSafe: (data) => b64(typeof data === 'string' ? enc(data) : toU8(data)).replace(/\+/g, '-').replace(/\//g, '_'),
    base64DecodeWebSafe: (s) => toSigned(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))),
    newBlob: (bytes) => ({ getDataAsString: () => new TextDecoder().decode(toU8(bytes)) })
  };
  const SpreadsheetApp = { getActiveSpreadsheet: () => ss, flush() {} };
  const LockService = { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) };
  const PropertiesService = { getScriptProperties: () => ({ getProperty: k => state.props[k] ?? null, setProperty(k, v) { state.props[k] = String(v); save(); } }) };
  const now = () => (opts.now ? opts.now() : Date.now());
  const CacheService = {
    getScriptCache: () => ({
      get(k) { const e = state.cache[k]; return e && e.exp > now() ? e.v : null; },
      put(k, v, sec) { state.cache[k] = { v, exp: now() + sec * 1000 }; save(); }
    })
  };
  const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType() { return this; }, getContent: () => t }) };
  const consoleShim = { log() {}, error: (...a) => console.error('[backend]', ...a) };

  // eslint-disable-next-line no-new-func
  const factory = new Function('SpreadsheetApp', 'LockService', 'PropertiesService', 'CacheService', 'Utilities', 'ContentService', 'console',
    source + '\n;return { handleRequest_: handleRequest_, setup: setup, CONFIG: CONFIG, offerFor_: offerFor_, secureDie_: secureDie_ };');
  const api = factory(SpreadsheetApp, LockService, PropertiesService, CacheService, Utilities, ContentService, consoleShim);
  return { ...api, state };
}

export { sha256, hmacSha256 };
