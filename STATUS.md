# STATUS — where Arya stands (updated 2026-10-28)

**Current state (2026-10-28).** Arya is live at
https://arya-pilot.duckdns.org. The engine — intake, ledger,
patterns, the staple judge, Eyes, Ask Arya, the Muse connector —
and the Quest layer (Stages A–E: sessions, the Optimizer, the
playable hunt on the photo/Cloud/Aisle/Strip scene ladder (Photo is the default view), Shop-Off,
friends and badges, item-to-shelf matching, the stores directory)
are built and deployed. Intake parity holds: every door runs on
Meta models (Muse in chat, Spark on the Meta API in the app).
The demo household is fictional and plays the full loop in a
per-visitor sandbox (2026-10-28): list, hunt in every mode and
view, receipt finish, Ask. Demo writes never reach disk. The Add tab
is one surface for the list; receipts enter by image only. The
app is light mode only. A wireframe parity pass (dead surfaces
removed, primary-action chrome, Brain back links) and the
collect celebration (Discussion 32: Muse Image characters with
a verified fun-fact bank, Quest mode only) are built and
deployed. A hardening pass
over the 2026-10-28 code review is deployed (2026-10-28,
main 9712c54, service worker arya-v32)
(atomic store, event-loop rule, error mapping, input validation,
session hashing, demo budget bucket, real cross-account friends,
Today clock, List/Ask/Eyes pass, Caddy CSP/HSTS) — see
assistant/loops/2026-10-28-hardening.md. Test suite:
**317 green**.

