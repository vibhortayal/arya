# The Assistant — Implementation Plan

This plan builds SPEC.md. Read SPEC.md first.
Each stage has a gate. The gate refers to SPEC.md Section 9.
Deadline: November 4, 2026, 9:00 PM ET.
This document uses ASD-STE100 style. Sentences are short. Each sentence has one idea.

## Changes in this revision

Date: 2026-10-27.
- Name decided (owner, 2026-10-27): the assistant is **Arya**. Body text keeps "the assistant" as the generic noun.

- The stage order is new. Foundations come first. Two pre-build spikes come second. The decode API comes third.
- Stage 0.5 is new. Stage 0.5 has the photo-receipt gate and the Costco history pull test. The build commits after Stage 0.5.
- Reconciliation moves from the store stage to Stage 2. Reconciliation is core.
- The prepared cart is in Stage 2. The cart is the closing beat of the core loop.
- PWA-core is Stage 3. Eyes is Stage 4. The store add-on is Stage 5. Hardening and demo are Stage 6.
- The decode output has an allocation field on each line. Stage 2 patterns exclude FOR-OTHERS lines.
- The demo runbook has seven beats in a fixed order. Section 7 gives the beats.
- Costs and loop rules stay from the prior revision. Amounts are re-allocated to the new stages.

Revision, 2026-10-27 (evening). Built and live since this plan was written:
- ARCHITECTURE.md is new. It records the as-built structure: the two layers, the intake paths, the agents, the connector, and the deployment.
- Stage 6 additions: connector tokens (hash-only at rest) and the custom.arya connector; structured intake (POST /api/intake/structured); order-text intake; the Curator (propose-only, with automatic retirement of overtaken proposals); the Resolver endpoints (POST /api/review/suggest for items and for single lines); the Profile tab and the theme switch; the Add tab; the connect-first onboarding step with a copyable setup prompt.
- Decode post-rule change: discount lines are always auto. The old inferred-attachment demotion is removed.
- Test count: 59, all green. Deploy is git pull on the VM only.

## 1. Method — loops, not passes

### 1.1 The three loop types

Loop A. Builder and verifier.
A builder agent writes the code for a stage. A verifier agent runs the gate checks. The verifier does not read the reasoning of the builder. The verifier reads API behavior and evidence only. A failure returns as a defect list: check, input, expected value, actual value. The loop runs until the gate passes or a stop condition fires.

Loop B. Eval loop.
A prompt carries the quality of decode, sighting detection, and command parsing. The loop runs the prompt against a golden set. A scorer gives a number. The builder changes one variable. The loop runs again. Each attempt is logged: prompt hash, set version, score, cost. The report shows the attempts and the score path. The report does not show the final number only.
Gate scores count on Standard mode only. Section 1.3 gives the mode rules.

Loop C. Parallel candidates.
The riskiest prompts get three candidate variants. Candidates are scored on the golden set. The build uses the winner. Losers stay in the repo with scores.
The two riskiest prompts are the receipt decode prompt and the photo sighting prompt.
The store indexing approach gets candidates in Stage 5 only.

Rule D. Dual judge.
Two independent Spark calls must agree on two call types: a dictionary-novel line that auto-posts, and a sighting from a single photo. A disagreement sends the item to the review queue. This rule defends the silently-wrong gate metric of SPEC.md.

### 1.2 Stop conditions

| Trigger | Action |
|---|---|
| The gate passes | Stop at once. More polish is a new decision. |
| The iteration cap is hit | Stop. Escalate to the owner with the score path and the best result. |
| Improvement is under 1 point in 3 attempts | Stop. The approach is the problem. Escalate with a proposed new approach. |
| Stage spend is over the allocation by more than 50 percent | Stop. Escalate before more spend. |
| A loop shows an error in the specification | Stop. The owner decides specification changes. |

Default caps: 12 prompt iterations, 3 candidate rounds, 4 builder and verifier rounds.
Token use inside the caps is free. Parallel candidates and full golden-set runs are normal.

### 1.3 The two budgets

| Budget | Size | Use | Rule |
|---|---|---|---|
| Agent labor tokens | 500 million per week plus a 5 billion reserve | Build, verify, eval reasoning | Spend freely inside the stop conditions |
| Meta API dollars | 150 dollar credit, plus 25 dollar Fireworks credit if granted | The model calls of the product | Metered from the first call |

