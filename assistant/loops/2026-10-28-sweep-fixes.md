# 2026-10-28 — Phase 2 QA sweep fix (local commit, NOT pushed/deployed)

Found by the overnight user-lens sweep (~/workspace/arya-qa/), verified
against the live build 9712c54, fixed locally under the sweep's fix
policy (verified, unambiguous, small, non-UI). Awaits the owner's
deploy gate like everything else.

## The bug — one US-dated photo receipt poisons an account

- Wonder photo decode returns the date as printed on the receipt.
  For the sweep's Safeway photo it returned "07/29/26"; decode stored
  `purchased_at` verbatim (api/decode/service.py).
- Every consumer parses ISO only. patterns.engine._d raised
  ValueError, which crashed:
  - POST /decode/photo itself — the receipt is FILED, then the
    route's judge_pending step raises → HTTP 500 (live log
    2026-10-28T04:25:12Z). The user sees failure for a succeeded
    filing, and the quest late-attach dies with it (the session
    never settles).
  - GET /api/home for the whole account afterwards (state.derived →
    summarize) — verified live: sweep-a's home returned 500 once the
    US-dated receipts were in its store.
- Repro (local, pre-fix): summarize() over entries dated
  '2026-07-01' / '07/29/26' / '2026-08-20' → ValueError: Invalid
  isoformat string: '07/29/26' — the exact production error.

## The fix

- api/decode/service.py: `_iso_day()` normalizes purchased_at to
  ISO YYYY-MM-DD at all four receipt constructors (Costco JSON,
  PDF text, photo, order text). Unparseable values pass through.
- api/patterns/engine.py: `_d()` tolerantly parses ISO + US formats
  (heals records already stored), returns None for unparseable;
  summarize orders events by parsed day (string order lies across
  formats) and skips events no format can place.
- api/social.py: no change — its two parse sites already guard with
  try/except; normalization restores their accuracy.

## Tests

- tests/test_receipt_dates.py (7 tests): _iso_day shapes,
  mixed-format summarize (no crash, true-chronology median gap,
  unparseable skipped), and the live failure end-to-end
  (US-dated receipt → GET /api/home == 200).
- Pre-fix: the 4 behavioral tests fail. Post-fix: full suite
  325 passed (318 baseline + 7).

## Not in this commit (report-only per sweep policy)

- Demo cannot start a hunt (403 on /api/quest/optimize — the whole
  quest lifecycle sits outside the demo live-doors; needs an
  ephemeral-demo-session design decision).
- Quest UI findings (parked): coincident photo-scene stop dots,
  uncheck-after-GRAB scene restart/stranding, finish/score loop.
- Receipts archive: unsettled row store-name letter-wrap; raw
  unstyled file input on the photo door. Shop-Off cross-account
  placeholder; friend-run notifications unbuilt.
  Full detail: ~/workspace/arya-qa/findings.md.

## Follow-up (2026-10-28, later): F-01 reconciled + F-03 built

The owner lifted the holds on issues #10 and #11.

- F-01 (this file's fix): cherry-picked onto the PR #7 merge
  (737a1b4) as 27b76f7 — clean pick, decode/service.py and
  patterns/engine.py untouched by the PR.
- F-03 (issue #11), server-side only, no quest UI: attach_receipt
  now compares store families before settling. `_store_family`
  normalizes a free-text name (lowercase, apostrophes dropped,
  "#452" / "No. 12" suffixes stripped, punctuation to word breaks)
  and maps it through a small alias table (trader-joes, safeway,
  costco, target, walmart). Both families known and different ->
  ValueError; the attach route surfaces it as HTTP 400 naming both
  ("this receipt is from Safeway; the hunt is at Trader Joe's"),
  mirroring the set_state error pattern. Either side unclassifiable
  -> the settle proceeds. The Receipts-tab late attach files the
  receipt, then calls this same route/function, so one check covers
  both doors. Four new tests in TestQuestSessions: cross-merchant
  refused (hunt untouched, right receipt still settles), variant
  name settles, unknown merchant settles, unknown hunt store
  settles. (Test-writing note: mid-test state writes need the
  account's current-user context, restored afterwards — the
  ContextVar otherwise leaks across tests on the thread.)
- Suite: 334 green (323 PR head + 7 receipt-date tests + 4 new).
