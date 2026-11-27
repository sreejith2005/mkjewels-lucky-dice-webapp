export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const monthNames = MONTHS;

export function prettyDate(ymd, withDay) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withDay ? wd + ', ' : ''}${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}
export function addDays(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function istToday() { const t = new Date(Date.now() + 330 * 60000); return t.toISOString().slice(0, 10); }
export function time12(hhmm) { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }

let toastTimer;
export function toast(msg, kind = 'info') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
  el.textContent = msg; el.dataset.kind = kind; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (er) { /* */ } t.remove(); return ok;
  }
}

/** Elegant month calendar. opts: { min, max, closedWeekdays, value, onChange } */
export function calendar(host, opts) {
  const state = { value: opts.value || null };
  const start = state.value || opts.min;
  let [vy, vm] = start.split('-').map(Number);
  const render = () => {
    const first = new Date(Date.UTC(vy, vm - 1, 1));
    const offset = first.getUTCDay();
    const days = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
    const minYm = opts.min.slice(0, 7), maxYm = opts.max.slice(0, 7), ym = `${vy}-${String(vm).padStart(2, '0')}`;
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${ym}-${String(d).padStart(2, '0')}`;
      const wd = (offset + d - 1) % 7;
      const disabled = ymd < opts.min || ymd > opts.max || (opts.closedWeekdays || []).includes(wd);
      const cls = ['cal-cell', disabled ? 'off' : '', ymd === state.value ? 'sel' : '', ymd === opts.min ? 'today' : ''].join(' ');
      cells += `<button type="button" class="${cls}" data-d="${ymd}" ${disabled ? 'disabled aria-disabled="true"' : ''} aria-pressed="${ymd === state.value}" aria-label="${prettyDate(ymd, true)}">${d}</button>`;
    }
    host.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" ${ym <= minYm ? 'disabled' : ''} aria-label="Previous month">‹</button>
        <div class="cal-title">${MONTHS[vm - 1]} <span>${vy}</span></div>
        <button type="button" class="cal-nav" data-nav="1" ${ym >= maxYm ? 'disabled' : ''} aria-label="Next month">›</button>
      </div>
      <div class="cal-grid cal-dow">${DAYS.map((d) => `<span>${d[0]}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>`;
  };
  host.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav && !nav.disabled) { vm += Number(nav.dataset.nav); if (vm < 1) { vm = 12; vy--; } if (vm > 12) { vm = 1; vy++; } render(); return; }
    const cell = e.target.closest('[data-d]');
    if (cell && !cell.disabled) { state.value = cell.dataset.d; render(); opts.onChange && opts.onChange(state.value); }
  });
  render();
  return { get value() { return state.value; }, set(v) { state.value = v; if (v) { [vy, vm] = v.split('-').map(Number); } render(); } };
}

/** Chip group. multi=true for multi-select. */
export function chips(host, items, { multi = false, value = multi ? [] : null, onChange, render } = {}) {
  let val = multi ? [...value] : value;
  const draw = () => {
    host.innerHTML = items.map((it) => {
      const v = typeof it === 'string' ? it : it.value;
      const on = multi ? val.includes(v) : val === v;
      return `<button type="button" class="chip ${on ? 'on' : ''}" data-v="${esc(v)}" aria-pressed="${on}">${render ? render(it) : esc(v)}</button>`;
    }).join('');
  };
  host.setAttribute('role', 'group');
  host.addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    const v = b.dataset.v;
    if (multi) val = val.includes(v) ? val.filter((x) => x !== v) : [...val, v]; else val = v;
    draw(); onChange && onChange(val);
  });
  draw();
  return { get value() { return val; }, set(v) { val = multi ? [...(v || [])] : v; draw(); } };
}

export function countUp(el, from, to, ms = 1200) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 4);
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- calendar invites ---------- */
function icsDate(ymd, hhmm, plusMin = 0) {
  const d = new Date(`${ymd}T${hhmm}:00+05:30`); d.setMinutes(d.getMinutes() + plusMin);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
export function googleCalendarUrl({ title, ymd, hhmm, details, location }) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${icsDate(ymd, hhmm)}/${icsDate(ymd, hhmm, 60)}`, details, location });
  return `https://calendar.google.com/calendar/render?${p}`;
}
export function icsFile({ title, ymd, hhmm, details, location, uid }) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MK Jewels//Lucky Double Dice//EN', 'BEGIN:VEVENT',
    `UID:${uid}@mkjewels.in`, `DTSTAMP:${icsDate(istToday(), '00:00')}`, `DTSTART:${icsDate(ymd, hhmm)}`, `DTEND:${icsDate(ymd, hhmm, 60)}`,
    `SUMMARY:${title}`, `DESCRIPTION:${details.replace(/\n/g, '\\n')}`, `LOCATION:${location}`,
    'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', 'DESCRIPTION:Your MK Jewels visit', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'];
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}
