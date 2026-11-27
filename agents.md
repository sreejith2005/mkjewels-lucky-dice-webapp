# AGENTS.md — MK Jewels Lucky Double Dice

Instructions for any AI coding agent (or developer) working in this repo. Read this file fully before you change anything.

## What this is
This is a mobile-first campaign web app for MK Jewels (luxury gold and diamond jewellery, est. 1999, Mumbai | Ahmedabad).
- A customer opens an invitation link and registers.
- They roll two realistic 3D gold dice and win 20–50% off **making charges**.
- They claim the reward with one of two QR codes: **Online Claim** (enquiry) or **Store Visit** (appointment).
- Staff scan the QR, mark the visit and redeem the coupon **once**.
- All data lives in a Google Sheet.

## Commands
```bash
npm install
npm run dev            # http://localhost:5173 — PREVIEW MODE (no backend needed, see below)
npm test               # backend business rules (173 checks) + physics planner. Must pass.
npm run build          # production build → dist/ (needs VITE_API_URL in .env)
npm run preview        # serve dist/

# Browser checks (Python Playwright; dev server must be running)
python3 tests/e2e.py 390 844 m      # full mobile journey + staff redemption; screenshots → $SHOTS (default /tmp)
python3 tests/e2e.py 1440 900 d     # desktop
python3 tests/dice_faces.py         # renders all 36 dice combos and asserts the visible top faces match
# Optional env: CHROME_PATH=/usr/bin/google-chrome  BASE_URL=http://127.0.0.1:5173  SHOTS=/tmp
```

## Architecture
| Path | Role |
|---|---|
| `backend/Code.gs` | **The only backend.** Google Apps Script bound to the Sheet. It holds `CONFIG` (campaign, offer table, branches, slots), all API actions, sheet schema (`SHEETS`), `setup()` and the Dashboard. |
| `src/gas-shim.js` | Apps Script emulator. It runs `Code.gs` **unchanged** in Node (tests) and in the browser (preview mode). |
| `src/preview-backend.js` | Preview mode: runs `Code.gs` on localStorage (`mk_preview_db_v1`). Dead-code-eliminated when `VITE_API_URL` is set. |
| `src/api.js` | `api(action, payload)`. POST with `text/plain` (avoids CORS preflight) to the Apps Script `/exec` URL, falling back to preview. It throws `ApiError{message, code}`. |
| `src/config.js` | `API_URL`, `PUBLIC_URL`, `claimUrl(kind, token)`, brand links. |
| `index.html` + `src/main.js` | Customer SPA. Views are `<section data-view>`: welcome → register → play (states `ready` / `rolling` / `won`) → online / store / message. The router reads `?c=online\|store&t=TOKEN`. |
| `staff.html` + `src/staff.js` | Staff portal: login, camera scan (`qr-scanner`), search, mark visited, redeem. |
| `src/dice/physics.js` | cannon-es throw planner (pure, Node-testable). Chamfered-cube dice, prefers 2.25–5.5 s rolls. |
| `src/dice/physics.worker.js` | Runs `planThrow` in a Web Worker so planning never blocks the UI (stage falls back to the main thread). |
| `src/dice/stage.js` | Three.js renderer: tray, studio environment, modes (`idle`/`hold`/`launch`/`rolling`/`result`), pointer flick, hand shake, playback, camera. **Renders only when something moves** and lowers pixel ratio if frames run slow. |
| `src/dice/textures.js` | Procedural PBR face maps (pips) and velvet. |
| `src/dice/fallback.js` | CSS 3D dice when WebGL is unavailable. |
| `src/lib/` | `audio.js` (synthesised Web Audio, no files), `haptics.js` (vibrate plus iOS switch trick), `fx.js` (confetti and fireworks), `qr.js`, `keepsakes.js` (coupon and QR PNGs), `ui.js` (calendar with month/year pickers, `datePicker` field, chips, toast, dates, ICS), `motion.js` (shake-to-roll via DeviceMotion; iOS permission requested from the Register tap), `phone.js` (libphonenumber `max`). |
| `src/styles/base.css` | Design tokens and shared components (buttons, cards, fields, chips, calendar). |
| `src/styles/app.css`, `src/styles/staff.css` | Page-specific styles. |
| `public/brand/` | Official logo (transparent cutout of the original), the small version, and icons. **Never redraw or recolour the logo.** |
| `dev/stage.html` | Dice sandbox: `?mode=idle\|result\|roll`, plus `window.runCombos()` and `window.readFaces()`. |

