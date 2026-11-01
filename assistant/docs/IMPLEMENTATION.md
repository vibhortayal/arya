# The Assistant — Implementation

This document says how Arya is built. SPEC.md says what and why; read
it first. STATUS.md says where the build is now. ARCHITECTURE.md
section 0 is the one-page map of the built system (updated 2026-10-29). The per-session build
record is in `assistant/loops/`. ASD-STE100 style: short sentences, one
idea each.

## 1. Method

**Loop A — builder and verifier.** A builder writes the code. A
verifier runs the gate checks from behavior and evidence only. A
failure returns as a defect: check, input, expected, actual.

**Loop B — eval loop.** A prompt runs against a golden set. A code
scorer gives a number. Change one variable per attempt. Log each
attempt: prompt hash, set version, score, cost. Gate scores count on
Standard mode only.

**Loop C — parallel candidates.** The riskiest prompts get three
variants. The winner ships; losers stay in the repo with scores.

**Rule D — dual judge.** Two independent Spark calls must agree on a
dictionary-novel auto-post and on a single-photo sighting. A
disagreement goes to the review queue.

### Stop conditions

| Trigger | Action |
| --- | --- |
| The gate passes | Stop. More polish is a new decision. |
| The iteration cap is hit (12 prompt, 3 candidate, 4 builder rounds) | Stop. Escalate with the score path. |
| Under 1 point of gain in 3 attempts | Stop. Propose a new approach. |
| Stage spend over allocation by 50% | Stop. Escalate before more spend. |
| A loop finds a spec error | Stop. The owner decides. |

### Budgets and modes
- Meta API dollars: the $150 credit, metered from the first call.
  Engine caps: $10/day for the app, $2/day for the demo bucket.
- Contributor mode (owner, 2026-11-01): now the Spark tier for the app,
  so Spark content can train Meta models. `ARYA_SPARK_TIER=standard` reverts.
- Standard mode: Wonder, gates and eval scoring.
- Muse Code: Contributor OFF before code work.

## 2. Foundations

### 2.1 Layout
See AGENTS.md. All Meta calls go through `api/meta_client.py`, which
meters cost (`cost_ledger.py`, one row per call) and enforces mode
rules. Base URL https://api.meta.ai/v1; the key comes from env
`MODEL_API_KEY`, never from code.

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

- Photo receipts: Muse Spark reads first; Muse Wonder (90 s bound) re-reads only a receipt the arithmetic checks flag (`ARYA_PHOTO_READER=auto`, the default). `spark` and `wonder` force one reader.
- Parse streaming output with care. Spark emits a non-standard stream event.
- SAM accepts text prompts only. One concept per request. A maximum of 16 tracked objects per frame. A maximum of 15,000 frames per request. Video format is MP4 or MOV only.
- Team rate ceilings: 3,000 requests per minute on Standard, 150 on Contributor. Eval loops on Contributor throttle to 100.

### 2.2 Prompt caching
Each call has a stable prefix (system prompt, dictionary, store index)
and a variable tail. Prefix text does not change between calls.

### 2.3 Hosting
Development runs in the Hatch workspace. The runtime is the Oracle VM,
deployed by `git pull` only (never an rsync --delete: `deploy/.env` is
VM-only). The owner provisions the key on the VM.

| Layer | Choice | Reason |
|---|---|---|
| Edge and TLS | Caddy | Automatic HTTPS; PWA files and API proxy under one origin; the camera API needs a secure context |
| API | Python FastAPI | The media tools are Python: meta-sam-parser and ffmpeg |
| Background jobs | A Postgres table plus a worker loop | Indexing is a long job; no Redis, no extra parts |
| Data | File-backed JSON store, optional Supabase Postgres | Per-account files under data/users/<account>/ with atomic writes (temp file + replace + per-file locks). `ARYA_STORE=json\|dual\|pg` (`api/pgstore.py`) adds Postgres rows keyed (owner, name). A group uses owner `group:<id>`. The unused Postgres container was removed (2026-10-29) |
| Media | VM disk | Videos and photos are large; derived data sits in the database |
| Deploy | Git pull plus docker compose up | GitHub is the source of truth |
| Insurance | Nightly sync of media and a database dump to Hatch | A dead VM in demo week loses no data |

## 3. Contracts

The harness tests these before a UI exists.

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

SmartList (SPEC 6.5) — suggestions
{ list_id, items: [ { item_id, qty, due_reason, source: pattern | user } ],
  narration }

