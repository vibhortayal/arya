# 2026-11-01 — To check smart pass (backend)

Owner: To check (122 items) shows raw names ("ORG YELLOW", "DFMBLLRNFLAT")
with only Looks right and More; Arya should take a smart pass first.

Changed (backend only; the card is the UI/UX thread's, mockup first):
- `clean.suggest_review`: To check lines with no suggestion get
  `suggested = {name, section, confidence, by: "arya"}`, one per item
  number. A name the household taught or the clean pass wrote is reused
  with no call; the rest go to Spark in batches of 25 (same prompt as
  clean names, now also returning a store section). Unreadable lines get
  `suggest_tried` and are not paid for again. Lines stay unverified.
- `state.suggest_lines`: one save per filer (group-safe).
- `POST /api/review/smart-pass` (budget-guarded, blocked for API tokens);
  `judge_pending` runs it after each receipt (limit 60).
- `POST /api/review/line` rename takes an optional `section`, saved on
  the item when it has none.
- `harness.clean_names <account> --suggest` backfills every waiting item.
- Help receipt note and Ask Arya text mention the guess.

Tests: `tests/test_review_smart_pass.py` (6). Full suite: same 12
failures as main.