### API actions (`Code.gs` → `ACTIONS`)
- **Public:** `config`, `register`, `restore`, `roll`, `resolve`, `submitOnline`, `availability`, `bookStore`, `cancelStore`.
- **Staff** (need `staffToken`): `staffLogin`, `staffLookup`, `staffVisit`, `staffRedeem`.
- **Response shape:** `{ok:true, ...}` or `{ok:false, error, code}`. User-facing errors come from `fail_(message, CODE)`; the frontend shows `message` and branches on `code` (`NO_SESSION`, `BAD_TOKEN`, `WRONG_QR`, `SLOT_FULL`, `REDEEMED`, `EXPIRED`, `STAFF_AUTH`, `RATE_LIMIT`, …).

## Non-negotiable invariants (tests enforce most — do not weaken them)
1. **Results are decided on the server only.** `secureDie_()` uses a crypto-secure UUID with rejection sampling. The browser never chooses or sends dice values or discounts.
2. **Offer table:** `CONFIG.OFFER_TABLE` = 2:20, 3:22, 4:24, 5:26, 6:28, 7:30, 8:33, 9:36, 10:40, 11:45, 12:50. 50% only for 6+6. The discount applies to **making charges only**. If the table ever changes, update it in all of these places: `Code.gs`, `tests/backend.test.mjs` (`expected`), `SHEETS.terms` in `src/main.js`, `README.md`, and the `offers` list in `buildDashboard_()`.
3. **One roll per normalised mobile (cc+number) per campaign.** A repeat register or roll returns the **existing** result.
4. **One redemption per coupon**, across ONLINE and STORE. All writes run inside `withLock_()`.
5. **Scanning never mutates state.** Only `staffVisit` / `staffRedeem` by an authenticated staff member do.
6. **QR tokens** = `HMAC(secret, 'qr|KIND|coupon')[:32]`, deterministic and never stored. Only the SHA-256 is stored (`*_Token_Hash`). QR codes contain no personal data. The Store QR must keep working after a reschedule (same appointment row; `Reschedule_Count++`).
7. **The dice must visibly land on the server result.** `stage.throwTo(values)` plans a validated physics trajectory, then sets each die's `inner.quaternion` (a cube symmetry) so the physically-up face shows the target. Never snap or rotate dice after landing. Run `tests/dice_faces.py` after touching `physics.js` or `stage.js`. Face layout: `FACE_VALUES = [3,4,1,6,2,5]` for +x, −x, +y, −y, +z, −z (opposites sum to 7).
8. **No secrets in frontend code.** The HMAC secret lives in Script Properties (`SECRET`, auto-created).
9. **Never show success before the backend confirms.**

## Changing the backend (`Code.gs`)
- **Plain Apps Script (V8). No imports or npm.** It must also run inside `gas-shim.js`. If you call any Apps Script API not already emulated, add it to the shim, or tests and preview mode break. Emulated APIs:
  - `SpreadsheetApp.getActiveSpreadsheet` / `flush`
  - Sheet: `getSheetByName`, `insertSheet`, `getLastRow`, `getLastColumn`, `getMaxRows`, `getRange(r,c,nr,nc).getValues/setValues/…format no-ops`, `appendRow`, `clear`
  - `LockService`, `PropertiesService`, `CacheService`
  - `Utilities.getUuid`, `computeDigest`, `computeHmacSha256Signature`, `base64EncodeWebSafe/DecodeWebSafe`, `newBlob`
- **Dates and times:** IST via `istParts_()`, `todayStr_()`, `nowStr_()`. Do not use `Utilities.formatDate` (not emulated) or the local timezone.
- **Cell storage:** all writes go through `writeRow_`/`appendRow_` → `cell_()`, which prefixes `'` to values starting with a digit, `+`, `-`, `=` or `@`, so Sheets never converts phones, IDs or dates. Rows are read as strings keyed by header name via `readTable_()`.
- **Free text:** pass it through `cleanText_()` to neutralise formulas and HTML. Validate choices with `oneOf_` / `cleanList_` against `CONFIG` lists.
- **Adding a column:** append it to the **end** of the `headers` array in `SHEETS`. A live sheet does **not** auto-migrate, so tell the user to add the same header to the end of row 1 in that tab. In preview, bump the localStorage key in `preview-backend.js` (e.g. `mk_preview_db_v2`).
- **New action:** add `actX_` + an entry in `ACTIONS`, add tests in `tests/backend.test.mjs`, then call it via `api('x', {...})`.
- **Deploying:** after any `Code.gs` edit, the user must paste the new file into Apps Script and run **Deploy → Manage deployments → Edit → New version** (keeps the same URL). Say this in your summary.