Mode discipline:

- Contributor mode is for development loops with synthetic data only. A Contributor model can be trained on inputs. Meta terms bar personal data on Contributor mode.
- Standard mode is for gate measurements, rehearsals, the demo, and all real user data.
- The owner receipts never touch Contributor mode. Flag F1 gives the full rule.
- Muse Code defaults to Contributor mode on subscription seats. Set Contributor to OFF in the settings before code work starts.

## 2. Foundations

### 2.1 Repo layout

```text
assistant/
  api/            # services, API first, one module per SPEC component
    decode/  dictionary/  ledger/  patterns/  list/
    cart/    reconcile/   eyes/     storemap/  relocalize/
    route/   guided/      voice/    grading/
    meta_client.py        # the only module that calls the Meta API or Fireworks
    cost_ledger.py        # one row per call: model, mode, tokens, cost
  harness/        # CLI harness; spikes and eval loops run here, no UI
    spike_photo.py  spike_receipts.py  spike_costco_pull.py
    spike_relocalize.py  eval_runner.py  scorers/
  prompts/        # versioned prompt files, one copy per eval attempt
  golden/         # golden sets and expected outputs; Section 6
  pwa/            # Stage 3; the folder does not exist before Stage 3
  deploy/         # Oracle deployment: compose file, env template, pull script
  docs/           # SPEC.md, IMPLEMENTATION.md, loop reports
  loops/          # per-stage loop logs: attempts, score paths, gate verdicts
```

Git and GitHub are the source of truth.

### 2.2 The meta_client contract

All Meta calls go through one module. The module enforces cost metering and mode discipline.
Base URL: https://api.meta.ai/v1.
Auth: Bearer token from an environment variable. The key stays in the Secure Vault. The key is never in code.

| Job | Model | Endpoint |
|---|---|---|
| Reasoning, decode, sightings, parse | muse-spark-1.3 or the Contributor variant | POST /v1/responses |
| File upload | none | POST /v1/files |
| Shelf grounding, add-on | sam-3.1 | POST /v1/responses; masks via meta-sam-parser |
| Voice in, live | muse-voice-transcribe-1.0 | wss://api.meta.ai/v1/asr/realtime |
| Voice in, batch | muse-voice-transcribe-1.0 | POST /v1/asr/transcribe |
| Dinner render, optional | muse-image-1.0 | POST /v1/images/generations |
| Pre-filter, add-on, flag only | Glimmer via Fireworks | Fireworks chat endpoint |

Client rules:

- Parse streaming output with care. Spark emits a non-standard stream event.
- SAM accepts text prompts only. One concept per request. A maximum of 16 tracked objects per frame. A maximum of 15,000 frames per request. Video format is MP4 or MOV only.
- Team rate ceilings: 3,000 requests per minute on Standard, 150 on Contributor. Eval loops on Contributor throttle to 100.

### 2.3 Prompt caching discipline

Each call has a stable prefix and a variable tail.
Stable prefixes: the system prompt, the dictionary, the store index.
The prefix text does not change between calls. Cache keys are exact prefixes.
Cached input costs less. Section 7.1 of SPEC.md gives the prices.

### 2.4 Cost ledger

The cost ledger adds one row per API call: time, service, model, mode, input tokens, cached tokens, output tokens, estimated cost.
The ledger renders a total against the Section 8 allocations.
A stage gate includes spend inside the allocation.

### 2.5 Hosting split

| Item | Hatch workspace | Oracle VM |
|---|---|---|
| Work | Code, agent loops, harness, spikes, evals, all development API calls | The deployed runtime: API service and PWA |
| Source | Git working copy | Git pull from GitHub; no hand edits |
| API key | The Secure Vault credential works from Hatch only | The owner puts the key into the Oracle environment by hand, one time |
| Reason | Loops need the vault key and fast iteration | The runtime is durable, public, and has HTTPS for the camera API |

The owner step has no delegate. The agent cannot read the vault key. The agent cannot move the vault key.
Fallback: the same API service runs from Hatch for desk tests. The harness has no dependency on Oracle. The phone has no dependency on Hatch.

### 2.6 Runtime stack on the Oracle VM

New cloud resources: zero. New charges: zero.

