// Production-only browser error reporting → `logClientError` (written to Audit_Log).
// At most 3 reports per page load; reporting itself can never throw or loop.
import { api } from '../api.js';

const MAX_PER_LOAD = 3;

export function installErrorReporting(page, getSession = () => null) {
  if (!import.meta.env.PROD || !import.meta.env.VITE_API_URL) return;
  let sent = 0;
  const sid = (() => {
    try { return crypto.randomUUID().replace(/-/g, '').slice(0, 20); } catch (e) { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  })();
  const report = (message, source, line) => {
    if (sent >= MAX_PER_LOAD) return;
    message = String(message || '').trim();
    if (!message || /^Script error\.?$/i.test(message)) return;   // cross-origin noise, no detail
    sent++;
    let session = null;
    try { session = getSession(); } catch (e) { /* */ }
    api('logClientError', {
      sid, session, page, message: message.slice(0, 300), source: String(source || location.pathname).slice(0, 120),
      line: Number(line) || 0, ua: navigator.userAgent.slice(0, 120)
    }).catch(() => {});   // never report a failed report
  };
  window.addEventListener('error', (e) => {
    if (!e || !e.message) return;   // resource load errors (img/video) carry no message
    report(e.message, e.filename, e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    if (r && r.code === 'NETWORK') return;   // the report would fail too
    report(r && (r.stack || r.message) ? String(r.message || r) + (r.stack ? ' | ' + String(r.stack).split('\n').slice(1, 3).join(' ').trim() : '') : String(r));
  });
}
