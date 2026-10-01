# Nestchen 🌙

A small, private organiser for new parents – minimal, functional and a tiny bit cute.

- **Public page** for family & friends: see when a visit suits you, request a slot or suggest a time,
  sign up to bring a meal, and reserve gifts from your wishlist so nothing is bought twice.
- **Private area** for the two of you: a calendar (paediatrician, Kita, paperwork, …) plus all visits,
  a visits inbox, lists (to-dos, shopping, wishlists, contacts, gifts, notes), a thank-you tracker, and
  trackers for feeding, pumping and sleep with statistics.
- German and English, light and dark mode, works great on phones and can be added to the home screen.

It runs for free on Cloudflare (Workers + D1 database). The code lives on GitHub, and every
`git push` deploys automatically.

---

## Contents

1. [Features](#features)
2. [Put it online (≈ 15 minutes)](#put-it-online--15-minutes)
3. [Everyday use](#everyday-use)
4. [Calendar sync (Google / Apple)](#calendar-sync-google--apple)
5. [Push notifications (optional)](#push-notifications-optional)
6. [Privacy & security](#privacy--security)
7. [Local development](#local-development)
8. [Customising](#customising)
9. [Troubleshooting](#troubleshooting)
10. [Costs & limits](#costs--limits)

---

## Features

**Public page** (`/`)

| | |
|---|---|
| ☕ **Visits** | Guests see your open visiting times for the next weeks and request one with a tap. Other guests only ever see "free" or "taken" – never names. |
| 💌 **Suggest a time** | Nothing fits? Guests can propose up to three dates (time optional). |
| 🍲 **Meal train** | Friends sign up to bring dinner on a given day and see your notes (allergies, containers, …). |
| 🔗 **Status link** | Every guest gets a personal link: pending → confirmed / not possible, your reply, "add to my calendar", cancel. |
| 🎁 **Wishlist** | Items with link, price, quantity ("2 of 5 left"), tags and "top wish" ♥. Guests reserve items (only you see who) and can undo. Plus a "please not" note. |
| 🙏 **Visitor guidelines** | Your little rules next to the calendar (healthy only, wash hands, max. 1 h, …). |
| 🔒 **Family code** | Optional: only people with the code (or your share link) can open the page. Search engines are always blocked. |

**Private area** (`/family`)

| | |
|---|---|
| 🏠 **Home** | Greeting, baby's age, one-tap Start/Stop for feeding, sleep and pumping, open requests, the next 7 days, urgent to-dos, thank-you reminder. |
| 🗓️ **Calendar** | Appointments in categories (doctor, Kita, paperwork, family, other), all-day and multi-day events, repeating events (daily … yearly), visits and open slots as layers, month and list view. |
| 👥 **Visits** | Requests inbox (confirm / decline / reschedule), planned visits, visiting times (create many at once, e.g. "Sat + Sun 15–17 h for 3 weeks, in 1-hour slots"), past visits. After confirming, one tap sends a pre-written WhatsApp / SMS / e-mail in the guest's language. "Nicht vergessen / Don't forget": a list of people who should meet the baby – invite them with a ready-made message (incl. the link and family code) and tick them off after their visit. |
| ✅ **Lists** | To-dos with fixed labels – **who** (Lukas / Sandrine / Both), **priority** (high / mid / low) and your own – plus due date and free `#tags`; filter e.g. "high priority for Lukas" (remembered per list). Shopping, wishlists (public or private), contacts (tap to call / WhatsApp), gifts, notes. Quick add understands `#tag`, `@name` and `!` / `!high`. |
| 🍼 **Feeding** | Start/pause/stop with a live timer (synced between both phones; pauses don't count), method (breast, breast with nipple shield, bottle, finger feeder), side with "other side next" suggestion, amount in ml, observations. Log or fix feeds afterwards. Statistics for 7/14/30 days: feeds per day, average duration, interval and longest break with trend vs. the period before, a daily chart, a 24-hour rhythm view, the split by method and a table. One-tap Start/Stop on the home screen. |
| 💧 **Pumping** | Start/pause/stop with a live timer, side (left / right / both), the amount with a slider (plus − / + for 5 ml steps), observations (e.g. "into the fridge", "frozen"). Statistics: ml per day and per session, sessions per day, duration, interval and pumping time per day with trends, charts, rhythm view and a table. Switch to "Mit Stillen / With breastfeeding" to count every time the breasts were emptied – pumping plus breastfeeding (breast and nipple shield). |
| 🌙 **Sleep** | "Fell asleep" / "Woke up" with a live timer, day or night sleep (suggested by the time of day), where (crib, parents' bed, pram, carrier, in arms, car, elsewhere), observations. The history shows how long the baby was awake in between. Statistics: sleep per day, night and day sleep, naps per day, longest stretch and wake-ups per night with trends, a stacked day/night chart, where the baby slept, rhythm view and a table. |
| 🎀 **Thanks** | Who gave what, "received" ✓ and "thanked" ✓ – wishlist reservations appear automatically. |
| ⚙️ **Settings** | Texts of the public page (German + English), what guests see, family code, to-do labels, calendar links, Google Calendar embed, notifications, accounts, JSON export. |

---

## Put it online (≈ 15 minutes)

You need a **GitHub** account and a free **Cloudflare** account. No command line is needed on Cloudflare's side.

### 1. Put the code on GitHub

Create an empty **private** repository on github.com (e.g. `nestchen`), then in this folder:

```bash
git init
git add .
git commit -m "Nestchen"
git branch -M main
git remote add origin https://github.com/<your-user>/nestchen.git
git push -u origin main
```

(Nothing secret is in the code – passwords, the setup code and all data live only in Cloudflare.)

### 2. Connect the repository to Cloudflare

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com) (the free plan is enough).
2. Go to **Workers & Pages → Create → Import a repository**, connect GitHub and pick your repository.
3. Settings:
   - **Project / Worker name:** `nestchen` – it must match `"name"` in `wrangler.jsonc`
     (if you want another name, change it in both places).
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
4. Click **Deploy**. The first deploy also creates the database (`nestchen-db`) automatically; the app creates its tables on the first visit.

Your site is now live at `https://nestchen.<your-subdomain>.workers.dev`.

### 3. Set the setup code

The two parent accounts can only be created with a secret setup code:

1. In Cloudflare open your Worker → **Settings**. Use the runtime variables section – it's called
   **Runtime** or **Variables and Secrets** and sits right above **Bindings** (where `DB → nestchen-db` is listed).
   Click **Add variable** (or **Add**).
   ⚠️ Not the "Variables and secrets" box inside the **Build** section further down – those only exist
   while the code is being built, the running site can't see them.
2. Environment **Production**, key `SETUP_CODE`, value: any passphrase you like, tick **Secret**
   → **Add variable and deploy** (or **Deploy**).

### 4. Create your accounts

1. Open `https://…workers.dev/family` → "Konto erstellen / Create account", enter the setup code, your name, a username and a password.
2. The other parent does the same on their phone (setup stays open until two accounts exist).
   Alternatively add the second account under **Settings → Accounts**.
3. Optional: delete the `SETUP_CODE` secret again.

### 5. Make it yours

In **Settings**:

- **Public page:** site name, heading, welcome text, visitor guidelines, meal notes and gift notes – in German and English.
- **Privacy:** set a family code if you like and share the "link including the code" via WhatsApp.
- **Family:** the baby's birthday (only used for the age on your home screen) and your country code for WhatsApp links.
- **To-do labels ("To-do-Merkmale"):** rename, recolour, reorder, add or remove the options of *Who* and *Priority*,
  or add your own label (e.g. "Ort: Zuhause / Unterwegs"). Who-options are linked to accounts, so "Beide / Both" is
  linked to all accounts. The defaults use your accounts' display names.
- **Visits → Offer times:** add your first visiting times.
- **Lists → Wishlist:** add what you still need.

### 6. On your phones

- Open `/family`, then "Add to Home Screen" (iPhone: Share menu; Android: ⋮ menu). It opens like an app.
- Subscribe to the calendar links (see [Calendar sync](#calendar-sync-google--apple)).

From now on every `git push` to `main` redeploys automatically. Your data stays untouched.

**Custom domain (optional):** Worker → Settings → Domains & Routes → add e.g. `baby.your-domain.de`
(the domain must be on Cloudflare).

---

## Everyday use

- **Logged in = straight to your area:** when you're logged in, opening the site (or the home-screen app)
  goes directly to the private area. To see what guests see, use "Öffentliche Seite / Public page"
  (it opens `/?view=public`). Guests' status links are never redirected.
- **Offer times in bulk:** Visits → "Zeiten anbieten / Offer times" → date range, weekdays, time window,
  optionally split into 30/45/60/… minute slots, groups per slot. A preview shows exactly what gets created.
- **Answer a request:** open it, pick one of the suggested times if needed, write a short note, then
  Confirm / Decline. The notify panel opens with a ready-made message for WhatsApp, SMS or e-mail
  (written in the guest's language). The guest also sees your note on their status link.
- **Guest called you?** "Besuch eintragen / Add visit" enters a visit manually.
- **Auto-confirm:** in Settings you can let requests for free slots be confirmed automatically.
- **Quick add** in lists: `Windeln Gr. 2 #dm @Sandrine !hoch` adds a to-do tagged *dm*, for Sandrine, with high
  priority. `@` and `!` match the start of a label (`@san`, `!mit`); a bare `!` means the top priority.
- **Filter to-dos:** tap e.g. *Lukas* and *Hoch / High* above a to-do list. Filtering by a person also shows the
  to-dos for *Beide / Both*. Tap an active chip again (or "Alle / All") to clear it. The home screen shows your own
  to-dos, everything with top priority and whatever is due within a week.
- **Wishlist:** tap an item to see who reserved it, mark gifts as received and thanked, or hide items
  that are no longer needed.
- **Baby tab (phones):** feeding, pumping and sleep share one tab; switch between them at the top. The tab
  remembers which one you used last. On a computer they're separate entries in the sidebar.
- **Sleep:** tap "Eingeschlafen / Fell asleep" (day or night is picked from the time, the place from the last
  sleep – change them if needed) and "Aufgewacht / Woke up" afterwards. If the baby wakes up at night and
  sleeps again, just start a new one – the gaps count as wake-ups. For the statistics a day is its naps plus
  the night after it, so Monday's night (even after midnight) counts for Monday.
- **Pumping:** Start → Stop → set the amount with the slider → Fertig / Done. The home screen hides pumping
  after two weeks without a session (it stays under Baby → Abpumpen).
- **Pause (feeding, pumping):** "Pause" stops the clock (e.g. burping or changing sides), "Weiter / Resume"
  continues. On the home screen it's the small ⏸ button next to Stopp. Pressing Stopp while paused ends the
  session when the pause began. Paused minutes don't count as feeding/pumping time and can be corrected in the
  entry ("Pause (Min.)").
- **Pumping statistics with breastfeeding:** in the statistics, switch "Nur Abpumpen / Mit Stillen". With
  breastfeeding, every emptying of the breasts counts: pumping sessions plus breastfeeding with breast or nipple
  shield. Breastfeeding and pumping within 30 minutes of each other (e.g. pumping the rest after a feed) count as
  one emptying. Amounts (ml) always come from pumping only.
- **People not to forget:** Besuche → "Nicht vergessen". Add names (and a phone number or e-mail if you like),
  tap "Einladen" to send a prepared message with the link via WhatsApp, SMS or e-mail (or copy it) – the person
  moves to "Eingeladen". Tick the circle once they've visited.
- **Feeding at night:** open the app (home screen) → "▶ Brust · rechts" is already suggested →
  tap it, later Stop, then optionally tap a couple of observations. Forgot to press Start?
  "Mahlzeit nachtragen / Add a feed". Both parents see a running feed on their phones.

---

## Calendar sync (Google / Apple)

The calendar lives in Nestchen and is **published to your phones** through secret subscription links
(Calendar → "In eure Handy-Kalender", or Settings → Calendar):

| Link | Contains |
|---|---|
| `…/cal/<secret>/all.ics` | appointments + confirmed visits |
| `…/cal/<secret>/family.ics` | appointments only |
| `…/cal/<secret>/visits.ics` | confirmed visits and meals only |

- **Google Calendar:** tap "Google" next to a link (or in Google Calendar on a computer:
  *Other calendars → + → From URL* and paste the link). It shows up as its own calendar with its own colour.
  Google refreshes subscribed calendars only every few hours.
- **Apple Calendar:** tap "Apple" (opens the subscribe dialog). You can set the refresh to every 15 minutes.
- **Right now:** every appointment has an "Add to Google Calendar" button and a calendar-file download
  for an instant one-off copy. Guests get the same buttons for their confirmed visit.
- **Already have a shared Google Calendar?** Settings → Calendar → "Embed Google Calendar": paste its
  calendar ID (e.g. `…@group.calendar.google.com`) or the embed link. It appears in the calendar under "Google".
- Leaked a link? Settings → Calendar → "Generate new subscription links" (then subscribe again).

---

## Push notifications (optional)

Get a ping on both phones for new requests, meal offers, cancellations and gift reservations:

1. Install the free app **ntfy** ([ntfy.sh](https://ntfy.sh), iOS & Android).
2. Subscribe to a topic with a hard-to-guess name, e.g. `nest-7f3k9q2x` (anyone who knows the name can read it).
3. In Settings → Notifications enter `https://ntfy.sh/nest-7f3k9q2x` → "Send test".

The messages contain only the guest's name and the date.

---

## Privacy & security

- The public page shows only what you enable. Guests never see other guests' names; gift givers are only visible to you.
- `noindex` headers, `robots.txt` and no tracking. The font is self-hosted, so there are no requests to Google or other third parties.
- Optional family code for the public page (stored as a signed cookie on the guest's device).
- Passwords are hashed (PBKDF2 + salt). Sessions are random tokens stored hashed, in `HttpOnly`, `Secure`, `SameSite` cookies.
  Login, setup, unlock and all guest forms are rate-limited. Cross-site write requests are rejected.
- IP addresses are never stored, only a salted hash for rate limiting.
- A strict Content-Security-Policy, `X-Frame-Options`, `nosniff` and `Referrer-Policy` are set (`public/_headers`).
- The private area (feeding, pumping, sleep, lists, people, export …) only answers to a logged-in parent; the
  calendar feeds contain appointments and visits only, never tracker data.
- **Your data survives updates:** the database is separate from the code. A `git push` replaces only the code;
  database upgrades only ever add tables or columns, never delete anything.
- **Backups:** Settings → Data → "Export everything (JSON)". Cloudflare D1 also keeps a point-in-time history
  (Time Travel) that you can restore from the dashboard.

---

## Local development

Requirements: Node.js ≥ 22.12 (on this machine there is a conda env: `conda activate kiddie-orga`).

```bash
npm install
cp .dev.vars.example .dev.vars   # local setup code: dev-setup-code
npm run dev                      # http://localhost:5173 (Worker + database run locally)
```

- Fill the local database with demo data: `npm run seed` (while `npm run dev` is running).
  Local demo logins are listed at the top of `scripts/seed-dev.mjs`.
- Type-check: `npm run typecheck` · Production build: `npm run build` · Try the build: `npm run preview`
- Deploy from your laptop instead of GitHub (optional): `npx wrangler login` then `npm run deploy`.
- The local database lives in `.wrangler/state` – delete that folder to start fresh.

---

## Customising

| What | Where |
|---|---|
| Texts on the public page, site name | in the app: Settings |
| UI texts (German / English) | `src/client/i18n/de.ts`, `src/client/i18n/en.ts` |
| Colours, fonts, spacing (light + dark) | CSS variables at the top of `src/client/styles.css` |
| Icon / app name on the home screen | `public/icon.svg`, `public/*.png`, `public/*.webmanifest`, `index.html` |
| Starter lists created with the first account | `SEED_LISTS` in `src/worker/db.ts` |
| Database schema (auto-migrating) | `MIGRATIONS` in `src/worker/db.ts` – append an entry (a list of SQL statements or an async function) for changes |
| API | `src/worker/routes/*.ts` (public, auth, admin, calendar feeds) |
| Pages | `src/client/public/*` (guests) and `src/client/family/*` (private area) |

---

## Troubleshooting

- **Build fails with a name mismatch:** the Worker name in Cloudflare must equal `"name"` in `wrangler.jsonc`.
- **Build complains about a missing `database_id`:** create the database yourself
  (Cloudflare → Storage & Databases → D1 → Create, name `nestchen-db`), copy its ID into
  `wrangler.jsonc` (`"database_id": "…"` next to `"database_name"`), commit and push.
- **Setup says the SETUP_CODE is missing:** add the secret (step 3) and reload the page. If you already
  added it, it probably landed in the **Build** section's variables – add it under
  **Settings → Variables and Secrets** instead (or run `npx wrangler secret put SETUP_CODE`).
- **Forgot a password:** the other parent removes your account in Settings → Accounts and adds it again.
  If nobody can log in: Cloudflare → D1 → `nestchen-db` → Console → `DELETE FROM users WHERE username = 'name';`,
  then create the account again via `/family` with the setup code. No data is lost.
- **Google Calendar shows changes late:** that's Google's refresh interval for subscribed calendars;
  use the "Google Calendar" button on an appointment for anything urgent, or use Apple Calendar.

---

## Costs & limits

Everything runs on Cloudflare's free plan: 100,000 requests per day and 5 GB of database storage –
far more than a family site needs. A custom domain is optional (≈ 10 €/year).

Tech: [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [D1](https://developers.cloudflare.com/d1/),
[Hono](https://hono.dev), [Preact](https://preactjs.com), [Vite](https://vite.dev), TypeScript.
