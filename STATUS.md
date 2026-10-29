# STATUS — where Arya stands (2026-10-29)

Live: https://arya-pilot.duckdns.org. Deadline: Nov 4, 2026, 9:00 PM ET.
The build record per session lives in `assistant/loops/`; decisions
live in `docs/quest/DISCUSSION.md`. This page says only what is true now
on `main`. A merge is not a deploy: the live site changes only after
`git pull` and a rebuild on the VM.


## Price intelligence and Arya's powers (2026-10-29, merged)
- Prices from the household's own receipts only: why-sheet trend, cheaper
  store and similar items with (i) caveats; Analysis "Your prices" (own
  inflation, split smarter, food waste); Ask answers price questions from
  precomputed facts. Settings > Arya's powers (grouped: working for you, turns on as you add
  receipts, you choose to turn on); one "Did you know?" card a day.
- Community prices, Deals and Arya Shoppers are opt-in and not live yet
  (choice is recorded only). No store sites, flyers, APIs or web prices.
## The product on main
Arya is list first, Quest second ("Waze for grocery shopping"). Tabs:
Today · Lists · Ask · Quest · Settings (Settings opens Profile). Landing
headline: "Groceries, sorted." The app is the React app (`assistant/web/`),
served at `/`; the plain-JS app is retired (it stays in git history: tag
`plain-js-app`, commit 80bd79d). `/next/...` answers 302 to `/...`. The
service worker (`web/src/sw.js`) precaches the build, so no cache name is
bumped by hand. Tests: Python suite 1,195 (2 skipped; 3 test_decode errors
only in the sandbox), vitest 159, e2e 34 screens (run 2026-10-29). All
UI text lives in `web/src/i18n/en.json` (i18next; English only for now).
Architecture diagram and technical detail: `assistant/docs/ARCHITECTURE.md`
section 0. `assistant/loops/2026-10-29-react-at-root.md`.

- **Today:** running low, store alerts, use soon (expiry dates, with
  "+ Snap a date"), still-good checks, your lists, your patterns, one
  quiet Quest row. `assistant/loops/2026-10-29-list-first.md`.
- **Lists:** one card per named list plus Everything else. A list shows
  only what the household added; due staples show as suggestions under
  the list of their usual store, with a reason and a "why" sheet. Swipe
  to Move or Remove, Select to move many, a pencil renames a list.
  Prepared cart is gone. A "Start shopping · N items" bar on an open
  list leads to the Quest or Express choice. `2026-10-29-list-overhaul.md`,
  `2026-10-29-named-lists.md`, `2026-10-29-start-shopping.md`.
- **Adding:** one row (field, mic, camera). Adds apply at once with Undo;
  riskier changes (out, never, snooze) ask first. A typed name links to
  the tracked item ("milk" finds "Whole Milk", "mlik" fixes itself).
  Non-grocery items are kept and grouped under Other errands.
  `2026-10-29-typed-name-links.md`, `2026-10-29-grocery-detect.md`.
- **Running low:** one rule for Today and Ask (`state.running_low`).
  It works before the staple judge has run; intake warns on receipt
  lines with no item number.
- **Brain:** intake (photo, PDF, order text, JSON, voice, Muse
  connector), ledger with returns netted, patterns, the staple judge
  with the open-weights second seat, Ask Arya, Receipts with the
  original kept, Analysis (groceries vs other purchases).
