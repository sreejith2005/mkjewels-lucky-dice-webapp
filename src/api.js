import { API_URL } from './config.js';

export class ApiError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

async function remote(action, payload) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      // text/plain avoids a CORS pre-flight; Apps Script reads the raw body.
      const res = await fetch(API_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, payload }), redirect: 'follow', signal: ctrl.signal
      });
      clearTimeout(timer);
      return await res.json();
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  throw new ApiError(navigator.onLine === false ? 'You appear to be offline. Please check your connection.' : 'We could not reach MK Jewels right now. Please try again.', 'NETWORK');
}

export async function api(action, payload = {}) {
  let data;
  if (!import.meta.env.VITE_API_URL) {
    const { previewCall } = await import('./preview-backend.js');
    data = await previewCall(action, payload);
  } else {
    data = await remote(action, payload);
  }
  if (!data || !data.ok) throw new ApiError((data && data.error) || 'Something went wrong.', data && data.code);
  return data;
}