| Layer | Choice | Reason |
|---|---|---|
| Edge and TLS | Caddy | Automatic HTTPS; PWA files and API proxy under one origin; the camera API needs a secure context |
| API | Python FastAPI | The media tools are Python: meta-sam-parser and ffmpeg |
| Background jobs | A Postgres table plus a worker loop | Indexing is a long job; no Redis, no extra parts |
| Data | Postgres in Docker | Items, ledger, and index are relational data with JSON fields |
| Media | VM disk | Videos and photos are large; derived data sits in the database |
| Deploy | Git pull plus docker compose up | GitHub is the source of truth |
| Insurance | Nightly sync of media and a database dump to Hatch | A dead VM in demo week loses no data |

Vercel is not in the hackathon build. Reasons: split origin, short function times, a single-user demo.
Supabase is not in the hackathon build. Reason: VM Postgres covers the demo. Supabase is the platform-stage answer for auth and multi-user data.
The public hostname is an open choice of the owner: a subdomain on a domain of the owner, or a Cloudflare Tunnel name. The choice is due before Stage 3.

## 3. Contracts

The harness tests these contracts before a UI exists.
The repo carries the full JSON schema files. This section gives the field lists.

```text
DecodedReceipt — output of the decode service (SPEC 6.1, 6.2, 6.3)
{ receipt_id, source_type: grocery | restaurant | delivery,
  merchant, purchased_at,
  lines: [ { raw, sku, item_id (dictionary ID or null),
             decoded_name, qty, unit_price, line_total,
             line_type: item | discount | return,
             discount_parent_sku (for a discount line),
             allocation: HOUSEHOLD | FOR_OTHERS,
             for_person (name or null),
             confidence, status: auto | unverified,
             judge_agree } ],
  subtotal, tax, total, totals_reconcile: true | false, image_ref }

DictionaryEntry (SPEC 6.2)
{ item_id, canonical_name, category, aliases: [],
  spoken_names: [], typical_unit, sam_concept }

LedgerEntry (SPEC 6.2, 6.3)
{ entry_id, receipt_id, item_id, store_id, date,
  qty, price, event_type: purchase | return | correction,
  allocation: HOUSEHOLD | FOR-OTHERS, supersedes (entry ID or null) }

PatternSummary (SPEC 6.4) — computed by code, not by a model
{ item_id, purchase_count, median_interval_days, last_bought,
  typical_qty, total_spend, due: true | false,
  history_state: pattern | not-enough-history }
Input set: purchases minus returns minus FOR-OTHERS lines.

ReconciliationResult (SPEC 6.6)
{ trip_id,
  matched:   [ { item_id, evidence: [list, receipt, cart], price } ],
  unverified: [ { item_id, seen_in: [], reason } ],
  surprises: [ { raw, reason } ] }

SmartList (SPEC 6.5)
{ list_id, items: [ { item_id, qty, due_reason, source: pattern | user | eyes-removed } ],
  narration }

PreparedCart (SPEC 6.5)
{ cart_id, list_id, store,
  items: [ { item_id, name, qty } ],
  state: waiting | approved, approved_at }
The cart sends no order. The cart makes no payment.

EyesSighting (SPEC 6.7)
{ sighting_id, item_id (or null), photo_ref, seen_at,
  quantity_level: full | some | low | out | unknown,
  confidence, user_state: unconfirmed | confirmed | corrected }

Store add-on contracts (SPEC 6.8)
Sighting { sighting_id, store_id, zone_id, item_id, evidence,
  captured_at, base_confidence, status: live | disputed | retired }
Effective confidence = base x 0.5^(age in days / 21). The value is computed at read time.
StoreIndex { store_id, version, zones: [], sightings: [], coverage_pct, item_coverage_pct }
RoutePlan { route_id, store_id, index_version,
  stops: [ { item_id, zone_id, confidence, evidence_age_days } ],
  unknowns: [ { item_id, ask } ] }
RelocalizationResult { zone_id (or null), confidence, landmarks_seen: [], needs }
WalkthroughGrade { walkthrough_id, recency_days, clarity,
  completeness_zones, completeness_items, overall }
```

## 4. Stages

A stage starts after the prior gate passes. Stage 5 is an exception. Stage 5 has no gate effect on Stages 1 to 4.

