# MK JEWELS – Lucky Double Dice

A mobile-first campaign web app. Customers register, roll two physically simulated 3D gold dice, win 20–50% off making charges, and claim the reward online or at a store using two separate QR codes. Every record lands in your Google Sheet.

| Piece | Technology | Why |
|---|---|---|
| Customer site + staff portal | Vite, vanilla JS, Three.js (PBR rendering), cannon-es (physics) | Fast first load, 60 fps on phones, works in the WhatsApp/Instagram in-app browsers |
| Backend + database | Google Apps Script bound to a Google Sheet | Data is in Sheets for your team; `LockService` makes "one roll per phone" and "one redemption per coupon" race-proof; no server bill |
| Hosting | Vercel (builds from GitHub `main`; settings and security headers in `vercel.json`) | Free and fast, with HTTPS by default |

---

## 1. Set up the Google Sheet backend (10 minutes)

1. Create a new Google Sheet, for example **"MK Lucky Double Dice – Live"**.
2. Open **Extensions → Apps Script**. Delete the sample code, then paste in all of `backend/Code.gs`. Save.
3. Review the `CONFIG` block at the top of the file. The settings are campaign dates, coupon validity (default 30 days), branches, store time slots, slot capacity and closed weekdays.
4. In the editor, choose the function **`setup`** and click **Run**. Approve the permissions prompt (it only uses this Sheet).
   This creates these tabs: `Dashboard`, `Participants`, `Online_Claims`, `Store_Visits`, `Redemptions`, `Staff`, `Audit_Log`.
5. Open the **Staff** tab. It contains `ADMIN01` with a random PIN. Add one row per staff member:
   `Staff_ID | Name | PIN | Role | Branch | Active`
   Branch is one of `BANDRA, ANDHERI, ZAVERI, CGROAD, SINDHUBHAVAN`, or `ALL`. Set Active to `NO` to revoke access immediately.
   If a PIN should start with 0, format the PIN column as plain text first.
6. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   Copy the **Web app URL** (it ends in `/exec`).

7. **Health check:** open the Web app URL in a browser. You should see something like
   `{"ok":true,"service":"MK JEWELS LUCKY DOUBLE DICE","version":"2026.11.28-1","campaignActive":true,"time":"2026-11-28 14:05:00"}`.
   `version` is the `VERSION` constant at the top of `Code.gs`, so you can confirm which backend is live. `campaignActive` is `false` outside the campaign dates or when `CAMPAIGN_ACTIVE` is off.

> Every time you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same. Then reload the health-check URL and check that `version` changed.

### Reset before launch (`resetForLaunch`)
Use this once, after testing and just before going live, to wipe the test data.
1. In Apps Script, open **Project Settings → Script Properties → Add script property**. Name it `CONFIRM_RESET` and set the value to `YES`. Save.
2. In the editor, choose the function **`resetForLaunch`** and click **Run**.

It deletes every data row (the header rows stay) in `Participants`, `Online_Claims`, `Store_Visits`, `Redemptions` and `Audit_Log`, and resets the ID counters, so the first player is `MKC-100001` and the first coupon ends in `000001`. Afterwards `Audit_Log` contains a single `RESET_FOR_LAUNCH` row.
It **keeps the `Staff` tab** and **never touches the `SECRET` property**, so staff logins keep working.
It refuses to run unless `CONFIRM_RESET` is exactly `YES`, and it deletes `CONFIRM_RESET` when it finishes (even if it failed). To run it again, you must set the property again.

**Scale:** request paths never read whole sheets. They find single rows with Sheets' TextFinder on one column (mobile, customer ID, coupon, referral code, QR hash), so speed stays flat as `Participants` grows. `npm test` includes a 20,000-participant test.

## 2. Build and host the website

```bash
npm install
cp .env.example .env      # then fill in the two values
npm test                  # 205 backend checks + 27 checks at 20,000 participants + physics planner checks
npm run build             # outputs ./dist
npm run preview:vercel    # optional: serve dist/ locally with the production security headers
```

`.env`
```
VITE_API_URL=https://script.google.com/macros/s/XXXXXXXX/exec
VITE_PUBLIC_URL=https://luckydice.mkjewels.in
```

### Deploy on Vercel
1. In Vercel, **Add New → Project** and import the GitHub repository. `vercel.json` already sets the framework (Vite), `npm run build` and the `dist` output folder.
2. Go to **Settings → Environment Variables** and add both for the **Production** environment:
   - `VITE_API_URL` = the Apps Script Web app URL (ends in `/exec`)
   - `VITE_PUBLIC_URL` = the public site address, for example `https://luckydice.mkjewels.in` (used in QR codes and share links)

   A production build **fails on purpose** if `VITE_API_URL` is missing, so the live site can never fall back to preview mode. Leave both unset for Preview deployments if you want those to run in preview mode.
3. Every push to `main` deploys to production. After changing environment variables, redeploy (**Deployments → … → Redeploy**).
4. Go to **Settings → Domains** and add `luckydice.mkjewels.in`, then create the DNS record Vercel shows.
5. Check that it works:
   - Open the site and complete one test roll.
   - Open the staff portal and sign in.
   - Open the health-check URL (the `VITE_API_URL` value).

**Security headers** (`vercel.json`):
- A Content-Security-Policy allows scripts only from the site itself, and network calls only to the site, `script.google.com`, `script.googleusercontent.com` and `api.postalpincode.in` (PIN-code autofill).
- The camera is allowed only for the site itself; motion sensors are allowed for shake-to-roll.
- `frame-ancestors 'none'` (and `X-Frame-Options: DENY`) blocks framing.
- `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` are set.
- `/assets/*` and `/film/*` are cached for a year; the two HTML pages are always revalidated. If you replace the film, give the new file a new name.

