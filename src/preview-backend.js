/**
 * PREVIEW MODE ONLY (no VITE_API_URL configured).
 * Runs the real backend/Code.gs in-browser on top of localStorage so the full experience
 * can be reviewed before Google Sheets is connected. Nothing is sent anywhere.
 * This module is excluded from production builds that set VITE_API_URL.
 */
import source from '../backend/Code.gs?raw';
import { createGasRuntime } from './gas-shim.js';

const KEY = 'mk_preview_db_v2';
export const PREVIEW_STAFF = { id: 'ADMIN01', pin: '246810' };
let rt;

function runtime() {
  if (rt) return rt;
  rt = createGasRuntime(source, {
    load: () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } },
    save: (state) => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* storage full */ } }
  });
  if (!rt.state.sheets.Staff) {
    rt.setup();
    const staff = rt.state.sheets.Staff;
    staff[1][2] = PREVIEW_STAFF.pin;
    staff.push(['STORE01', 'Bandra Store', '135790', 'STORE', 'BANDRA', 'YES'], ['ONLINE01', 'Online Sales', '112233', 'ONLINE_SALES', 'ALL', 'YES']);
    localStorage.setItem(KEY, JSON.stringify(rt.state));
  }
  return rt;
}

export async function previewCall(action, payload) {
  const delay = action === 'roll' ? 700 : 350;
  await new Promise((r) => setTimeout(r, delay + Math.random() * 300));
  return JSON.parse(JSON.stringify(runtime().handleRequest_(action, payload)));
}

export function resetPreview() { localStorage.removeItem(KEY); rt = null; }
export function previewSheets() { return runtime().state.sheets; }
