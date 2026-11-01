# 2026-11-01 — Re-audit fixes: server

Owner's Oct 31 re-audit, items N6 and #9 (#11 left, see below).
No model calls, $0.

## What changed
- N6: the per-request memo hands out copies by a pickle round trip
  (`state._clone`), about 4x faster than `copy.deepcopy` on a synthetic
  200-receipt ledger (25 ms to 6.6 ms a copy). Each caller still gets its
  own deep copy, so no caller had to be audited for writes. Anything that
  cannot be pickled falls back to deepcopy.
- #9: `/api/list/add`, `/api/list/from-text`, `/api/list/import-preview`,
  `/api/list/import` and `/api/lists` (create) run their file writes, and
  the from-text/import model call, in the thread pool. from-text called
  the model on the event loop, which held every other request for the
  length of the call.

## Not changed
- #11 (`--workers 2`): demo sessions and demo sandboxes live in one
  process's memory. A second worker would not know them: half the
  demo's requests would answer 401. Needs shared demo state first.

## Checks
Full suite: 1560 tests, 2 failures that fail the same on main
(`test_feature_sheet` size cap 9843 > 9500, `test_running_low_no_judge`
steady rhythm).
