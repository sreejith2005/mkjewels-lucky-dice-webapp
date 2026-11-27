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

/**
 * Month calendar. opts: { min, max, closedWeekdays, value, onChange, pickers, startView }
 * pickers=true shows month and year dropdowns (for birthdays and anniversaries far in the past).
 */
export function calendar(host, opts) {
  const state = { value: opts.value || null };
  const start = state.value || opts.startView || opts.min;
  let [vy, vm] = start.split('-').map(Number);
  const minY = Number(opts.min.slice(0, 4)), maxY = Number(opts.max.slice(0, 4));
  const clampView = () => {
    const ym = `${vy}-${String(vm).padStart(2, '0')}`;
    if (ym < opts.min.slice(0, 7)) [vy, vm] = opts.min.split('-').map(Number);
    if (ym > opts.max.slice(0, 7)) [vy, vm] = opts.max.split('-').map(Number);
  };
  const render = () => {
    clampView();
    const first = new Date(Date.UTC(vy, vm - 1, 1));
    const offset = first.getUTCDay();
    const days = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
    const minYm = opts.min.slice(0, 7), maxYm = opts.max.slice(0, 7), ym = `${vy}-${String(vm).padStart(2, '0')}`;
    const today = istToday();
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<span class="cal-cell empty"></span>';
    for (let d = 1; d <= days; d++) {
      const ymd = `${ym}-${String(d).padStart(2, '0')}`;
      const wd = (offset + d - 1) % 7;
      const disabled = ymd < opts.min || ymd > opts.max || (opts.closedWeekdays || []).includes(wd);
      const cls = ['cal-cell', disabled ? 'off' : '', ymd === state.value ? 'sel' : '', ymd === today ? 'today' : ''].join(' ');
      cells += `<button type="button" class="${cls}" data-d="${ymd}" ${disabled ? 'disabled aria-disabled="true"' : ''} aria-pressed="${ymd === state.value}" aria-label="${prettyDate(ymd, true)}">${d}</button>`;
    }
    const title = opts.pickers
      ? `<div class="cal-pick">
          <select class="cal-sel" data-pick="m" aria-label="Month">${MONTHS.map((m, i) => { const v = `${vy}-${String(i + 1).padStart(2, '0')}`; return `<option value="${i + 1}" ${i + 1 === vm ? 'selected' : ''} ${v < minYm || v > maxYm ? 'disabled' : ''}>${m}</option>`; }).join('')}</select>
          <select class="cal-sel" data-pick="y" aria-label="Year">${Array.from({ length: maxY - minY + 1 }, (_, i) => maxY - i).map((y) => `<option ${y === vy ? 'selected' : ''}>${y}</option>`).join('')}</select>
        </div>`
      : `<div class="cal-title">${MONTHS[vm - 1]} <span>${vy}</span></div>`;
    host.innerHTML = `
      <div class="cal-head">
        <button type="button" class="cal-nav" data-nav="-1" ${ym <= minYm ? 'disabled' : ''} aria-label="Previous month"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        ${title}
        <button type="button" class="cal-nav" data-nav="1" ${ym >= maxYm ? 'disabled' : ''} aria-label="Next month"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div class="cal-grid cal-dow">${DAYS.map((d) => `<span>${d.slice(0, 2)}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>`;
  };
  host.classList.add('cal');
  host.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav && !nav.disabled) { vm += Number(nav.dataset.nav); if (vm < 1) { vm = 12; vy--; } if (vm > 12) { vm = 1; vy++; } render(); return; }
    const cell = e.target.closest('[data-d]');
    if (cell && !cell.disabled) { state.value = cell.dataset.d; render(); opts.onChange && opts.onChange(state.value); }
  });
  host.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-pick]'); if (!sel) return;
    if (sel.dataset.pick === 'm') vm = Number(sel.value); else vy = Number(sel.value);
    render();
  });
  render();
  return { get value() { return state.value; }, set(v) { state.value = v; if (v) { [vy, vm] = v.split('-').map(Number); } render(); } };
}

/**
 * Date field that opens a calendar. opts: { min, max, value, startView, placeholder, label, onChange }
 */
export function datePicker(host, opts) {
  let value = opts.value || '';
  host.classList.add('date-field');
  host.innerHTML = `
    <button type="button" class="date-btn input" aria-haspopup="dialog" aria-expanded="false">
      <svg class="icon" aria-hidden="true"><use href="#i-cal"/></svg><span class="date-val"></span>
    </button>
    <button type="button" class="date-clear" aria-label="Clear ${esc(opts.label || 'date')}" hidden><svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>
    <div class="date-pop" role="dialog" aria-label="${esc(opts.label || 'Choose a date')}" hidden><div class="date-cal"></div></div>`;
  const btn = host.querySelector('.date-btn'), clr = host.querySelector('.date-clear'), pop = host.querySelector('.date-pop'), val = host.querySelector('.date-val');
  const paint = () => {
    val.textContent = value ? longDate(value) : (opts.placeholder || 'Select date');
    btn.classList.toggle('empty', !value); clr.hidden = !value;
  };
  let cal = null;
  const open = () => {
    if (!cal) cal = calendar(host.querySelector('.date-cal'), { min: opts.min, max: opts.max, value: value || null, startView: opts.startView, pickers: true, onChange: (v) => { value = v; paint(); close(); opts.onChange && opts.onChange(v); } });
    else cal.set(value || null);
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => { const r = pop.getBoundingClientRect(); if (r.bottom > innerHeight) window.scrollBy({ top: r.bottom - innerHeight + 16, behavior: 'smooth' }); });
  };
  const close = () => {
    pop.hidden = true; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onKey);
  };
  const outside = (e) => { if (!host.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));
  clr.addEventListener('click', () => { value = ''; paint(); close(); opts.onChange && opts.onChange(''); });
  paint();
  return { get value() { return value; }, clear() { value = ''; paint(); }, focus() { btn.focus(); } };
}

export function longDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
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