## Changing the frontend
- **Vanilla JS modules, no framework.** Use `$`, `$$` and `esc()` from `lib/ui.js`. **Always `esc()` any server or user text inserted via `innerHTML`.**
- `main.js` has a `DEFAULT_CONFIG` fallback (branches, slots, interests). The server's `config` action overrides it. Keep both in sync with `Code.gs`. The staff category list is hard-coded in `staff.js`.
- **`[hidden]` is forced to `display:none !important`** in `base.css`. Use the `hidden` attribute for show/hide; do not rely on it being overridden.
- **Styling:**
  - Use the tokens in `base.css` (`--obsidian #080808`, `--champagne #D4B477`, `--metallic #C9A45C`, `--royal #D4AF37`, `--ivory #FFF8E7`, `--gold-grad`, `--gold-text`, `--serif` Cormorant Garamond, `--sans` Jost).
  - Reuse `.btn-gold`, `.btn-ghost`, `.btn-quiet`, `.card`, `.field` / `.input`, `.chips`, `.cal`, `.eyebrow`, `.display`, `.gold-text`.
  - Fonts are self-hosted via `@fontsource`; no Google Fonts CDN.
- **Brand tone:** quiet luxury. No neon, casino styling, emoji clutter, gradient text (only the big offer number), ornaments, numbered labels, animated backgrounds or exclamation-heavy copy. Serif headings, sentence-case buttons, short copy.
- **Performance:** no `backdrop-filter`, `mix-blend-mode` overlays, animated blur, or infinite decorative animations. Don't animate the stage size (it rebuilds the tray).
- **Mobile first:**
  - Test at 360–430 px width first, then ≥1024 px.
  - Touch targets ≥ 42 px. Inputs at 16 px font (prevents iOS zoom).
  - Respect `prefers-reduced-motion`.
  - Must work in the WhatsApp/Instagram in-app browsers (no popups on load, no reliance on `localStorage` succeeding — wrap it in try/catch like `store` in `main.js`).
- **Audio:** only after a user gesture (`unlockAudio` on the first pointerdown). Keep sounds synthesised in `audio.js`; don't add audio files.
- **Haptics:** go through `haptic()` / `hapticPattern()` only.

## Dice engine notes
- **Tuning:**
  - Physics: gravity `G`, contact materials, damping and sleep thresholds in `physics.js`.
  - Rejection rules: still moving at the end, cocked (`dot < 0.985`), escaped, a wall hit with `y > 1.25` (looks like an invisible wall), shorter than 60 frames, and landing near the rim on the first 60% of attempts.
  - After tuning, run `node tests/physics.test.mjs` and keep **150/150 ok** on all three tray shapes (it also checks final faces). Planning runs in a worker; keep the average under ~50 ms on desktop.
- **Look:**
  - Lighting comes from `studioEnvironment()` (dark room with softboxes, which gives the jewellery-like contrast) plus a key spotlight with shadows.
  - Gold colour: `0xf4d8a2` for the dice, `0xe6c88e` for the frame.
  - Pip maps: `faceTextures()`.
  - Check visuals with `dev/stage.html?mode=result|idle`.
- **Quality tiers:** `detectQuality()` sets `high` / `low` (texture size, shadow map size, pixel ratio, particle count). Keep low-end Android at 60 fps.
- **Events:** the stage emits `grab`, `release{velocity}`, `rattle{strength}`, `impact{kind,strength}`, `roll{level}` (continuous rolling-noise level), `throw`, `settled`. `main.js` wires sound and haptics to them.
- **Throw flow:** `beginHold('auto'|'shake'|'drag')` → `throwTo(values, {velocity})`. Faces are relabelled when the plan arrives with the outer pose compensated (`outer·inner·R⁻¹`) so nothing visibly jumps; then a back-swing/launch tween hands over to physics with continuous velocity.
- **Canvas reuse:** one canvas is re-parented between `#stage-welcome` and `#stage-play` via `stage.mount()`.

## Preview mode
When `VITE_API_URL` is empty, a ribbon shows and data stays in the browser.
- Staff demo logins: `ADMIN01/246810`, `STORE01/135790` (Bandra), `ONLINE01/112233`.
- Reset with `localStorage.clear()`.
- Never ship a production build without `VITE_API_URL`.

## Before you finish any change
1. `npm test` passes.
2. For UI changes: run `python3 tests/e2e.py 390 844 m` (and the desktop run), then **look at the screenshots**.
3. For dice changes: `python3 tests/dice_faces.py` reports 0 mismatches.
4. `npm run build` succeeds with no new large chunks. `three` ≈ 128 KB gzip is expected.
5. If `Code.gs` changed: tell the user to redeploy a new Apps Script version, and to add any new sheet headers by hand.
6. Update `README.md` if setup, config or behaviour changed, and update this file if any rule above changed.

## Pending / out of scope (ask before building)
These need credentials or approvals from MK Jewels:
- OTP mobile verification (provider TBD).
- WhatsApp templates (e.g. DoubleTick).
- CRM / Jewel OS sync.
- Approved Terms & Conditions — current text in `SHEETS.terms` in `main.js` is a **draft**. The registration form has **no** terms or marketing checkboxes (by request); `register` no longer requires `terms`, so `Terms_Accepted_At` stays blank and `Marketing_Consent` is `NO` for new players.
- Real store hours and slot capacity.