### Stage 0 — Foundations (Day 0)

Build:

- Repo and layout of Section 2.1.
- The meta_client with the cost ledger.
- One smoke call per service: Spark text, SAM on one photo, ASR batch on a 10 second clip, one Muse Image render, a Glimmer ping if the Fireworks credit exists.
- Contributor mode OFF in the Muse settings.
- Oracle skeleton: Caddy, FastAPI, and Postgres with docker compose. The health endpoint is green on HTTPS.

Owner steps, no delegate: the hostname decision (due before Stage 3); the API key in the Oracle environment (due before Stage 3 rehearsal).

Loops: Loop A, one to two rounds.
Gate: smoke calls green from the Hatch harness and from the Oracle service. The cost ledger renders a total. A clean pull plus compose up rebuilds the stack.
Estimated API cost: 1 dollar.

### Stage 0.5 — The two pre-build spikes (Day 0 to Day 1)

Spike A. The photo-receipt gate.

- Set: 20 real paper receipts. Stores are mixed. Light is mixed. Composition: 4 from the owner, 16 public (owner amendment, 2026-10-27).
- Isolation: public receipts are fixtures in a separate store (spike2/public-set). Labels are written before any decode runs. Public data never touches the dictionary, the ledger, or the patterns of the owner. The subsets report separately.
- Method: the v1 decode prompt from Spike 1 runs on the photos. Scoring is by code plus a manual product check per line.
- Pass mark: 90 percent or more of lines correct (SPEC.md Gate 0).
- Failure path: PDF receipts and e-receipts only. Photo intake leaves the MVP. The decision is made on the same day.

Spike B. The Costco history pull test.

- Question: the Costco account of the owner gives receipt history in a usable form, yes or no.
- Method: a browser session with the saved login of the owner. Open Orders and Returns. Count the receipts. Read the date range. Download a sample set.
- Risk: bot checks, a changed site, terms limits. The test result is a fact for the plan. The result is not a promise.
- Plan B: uploads from the owner plus manual exports. The cold start uses the 7 receipts in hand today plus new uploads.
- Output: a count, a date range, and a sample decode of pulled receipts, or a failure note with the exact blocker.

Gate: Spike A passes, or the fallback is declared. Spike B has a result, pass or fail.
Estimated API cost: 2 dollars.

### Stage 1 — Receipt decode API (Day 1 to Day 2)

Build:

- The decode service: PDF or photo input, DecodedReceipt output.
- The arithmetic check of SPEC FR-1.5.
- Discount folding of SPEC FR-1.8.
- Return detection of SPEC FR-3.1 and FR-3.2.
- The allocation field on each line. Default: HOUSEHOLD.
- The dictionary v1, seeded from decodes and corrections.
- The ledger: append-only posting, the review queue, the unverified list.
- The review actions: confirm, correct, and "Not for us" (sets FOR-OTHERS, with an optional person name).
- The harness driver: spike_receipts.py runs all functions from the CLI.

Data:

- Real set: the receipts of the owner. Standard mode only.
- Iteration set: fabricated receipts in Costco format, with edge cases: return lines, duplicate receipts, discount lines, a gift-card line, a for-others candidate line, a blurry photo variant.

Loops: Loop C with three decode prompt candidates on the iteration set. Loop B on the winner, 12 iterations maximum. Rule D on dictionary-novel auto-posts.
Gate: SPEC.md Gate 1. Totals reconcile on the golden set. A re-decode after corrections asks about zero corrected codes.
Estimated API cost: 5 dollars.

### Stage 2 — Patterns, reconciliation, smart list, prepared cart (Day 2 to Day 3)

Build:

- Patterns: deterministic aggregation over the ledger (SPEC 6.4). The input set excludes returns and FOR-OTHERS lines. An item with one purchase gets the state "not-enough-history."
- Reconciliation: the three-way join of list, receipt, and cart photo (SPEC 6.6). Price and quantity are the join keys.
- Smart list: the due rule of SPEC FR-5.1, the typical quantity, model narration inside the due set only.
- Prepared cart: the list becomes a cart in the sandbox (SPEC FR-5.5 and FR-5.6). The cart state is waiting or approved. The cart sends no order.
- Budget rollup endpoint: spend by category and by period, with the bought-for-others subtotal as a separate view.
- Optional scene, cut first under time pressure: the meal hook of SPEC 6.9.

