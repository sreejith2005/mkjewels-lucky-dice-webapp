/**
 * Haptics: Vibration API on Android; on iOS Safari (17.4+/18) a hidden native switch
 * produces a system haptic tick when toggled.
 */
let iosLabel = null;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function iosTick() {
  try {
    if (!iosLabel) {
      const id = 'mk-haptic-switch';
      const input = document.createElement('input');
      input.type = 'checkbox'; input.id = id; input.setAttribute('switch', '');
      input.style.cssText = 'position:fixed;opacity:0;pointer-events:none;width:1px;height:1px;left:-10px;top:-10px';
      iosLabel = document.createElement('label'); iosLabel.htmlFor = id; iosLabel.setAttribute('aria-hidden', 'true');
      iosLabel.style.cssText = input.style.cssText;
      document.body.append(input, iosLabel);
    }
    iosLabel.click();
  } catch (e) { /* not supported */ }
}

export function haptic(ms = 12) {
  if (reduce) return;
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } }
  else if (isIOS) iosTick();
}

export function hapticPattern(pattern) {
  if (reduce) return;
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  else if (isIOS) { pattern.forEach((v, i) => { if (i % 2 === 0) setTimeout(iosTick, pattern.slice(0, i).reduce((a, b) => a + b, 0)); }); }
}
