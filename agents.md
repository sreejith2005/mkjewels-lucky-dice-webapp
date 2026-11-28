# AGENTS.md — MK Jewels Lucky Double Dice

Instructions for any AI coding agent (or developer) working in this repo. Read this file fully before you change anything.

## What this is
This is a mobile-first campaign web app for MK Jewels (luxury gold and diamond jewellery, est. 1999, Mumbai | Ahmedabad).
- A customer opens the site (or a friend's invite link `?ref=CODE`) and registers. The home page is always reachable; each mobile number can play only once.
- They roll two realistic 3D gold dice and win 20–50% off **making charges**.
- They claim the reward with one of two QR codes: **Online Claim** (enquiry) or **Store Visit** (appointment).
- Staff scan the QR, mark the visit and redeem the coupon **once**.
- All data lives in a Google Sheet.

## Commands
```bash
npm install
npm run dev            # http://localhost:5173 — PREVIEW MODE (no backend needed, see below)
npm test               # backend business rules (205 checks) + 20,000-participant scale test (27 checks, prints timings) + physics planner. Must pass.
npm run build          # production build → dist/ (needs VITE_API_URL in .env; fails on Vercel production without it)
npm run preview        # serve dist/
npm run preview:vercel # serve dist/ with the vercel.json headers (CSP, Permissions-Policy, caching) applied locally

# Benchmark another backend version with the scale test:
CODE_GS=path/to/old/Code.gs node tests/scale.test.mjs

# Browser checks (Python Playwright; dev server must be running). NOTE: these two scripts are not currently in the repo.
python3 tests/e2e.py 390 844 m      # full mobile journey + staff redemption; screenshots → $SHOTS (default /tmp)
python3 tests/e2e.py 1440 900 d     # desktop
python3 tests/dice_faces.py         # renders all 36 dice combos and asserts the visible top faces match
# Optional env: CHROME_PATH=/usr/bin/google-chrome  BASE_URL=http://127.0.0.1:5173  SHOTS=/tmp
```

## Architecture
| Path | Role |
|---|---|
| `backend/Code.gs` | **The only backend.** Google Apps Script bound to the Sheet. It holds `VERSION`, `CONFIG` (campaign, offer table, branches, slots), all API actions, sheet schema (`SHEETS`), `setup()`, `resetForLaunch()` and the Dashboard. `doGet` is the health check (`{ok, service, version, campaignActive, time}`). |
| `src/gas-shim.js` | Apps Script emulator. It runs `Code.gs` **unchanged** in Node (tests) and in the browser (preview mode). |
| `src/preview-backend.js` | Preview mode: runs `Code.gs` on localStorage (`mk_preview_db_v2`). Dead-code-eliminated when `VITE_API_URL` is set. |
| `src/api.js` | `api(action, payload)`. POST with `text/plain` (avoids CORS preflight) to the Apps Script `/exec` URL, falling back to preview. It throws `ApiError{message, code}`. |
| `src/config.js` | `API_URL`, `PUBLIC_URL`, `claimUrl(kind, token)`, brand links. |
| `src/lib/errors.js` | `installErrorReporting(page, getSession)`: production-only `window.onerror` / `unhandledrejection` → `logClientError`, max 3 per page load. Installed at the top of `main.js` and `staff.js`. |
| `vercel.json` | Vercel build settings, security headers (CSP, Permissions-Policy, …) and caching. |
| `vite.config.js` | Build. Fails when `VERCEL_ENV=production` and `VITE_API_URL` is empty, and when an inline `<script>` in the built HTML has no matching `sha256-…` in the `vercel.json` CSP. |
| `dev/preview-headers.config.js` | `npm run preview:vercel`: `vite preview` plus the `vercel.json` headers. |
| `tests/scale.test.mjs` | Builds 20,000 participants (plus claims and bookings) and checks register, roll, restore, resolve, referrer and staff lookup/visit/redeem; prints per-action timings. |
| `index.html` + `src/main.js` | Customer SPA. Views are `<section data-view>`: welcome → register → play (states `ready` / `rolling` / `won`) → online / store / message. The router reads `?c=online\|store&t=TOKEN`. |
| `staff.html` + `src/staff.js` | Staff portal (URL `/staff`; Vercel `cleanUrls` serves `staff.html` there, never linked from the customer app): login, camera scan, search, mark visited, redeem. |
| `src/dice/physics.js` | cannon-es throw planner (pure, Node-testable), tuned to the approved motion study `MK Jewels – Lucky Double Dice.html` (solid rails, ceiling, G=32). Frames are a flat `Float32Array` (`STRIDE` 14 per frame at `HZ` 120). |
| `src/dice/physics.worker.js` | Runs `planThrow` in a Web Worker so planning never blocks the UI (stage falls back to the main thread). |
| `src/dice/stage.js` | Three.js dice stage: `new DiceStage(host, {mode:'game'})` (a `showcase` mode still exists but the home screen now shows the campaign film instead). States `idle`/`awaiting`/`rolling`/`settled`. Custom `studioEnvironment()` (neutral softboxes) + `NeutralToneMapping` so gold reads as gold, plum velvet tray (Jiyo Saj Ke colour) with gold-foil MK logo, "Jiyo Saj Ke" script and inlay, gold rails, clear-coated dice whose "1" is a large engraved pip with the MK monogram (`applyBrand()` once the logo + Great Vibes font load). Dice rest on the felt when idle and are lifted only while held, shaken or gathered. Emits `pick` when a settled tray is touched (fun rolls). Always antialiased. Created on entering play, `dispose()`d on leaving. Degrades once (1× DPR, no shadows/dust) on slow devices. |
| `src/dice/fallback.js` | CSS 3D dice when WebGL is unavailable. |
| `src/lib/` | `audio.js` (synthesised Web Audio, no files), `haptics.js` (vibrate plus iOS switch trick), `fx.js` (confetti and fireworks), `qr.js`, `keepsakes.js` (coupon and QR PNGs), `ui.js` (calendar with month/year pickers, `datePicker` field, chips, toast, dates, ICS), `motion.js` (shake-to-roll via DeviceMotion; iOS permission requested from the Register tap), `phone.js` (libphonenumber `max`). |
| `src/styles/base.css` | Design tokens and shared components (buttons, cards, fields, chips, calendar). |
| `src/styles/app.css`, `src/styles/staff.css` | Page-specific styles. |
| `public/brand/` | Official logo (transparent cutout of the original), the small version, and icons. **Never redraw or recolour the logo.** |
| `dev/stage.html` | Dice sandbox: `?mode=idle\|result\|roll`, plus `window.runCombos()` and `window.readFaces()`. |

### API actions (`Code.gs` → `ACTIONS`)
- **Public:** `config`, `register`, `restore`, `roll`, `resolve`, `submitOnline`, `availability`, `bookStore`, `cancelStore`, `referrer`, `logClientError` (writes `CLIENT_ERROR` to `Audit_Log`; rate-limited to 5 per session/page id per 10 min and 300 in total per 10 min; message trimmed to 300 characters).
- **Staff** (need `staffToken`): `staffLogin`, `staffLookup`, `staffVisit`, `staffRedeem`.
- **Response shape:** `{ok:true, ...}` or `{ok:false, error, code}`. User-facing errors come from `fail_(message, CODE)`; the frontend shows `message` and branches on `code` (`NO_SESSION`, `BAD_TOKEN`, `WRONG_QR`, `SLOT_FULL`, `REDEEMED`, `EXPIRED`, `STAFF_AUTH`, `RATE_LIMIT`, …).

## Non-negotiable invariants (tests enforce most — do not weaken them)
1. **Results are decided on the server only.** `secureDie_()` uses a crypto-secure UUID with rejection sampling. The browser never chooses or sends dice values or discounts.
2. **Offer table:** `CONFIG.OFFER_TABLE` = 2:20, 3:22, 4:24, 5:26, 6:28, 7:30, 8:33, 9:36, 10:40, 11:45, 12:50. 50% only for 6+6. The discount applies to **making charges only**. If the table ever changes, update it in all of these places: `Code.gs`, `tests/backend.test.mjs` (`expected`), `SHEETS.terms` in `src/main.js`, `README.md`, and the `offers` list in `buildDashboard_()`.
3. **One roll per normalised mobile (cc+number) per campaign.** `register` with a number that has already rolled fails with `ALREADY_PLAYED` (and never reveals that coupon). A registered-but-not-rolled number may register again. A repeat `roll` on the same session returns the existing result.
10. **Referrals:** every player has a derived `Referral_Code` (`referralCode_()`); `register` with `ref` links the new player (`Referred_By_*` columns) unless it is their own number or an unknown code. The Dashboard lists top referrers.
4. **One redemption per coupon**, across ONLINE and STORE. All writes run inside `withLock_()`.
5. **Scanning never mutates state.** Only `staffVisit` / `staffRedeem` by an authenticated staff member do.
6. **QR tokens** = `HMAC(secret, 'qr|KIND|coupon')[:32]`, deterministic and never stored. Only the SHA-256 is stored (`*_Token_Hash`). QR codes contain no personal data. The Store QR must keep working after a reschedule (same appointment row; `Reschedule_Count++`).
7. **The dice must visibly land on the server result.** `stage.throwTo(values)` plans a validated physics trajectory, then sets each die's `inner.quaternion` (a cube symmetry) so the physically-up face shows the target. Never snap or rotate dice after landing. Run `tests/dice_faces.py` after touching `physics.js` or `stage.js`. Face layout: `FACE_VALUES = [3,4,1,6,2,5]` for +x, −x, +y, −y, +z, −z (opposites sum to 7).
8. **No secrets in frontend code.** The HMAC secret lives in Script Properties (`SECRET`, auto-created).
9. **Never show success before the backend confirms.**

## Changing the backend (`Code.gs`)
- **Bump `VERSION`** (top of `Code.gs`, format `YYYY.MM.DD-n`) with every backend change. The health check (GET the web-app URL) shows which version is live.
- **Plain Apps Script (V8). No imports or npm.** It must also run inside `gas-shim.js`. If you call any Apps Script API not already emulated, add it to the shim, or tests and preview mode break. Emulated APIs:
  - `SpreadsheetApp.getActiveSpreadsheet` / `flush`
  - Sheet: `getSheetByName`, `insertSheet`, `getName`, `getLastRow`, `getLastColumn`, `getMaxRows`, `getMaxColumns`, `appendRow`, `clear`
  - Range: `getRange(r,c,nr,nc)` → `getValues`/`getValue`/`setValues`/`clearContent`/`getRow`/`getColumn`/format no-ops, and `createTextFinder(text)` → `matchCase`, `matchEntireCell`, `findAll()` (ranges with `getRow()`), `findNext()`. Like Sheets, the finder is case-insensitive and matches substrings unless told otherwise.
  - `LockService`, `PropertiesService` (`getProperty`, `setProperty`, `deleteProperty`, `getKeys`), `CacheService`
  - `Utilities.getUuid`, `computeDigest`, `computeHmacSha256Signature`, `base64EncodeWebSafe/DecodeWebSafe`, `newBlob`
- **Scale (20k+ rows): never read a whole data sheet on a request path.** Look rows up with `findRows_(def, col, value)` / `findBy_` / `participantById_` / `participantByCoupon_` / `inCampaign_`. These run a `TextFinder` (exact cell, case-sensitive) on one column, then read only the matched rows. Searchable columns: `Normalized_Mobile`, `Customer_ID`, `Coupon_Code`, `Referral_Code`, `*_Token_Hash`, `Appointment_ID`. Use `readTable_()` only for the small `Staff` sheet and for admin jobs run by hand (`setup`, `backfillReferralCodes_`). When a scan is unavoidable (slot capacity), `readColumns_()` reads just the columns needed. Headers are cached per execution (`headersOf_`).
- **Locking pattern:** do validation and read-only checks (and fail fast) **outside** `withLock_`, then **re-read and re-check inside** the lock before writing. Build response extras (`buildResult_`, `staffRecord_`) after the lock is released.
- **`resetForLaunch()`** (run by hand) clears the data rows in Participants, Online_Claims, Store_Visits, Redemptions and Audit_Log, and deletes the `SEQ_*` counters. It never touches `Staff` or `SECRET`. It refuses to run unless Script Property `CONFIRM_RESET` = `YES`, and always deletes that property. Keep these guarantees (the tests enforce them).
- **Dates and times:** IST via `istParts_()`, `todayStr_()`, `nowStr_()`. Do not use `Utilities.formatDate` (not emulated) or the local timezone.
- **Cell storage:** all writes go through `writeRow_`/`appendRow_` → `cell_()`, which prefixes `'` to values starting with a digit, `+`, `-`, `=` or `@`, so Sheets never converts phones, IDs or dates. Rows are read as strings keyed by header name via `readTable_()`.
- **Free text:** pass it through `cleanText_()` to neutralise formulas and HTML. Validate choices with `oneOf_` / `cleanList_` against `CONFIG` lists.
- **Adding a column:** append it to the **end** of the `headers` array in `SHEETS`. `ensureHeaders_()` adds missing headers to the end of row 1 of a live sheet automatically. In preview, bump the localStorage key in `preview-backend.js` (now `mk_preview_db_v2`).
- **New action:** add `actX_` + an entry in `ACTIONS`, add tests in `tests/backend.test.mjs`, then call it via `api('x', {...})`.
- **Deploying:** after any `Code.gs` edit, the user must paste the new file into Apps Script and run **Deploy → Manage deployments → Edit → New version** (keeps the same URL). Say this in your summary.

## Changing the frontend
- **Vanilla JS modules, no framework.** Use `$`, `$$` and `esc()` from `lib/ui.js`. **Always `esc()` any server or user text inserted via `innerHTML`.**
- `main.js` has a `DEFAULT_CONFIG` fallback (branches, slots, interests). The server's `config` action overrides it. Keep both in sync with `Code.gs`. The staff category list is hard-coded in `staff.js`.
- **`[hidden]` is forced to `display:none !important`** in `base.css`. Use the `hidden` attribute for show/hide; do not rely on it being overridden.
- **Styling:**
  - Light and dark themes: `html[data-theme]` (set before paint by the inline script in `index.html`, toggled in the top bar, stored as `mk_theme`). Use the semantic tokens in `base.css` (`--bg`, `--surface`, `--surface-2`, `--input-bg`, `--text`, `--heading`, `--muted`, `--faint`, `--accent`, `--line`, `--gold-grad`, `--on-gold`). The 3D stages stay dark in both themes.
  - Reuse `.btn-gold`, `.btn-ghost`, `.btn-quiet`, `.card`, `.field` / `.input`, `.chips`, `.cal`, `.eyebrow`, `.display`, `.gold-text`.
  - Fonts are self-hosted via `@fontsource`; no Google Fonts CDN.
- **Brand tone:** quiet luxury. No neon, casino styling, emoji clutter, gradient text (only the big offer number), ornaments, numbered labels, animated backgrounds or exclamation-heavy copy. Serif headings, sentence-case buttons, short copy.
- **Security headers (`vercel.json`):**
  - The CSP allows scripts only from `'self'` plus the sha256 of the inline theme script in `index.html`. If you change or add an inline script, update the hash; the build fails and prints the new one.
  - Any new external origin the browser fetches from must be added to `connect-src`. Today that is `script.google.com`, `script.googleusercontent.com`, and `api.postalpincode.in` (PIN-code autofill).
  - Workers come from `'self'` and `blob:` (qr-scanner).
  - `camera`, `accelerometer` and `gyroscope` are allowed for `self` only (staff scanner, shake-to-roll).
  - Check with `npm run preview:vercel` and watch for `securitypolicyviolation` and console errors.
- **Caching:** `/assets/*` and `/film/*` are cached for a year as immutable; `index.html` and `staff.html` (`/staff`) are `no-cache`. **Files in `public/film/` are not content-hashed, so give a replaced film a new file name.**
- **Error reporting:** keep `installErrorReporting` in `main.js` / `staff.js`. It only runs in production builds with `VITE_API_URL`.
- **Performance:** no `backdrop-filter`, `mix-blend-mode` overlays, animated blur, or infinite decorative animations. Don't animate the stage size (it rebuilds the tray).
- **Mobile first:**
  - Test at 360–430 px width first, then ≥1024 px.
  - Touch targets ≥ 42 px. Inputs at 16 px font (prevents iOS zoom).
  - Respect `prefers-reduced-motion`.
  - Must work in the WhatsApp/Instagram in-app browsers (no popups on load, no reliance on `localStorage` succeeding — wrap it in try/catch like `store` in `main.js`).
- **Audio:** only after a user gesture (`unlockAudio` on the first pointerdown). Keep sounds synthesised in `audio.js`; don't add audio files.
- **Coupon reveal:** after the roll only the % and a "Download my coupon" button show. Tapping it downloads `couponPng(r, storeQrUrl)` (code + Store QR) and only then reveals the coupon card, the claim options and sharing. Revealed state is remembered per coupon (`mk_ldd_revealed_<code>`); returning players see it open.
- **Throw feel:** dice rest on the felt; when held they lift to ~1.2 units and are thrown down (landing in ~0.15 s). All feel parameters live in `TUNE` in `physics.js` (G −28). The planner re-plans throws with less than `minRoll` (1.6 s) of tumbling on the felt or more than `maxBounce` (0.2 s) of hopping, and rejects anything over 3.4 s. Playback runs at 0.92× and the last 0.6 s at 0.72×. Result: ~2 s of rolling on the tray.
- **Sounds:** impacts are short modal "knocks" (`knock()` in `audio.js`): dry resin clacks die-to-die, muffled toks on velvet, firmer knocks off rails. Soft felt contacts (≥0.45) are recorded so the tumble patters. No bell-like ringing on impacts.
- **Fun rolls:** after the real roll, "Roll again for fun" (or touching the settled tray, then swipe/shake) rolls random values locally. It never calls the server and never changes `S.result` or the coupon; the readout says "Fun roll" and the note says the reward stays the same.
- **Campaign film (Jiyo Saj Ke):** home screen only, `#film-video` (`public/film/jiyo-saj-ke-720.mp4`, `-1080.mp4` for large screens, `poster.jpg`). Muted autoplay loop (sound only when the user taps "Tap for sound" or the video); no autoplay on Save-Data/2G or reduced motion. `go()` pauses and re-mutes it whenever the home screen is left, so it never plays over the dice. The 665 MB ProRes master (`public/brand/FILM 1.mov`) is git-ignored; re-encode with ffmpeg (H.264 CRF 24–25, AAC, `+faststart`) if the film changes.
- **Top bar:** text wordmark "MK JEWELS" only (no image logo).
- **Theme default:** light (white & gold) unless the visitor chose dark (`mk_theme`).
- **Home screen:** film, campaign line, one-line headline, Play now; the discount table is a collapsed `<details>` (open by default on desktop). Keep it this lean.
- **How-to-roll popup:** `#howto` opens every time the play view is entered before a roll (shake + hold-and-throw on phones; drag-and-throw on desktop). Its "Let's roll" tap is where iOS motion permission is requested.
- **Haptics:** go through `haptic()` / `hapticPattern()` only.

## Dice engine notes
- **Tuning:**
  - Physics: gravity `G`, contact materials, damping and sleep thresholds in `physics.js`.
  - Rejection rules: still moving at the end, cocked (`dot < 0.985`), escaped, too little tumbling on the felt (`minRoll`), hopping (`maxBounce`), over `maxSeconds`. The last 5 attempts accept anything valid.
  - After tuning, run `node tests/physics.test.mjs` and keep **150/150 ok** on both tray shapes (it also checks final faces).
- **Look:**
  - Lighting comes from `studioEnvironment()` (dark room with softboxes, which gives the jewellery-like contrast) plus a key spotlight with shadows.
  - Gold colour: `0xf4d8a2` for the dice, `0xe6c88e` for the frame.
  - Pip maps: `faceTextures()`.
  - Check visuals with `dev/stage.html?mode=result|idle`.
- **Quality tiers:** `detectQuality()` sets `high` / `low` (texture size, shadow map size, pixel ratio, particle count). Keep low-end Android at 60 fps.
- **Events:** the game stage emits `grab`, `swipe{velocity}`, `rattle{strength}`, `impact{kind:'floor'|'wall'|'dice',strength,pan}`, `throw`, `settled`. `main.js` wires sound and haptics to them.
- **Throw flow:** `beginAwait('auto'|'shake')` → `throw(values, {velocity, power})` (plans in the worker, resolves on settle). The left-most die shows `values[0]`. Faces are relabelled with a cube-symmetry quaternion multiplied on the right of the physics pose; the first 10 frames blend from the hand pose.
- **Canvas reuse:** one canvas is re-parented between `#stage-welcome` and `#stage-play` via `stage.mount()`.

## Preview mode
When `VITE_API_URL` is empty, data stays in the browser (no ribbon is shown to customers).
- Staff demo logins: `ADMIN01/246810`, `STORE01/135790` (Bandra), `ONLINE01/112233`.
- Reset with `localStorage.clear()`.
- Never ship a production build without `VITE_API_URL`. `vite.config.js` enforces this on Vercel (`VERCEL_ENV=production`).

## Before you finish any change
1. `npm test` passes (backend, scale and physics).
2. For UI changes: run `python3 tests/e2e.py 390 844 m` (and the desktop run), then **look at the screenshots**.
3. For dice changes: `python3 tests/dice_faces.py` reports 0 mismatches.
4. `npm run build` succeeds with no new large chunks. `three` ≈ 128 KB gzip is expected.
5. If `Code.gs` changed: bump `VERSION`. Tell the user to redeploy a new Apps Script version, check that the health-check URL shows the new version, and add any new sheet headers by hand.
6. Update `README.md` if setup, config or behaviour changed, and update this file if any rule above changed.

## Pending / out of scope (ask before building)
These need credentials or approvals from MK Jewels:
- OTP mobile verification (provider TBD).
- WhatsApp templates (e.g. DoubleTick).
- CRM / Jewel OS sync.
- Approved Terms & Conditions — current text in `SHEETS.terms` in `main.js` is a **draft**. The registration form has **no** terms or marketing checkboxes (by request); `register` no longer requires `terms`, so `Terms_Accepted_At` stays blank and `Marketing_Consent` is `NO` for new players.
- Real store hours and slot capacity.