Loops: Loop A. Pattern values get a 100 percent hand check on the golden ledger. A small Loop B on the meal prompt has one metric: invented ingredients equal zero.
Gate: SPEC.md Gate 2 rows for Returns, Allocation, Patterns, Smart list, Prepared cart, and Reconciliation.
Estimated API cost: 3 dollars.

### Stage 3 — PWA-core (Day 3 to Day 5)

Build:

- The PWA of SPEC Section 8: Home, Scan, Dashboard, Item detail.
- Offline cache: app shell, active list, active index. A local queue for corrections and check-offs. Sync at reconnect.
- The review queue in the Scan screen: confirm, correct, "Not for us," each with one tap.
- The evidence display: confidence values visible, unverified items marked, unknown states shown as unknown.
- The UX pass follows the impeccable skill playbook. Each rule of SPEC Section 8 becomes a check item.

Owner steps, blocking: the API key in the Oracle environment; the hostname live. A rehearsal on a deployment without the key does not count.

Loops: Loop A against the UX checklist. The checklist passes at 100 percent or the stage does not pass. One rehearsal trip on the phone of the owner feeds one fix loop, 4 rounds maximum.
Gate: the UX checklist is complete. One trip runs end to end on the Oracle deployment: scan, review, patterns, list, cart approval.
Estimated API cost: 4 dollars.

### Stage 4 — Eyes (Day 5 to Day 6)

Build:

- Eyes intake in the Scan screen: refrigerator, pantry, freezer, or fruit photo.
- Sighting detection: Spark reads one photo and returns sightings with confidence. Rule D applies to a sighting from a single photo.
- The confirm and correct list for sightings, one tap per item.
- The inventory correction: a confirmed sighting updates the estimate of the item and can remove the item from the list draft.
- The evidence frame component: the photo with the item highlight, plus the sighting card with date and state.
- Expiry v1: category priors, the put-away date photo prompt for high-risk items, the "this expired" report, the warning as a question (SPEC FR-7.9).

Loops: Loop B on the sighting prompt against the golden photo set (Section 6), 10 iterations maximum. Loop A on the correction flow.
Gate: SPEC.md Gate 2 row for Eyes. One demo photo with one obvious item produces the evidence frame and removes the item from the draft.
Estimated API cost: 4 dollars.

### Stage 5 — Enhancement: the store add-on (Day 4 to Day 7, parallel value)

This stage has no gate effect on the core. A failure here changes the demo script only.

Build:

- Walkthrough ingest: video upload, a DB job, Spark video to zones and sightings.
- A probe first: index a 2 minute clip with three methods. Measure tokens, time, and cost per method. Flag F5 gives the reason.
- The store index with coverage values (SPEC FR-8.2 and FR-8.3).
- Aisle-photo ingest.
- Relocalization: a photo plus the cached index prefix gives a zone and a confidence.
- Route planning over the zone order, with an explicit unknowns list.
- The guided session states: to zone, checkpoint, at shelf, found, not here, teach, done.
- SAM find on stills, one concept per request.
- Voice: ASR realtime with dictionary biasing; a Spark parse to intent, slots, and parse confidence; a confirm prompt for a low-confidence parse (flag F4).
- The correction protocol: "Not here" demotes at once; the repair answer names an alternate zone and one fix action; the end-of-trip recap lists found, not found, and taught.
- Grading: a second walkthrough gets a grade table (SPEC FR-8.9).
- Glimmer pre-filter behind a flag. The flag is the first cut under time pressure.

Loops: Loop C on the indexing method from the probe. Loop B on relocalization, 10 iterations maximum, with negative photos in the set.
Gate: SPEC.md Gate 3 (Spike 2). A failure gives the degraded add-on on the same day: zone guide and item spotting. The core and the demo beats of Section 7 do not change.
Estimated API cost: 20 dollars. The stop rule at plus 50 percent applies.

### Stage 6 — Hardening and demo (Day 6 to November 4)

Build:

- The demo script and the shot list, keyed to the seven beats of Section 7.
- The privacy sentence in the script (SPEC Section 7.3).
- Pre-computed artifacts from real data: the pattern history, the store index if the add-on passes, one dinner render if the meal scene stays.
- The submission package for the review of the owner.