**Error reports:** in production, browser errors are sent to the backend, at most 3 per page load. They appear in `Audit_Log` as `CLIENT_ERROR` rows (message trimmed to 300 characters; rate-limited).

Then:
- Customer link for the invitation message: `https://luckydice.mkjewels.in/?src=whatsapp` (the `src` value is saved as the campaign source)
- Staff portal: `https://luckydice.mkjewels.in/staff` (unlisted; share it only with staff and bookmark it on store and sales-team phones)

**Preview mode:** if `VITE_API_URL` is empty (for example during `npm run dev`), the app runs the real `Code.gs` inside the browser against local storage. The customer site shows no ribbon. The staff portal shows a small bar with the demo logins: `ADMIN01 / 246810`, `STORE01 / 135790` and `ONLINE01 / 112233`. Builds with `VITE_API_URL` never include preview mode, and Vercel production builds refuse to run without it. Reset preview data with `localStorage.clear()`.

---

## 3. How it works

**Customer journey:** invitation link → welcome (the *Jiyo Saj Ke* campaign film plays silently; tap for sound, it stops when they move on) → registration (name, mobile with +91 default, city, PIN code; birthday and anniversary optional) → 3D dice → reward, coupon code and two QR codes → online enquiry *or* store booking.

**Discount table** (server-side; the browser can't influence it):

| Total | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 (6+6) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Off making charges | 20% | 22% | 24% | 26% | 28% | 30% | 33% | 36% | 40% | 45% | **50% jackpot** |

**How the dice land on the server's result:** the server rolls first, using a cryptographically secure random source, and saves the result. The phone then runs a full physics simulation of your throw, with gravity, bounces, friction, and dice hitting each other and the gold rim. It checks the trajectory, rejecting any where a die rests on an edge, hits an invisible wall or ends against the rim. Once a good trajectory is found, it relabels the cube's faces before the throw starts, so the face that physically lands on top is the official result. What you see is genuine physics, and the numbers never change after landing. All 36 combinations are verified in tests. Sounds and phone vibrations are driven by the actual collisions.

**Fun rolls:** after the real roll, players can keep rolling just for fun ("Roll again for fun"). These rolls are random, stay on the phone and never touch the server, so the reward from the first roll never changes. The page says so right under the button.

**QR codes:** each reward gets two different 32-character random tokens, one for *Online Claim* and one for *Store Visit*. Only SHA-256 hashes are stored in the sheet, and the QR codes contain no personal data. They are identical on every refresh, and the Store QR always points to the latest appointment, even after rescheduling.

**Security rules enforced on the server:**
- One roll per mobile number per campaign. A returning number sees its original reward.
- One redemption per coupon, across online and in-store.
- Scanning a QR never marks anything. Only an authenticated staff tap does.
- Staff sessions are signed and expire after 12 hours, and deactivating a staff row revokes access at once.
- Login brute force is rate-limited, and every action is written to `Audit_Log`.
- Text that looks like a formula or HTML is neutralised before it reaches the Sheet.

**Sheet tabs for your team:**
- `Online_Claims` and `Store_Visits` have **Assigned_To** and **Follow_Up_Notes** columns for the online salesperson and the store team.
- `Dashboard` updates live: registrations, games, jackpots, enquiries, bookings, visits, redemptions, sales, discount given, and discount distribution.

---

## 4. Pending integrations (need your credentials or approval)

| Item | Status |
|---|---|
| **SMS / WhatsApp OTP** to verify that the mobile number belongs to the player | Not enabled. Numbers are format-validated, but without OTP someone could enter another person's number. Recommended before a wide launch. Plug in MSG91, Twilio Verify or DoubleTick OTP. |
| **WhatsApp messages** (congratulations, appointment reminder, thank-you) | Templates still to be written and approved in your WhatsApp provider (for example DoubleTick). The Sheet has every field needed. |
| **CRM / Jewel OS sync** | Data sits in Sheets today. A sync can be added from Apps Script once API access is available. |
| **Terms & Conditions** | Draft text is in `src/main.js` (`SHEETS.terms`) and linked from the footer and result page. The registration form has no terms or marketing checkboxes, so `Terms_Accepted_At` stays blank and `Marketing_Consent` is `NO`. Please have MK Jewels approve the terms before going live. |
| Store hours and slot capacity | Defaults are hourly slots from 11:00 to 19:00 and 4 bookings per slot per branch. Edit `CONFIG` in `Code.gs`. |

## 5. Project map
```
backend/Code.gs            Apps Script API + Sheet setup + dashboard
index.html, src/main.js    Customer experience
staff.html, src/staff.js   Staff scanner, check-in and redemption
src/dice/                  3D stage, physics planner, procedural gold & velvet textures, no-WebGL fallback
src/lib/                   audio synthesis, haptics, QR, coupon PNGs, calendar, phone validation
tests/                     backend business-rule tests, 20k-participant scale test, physics tests
vercel.json                Vercel build, security headers and caching
dev/                       local preview with the Vercel headers (npm run preview:vercel)
```

## Invites and referrals
Every player gets a personal invite link (`/?ref=CODE`) on their result screen, shared through WhatsApp or Copy link.
When a friend registers through it, the `Participants` sheet records `Referred_By_Code`, `Referred_By_Customer_ID`, `Referred_By_Name` and `Referred_By_Mobile`, and each player's own `Referral_Code`.
The Dashboard shows how many players came through invites and a live "Top referrers" table (who invited how many people). These columns are added to the live sheet automatically.
