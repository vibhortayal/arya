# 2026-11-01 — clean receipt names

Owner: "ORG BLACKBRY" in suggestions should read "Blackberry - Organic".

Cause: the name book (dictionary.json) was built once from the Costco
history (build.expand already reads ORG BLACKBRY there). Items first seen
on later photo receipts never got an entry, so names fell back to the
printed text.

Changed:
- `api/dictionary/clean.py`: candidates (items whose shown name is still
  printed text; fees, manual, resolved and unresolved names skipped),
  plan (one Spark Standard text call per 25 items: printed text, chain,
  item number, usual price, pack detail; prompt `prompts/clean_names_v1.md`
  + the Costco hints), apply, undo, clean_new. The name is composed in
  code: "Product - Detail, Brand, Size".
- Receipts are never edited. Each changed entry keeps its old group key,
  so a new name never merges or splits purchase history. Old name and
  printed text stay as aliases. Everything replaced is kept in
  `clean_undo`.
- Confidence below 0.8: entry becomes unresolved with the guess as the
  first candidate (existing To check card, no screen change; kept off
  suggestions until answered).
- `state.judge_pending` calls `clean_new` first, so each new receipt's
  new items are cleaned — only after the owner has applied once.
- `harness/clean_names.py`: dry run (saves the plan, prints counts and a
  sample), `--apply` (writes the saved plan, no second call), `--undo`.
- Help: receipt topic note n3. Ask Arya: "Clean names" paragraph.

Tests: `tests/test_clean_names.py` (8). Full suite: same 12 failures as
main, no new ones.

Spend: none yet (no key here). Dry run on the VM costs one call per 25
items.

Next: owner runs the dry run on the VM and says go.
