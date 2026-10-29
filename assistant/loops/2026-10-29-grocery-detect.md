# 2026-10-29 — Grocery detection (hybrid), owner-approved

Owner asked "is it built smartly to detect only grocery items" and chose
the hybrid after the audit (reviews/arya-grocery-detection-audit.md).
Before: no entry path judged groceries; the Add box only checked shape.

## What changed
- `api/list/grocery.py`: `classify(name, verdicts)` is pure, $0 and never
  blocks. Order: user verdict, non-grocery phrase rules (gift cards,
  fuel, pharmacy, clothing, electronics, sports and hobbies, tickets and
  services), the aisle map, saved model verdict, else "unknown". Unknown
  counts as groceries everywhere.
- `judge_unknown(names, client)`: one Spark Standard call per 20 unknown
  names (personal=True, cache_key arya-grocery-judge-v1). Confident
  verdicts are cached in `grocery_verdicts.json`; low confidence is
  cached as unsure so it is not asked again. A failed call changes
  nothing. A user verdict is never overwritten by a model verdict.
- `POST /api/list/judge` (typed items with unknown names, cached) and
  `POST /api/list/grocery-verdict` (the user's Keep).
- List rows carry `not_grocery` (derived, rules and cache only). The
  List shows "Not a grocery item? Added anyway" with "It is groceries"
  and "Remove", and an "Other errands" group. Ask-to-add says the same
  in words. Nothing is dropped.
- Analysis: `spend_groceries`, `spend_other`, `other_by_kind`; top items
  are groceries; Other purchases row under All-time spend. Totals still
  reconcile to the receipts. Receipt lines missing from the dictionary
  now use their receipt name.
- `_sensible` accepts any script (Hindi was refused before).

## Not done (flagged to owner)
- Hunt still takes every list item; non-grocery errands are not yet
  skipped by the Optimizer.
- Receipt lines the rules do not know are counted as groceries in
  Analysis (no model call at dashboard time). Decode does not yet emit a
  per-line kind.

## Cost
Rules and aisle map: $0. Model: about $0.0002 to $0.0004 per unknown
name, once per name. Tests: 957 green (`tests/test_grocery_detect.py`).