Loops: three full dry runs. One dry run uses the Hatch fallback service. Two dry runs use the Oracle deployment. Each dry run is a verifier pass against the script. Defects loop back, 3 rounds maximum.
Gate: two green dry runs in a row on the Oracle deployment. The runbook of Section 7 is rehearsed. The package is ready for the approval of the owner.
Estimated API cost: 8 dollars.

## 5. Daily workflow

1. Pick the next unpassed gate check of the stage.
2. The builder gets: the SPEC section, the contract, the failing checks or the golden set, and the stop conditions.
3. The builder works in a branch. Commits are small and gate-scoped.
4. The verifier runs the harness from a clean checkout. The verifier files defects: check, input, expected, actual, evidence. The verifier edits no code.
5. Prompt work runs in the eval runner. Each attempt writes one file in the loops folder: prompt hash, set version, per-item scores, gate metric, cost, and the one changed variable.
6. A merge needs a verifier pass. The cost ledger is read at each gate.
7. The nightly sync to Hatch runs from a script. The sync is not a memory task.

## 6. Test sets — golden sets

Golden sets are versioned. A scorer is code. A scorer is not an impression of an agent.
A prompt change or a contract change triggers a full re-run of the affected sets.

| Set | Contents | Used by |
|---|---|---|
| golden/photos-20 | 20 real paper receipts, mixed stores and light, with hand-checked lines | Stage 0.5 Spike A gate |
| golden/receipts-real | The receipts of the owner as PDFs, with hand-verified decodes; Standard mode only | Stage 1 gate |
| golden/receipts-synthetic | Fabricated receipts: return lines, a duplicate, discount lines, a gift-card line, a for-others candidate, a blurry photo | Stage 1 loops |
| golden/ledger | The Stage 1 output as frozen data, with hand-computed pattern values | Stage 2 gate |
| golden/trips | Scripted reconciliation trips: one clean trip, one mismatch, one return, one for-others line | Stage 2 gate |
| golden/eyes | Fridge and pantry photos with hand-labeled visible items; each photo has one obvious item | Stage 4 gate |
| golden/relocalize | 10 fresh store photos with zone labels, plus 5 negatives: wrong store, parking lot, home kitchen | Stage 5 gate |
| golden/shelf | 10 shelf photos with hand-labeled target boxes | Stage 5 SAM check |
| golden/voice | About 40 recorded commands, clean audio and store-noise mixes, with expected intent and slots | Stage 5 voice check |

## 7. Demo runbook (November 4)

### 7.1 The seven beats, in order

| Beat | Action | Evidence on screen |
|---|---|---|
| 1. Scan | The user scans a real receipt | Decoded lines with confidence values |
| 2. Learn | The model updates | Dictionary entries and pattern values change; the narration names the change |
| 3. The list writes itself | The due set becomes a draft | The draft with due reasons and date ranges |
| 4. Eyes | One fridge photo with one obvious item | The evidence frame: the highlight in the photo plus the sighting card; the item leaves the draft |
| 5. A return | A return receipt enters intake | The ledger nets the return; the pattern of the item changes; the item leaves future drafts |
| 6. A verified total | The arithmetic check runs | The line sum and the receipt subtotal match on screen |
| 7. The prepared cart | The approved list becomes a cart | The cart in the waiting state; the user approves with one tap |

The privacy sentence is spoken in beat 1 or in the intro: photos and receipts go to the Meta API for processing, in Standard mode, with no training on the data. Records stay on the server of the user.

### 7.2 Day minus 1 (November 3)

- Prompt and index freeze. Defect fixes only after the freeze.
- Final dry run on the Oracle deployment.
- The nightly sync is tested with a restore.
- Devices are charged. The shot list is printed.
- Portal fields are checked: Representative is the owner, Indie track, team members named.

### 7.3 Owner-only steps

1. The API key in the Oracle environment. One time. Section 2.5 gives the reason.
2. The public hostname confirmed live.
3. The final submission. The owner reviews the complete package. The owner gives the explicit approval before submission.

### 7.4 Live and pre-computed