**Demo sandbox + judge front door (2026-10-28; branch
fix/demo-hunt-and-review, PR pending owner review).** The gap
review found that a judge could not start a hunt: the demo
household refused every write, so "Check my list" returned 403.
The demo is now a sandbox: each demo visitor's writes go to an
in-memory overlay keyed by their session (`state.set_overlay`),
reads see the overlay first, and nothing reaches disk or another
visitor. Judges can type, snap or speak a list, play the hunt in
Quest and Express on every view (Photos, 3D, Aisle, Strip), finish
on a receipt photo, and use Ask. Bulk imports, PDF/text decode,
fridge photos and batch model jobs stay closed to the demo. Demo
model spend goes to the demo budget bucket and the per-IP live-door
cap. The demo's fictional trips shift so the last one is three days
before today. The landing page now says what Arya is and opens the
demo in one tap. Docs carry one set of numbers (README "Measured
results"), the localizer number is described as held-out mapping
frames, and the README has a "How this was built" note. No quest
UI was changed (Hunt v2 freeze). Suite: **321 green**. Not
deployed — deploy is a separate owner step.

**Live tester pass (2026-10-28).** Owner test account plus
tester-a/b/c on the live site: sign-in, every Brain tab, Ask, Quest
and Express at Trader Joe's and Costco, friends request/accept and
cross-account isolation (another account's session, race and
reports all 404). Two fixes: a client could post state "done" and
bank a verified hunt with no receipt, so now only the receipt
attach closes a hunt; and the Optimizer's token coverage ran both
ways ("pasta sauce" became "Pasta 1 lb"), so now it runs
typed-into-product only. Suite: **323 green**. Known and not changed:
Shop-Off and Spotter reports are single-account (the opponent can't
see the race, and other players can't see the reports).

**Gate 0 (photo receipt decode): PASS.** Public set 91.84%
(90/98 lines, 9 public receipts); owner subset 32/32; combined
93.85% (122/130); strict-string accuracy 81.6%; arithmetic 7/7.
One silent price rotation in the public set got through. It is
recorded here, not hidden; the review queue is the mitigation.
Full record: the research repo's GATE-REPORT.md.

**Photo decode model (2026-10-27).** Judge-facing photo decode
reads with Muse Wonder 1.0, per the MODEL-POLICY hackathon
amendment. The attempt has a 90-second bound and an automatic
fallback to Spark Standard on timeout or error; each photo
receipt records its reader in `decoded_by`. Live proof: the
Gate 0 public set through the production path scored 97/98
identity+price after hand adjudication (automatic scorer 87/98),
price errors 0, arithmetic 7/7, one extra line on pub-09; the
proof run cost $1.12. **The amendment expires Nov 4, 2026** —
photo decode returns to Spark Standard then unless the owner
extends it. The staple judge and Ask Arya stay on Spark
Standard. Detail: `assistant/loops/2026-10-27-wonder-decode.md`.

**Hunt fixes (2026-10-27, late; Discussion 44).** From the
owner's phone test: collecting is non-sequential — every stop
in a hunt is grabbable in any order (per-row GRABs on the
Up-next rail, any marker tap opens that stop's card), the
route is a recommendation, and after a grab the hunt
re-targets to the next uncollected stop after it (wrapping to
the first). The collect celebration moved from center-screen
to a small card in the bottom-left corner above the route
bar. Deployed (main ef20ece, service worker arya-v31). Detail:
`assistant/loops/2026-10-27-hunt-fixes.md`.

**Quest UI freeze (2026-10-28; Discussion 45).** The owner's
phone test found the built hunt UI broken — item markers
scattered over the scene, uncheck-after-grab corrupting the
scene state, a finished hunt presenting as stuck, Back from
Finish exiting to Home. His ruling: wireframes first. The
Hunt v2 wireframes are reworked and committed in this repo
(`docs/quest/wireframes.html`); quest UI code is frozen until
he approves them, and the rebuild (uncheck-after-grab is an
acceptance item) follows the approved wireframes. The
finish-flow presentation fixes built the same night are held
unshipped on branch `held/finish-flow-presentation`. Ahead of
the hardening batch, one live defect was hotfixed on its own:
the photo driver was missing from the server's accepted
driver list, so hunt starts at mapped stores failed
(67e8d52, with a regression test). One verification finding
is queued for the next fix round: /auth/login answers 500 on
a non-string username.

**Remaining for submission:** the quest UI rebuild to the
Hunt v2 wireframes (owner approval of the wireframes
required), the demo video, and the final
submission package (owner go-ahead required). This repo goes
public with the submission freeze (DISCUSSION 28).
Deadline: submission Nov 4, 2026, 9:00 PM ET.

The dated sections below are the build record for 2026-10-27,
kept as written. A section that ends "not deployed — deploy is a
separate owner step" states what was true when it was written;
the deploy steps followed the same evening, and the app at the
URL above is the deployed result.

| Stage | State |
| --- | --- |
| 0.5 Spikes | Spike 1 PASS (PDF decode 7/7 arithmetic). Spike B closed: owner plan B — uploads/exports. Gate 0 photo decode PASSED: public set 91.84% (90/98, 9 receipts), owner subset 32/32, combined 93.85%, strict-string 81.6%, arithmetic 7/7; one silent price rotation recorded (header). |
| 0 Foundations | Repo + layout ✓ · model policy ✓ · meta_client + cost_ledger ✓ (6 tests green) · eval harness skeleton ✓ · Oracle skeleton LIVE ✓ (db healthy, api + caddy up on the VM; GET :8081/health returns ok) · owner provisioned the Oracle API key 2026-10-27; live decode verified on the VM (Standard, $0.0054/call, ledger row written) |
| 1 Decode API | Built and live. Prompt v2 written (versioned file). JSON import + PDF-text decode built, 10 tests green; real-corpus smoke: 114/114 reconcile, 1,058 item / 118 discount / 50 return lines typed, 5 orphan discounts flagged. Photo path opened after Gate 0 passed. Dictionary v1 BUILT: 458 entries (10 fee-class), ORG BELLAS resolved = Organic Baby Bella Mushrooms (0.90); 2 entries honestly unresolved (KS Blueberry, KS Vanilla — review-queue material). Dictionary data lives in the staging area, not git. |
| 2 Patterns/list/cart | DONE (v1). Ledger 1,074 entries; 91 patterns; returns netted FIFO; lapsed state for items the household stopped buying; list requires >=3 kept purchases. Staple check: egg whites every ~21d (x35), spinach ~22d (x30), pasture eggs ~34d (x25) — all correct, none due after the Oct 26 trip. Known limit: seasonality not modeled (annual items read as long intervals). |
| 3 PWA-core | LIVE. Auth + per-user data; first account (owner) adopted the 114-receipt household. Demo household live; since 2026-10-28 it is a per-visitor sandbox, not read-only. |
| 4 Eyes + chat | LIVE. Eyes dual-judge sightings with confirm/reject; Ask Arya chat with server-validated actions; voice input + spoken replies (Stage 6). |
| 5 Store add-on | Superseded: the TJ walkthrough landed, and the store layer shipped as Quest Stages C–E (3D model + shelf graph, stores directory) — see the dated sections below (DISCUSSION 29). |
| 6 Hardening/UX | UX review implemented + deployed; then intake parity, the Brain restyle to the approved wireframes, and light mode only — see the dated sections below. Impeccable vendored (.claude/skills/impeccable); PRODUCT.md + DESIGN.md written. Suite 181 green. |

## Data staging (owner data — NOT in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines, 114/114
arithmetic) staged in the Hatch workspace
`meta-hackathon-2026/imports/costco-json/` with STAGING-REPORT.md; the
report is in the research repo. Raw files stay out of git.

## Blockers / owner items
- Friend run notifications: designed (Discussion 24 — the run-start ping carries store + moment, never the list; Challenge / Add one thing / Follow), engine NOT built. The top known gap in the social layer.
- Known deferred: stale-staple / near-duplicate curation (M8 — curator and product-rule territory, owner's call); /health reports a receipt count (M11 sub-point); the deny-by-default route-guard rewrite (L12 — the prefix list still guards routes).
- Demo video + final submission package: pending the owner's go-ahead on the complete package. Nothing submits without it.
- Public flip of this repo: lands with the submission freeze (DISCUSSION 28); the pre-flip scrub (VM internals out of the docs, secrets re-grep) is part of that step.
- Closed: the Oracle API key is provisioned; the public hostname is live (DuckDNS + Let's Encrypt); the Trader Joe's walkthrough was obtained (Quest Stage C).

## Connector (2026-10-27)
Muse is an intake surface: per-account API tokens (Home card "Use Arya
from Muse" mints; hash-only storage), the custom.arya connector +
bin/arya.py CLI, order-text intake for forwarded online orders. Live
proof done (read on the owner account; write on a scratch account).
Distribution: registration opens after the hackathon; per-user spend
caps first. (The "Muse is the only way in" line was retired the
same evening — see Intake parity below.)

## Quest Stage A (2026-10-27, later still)
- **Arya Quest engine built** (owner pivot + build approval; design in
  the arya-quest repo): sessions (one store trip, quest.json per
  account, adopted by the first account), the Optimizer (merge /
  correct / ask, deterministic, dictionary-backed), demo-grade
  Shop-Off (winner by receipt timestamp), friends + profile with a
  receipt-verified badge shelf, and the connector's `quest-add`.
  Commits `41c099d`, `2673256`, `2ed3498` (+ log/status). Suite:
  **71 green**. No model calls, $0. **Not deployed** — deploy is a
  separate owner step (git pull on the VM).

## Quest Stage B (2026-10-27, evening)
- **Playable Quest UI built** in the PWA (owner: build the game now,
  plug the 3D in when the spike lands): Today hub session cards +
  New hunt; the add-list flow with the Optimize screen (merges,
  corrections with Undo, question chips gating the start); Hunt and
  Express play screens; receipt finish -> Score with live badges;
  Community (household Fastest Hands from real finished sessions),
  Shop-Off, Friends, Quest profile with the private receipt archive
  (one new read: GET /api/quest/receipts[/{id}]).
- **SceneView driver ladder**: cloud (stub) / aisle (stylized) /
  strip (first-class 2D, the default). The engine is the game; the
  scene is a viewport — sessions record their starting driver and
  scoring never reads it (proven by test). Mid-hunt toggle drops
  aisle -> strip without losing state.
- **Spotter slice** (store drift): "not here" reports
  (empty_shelf / replaced / cant_tell + photo reference) in the
  "reported" state, per-store open-report read, Eagle Eye on the
  badge shelf (locked until a verified_move — rollout), and
  spots_reported on the profile.
- Commits `a746e00`, `56cffb1`, `ee85e36`, `0f623e0` (+ this log).
  Suite: **78 green**. Local serve smoke passed end to end.
  **Not deployed** — deploy is a separate owner step (git pull).

## Quest Stage C (2026-10-27, night)
- **The cloud driver is real**: the VGGT Trader Joe's reconstruction
  is a playable SceneView rung. `assistant/tools/prep_cloud.py`
  (pure stdlib) turns the spike PLY + poses into a web asset —
  373,630 points, 3.36 MB quantized binary + manifest with a
  smoothed camera path (5 mislocalized poses dropped as spikes;
  max path step 0.089). The driver (Three.js, vendored) walks that
  path: numbered stop markers alternating shelf sides, the next
  stop pulses, glideTo animates the walk, taps collect, drag looks
  around. Any load failure falls back to strip in place — a hunt
  never hard-fails on a model. TJ sessions start on cloud (store
  wiring by squashed name); strip stays the default elsewhere.
- Commits `41cf728`, `3f562d3` (+ this log). Suite: **83 green**.
  Headless-Chromium proof against the real asset (renders, marker
  states, glide motion, strip fallback). **Not deployed** — deploy
  is a separate owner step (git pull).

## Evening addendum (2026-10-27, later)
- **ARCHITECTURE.md added** (assistant/docs/): the as-built record — two
  layers (edge perception in the user's Muse, core verification and
  reasoning in Arya), intake paths, the agents and their limits, the
  connector, onboarding, cost control, deployment. SPEC.md gained rules
  8–10 (discounts are structure; research proposes, the user disposes;
  no silent identity edits) and both living docs carry the evening
  revision notes.
- **Resolver LIVE**: POST /api/review/suggest takes researched
  candidates with source URLs for unresolved items AND for single
  unverified receipt lines. First runs on owner data: 5 of 7 unresolved
  items identified from Costco's own catalog pages; 4 receipt lines
  identified by item number (Bissell 3857P, Cole Haan socks, KS fleece
  zip, Puma crew socks). TNWMNPRBTC and TB DRESSSOCK have no catalog
  match and stay open — no guesses posted.
- **Discount lines are structural**: always auto-verified in decode,
  never queued (code rule, all paths). The owner's 6 queued discount
  lines were cleared; the line queue holds only real questions.
- **Curator reconcile**: proposals the dictionary has already overtaken
  (already one group, duplicates, splits already in effect) retire as
  "superseded" when the queue is read, and already-grouped clusters are
  never proposed again. Of the owner's 23 pending proposals, 21 were
  already in effect; the queue now shows only genuine judgment calls.
- **Connect-step upgrade**: numbered steps for both halves of the setup
  plus a copyable fallback setup prompt (connect view + Profile).
- Hotfix: bindItemLinks helper (dropped in the Stage 6 file split)
  restored after the owner hit "Could not load" on Home.
- Suite: 60 green. sw arya-v12.

## Intake parity (2026-10-27, night)
- **Owner ruling**: intake is NOT Muse-only — every door runs on
  Meta models (Muse in chat, Spark on the Meta API in the app).
  The Add tab now carries all five doors: Via Muse (connector),
  Photo (Spark on the Meta API, reusing POST /decode/photo), Voice
  (Muse Voice Transcribe), Paste (order text), Type.
- **Voice is real**: POST /api/transcribe proxies to Meta's batch
  ASR (POST /v1/asr/transcribe, muse-voice-transcribe-1.0,
  $0.18/audio-hour; mono 16-bit WAV 16/24 kHz, ≤10 min). The PWA
  records and encodes 16 kHz WAV client-side; Ask Arya's mic uses
  the same path — the device SpeechRecognition input is gone.
  Speech out stays device TTS (no Meta TTS API; MODEL-POLICY rule 5).
- **Demo doors live**: the demo household's Photo and Voice doors
  call the Meta API on camera and persist nothing (photo returns a
  preview; transcription is stateless). All other demo writes
  remain 403.
- Commits `a4634f5`, `584e051`, `6abc9bf` (+ this log). Suite:
  **116 green**. Session log:
  assistant/loops/2026-10-27-intake-parity.md. **Not deployed** —
  deploy is a separate owner step (git pull on the VM); the deploy
  smoke should confirm the ASR response envelope against the
  defensive parser in api/voice/service.py.

## Brain restyle (2026-10-27, night)
- **The Brain screens now match the approved wireframes** (B1–B6 +
  decluttered Today; DISCUSSION 20–27), built on top of Intake
  parity: five tabs (Today / List / Add / Ask / Profile, wireframe
  SVG icon set; no Dashboard tab — Dashboard became Analysis,
  reached from Profile); Today = greeting, one hero card (Resume
  the only primary button), game rows, a Needs-your-eye row, and
  the list as one plain-text line in the owner's format; B1 List
  with the store lens (affinity from price_by_store history,
  "Your <store> list" / muted "Could grab here too", global
  check-off); B4 Receipts (review + Curator as Needs-your-eye,
  archive rows open the detail); B5 Analysis (Spend live with
  honest period labels; Patterns/Trends "Coming next"); B6 one
  unified Profile (player card + badge shelf + Eagle Eye/spots +
  account/token/Appearance). B3's confirmed actions render as
  chips.
- **Restored dead controls:** the list-row actions (check /
  stepper / remove), the still-good/expired check buttons, and
  the old Home add-picker had no click handlers anywhere (lost
  in the Stage 6 file split; the endpoints always existed).
  All wired and smoke-proven.
- Commits `3be9bd6`, `2f9fb4b` (+ tests/log). Suite: **126 green**
  (10 new: shell contract + lens/analysis/Today data shapes).
  Headless serve smoke: 40 checks passed. **Not deployed** —
  deploy is a separate owner step (git pull on the VM).
- Gaps (no fabricated data): Analysis has no category source
  (Top items + by-store shown) and cannot net returns per month
  (API exposes returns all-time only — labeled as such); Profile
  mapper credits have no data source (mapped_stores is empty;
  empty state shown). Detail: assistant/loops/2026-10-27-brain-restyle.md.

## Quest Stage D (2026-10-27, night)
- **The cloud stops are grounded in the real shelves**:
  `assistant/tools/build_shelf_graph.py` ran SAM 3.1 (Meta Model
  API, `sam-3.1` via /v1/responses) over every 5th walkthrough
  frame (18 frames, prompts "grocery shelf" + "grocery products")
  and Muse Spark 1.3 Standard labelled the clustered shelf
  regions from crops. Output: `pwa/models/trader-joes/
  shelf-graph.json` — 18 path stops, 55 labelled regions, each
  with side (from the pose geometry), the SAM confidence, and
  the label carried as a proposal (confidence + raw reply
  stored; an unparseable reply stays unlabelled, never filled
  in). Walk order checks out: cheese wall at u=0, pasta at
  0.27, pasta sauce at 0.37, bread at 0.48–0.57, the frozen
  wall at 0.89–0.91.
- **Read side**: the cloud driver fetches shelf-graph.json beside
  the manifest and shows the next stop's shelf label as a chip
  ("Bread & Bakery Shelf"); no graph → no labels, nothing
  breaks. Stop placement and scoring untouched.
- **Cost**: pipeline $0.2414 actual from API usage (SAM 36
  images $0.0900 + Spark 55 calls $0.1514) against a $2 cap;
  +$0.0075 of SAM probes while pinning the API shape.
- Commits `a7c8ef2`, `3e10b45`, `20fe982` (+ this log). Suite:
  **116 green**. **Not deployed** — deploy is a separate owner
  step (git pull on the VM).

## Quest Stage E (2026-10-27, night)
- **Stores: the directory, search, favorites, add-with-address**
  (owner design fix, DISCUSSION entry 29). Two planes, per the
  architecture split: the **directory is platform-level** — one
  shared `stores.json` in the data root (id, name, street, city,
  state, ZIP, scene cloud|strip, created_by), seeded idempotently
  with four Chino Hills stores (Trader Joe's, 13911 Peyton Dr,
  scene cloud; Costco Wholesale; Sprouts Farmers Market;
  Los Serranos Market — seeded demo data). **My Stores +
  favorites are account-level** (`my_stores.json`: store ids +
  favorite flag); a fresh account starts with the seeds, Trader
  Joe's and Costco starred.
- **API** (`api/stores.py`, no model calls, $0): GET
  /api/stores/search (name/street/city substring; digit query =
  ZIP prefix; &quests=1 keeps scene=cloud; rows carry in_mine +
  favorite), GET /api/stores/mine (favorites first, then name),
  POST /api/stores/mine (idempotent), POST /api/stores (create —
  scene strip, dedupe on normalized name+ZIP — and add to mine),
  POST /api/stores/favorite (must be in mine, else 404). Store
  writes are normal writes: the demo household gets 403, like
  every write outside the two carved live doors.
- **Sessions**: POST /api/quest/sessions accepts `store_id` —
  the session snapshots the directory name + address
  (`store_id`, `store_address`); the name stays the display
  string everywhere. Free-text sessions are unchanged.
- **PWA** (wireframe panels S1–S3): the store pick reads My
  Stores — Favorites section first (drawn-SVG star, address +
  scene status under the name), typed-name fallback kept, Find /
  Add links at the bottom. Find stores view (search + All / With
  quests / Near this ZIP chips, Add / Added per row), My stores
  view (star toggles), Add-a-store form (name + full address,
  "New stores play in Strip. Map it to unlock the 3D view."),
  and a Stores navrow in Profile. SW cache arya-v17.
- Commits `9030836`, `757d6db` (+ tests/log). Suite: **146
  green** (20 new in tests/test_stores.py: directory/search,
  mine ordering, dedupe, favorite authz, session snapshot,
  demo write block, shell contract). Live-serve smoke passed
  (mine, quests search, session snapshot, new views served).
  **Not deployed** — deploy is a separate owner step (git pull
  on the VM).
- Gaps (honest): "Near this ZIP" is a ZIP-prefix-area filter
  (first three digits), not a distance sort — no geocoding yet;
  there is no remove-from-mine or directory edit; Shop-Off
  creation still takes a free-text store (no store_id yet).

## Item–shelf matching (2026-10-27)

- Hunt stops now sit at the shelf their item belongs to.
  Matching runs at session creation for stores with a shelf graph
  (`api/shelfmatch.py`): a deterministic token-overlap pass ($0),
  then ONE batched Spark 1.3 Standard call for the rest, verdicts
  cached per item name in `shelf_matches.json`. Stops record
  shelf_label / shelf_u / shelf_side / match_source; matched
  stops walk in shelf order, unmatched keep list order after
  them. Sessions for stores with no graph are unchanged; the
  demo household still cannot create sessions (403).
- PWA: cloud markers anchor at the matched shelf position/side
  and the chip shows the stop's own shelf label (Stage D
  nearest-label remains the fallback for unmatched stops); the
  Strip card prints the shelf label, or "Not placed on the map".
  SW cache arya-v18.
- Suite: **166 green** (20 new in tests/test_shelf_match.py).
  **Not deployed** — deploy is a separate owner step.

## Add is one surface (2026-10-27)

- The five Add doors are gone. Add is one surface for the LIST:
  a text field (typing and paste are the same act; placeholder
  "Add items — type, or paste a list from WhatsApp"), a mic
  (Voice Transcribe lands in the field), a camera, and one line
  pointing at Muse chat. POST /api/list/from-text splits
  deterministically ($0) with one Spark Standard fallback when
  the split finds nothing sensible; POST /api/list/from-photo
  reads a list photo into list adds, and routes a receipt photo
  to "File it as a receipt" (/decode/photo) adding nothing.
  Receipts enter by image only; the Receipts view has its own
  "Add a receipt photo". Demo: camera/mic live, persist nothing.
  SW cache arya-v19.
- Suite: **180 green** (13 new in tests/test_add_surface.py,
  parity tests extended). **Not deployed** — separate owner step.

## Light mode only (2026-10-27)

- Owner: no dark mode. The Appearance switch is removed from
  Profile; the :root light token set is the only theme (dark
  media/data-theme blocks deleted); the boot script pins
  data-theme="light" and clears any stored theme preference.
  SW cache arya-v20. Suite: **181 green**. Not deployed.

## Navigation-first hunt (2026-10-27)

- Discussion 35 + 36 built: the hunt is a full-screen portrait
  store view (tab bar hidden while hunting), not a viewer. The
  scene auto-follows the route — a walk timer glides to the
  current stop and its arrival pop rises with the one big GRAB
  (60px, current stop only; marker taps remain the seated
  fallback). Top overlay: Up next (3 stops, route order, shelf
  labels). Bottom overlay: route dots + collected count, nothing
  else. Rail and view switch live in the trip panel. Express
  wears the same frame (strip view, faster walk, no game).
  Manual navigation holds the walk until the next collect.
- The celebration hook is wired (collectCurrent → qOnCollected)
  but sub-stage 2's characters/facts are not built yet — the pop
  carries an empty character slot until they land.
  SW cache arya-v21.
- Suite: **187 green** (6 new in tests/test_hunt_nav.py, incl. an
  18-check headless behavior harness over the real quest.js).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-hunt-navigation.md.

## Motion navigation (2026-10-27)

- Discussion 33 built, on top of the navigation-first frame:
  gyro look-around (one-tap enable, baseline capture, manual
  input suspends, silent absence) driving every SceneView driver
  through setLook/setProgress; controls live in the trip panel.
  Step-advance ships as a flagged experiment (arya-steps, default
  OFF): synthetic-step simulation passes, collects re-anchor,
  manual navigation holds it. SW cache arya-v22.
- Suite: **194 green** (7 new in tests/test_motion_nav.py, incl.
  a 22-check headless simulation harness). **Not deployed** —
  separate owner step. Loops:
  assistant/loops/2026-10-27-motion-nav.md.

## Shelf Scan demo slice (2026-10-27)

- Discussion 37 built to the spike's measured spec: in an
  unmapped (Strip) hunt, Shelf Scan spots the session's
  remaining list items in a shelf photo — SAM 3.1 proposes
  boxes from a list-driven phrasing bank, Muse Spark verifies
  each crop, only verified items pop (top-3 verify, 0.35
  box-area cap with region-grade pops, per-item phrasings —
  the spike's three fixes). POST /api/quest/scan-shelf is
  stateless (frames processed, never stored) and a live door
  for the demo household.
- The scan view opens as a live viewfinder: still frames sent
  on settle (frame-diff sampler; 3 s floor, 2 s ceiling under
  continued change), pops overlaid and replaced per scan, the
  last scan's time shown. Still-photo capture remains the
  fallback. Copy claims a verified scan, never real-time.
  SW cache arya-v23.
- Suite: **203 green** (9 new in tests/test_shelf_scan.py).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-shelf-scan.md.

## Localizer integration — Where am I? (2026-10-27)

- Discussion 34's Wonder-authored localizer is integrated as
  the mapped hunt's position anchor: `api/localizer.py` is the
  spike code vendored verbatim (paths only adapted), matching
  a photo against the store's walkthrough index locally — no
  model calls, $0, photo never stored. Shipped index:
  10.6 MB (per-frame descriptor subsample in the build step),
  and the spike's held-out eval re-run against it holds the
  spike's numbers: stop accuracy 42/45, neighborhood 45/45,
  median |Δu| 0.003, ~1 s per query. Confidence gate 0.60.
- Client: in a Cloud hunt the corner stack carries Where am
  I? (compass) where Shelf Scan sits on the Strip rung; a
  placement anchors the hunt — position jumps to the nearest
  stop, the follow resumes from there. POST
  /api/quest/locate is a live door for the demo household.
  SW cache arya-v25.
- Suite: **232 green** (12 new in tests/test_localizer.py).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-localizer-integration.md.

## Theme migration — wireframe orange at the token layer (2026-10-27)

- The approved wireframes' colors are now the app's colors:
  --acc #E4572E is the one accent and sits on game elements
  only (Quest primaries, hero card, Quest mode card, hunt
  markers/dots/progress, GRAB, verified pills, "you" rows,
  tab-current); structure runs on the wireframes' greyscale
  tokens (--ink/--line/--bg/--panel/--fill, values verbatim,
  the app's semantic names aliased onto them). Scene
  background #FAFAFA everywhere (the cloud viewport is light
  now); the amber warning palette (#8a3b12 / #FFF1D6 /
  #E8A33D) stays separate from the accent. The old green
  accent is gone from every first-party source.
- Verification, the step the first parity pass skipped:
  tests/test_theme.py pins the token values exactly and
  greps out every pre-migration color; computed styles were
  read in a real browser and a five-screen screenshot pass
  (Today, List, Hunt, Community, Profile) confirms
  orange-on-greyscale. SW cache arya-v26.
- Suite: **240 green** (8 new in tests/test_theme.py).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-theme-migration.md.

## Finish flow — this trip's receipt, now or later (2026-10-27)

- Discussion 41: the filed-receipt picker is off the Finish
  screen (the settling receipt is this trip's, snapped at
  finish — never an old receipt tagged onto a hunt). Finish
  is "Snap the receipt" or Skip. Skip finishes the hunt
  unsettled: sessions carry an explicit settled flag, and
  the Receipts view logs the hunt as its own entry with a
  "Receipt missing" tag; its "Upload the receipt" button
  files this trip's photo through the normal decode,
  attaches it to the hunt, settles it, and clears the tag.
  While unsettled the play record stands but
  receipt-verified rewards do not credit (badges, boards,
  and the profile hunt count read receipt-closed hunts
  only — now pinned by tests). SW cache arya-v27.
- Suite: **247 green** (7 new in tests/test_finish_flow.py).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-finish-flow.md.

## Receipt image retention (2026-10-27)

- A filed receipt now keeps its original: receipts filed
  from an uploaded photo or PDF store the bytes per account
  (users/<user>/receipt-media/<receipt_id>, as uploaded, no
  recompression), with the media type on the record.
  Retention lives in the filing path (state.add_receipts),
  so every upload door keeps it — including the Finish
  flow's late attach. GET /api/quest/receipts/{id}/original
  serves the owner's own original at its media type; a
  receipt filed without an upload (seeded history, order
  text) has none and 404s honestly; the demo files nothing.
  The receipt detail gains "View receipt" when an original
  exists (photo inline, PDF opens). Discussion 42.
  SW cache arya-v28.
- Suite: **253 green** (6 new in tests/test_receipt_media.py).
  **Not deployed** — separate owner step. Loops:
  assistant/loops/2026-10-27-receipt-media.md.

## Photo-walk driver — the mapped default (2026-10-27)

- The photo-walk is a first-class SceneView driver and the
  default view for mapped stores (Discussion 43). The splat
  spike closed NO-GO (pose drift; parked until pose
  refinement); the point cloud stays one tap away as the
  alternate 3D view; Strip remains the unmapped default.
- The 90-frame web tier ships at
  `assistant/pwa/models/trader-joes/frames-web/` — 17.45 MB
  total, ~1.27 MB initial window with rolling preload
  (-1/+4 at open, widening to -2/+5). Frames crossfade by
  path fraction; stops, markers, GRAB, route dots, gyro pan,
  and the step flag behave as in the other drivers; a
  mid-hunt switch loses no session state. Honest labels:
  "Photos", never a 3D model or a live view.
- Localizer gating amended with this stage: "Where am I?"
  shows on any hunt in a mapped store (Photo or Cloud) —
  the anchor is a path fraction. Suite 260 green, SW
  arya-v29. Log:
  `assistant/loops/2026-10-27-photo-driver.md`.
