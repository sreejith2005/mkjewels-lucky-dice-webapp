/**
 * Shake-to-roll. Uses DeviceMotion (Android: no prompt; iOS 13+: needs permission from a tap).
 * Calls onStart when a deliberate shake begins, onMove(ax, ay, az) with gravity-free acceleration
 * while shaking, and onEnd({ power }) once the phone has been still for a moment.
 */
const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const motionSupported = () => touch && typeof window !== 'undefined' && 'DeviceMotionEvent' in window && window.isSecureContext !== false;
export const motionNeedsPermission = () => motionSupported() && typeof DeviceMotionEvent.requestPermission === 'function';

let permission = motionNeedsPermission() ? 'unknown' : (motionSupported() ? 'granted' : 'denied');
export const motionPermission = () => permission;

/** Must be called from inside a tap/click handler on iOS. Never throws. */
export function requestMotion() {
  if (!motionNeedsPermission() || permission === 'granted') return Promise.resolve(permission);
  try {
    return DeviceMotionEvent.requestPermission()
      .then((r) => { permission = r === 'granted' ? 'granted' : 'denied'; return permission; })
      .catch(() => { permission = 'denied'; return permission; });
  } catch (e) { permission = 'denied'; return Promise.resolve(permission); }
}

export function shakeDetector({ onStart, onMove, onEnd, enabled = () => true }) {
  const g = { x: 0, y: 0, z: 0 };
  let hasG = false, state = 'idle', peaks = [], startedAt = 0, lastStrong = 0, energy = 0, seen = false;
  const START = 14, KEEP = 8;

  function handler(e) {
    let ax, ay, az;
    const a = e.acceleration;
    if (a && a.x != null) { ax = a.x; ay = a.y; az = a.z; }
    else {
      const ag = e.accelerationIncludingGravity; if (!ag || ag.x == null) return;
      if (!hasG) { g.x = ag.x; g.y = ag.y; g.z = ag.z; hasG = true; }
      g.x += (ag.x - g.x) * 0.1; g.y += (ag.y - g.y) * 0.1; g.z += (ag.z - g.z) * 0.1;
      ax = ag.x - g.x; ay = ag.y - g.y; az = ag.z - g.z;
    }
    seen = true;
    const now = performance.now();
    const mag = Math.hypot(ax, ay, az);
    if (state === 'idle') {
      if (!enabled()) { peaks = []; return; }
      if (mag > START) {
        peaks = peaks.filter((t) => now - t < 600); peaks.push(now);
        if (peaks.length >= 2) { state = 'shaking'; startedAt = now; lastStrong = now; energy = 0; peaks = []; onStart && onStart(); }
      }
      return;
    }
    if (state === 'shaking') {
      onMove && onMove(ax, ay, az);
      if (mag > KEEP) { lastStrong = now; energy += mag; }
      const still = now - lastStrong > 420, longEnough = now - startedAt > 650;
      if ((still && longEnough) || now - startedAt > 6000) {
        state = 'cooldown';
        const secs = Math.max(0.3, (now - startedAt) / 1000);
        onEnd && onEnd({ power: Math.min(1, energy / secs / 900) });
        setTimeout(() => { state = 'idle'; }, 1200);
      }
    }
  }
  let on = false;
  return {
    start() { if (!on && motionSupported()) { addEventListener('devicemotion', handler); on = true; } },
    stop() { if (on) { removeEventListener('devicemotion', handler); on = false; } state = 'idle'; },
    get active() { return state === 'shaking'; },
    get seen() { return seen; }
  };
}