NamedList (SPEC 5.10, 6.9) — `lists` store, one row per list
{ list_id, name, store (optional), items: [ { item_id, qty, checked } ] }
"Everything else" holds items with no list. A due staple is a suggestion
under the list of its usual store; it is not an item until the user adds it.
The prepared cart (PR #105) is gone from the app. Legacy `cart.json` and
`/api/cart/approve` are not used by any screen. Arya places no order.

ExpiryFlag (SPEC 6.7) — on the item's flag record
{ use_by, use_by_kind: use_by | best_by | expires | packed | unknown,
  use_by_set, use_by_snooze }
One vision read returns the printed date. The user confirms. The photo is never kept.
Fridge and pantry photo inventory was never shipped in the app. The
`eyes` code (`api/eyes/`) is a spike and has no screen.

Group (SPEC 6.10) — `groups.json` in the data root
{ groups: { id: { name, owner, members: [ { user, joined } ], created,
                  invite: { hash, expires, by } | null } },
  member_of: { user: id } }
In a group, `state._plane()` sends lists, item flags, and product
knowledge to the group plane. Receipts stay per account and are read as the union of all members.
Live sync: `GET /api/group/live` (SSE); Postgres LISTEN/NOTIFY on channel `arya_group` when `DATABASE_URL` is set, else in-process. `ARYA_GROUPS=0` turns groups off.

PriceFacts (SPEC 6.11) — computed by `api/prices.py`, deterministic, $0
{ item_id, per_store: [ { store, unit_price } ], cheaper_store,
  trend_pct, similar: [], caveat }
Unit price is net line total divided by quantity. A trend needs enough
buys over enough days. Thin data shows nothing. No outside source.

Store add-on contracts (SPEC 6.8)
Sighting { sighting_id, store_id, zone_id, item_id, evidence,
  captured_at, base_confidence, status: live | disputed | retired }
Effective confidence = base x 0.5^(age in days / 21). The value is computed at read time.
StoreIndex { store_id, version, zones: [], sightings: [], coverage_pct, item_coverage_pct }
RoutePlan { route_id, store_id, index_version,
  stops: [ { item_id, zone_id, confidence, evidence_age_days } ],
  unknowns: [ { item_id, ask } ] }
```

## 4. Stages

| Stage | State |
| --- | --- |
| 0 Foundations | Done. meta_client, cost ledger, Oracle stack live. |
| 0.5 Spikes | Gate 0 photo decode PASS (93.85% combined, arithmetic 7/7). Costco pull: plan B (uploads and exports). |
| 1 Decode API | Done. Dictionary v1: 458 entries. |
| 2 Patterns, list | Done. Returns netted; list needs 3 kept purchases. The prepared cart was removed in PR #105. |
| 3 PWA-core | Done. List first since PR #104: tabs Today, Lists, Ask, Quest, Settings. Named lists (#90), Start shopping bar. Express mode (#107) lost its entry points when Quest mode landed (#172). Demo household is a per-visitor sandbox. |
| 4 Ask | Done. Ask Arya answers about Arya and about prices. Fridge/pantry photos were never shipped; expiry-date photos (#96) replace them. |
| 5 Store add-on | Superseded by Quest Stages A–E (Discussion 29). |
| 6 Hardening and demo | Backend split into `api/routes/` (#112, #118), strict CSP (#119), manual-only CI (#108). Demo video and package pending. |
| 7 Groups | Merged (#121, live sync #127, on by default #128). |
| 8 Price intelligence | Merged (#120): own-receipt prices, Arya's powers, daily card. Community prices, Deals, Arya Shoppers: after Nov 4. |

Merged is not deployed. The owner deploys with `git pull` and
`docker compose up -d --build`. STATUS.md lists the open steps.

Switched-off flags: `ARYA_PUSH_REMINDERS`, `ARYA_SUPABASE_AUTH`. All app
settings pass through `deploy/docker-compose.yml`. Quest work after Stage 6 follows the Discussion log and the wireframes.

## 5. Daily workflow
1. Pick the next unpassed check.
2. Work on a branch based on `main`. Do not stack PRs.
3. Run the suite by hand before a commit. CI is manual only (`.github/workflows/tests.yml`, owner's choice).
4. Prompt work runs in the eval runner; each attempt writes a loop file.
5. Every session appends a loop entry and updates STATUS.md.

## 6. Golden sets

Golden sets are versioned. A scorer is code, not an impression. A
prompt or contract change re-runs the affected sets.

| Set | Contents | Used by |
|---|---|---|
| golden/photos-20 | 20 real paper receipts, mixed stores and light, with hand-checked lines | Stage 0.5 Spike A gate |
| golden/receipts-real | The receipts of the owner as PDFs, with hand-verified decodes; Standard mode only | Stage 1 gate |
| golden/receipts-synthetic | Fabricated receipts: return lines, a duplicate, discount lines, a gift-card line, a for-others candidate, a blurry photo | Stage 1 loops |
| golden/ledger | The Stage 1 output as frozen data, with hand-computed pattern values | Stage 2 gate |
| golden/trips | Scripted reconciliation trips: one clean trip, one mismatch, one return, one for-others line | Stage 2 gate |
| golden/shelf | 10 shelf photos with hand-labeled target boxes | Stage 5 SAM check |
| golden/voice | About 40 recorded commands, clean audio and store-noise mixes, with expected intent and slots | Stage 5 voice check |

## 7. Demo
The judge path is `docs/quest/JUDGE-PLAYBOOK.md`. The video beats are
in `docs/quest/SUBMISSION.md`. Day minus 1 (Nov 3): final dry
run, restore test of the nightly sync. Owner-only steps: the API key on
the VM, the hostname, the final submission (explicit approval).
Submission target 6:00 PM ET; the deadline is 9:00 PM ET.

Fallbacks, in order: cached data and manual check-off if the store
network fails; the Hatch service if Oracle fails; pre-shot video if a
live beat fails.

## 8. Design flags
- **F1 Contributor mode:** Spark runs on it since 2026-11-01 (owner
  decision); real content sent to Spark can train Meta models. Receipt
  photos are read by Spark first too; a Wonder re-read of a flagged
  receipt runs on Standard.
- **F2 SAM on video:** hosted SAM caps a request at 15,000 frames;
  SAM runs on stills ($0.0025 an image).
- **F3 Spark latency:** low effort, short prompts, cached prefixes,
  non-blocking calls in the store. Shelf Scan takes 4–8 s a frame.
- **F4 Voice Transcribe:** no confidence values; confidence lives in
  the parse layer.
- **F6 PWA limits:** HTTPS and a user gesture for the camera on iOS;
  no background camera.
- **F7 Glimmer:** flag-isolated, not used.
