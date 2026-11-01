# STATUS — where Arya stands (2026-11-01)

Live: https://arya.teamnightshift.org. Deadline: Nov 4, 2026, 9:00 PM ET.
The build record per session lives in `assistant/loops/`; decisions
live in `docs/quest/DISCUSSION.md`. This page says only what is true now
on `main`. A merge is not a deploy: the live site changes only after
`git pull` and a rebuild on the VM.

- **Live commit 904aaa5 (2026-11-01):** includes #362 to #367. Deploy and rollback steps are in `assistant/docs/OPS.md`; `/health` shows the running commit (#359).
- **Shopper's bottom bar (#367, merged):** see the bar entry below. `assistant/loops/2026-11-01-custom-bar.md`.
- **To check smart pass (#366, merged, backend):** before To check asks, Arya proposes a clean name and store section per item number (reused if already taught, otherwise Spark in batches of 25); lines stay unverified until the shopper answers. `POST /api/review/smart-pass`; backfill with `python -m harness.clean_names <account> --suggest`. The screen for it is still being designed. `assistant/loops/2026-11-01-to-check-smart-pass.md`.
- **Add-field suggestions (#364, merged):** suggestions come from a built-in grocery word list, not live model guesses (guesses are off by default). Similar items group by the product part of clean names (#363).
- **Receipts reading and To check (#343 to #348, merged):** To check has its own screen with store, date, price and More details; one answer fixes every line with the same item number, with Undo; bulk add says why a file fails; receipts are read in the background; the auto photo reader tries Spark first and uses Wonder only on failure.
- **Ops and cost (#349 to #352, merged):** Spark runs on the Contributor tier with disclosures and a rate gate; the Ops screen edits models, dollar limits and caps, lists accounts, guards owner change, erases data and runs a Supabase mirror job.
- **Names and suggestions (#353 to #357, #360, merged):** one readable store name per store; items shown as costco-NNN get real names; suggestions only for staples with a clear rhythm; Still good? asks only about fresh food that could still be at home; Today has a Next trip card (#350).
- **Ask sees food dates (2026-11-01, merged):** Ask Arya now gets the saved pack dates, the Still good questions and the list's own prices first, so "What goes bad this week?" answers from data. `assistant/loops/2026-11-01-ask-food-dates.md`.
- **Receipts search, Date and Sort (2026-11-01, merged):** search by store, person or amount; Date menu with presets and a custom range; Sort menu with Store A to Z; count, total and Clear on one line; pure filter code, no model calls. `assistant/loops/2026-11-01-receipts-filter.md`.
- **Clean receipt names (2026-11-01, merged):** printed text such as "ORG BLACKBRY" becomes "Blackberries - Organic" in the name book, learned per item number; receipts and totals are not changed; unsure names go to To check; off until the owner runs `python -m harness.clean_names <account>` (dry run) then `--apply`; `--undo` puts every name back. `assistant/loops/2026-11-01-clean-names.md`.
- **Quest first-visit skeleton (2026-11-01, merged):** the Quest tab draws grey cards in the home's shape while it loads, not a blank page. `assistant/loops/2026-11-01-quest-skeleton.md`.
- **Re-audit server fixes (2026-11-01, merged):** per-request memo copies about 4x faster; list add, paste, import and new list run off the event loop (paste no longer holds every request during its model call). `assistant/loops/2026-11-01-reaudit-server.md`.
- **Re-audit loading fixes (2026-11-01, merged):** one three.js (the build's); the worker precaches about 1.85 MB less; `/assets/` pictures answer from the cache and refresh behind; icons about half the size. `assistant/loops/2026-11-01-reaudit-loading.md`.
- **Re-audit correctness fixes (2026-11-01, merged):** a lost session (a deploy drops demo sessions) returns to the start page with "Arya was updated. Start the demo again."; Quest keeps its 680 px column on a laptop; practice strollers stop under sheets; boot Today snapshot expires; group keeps clear on live events; the app checks for updates every 10 min. `assistant/loops/2026-11-01-reaudit-correctness.md`.
- **Disk checks hermetic in tests (2026-10-31, merged):** the /health disk floor and the ops report's disk warning read the test host's free space, so 4 tests failed on any machine with a small temp filesystem; the tests now pin the floor or stub `disk_usage`, with no production change and the firing paths still covered. Full suite green (1546). `assistant/loops/2026-10-31-test-disk-hermetic.md`.
- **Ops screen (2026-10-31, merged):** owner-only Settings row and screen: needs a look, disk and backup age, spend against caps, model calls with failures and slow calls, and switches (pause all paid reads, photo reader, demo live reads, registration, Unfreeze) kept in `site.json`. `assistant/loops/2026-10-31-ops-screen.md`, `assistant/docs/OPS.md`.
- **Ops monitoring (2026-10-31, merged):** failed and slow model calls are now booked in the cost ledger (`ok:false`, `err`, `ms`); `/health` answers 503 on a full disk or unwritable data folder so an outside uptime check can alert; `python -m harness.ops report --email` is the owner's daily digest. VM setup and break-glass steps: `assistant/docs/OPS.md`. `assistant/loops/2026-10-31-ops-monitoring.md`.
- **Speed and feel audit (2026-10-31, merged):** list taps are optimistic with Undo; the Quest 3D world draws only while something moves; Today is one `/api/today` read with a cache; Ask shows typing dots; an error boundary and a cache-first service worker for hashed files. `assistant/loops/2026-10-31-speed-feel-audit.md`.
- **Receipts and Spending moved to Lists (2026-11-01, merged):** one group with Stores; Today keeps its Spending card. `assistant/loops/2026-11-01-receipts-to-lists.md`.
- **Trips row on Today; Sign out up (2026-10-31, merged):** trips with no receipt are one Today row that opens Receipts, not cards in Settings; Sign out sits above Export and Delete. `assistant/loops/2026-10-31-settings-trips.md`.
- **UI polish (merged, #300):** a new list row no longer shows Move/Remove through it; first-run picks are padded; Quest row chevrons sit at the edge; chips, selects and Quest buttons are 44 px; Ask puts its questions by the field and waits for text before Send. `assistant/loops/2026-10-31-ui-polish.md`.
- **Small polish (merged, #299):** `boot.js` revalidates; the owner rows in Settings show only for owners (no 401/403 noise for others); the add field shows "done"; quantity and unit never wrap apart. `assistant/loops/2026-10-30-small-polish.md`.
- **Start shell and cache lifetimes (merged, #298):** the start page headline paints before the bundle (`#boot`, `pwa/boot.js` starts the sign-in calls early); images and icons cache a day, three.js a week. Local FCP 4.3 s to 1.7 s. `assistant/loops/2026-10-30-start-shell.md`.
- **pypdf 6 (merged, #297):** pypdf 5.9 to 6.21.4, which closes about 60 crafted-PDF loop and memory advisories; text extraction unchanged. `assistant/loops/2026-10-30-pypdf-6.md`.
- **Security headers (merged, #296):** `/docs`, `/redoc` and `/openapi.json` are off (the Lists API schema stays); Caddy drops `Range` until the Starlette upgrade; `Permissions-Policy` for camera, microphone and location; no `Server` header. `assistant/loops/2026-10-30-security-headers.md`.
- **Upload size cap (merged, #295):** Caddy refuses request bodies over 40 MB (413), so an oversized upload can no longer fill memory before the app checks its size. `assistant/loops/2026-10-30-caddy-body-cap.md`.
- **Offline session and sign-in form (merged, #294):** a reload with no signal opens the app as the last account instead of the sign-in page; signing in on `/team` leaves the address at `/`; the password form posts and names its fields. `assistant/loops/2026-10-30-offline-session-signin.md`.
- **Map my store walk in the background (2026-10-30, merged):** the walk is full screen and only coaches; nothing is read while walking and only Done ends it. Sharp frames wait on the phone (IndexedDB) until there is signal, go up one by one, and are read by a server job (`/api/storemap/jobs`, resumed after a restart). Map my store then shows Building your map and Your map is ready with the sections to check; "Upload a video or photos" feeds the same job. `assistant/loops/2026-10-30-background-store-scan.md`.
- **Honest store coverage (merged, #292):** "Arya knows N%" counted only the sections a scan had itself created, so any store read 100% after one photo. Now the size comes from aisle numbers Arya read (signs and "Aisle N" sections) plus 6 outside departments; sides of one aisle count once. With no aisle number read there is no % at all: "Arya has seen 3 sections". Album chapters follow. `assistant/loops/2026-10-30-honest-coverage.md`.
- **Keeping Arya running (2026-10-30, merged):** Settings row and screen show each account's lifetime AI cost (`GET /api/usage`) and, from 50 accounts, the totals for everyone. Ledger rows now carry `user` and `kind`; rows from before have neither. No limit bar, no money ask. A heads-up at $3 a month, a pause at $5, and an hourly $1 trip-wire that switches an account's paid reads off for 24 h (owner exempt). `assistant/loops/2026-10-30-keeping-arya-running.md`.
- **Ask photo (2026-10-30, merged):** Talk and Photo are labelled chips under the Ask field; a photo opens a chooser over the existing readers (list, receipt, fridge, expiry date) plus a one-shot "Ask about this photo" (`/api/chat` takes an optional `image`, never stored, no price judgments). The speaker toggle and all spoken replies are gone. `assistant/loops/2026-10-30-ask-photo.md`.
- **Token guardrails (2026-10-30, merged):** one hourly allowance (600) for every route an API token reaches; a short blocked list (bulk model spend, groups, push, feedback, settings, account export) answers 403 to a token; the app is unaffected; `ARYA_TOKEN_GUARDS=off` lifts it. Two key types are after Nov 4. `assistant/loops/2026-10-30-token-guardrails.md`.
- **Developer page (2026-10-30, merged):** public `/developers` (React screen, no sign-in): what the API is, how to get a code, a copy-paste curl, every endpoint. The server answers `/developers` with the app shell. Say "open platform" only after the API is deployed. `assistant/loops/2026-10-30-developers-page.md`.
- **Open Lists API v1 (2026-10-30, merged):** `/api/v1` lists, items, add, change, delete, export and import with the connector's token; `docs/API.md`; schema at `/api/v1/openapi.json`. Say "Your lists, your data. Export anytime." until it is merged and deployed; only then "open platform". `assistant/loops/2026-10-30-lists-api-v1.md`.
- **Labels audit (merged, #197):** one word per idea across the app (quest,
  trip, Arya shoppers, friends, username, map this store, Spending, To
  check, points), plural and currency fixes, glyphs out of strings. Race,
  sample boards, sample crew hauls, Deals and Arya shoppers tips, and
  "Coming soon" rungs are hidden; their keys stay (`web/src/lib/flags.ts`).
  `assistant/loops/2026-10-29-labels-audit.md`.
- **Landing (merged, #199):** the logged-out landing says "Your grocery run,
  smarter." It has four flip cards that wobble until first tapped, a "Try it
  now" button, and "Start my own list" (shown only when registration is open).
- **Trips save on first grab (merged, #200):** a quest saves a trip when the
  first item is grabbed, not when the quest opens.
  `assistant/loops/2026-10-29-quest-trip-on-grab.md`.
- **Usability pass (2026-10-29, PR #203):** mapping screen leads with store, then one Start mapping (How it works and More folds); Settings has one Help and guide row (Replay the tour inside the guide), Quest progress moved to the Quest tab; no floating avatar; Today drops Open Lists and retires the Quest nudge after the first Quest open; Start shopping skips the one-option sheet; tick-off hint; "× 1" hidden. Pins: `tests/test_usability_pass.py`.
- **Get the app (2026-10-29, PR #206):** landing header pill before Sign in on phones that can install Arya (iPhone steps sheet "Get the Arya app" or the Android prompt), jiggles every 8 s until tapped (glow with reduced motion); Today's add-to-Home-Screen card now shows from the first visit. `assistant/loops/2026-10-29-get-the-app.md`.
- **First trip + Use soon (2026-10-30, #207):** Get started is now the first trip in four steps (list, store, start shopping, receipt; only the next one lit, "No rush" while waiting for the trip). After a receipt, Use soon names what can expire or go bad (rules only, $0) and opens one sheet to snap, pick or skip each date; Not now waits for the next receipt, two Not nows stop it. The empty "Add a use-by date" card is gone; by hand: Settings › Arya's powers › Use soon › Add a date.
- **Relevant cards (2026-10-30):** a card shows only when it says something true now. Today: empty lists fold into one row; the Quest nudge waits for a list with items; the tip line is a real price finding (or a power one step from on, else nothing); Still good? skips what the receipt card asks; Cheaper elsewhere only for items on a list; Running low drops rows already on a list; the receipts date only when a week old. Ask chips come from the data (Map my store stays); no repeated demo note. Settings: no zero scores, receipts say who sees them. Spending empty page has Add a receipt. Quest rows went to the Quest thread.
- **Guide in the owner's sections (2026-10-30):** "See how it works" is eight cards: a list for every store, share lists with your household (shop together or apart, in sync), store maps, store news, receipts (returns and recall refunds), prices (own plus Arya shoppers), reduce food waste, Ask Arya. The "Groceries, sorted." and Quest cards are gone, and Quest is no longer called "optional" (first-run tour, Today nudge). `web/src/guide/cards.ts`.
- **Guide steps, no links out (2026-10-30):** "See how it works" is eight cards (the Quick how-tos card is gone); each has a short line and 2 to 4 numbered steps that use the app's own button names. No Try it, no Practice Market link, no Start my group: the guide keeps you on the cards. "Replay the tour" is the last card's closing action. `web/src/guide/cards.ts`.
- **UI/UX pass, part 1 (2026-10-30):** accent is now #C2410C (passes 4.5:1); photo pickers are keyboard reachable; tab bar fits at 200% zoom; one 44pt `.linkbtn` rule and a 44pt check hit area; Lists shows skeleton rows and a Retry on failure, Ask has a Try again chip; pushed pages keep their parent tab lit (`PARENT_TAB`, `aria-current`); Receipts has an Add receipt pill, dates read like Tue, Oct 27, and a return-only row reads "Return · −$12.30"; Settings has one Preferences row, Export in ink and Delete in danger red; titles are `h1`; character art is 512px (1.8 MB to 0.2 MB). Today order, ticked rows and New list stores wait on mockups. Caddy already gzips (the review ran without it).
- **Landing cards (2026-10-30, owner option A):** the logged-out landing shows eight flip cards in the guide's order: a list for every store (with learns your habits), share with your household, map your store, store news, see where money goes, know where it's cheaper, reduce food waste (expires or goes bad), just ask Arya. The page is a little taller than a 664 px phone: the buttons are one scroll away. `web/src/screens/Login.tsx`.
- **Lists fixes (2026-10-30):** new accounts can tick items; a known item typed inside a list lands on that list, a ticked one comes back, and the toast names what happened; quest grabs tick the list; the phone's Back stays in the app; long press picks one row; "3 avocados" and "1.5 lb salmon" parse; a photo add files to the open list; a list named after a store links it. `assistant/loops/2026-10-30-lists-qa-fixes.md`.
- **Expiry wording (2026-10-30):** owner: "goes off" doesn't land; every expiry string now says "what to use before it expires or goes bad".

## Owner registration toggle (2026-10-29, merged)
- Registration is a flag the owner flips live in Profile (Account
  group, owner only): GET/POST `/auth/registration`; the choice is
  stored in `site.json` in the data root and overrides the
  ARYA_REGISTRATION_OPEN env default once set. The owner account is
  named by ARYA_OWNER_USERNAME (operator-set; unset = nobody can
  flip it). Ask's feature sheet reads the same gate.

## Price intelligence and Arya's powers (2026-10-29, merged)
- Prices from the household's own receipts only: why-sheet trend, cheaper
  store and similar items with (i) caveats; Analysis "Your prices" (own
  inflation, split smarter, food waste); Ask answers price questions from
  precomputed facts. Settings > Arya's powers (grouped: working for you, turns on as you add
  receipts, you choose to turn on); one "Did you know?" card a day.
- Community prices, Deals and Arya Shoppers are opt-in and not live yet
  (choice is recorded only). No store sites, flyers, APIs or web prices.
## The product on main
Arya is list first, Quest second ("Waze for grocery shopping"). The bottom bar is the shopper's own: four places they pick (default Today, Lists, Quest, Ask) then More, which holds Help, Settings and the rest (see "The shopper's bottom bar" below). Landing
headline: "Your grocery run, smarter." The app is the React app (`assistant/web/`),
served at `/`; the plain-JS app is retired (it stays in git history: tag
`plain-js-app`, commit 80bd79d). `/next/...` answers 302 to `/...`. The
service worker (`web/src/sw.js`) precaches the build, so no cache name is
bumped by hand. Tests: last full counts were Python 1,546 (2026-10-31), with about 12 known failures on main (2026-11-01 note in `loops/2026-11-01-to-check-smart-pass.md`); re-run before quoting numbers. All
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
  list opens a quest on that list. `2026-10-29-list-overhaul.md`,
  `2026-10-29-named-lists.md`, `2026-10-29-start-shopping.md`.
  Adaptive layout (merged, #191): large cards for 1 to 3 lists, tiles for 4
  to 11, search, Recent and A to Z rows for 12 or more, and a Cards | List
  switch. Today caps its sections. `2026-10-29-adaptive-layout.md`.
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
  Store status is earned: only located sections (a usable, fresh
  picture) count; 8 of 10 = Mapped, 3 to 7 = Part mapped, fewer =
  Simulated. `2026-10-29-earned-coverage.md`.
  One map per store location. `2026-10-29-store-maps-per-location.md`.
  The old Trader Joe's walk data (photos, 3D model, shelf graph,
  localizer and Where am I?) is removed; no store ships mapped.
  `2026-10-29-remove-old-trader-joes-walk.md`.
  Map my store is one tap from the Quest home and Ask Arya, and offered
  once after a trip at a store not fully mapped.
  `2026-10-29-map-my-store-up-front.md`.
  Map my store's walk is a guided scan: pan, never tap; Arya reads
  sections, aisle signs, items and (opt-in) shelf prices every ~4 s,
  outlines what it found, and blurs people before anything is kept
  (SAM 3.1 + Spark, daily cap). `2026-10-29-guided-store-scan.md`.
  The Profile page is titled Settings. `2026-10-29-no-map-stores.md`.
  Find or add a store right where one is needed (Teach Arya your store,
  Build a store), one shared search. `2026-10-29-find-store-everywhere.md`.
  A quest never starts on an empty list (Add items instead), and Leave on
  a real trip offers End quest, which closes it for good.
  `2026-10-29-quest-empty-and-leave.md`.
  A real trip is saved on its first grab, so one opened and left never
  shows as Resume. `2026-10-29-quest-trip-on-grab.md`.
  A list for a store shops there: Start shopping on it opens the trip at
  that store, the Quest home says "Start at <store>" with "Shop somewhere
  else", and the store pick leads with it under Your stores.
  `2026-10-29-quest-list-store.md`.
  One level, streak and sticker album: the game keeps its profile on the
  server and Settings counts it. `2026-10-29-quest-one-progress.md`.
  Your trips is history only: resume or end open trips, see finished
  ones. Bundles is cut from the Quest home. `2026-10-29-quest-trips-history.md`.
  In the store: a one-row header, one quiet "Typical layout · Map it" cue
  (its sheet maps the store now or after the trip), a small whole-store
  button, and one List sheet (add at the top, sections in walking order,
  reorder or skip behind a link). An empty list offers add or a saved list.
  `2026-10-29-quest-instore.md`.
  After a find in a part of the store Arya has not located, a one-line
  nudge offers Snap: the camera opens inside the game and the shelf photo
  goes to Map my store's scan (people blurred first). The finish card
  lists those sections with Snap each. `2026-10-30-quest-fog-snap.md`.
  The Quest home shows level, streak and the sticker album only once
  there is something to show, and "New here?" only to a player who has
  never shopped. `2026-10-30-quest-home-cards.md`.
  The golden item says it is picked at random from your own list and
  that Arya never adds products or ads; How to play matches today's
  buttons. `2026-10-30-quest-golden-wording.md`.
  Quest colors have one job each: green for grabbed or mapped, gold for
  golden, the app orange, neutral for the rest (no blue badges or black
  chips); the 3D simulated store stays a blue blueprint. `2026-10-30-quest-colors.md`.
  Start shopping goes straight into the list's store ("Costco" finds
  "Costco Wholesale"), no one-option sheet or second store pick, and the
  in-store chips, cue and buttons are 44pt targets. `2026-10-30-quest-straight-in.md`.
  In the store: one compact panel with the list always in view, Got it /
  Can't find it / Later, Got it walks on by itself, and the store view
  pinches to zoom and turns with two fingers. `2026-10-30-quest-one-panel.md`.
  Map my store (one name app-wide) starts with Select store: your stores
  as cards with addresses, then Find my store, then "Start mapping
  <store>". `2026-10-30-map-my-store-cards.md`.
  Resume on a Quest trip opens it in the Quest game, grabs in the cart.
  `2026-10-29-quest-resume-in-game.md`.
- **Demo:** a fictional household in a per-visitor sandbox; nothing a
  visitor does reaches disk. It has a Costco list and a Trader Joe's list
  (store names only; no Trader Joe's map data ships).
- **Demo Town (merged, #182; `ARYA_DEMO_TOWN=1`, off by default):** the demo
  household shops at invented stores in a simulated neighborhood. The app
  labels everything simulated. `assistant/docs/DEMO-TOWN.md`.
- **Design pass (PR #131) and Add to Home Screen:** type scale 34/22/17/15/13/12/11,
  a Start-shopping sheet into a hunt, tap-to-grab hunt rows, Today lists first.
  Add to Home Screen: one dismissible card on Today, a row in Settings; iPhone
  gets four steps. New-user screens have no sample store alerts.
- **PDF receipts:** digital PDFs use the text layer; scanned PDFs (up to 5
  pages) are rendered with `pypdfium2` and read by the photo reader.
- **Accounts:** password accounts; registration is closed unless
  `ARYA_REGISTRATION_OPEN=1`. New accounts open on Today (no Connect
  Muse step). Account names are letters, digits and `. _ % + - @` only.
- **First run (merged, #180):** a new account gets a welcome sheet, a
  5-step tour, a Get started card on Today and one first-list card on Lists.
  Accounts with data, and the demo, never see them.
  `assistant/loops/2026-10-29-first-run.md`.
- **To check: Arya's guesses (2026-11-01):** each To check card leads with Arya's guess, the printed text and a section, with Use this name, Fix (guess and section filled in) and Keep printed. "Use the N sure guesses" (confidence 0.85 or more) sets them all in one call (`POST /api/review/accept`) with one Undo. Lines not yet guessed are read on open ("Arya is reading this name…"); ones Arya cannot read say so. `assistant/loops/2026-11-01-to-check-guesses.md`.
- **The shopper's bottom bar (2026-11-01):** the bar holds four places the
  shopper picks, then More (always there; it holds Help, Settings and the
  rest). Default Today, Lists, Quest, Ask, More. Pinnable: Today, Lists,
  Receipts, Stores, Spending, Ask, Quest, Help, Settings. Touch and hold
  the bar, or More, Customize bar. Saved as `layouts.bar.on`. The Tour
  follows the bar and ends with "Make the bar yours"; the guide has a
  Your bar card; Help has Change the bar; Ask gets YOUR BAR with every
  question. Receipts and Spending now light Lists, not Today. Today's
  icon is a calendar. `assistant/loops/2026-11-01-custom-bar.md`.
- **Settings trimmed and grouped (2026-10-31):** Settings is now Group,
  Preferences (currency and language, When I start shopping, Display,
  Reminders), Account (Export, Delete), About Arya, and Sign out last.
  About Arya holds Arya's powers, Use Arya in another AI app, Add to Home
  Screen, Keeping Arya running and the credits. Stores moved to Lists;
  Receipts and Spending to a card at the bottom of Today. Help and Send
  feedback left Settings (the Help tab has both). Guide, tour, Ask's
  `arya_features.md` and the docs name the new paths.
  `assistant/loops/2026-10-31-settings-trim.md`.
- **Arya guide (merged, #187):** a swipeable guide (now sixteen cards with numbered
  steps; the Try-it sheets were removed 2026-10-30). It opens from
  Help tab > Guide, Powers > See how it works, and the last first-run
  tour step, and is never shown by itself. `assistant/loops/2026-10-29-arya-guide.md`.

## Feature flags
- **Email code and Google sign-in** (Supabase Auth): `ARYA_SUPABASE_AUTH=1`
  plus `SUPABASE_URL` and `SUPABASE_ANON_KEY`; dashboard steps in
  `2026-10-29-supabase-signin.md`. Not tried against the live project.
  Sign-in by code or Google works for: an existing account, an address the
  owner approved from the waitlist, or anyone while the owner's Registration
  switch is open (and `ARYA_SUPABASE_SIGNUP` is not 0). Approving is for the
  accounts listed in `ARYA_WAITLIST_ADMINS` (separate from the owner setting;
  unset means nobody): `GET /auth/waitlist/list`, `POST /auth/waitlist/approve`
  (`send_email` true mails the code), `POST /auth/waitlist/remove`, or
  `python -m harness.waitlist approve a@b.com [--email]`. A row is deleted when
  the person first signs in. Password accounts are unchanged.
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
- **Log caps and backups (#196):** compose caps each container log at 5 files
  of 10 MB. `deploy/backup.sh` backs up the data volume nightly; the VM
  runbook is `assistant/docs/ARCHITECTURE.md` section 11.1.
- Every setting the app reads now reaches the container through
  `assistant/deploy/docker-compose.yml` (PR #106). Set them in
  `deploy/.env` and rebuild.

## Owner steps to ship what is merged
1. On the VM: `git pull`, then `docker compose up -d --build` in
   `assistant/deploy`.
2. `python -m harness.make_demo_household data` (demo gains its lists).
   The first load after the deploy installs the new service worker; it
   deletes the old `arya-v*` cache and takes over the open page.
3. **Nov 4:** the Wonder amendment ends. Early on Nov 4, before judges
   arrive, set `ARYA_PHOTO_READER=spark` in `deploy/.env` and run
   `docker compose up -d` in `assistant/deploy`. NOT `docker compose
   restart`: restart keeps the old environment, so the site would keep
   calling Wonder. Any recreate drops in-memory demo sessions, so do it
   once, check one receipt photo, then deploy only in quiet hours.
4. Caddyfile changes need a reload: `docker compose exec caddy caddy
   reload --config /etc/caddy/Caddyfile`.

## Measured results
- Gate 0 photo decode: PASS. Public 91.84% (90/98 lines), owner
  32/32, combined 93.85%, arithmetic 7/7. One silent price rotation
  recorded; the review queue is the mitigation.
- Photo decode reads with Muse Wonder 1.0 (90 s bound, Spark
  fallback) under the hackathon amendment, which **expires Nov 4,
  2026**. Proof run 97/98 after adjudication, $1.12.

## Remaining for submission
- Demo video and the final submission package (owner go-ahead).
- Demo Town (`ARYA_DEMO_TOWN`, see `assistant/docs/DEMO-TOWN.md`): built, off by default; owner turns it on and reruns the demo household.
- Demo end sheet and feedback door (PR #205): "Finish demo" in the demo bar opens a thank-you + feedback (email required) sheet; notes land in the owner's Feature request inbox. The demo tour (next) opens it at its last step.
- Deploy what is merged (owner steps above), including the Demo Town switch
  if wanted.
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
