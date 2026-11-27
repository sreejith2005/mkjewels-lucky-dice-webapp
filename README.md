# MK JEWELS – Lucky Double Dice

A mobile-first campaign web app. Customers register, roll two physically simulated 3D gold dice, win 20–50% off making charges, and claim the reward online or at a store using two separate QR codes. Every record lands in your Google Sheet.

| Piece | Technology | Why |
|---|---|---|
| Customer site + staff portal | Vite, vanilla JS, Three.js (PBR rendering), cannon-es (physics) | Fast first load, 60 fps on phones, works in the WhatsApp/Instagram in-app browsers |
| Backend + database | Google Apps Script bound to a Google Sheet | Data is in Sheets for your team; `LockService` makes "one roll per phone" and "one redemption per coupon" race-proof; no server bill |
| Hosting | Any static host (Vercel, Netlify, Cloudflare Pages, Firebase Hosting) | Free and fast, with HTTPS by default |

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

> Every time you change `Code.gs`, use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## 2. Build and host the website

```bash
npm install
cp .env.example .env      # then fill in the two values
npm test                  # 173 backend checks + physics planner checks
npm run build             # outputs ./dist
```

`.env`
```
VITE_API_URL=https://script.google.com/macros/s/XXXXXXXX/exec
VITE_PUBLIC_URL=https://luckydice.mkjewels.in
```

Upload `dist/` to any static host. Recommended: point a subdomain such as `luckydice.mkjewels.in` at it. Then:
- Customer link for the invitation message: `https://luckydice.mkjewels.in/?src=whatsapp` (the `src` value is saved as the campaign source)
- Staff portal: `https://luckydice.mkjewels.in/staff.html` (bookmark it on store and sales-team phones)

**Preview mode:** if `VITE_API_URL` is empty (for example during `npm run dev`), the app runs the real `Code.gs` inside the browser against local storage, and a ribbon says "Preview mode". Preview staff logins are `ADMIN01 / 246810`, `STORE01 / 135790` and `ONLINE01 / 112233`. Production builds never include this.

---

## 3. How it works

**Customer journey:** invitation link → welcome → registration (name, mobile with +91 default, city, PIN code; birthday and anniversary optional) → 3D dice → reward, coupon code and two QR codes → online enquiry *or* store booking.

**Discount table** (server-side; the browser can't influence it):

| Total | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 (6+6) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Off making charges | 20% | 22% | 24% | 26% | 28% | 30% | 33% | 36% | 40% | 45% | **50% jackpot** |

**How the dice land on the server's result:** the server rolls first, using a cryptographically secure random source, and saves the result. The phone then runs a full physics simulation of your throw, with gravity, bounces, friction, and dice hitting each other and the gold rim. It checks the trajectory, rejecting any where a die rests on an edge, hits an invisible wall or ends against the rim. Once a good trajectory is found, it relabels the cube's faces before the throw starts, so the face that physically lands on top is the official result. What you see is genuine physics, and the numbers never change after landing. All 36 combinations are verified in tests. Sounds and phone vibrations are driven by the actual collisions.

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
tests/                     backend business-rule tests, physics tests
```