- **Quest tab (Quest mode, #158):** the 3D shopping game on the user's
  own lists and stores (`web/src/game`, host `screens/quest/`). A store's
  look comes from the shared map: mapped, part mapped (fog) or a labelled
  simulated store. A real trip is a hunt session (grabs check items off,
  Not here files the shortage report) and ends at Add your receipt;
  practice saves nothing. Express is gone from every entry point (its
  screen stays only for runs started before). Older hunts, Shop-Off,
  friends, album and Teach Arya your store are on Trips (from the game's
  home). `2026-10-29-quest-mode.md`.
  Build (Quest home, Play | Build): three questions (store type, look,
  what is big; said or typed) make a whole store, Arya adapts it, you
  walk it as practice, change it by saying what to move, and save it as
  My map of a real store (used on your next quest there) or a dream
  store. Dream-store sharing, the grid editor and map versions are cut
  for Nov 4 (#170).
  The Profile page is titled Settings. `2026-10-29-no-map-stores.md`.
- **Demo:** a fictional household in a per-visitor sandbox; nothing a
  visitor does reaches disk. Ships Costco and Trader Joe's lists.
- **Design pass (PR #131) and Add to Home Screen:** type scale 34/22/17/15/13/12/11,
  a Start-shopping sheet into a hunt, tap-to-grab hunt rows, Today lists first.
  Add to Home Screen: one dismissible card on Today, a row in Settings; iPhone
  gets four steps. New-user screens have no sample store alerts.
- **PDF receipts:** digital PDFs use the text layer; scanned PDFs (up to 5
  pages) are rendered with `pypdfium2` and read by the photo reader.
- **Accounts:** password accounts; registration is closed unless
  `ARYA_REGISTRATION_OPEN=1`. New accounts open on Today (no Connect
  Muse step). Account names are letters, digits and `. _ % + - @` only.

## Built but switched off (flags)
- **Email code and Google sign-in** (Supabase Auth): `ARYA_SUPABASE_AUTH=1`
  plus `SUPABASE_URL` and `SUPABASE_ANON_KEY`; dashboard steps in
  `2026-10-29-supabase-signin.md`. Not tried against the live project.
- **Push reminders:** `ARYA_PUSH_REMINDERS=1` plus VAPID keys and a daily
  cron line; steps in `assistant/docs/PUSH-REMINDERS.md`.
- **Groups** (share lists and receipts with your home): ON by default in
  compose since 2026-10-29 (owner); `ARYA_GROUPS=0` in `deploy/.env` turns it off.
  Profile > Group: start, invite by a 6-letter code (48 h), join, leave.
  Lists and product knowledge live in the group; receipts stay with whoever
  filed them and every member sees them. Leaving copies the lists.
  `2026-10-29-groups.md`. Live sync: an open app reloads within a second
  when another member changes a list (SSE `/api/group/live`; Postgres
  LISTEN/NOTIFY when `DATABASE_URL` is set, else in-process).
- **Postgres storage:** `ARYA_STORE=json|dual|pg` (`api/pgstore.py`).
- Every setting the app reads now reaches the container through
  `assistant/deploy/docker-compose.yml` (PR #106). Set them in
  `deploy/.env` and rebuild.

## Owner steps to ship what is merged
1. On the VM: `git pull`, then `docker compose up -d --build` in
   `assistant/deploy`.
2. `python -m harness.make_demo_household data` (demo gains its lists).
   The first load after the deploy installs the new service worker; it
   deletes the old `arya-v*` cache and takes over the open page.
3. **Nov 4:** the Wonder amendment ends. Set `ARYA_PHOTO_READER=spark`
   in `deploy/.env` and rebuild.

## Measured results
- Gate 0 photo decode: PASS. Public 91.84% (90/98 lines), owner
  32/32, combined 93.85%, arithmetic 7/7. One silent price rotation
  recorded; the review queue is the mitigation.
- Photo decode reads with Muse Wonder 1.0 (90 s bound, Spark
  fallback) under the hackathon amendment, which **expires Nov 4,
  2026**. Proof run 97/98 after adjudication, $1.12.
- Localizer: stop accuracy 42/45, neighborhood 45/45, ~1 s a query.
- Shelf graph build: $0.24 (SAM 36 images + Spark 55 calls).

## Remaining for submission
- Demo video and the final submission package (owner go-ahead).
- Owner phone pass on the list-first build after deploy.

## Known gaps
- Store news and the Friends/Store/Global boards read this account
  only; cross-account data shows labelled samples. Shop-Off and Spotter
  reports are single-account.
- Split the list (kids or partner) is not built. Friend run
  notifications: designed (Discussion 24), not built.
- An email sign-in account (no password) cannot delete itself yet: the
  Profile delete asks for a password.
- `scene.js` (three.js store view, about 930 lines) is still a classic
  script in the static folder, not a module. `api/main.py` is split
  (routes live in `api/routes/`).
- The demo bar is still tall on small phones (design pass follow-up).
- Tests run by hand: `.github/workflows/tests.yml` is manual only
  (Actions tab, Run workflow), by the owner's choice.
- Photo opt-in and privacy policy: after the hackathon (owner).

## Owner data (not in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines) are staged
in the Hatch workspace `meta-hackathon-2026/imports/costco-json/`.
Raw files stay out of git.