| Live in the demo | Pre-computed from real data |
|---|---|
| Receipt scan and decode; review queue | Pattern history from the receipts of the owner |
| List draft generation; Eyes photo and evidence frame | Store index from walkthroughs of the week, if the add-on passes |
| Return intake and netting; arithmetic check on screen | One dinner render, if the meal scene stays |
| Prepared cart and approval | The grading table of the second walkthrough |

### 7.5 Fallbacks, in order

1. Store network fails: cached data and manual check-off (SPEC Section 7.4).
2. Oracle fails: the API service runs from Hatch for the desk segments. Data comes from the nightly sync.
3. A live beat fails: pre-shot video of the same beat plus the stage artifacts carry the segment.

Submission target: 6:00 PM ET. The deadline is 9:00 PM ET. The buffer is for the portal. The buffer is not for building.

## 8. Cost rollup — Meta API dollars

| Stage | Estimate | Main driver |
|---|---|---|
| 0 Foundations | 1 | Smoke calls |
| 0.5 Pre-build spikes | 2 | 20 photo decodes plus pull samples |
| 1 Decode API | 5 | Contributor iterations on synthetic data plus Standard gate runs |
| 2 Patterns, reconcile, list, cart | 3 | Text calls; the meal prompt loop |
| 3 PWA-core | 4 | Rehearsal trips and fix loops |
| 4 Eyes | 4 | Photo sighting eval runs |
| 5 Store add-on | 20 | Walkthrough indexing; flag F5 is the swing factor |
| 6 Hardening and demo | 8 | Dry runs and video takes |
| Subtotal | 47 | |
| Contingency, about 30 percent | 14 | Re-indexing, extra takes |
| Expected total | About 61 | Ceiling: 150, enforced by the stop rule of Section 1.2 |

Cost per trip on Standard rates: about 0.25 dollars. The target is 0.35 dollars or less.
Glimmer spend rides the separate Fireworks credit. Glimmer spend does not count against the 150 dollars.
Agent labor tokens are not in this table. Attempt counts and score paths sit in the loops folder.

## 9. Design flags

F1. Contributor mode and personal data.
A Contributor model can be trained on inputs. Meta terms bar personal data on that mode.
Fix: Contributor loops use synthetic data only. Real receipts are Standard-only in development, rehearsal, and demo. The same rule covers Muse Code: Contributor OFF in the settings before code work.

F2. SAM on a full walkthrough video.
Hosted SAM caps a request at 15,000 frames. The price is 0.20 dollars per 1,000 frames per concept, one concept per request. A 10 minute video at 30 frames per second has 18,000 frames. The video is over the cap. Many concepts cost more than the credit.
Fix: Spark indexes the video. SAM runs on stills only, at 0.0025 dollars per image.

F3. Spark latency.
Spark is a reasoning model. A third-party measurement shows about 9 seconds for a short reply at default effort. The 6 second relocalization budget fails at default effort.
Fix: low reasoning effort in the store, short prompts, cached prefixes, non-blocking calls. A failure of Spike 2 on latency gives the degraded add-on.

F4. Voice Transcribe gives no confidence values.
The service returns turn-level times only. Voice ask-when-unsure cannot use an ASR score.
Fix: confidence sits in the Spark parse layer: intent, slots, and parse confidence. The product promises no word-level highlight.

F5. Spark video token counts are not published.
Indexing cost and time are unknown before measurement. This item is the budget swing factor.
Fix: Stage 5 opens with a 2 minute clip probe and three methods, with measurements before a commitment. Indexing works in zone chunks. Stage 5 carries the largest allocation and the stop rule.

F6. PWA platform limits.
iOS needs HTTPS and a user gesture for the camera. iOS gives no background camera. Wake Lock support varies.
Fix: one origin on HTTPS via Caddy. Guided mode is a foreground camera screen by design. Wake Lock is a request at trip start. The camera screen is the stay-awake fallback.

F7. Glimmer price and credit are unverified.
The Fireworks listing gives no per-token price in our sources. The 25 dollar credit is for selected participants.
Fix: Glimmer is flag-isolated. All gates pass with the flag off. The price is verified at the console before the flag turns on. A drop of Glimmer costs one optimization and no gate.

F8. Two small unknowns, with designs around them.
Spark audio input appears in one catalog and not in others. The design sends no audio to Spark. ASR is the only audio path.
The Contributor rate ceiling appears as 150 in one source and 100 in another. Eval loops throttle to 100 on Contributor mode.
