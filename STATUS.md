# STATUS — where Arya stands (updated 2026-10-27)

**Current stage: Stage 6 — hardening + UX pass (2026-10-27). Stages 3–4 and Ask Arya chat are LIVE. The full UX review (assistant/docs/UX-REVIEW.md, 21 findings) is implemented: Apple design-system rebuild, list add/remove/qty/check-off, review-queue actions, voice in Ask, and the staple judge (reasoning model) gating list admission over the deterministic pattern facts. Stage 5 (store add-on) is HELD by the owner until grocery features close. Remaining for submission: judge sweep verification on owner data, demo video, final submission package (owner go-ahead required). Public HTTPS is up at the stable name **https://arya-pilot.duckdns.org** (owner's DuckDNS, set to the VM IP 165.1.78.155; Caddy obtained a Let's Encrypt certificate 2026-10-27 — validation succeeded, so ports 80/443 are publicly reachable). The Cloudflare quick tunnel remains as a backup door. DuckDNS updater installed on the VM (systemd timer, 5 min; token in ~/.config/duckdns/token, 600, VM only — verified OK). AUTH IS LIVE: accounts + session cookies, per-user data; the API returns 401 signed-out; first-run setup is open for exactly one account, which adopts the seeded household data. Try-the-demo is LIVE: the login screen offers a synthetic demo household (fictional, 27 receipts, read-only — writes return 403, zero model calls). Remaining: the owner creates his account and does the phone check. Stages 0–2 done except the photo path (Gate 0 VERDICT (2026-10-27): PASS on the gate metric (product identity + paid price) - public set 91.84% (90/98), combined with the owner subset 93.85% (122/130); arithmetic 7/7. Caveats: abbreviation expansions separate the strict-string metric (81.6%), faded vintage print misreads digits (flagged for review), one silent price-rotation in pub-05 (review queue is the mitigation). Public set reached 9 receipts, not 16 - hand-labelability was the binding constraint; sourcing record is in the research repo's GATE-REPORT.md.**
Deadline: submission Nov 4, 2026, 9:00 PM ET.

| Stage | State |
| --- | --- |
| 0.5 Spikes | Spike 1 PASS (PDF decode 7/7 arithmetic). Spike B closed: owner plan B — uploads/exports. Gate 0 photo decode: owner subset 32/32 lines; public subset running (external). |
| 0 Foundations | Repo + layout ✓ · model policy ✓ · meta_client + cost_ledger ✓ (6 tests green) · eval harness skeleton ✓ · Oracle skeleton LIVE ✓ (db healthy, api + caddy up on the VM; GET :8081/health returns ok) · owner provisioned the Oracle API key 2026-10-27; live decode verified on the VM (Standard, $0.0054/call, ledger row written) |
| 1 Decode API | In progress. Prompt v2 written (versioned file). JSON import + PDF-text decode built, 10 tests green; real-corpus smoke: 114/114 reconcile, 1,058 item / 118 discount / 50 return lines typed, 5 orphan discounts flagged. Photo path waits on Gate 0. Dictionary v1 BUILT: 458 entries (10 fee-class), ORG BELLAS resolved = Organic Baby Bella Mushrooms (0.90); 2 entries honestly unresolved (KS Blueberry, KS Vanilla — review-queue material). Dictionary data lives in the staging area, not git. |
| 2 Patterns/list/cart | DONE (v1). Ledger 1,074 entries; 91 patterns; returns netted FIFO; lapsed state for items the household stopped buying; list requires >=3 kept purchases. Staple check: egg whites every ~21d (x35), spinach ~22d (x30), pasture eggs ~34d (x25) — all correct, none due after the Oct 26 trip. Known limit: seasonality not modeled (annual items read as long intervals). |
| 3 PWA-core | LIVE. Auth + per-user data; first account (owner) adopted the 114-receipt household. Demo household live and read-only. |
| 4 Eyes + chat | LIVE. Eyes dual-judge sightings with confirm/reject; Ask Arya chat with server-validated actions; voice input + spoken replies (Stage 6). |
| 5 Store add-on | HELD by owner (needs TJ walkthrough video + paper receipt). |
| 6 Hardening/UX | IN PROGRESS. UX review implemented + deployed; Impeccable vendored (.claude/skills/impeccable); PRODUCT.md + DESIGN.md written. |

## Data staging (owner data — NOT in this repo)
114 Costco receipts (2023-10-25 → 2026-10-26, 1,226 lines, 114/114
arithmetic) staged in the Hatch workspace
`meta-hackathon-2026/imports/costco-json/` with STAGING-REPORT.md; the
report is in the research repo. Raw files stay out of git.

## Blockers / owner items
- Oracle API key: owner installs into the Oracle env when the skeleton stands.
- Public hostname for the PWA (subdomain vs tunnel): owner choice, Stage 3.
- Trader Joe's walkthrough + paper receipt: owner's next natural shop (Stage 5 input).

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
