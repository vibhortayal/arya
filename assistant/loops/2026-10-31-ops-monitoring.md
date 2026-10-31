# 2026-10-31 — Ops monitoring (ops readiness review, option B)

What changed
- Cost ledger: rows carry `ms`; a failed model call is booked (`ok:false`, `err`, cost 0) by a `_watched` decorator on `MetaClient.chat/segment/generate_image/edit_image/transcribe`. Failed rows are skipped by `usage()` and `whole()`. New `CostLedger.health(hours)`.
- `/health`: same body when healthy; 503 `degraded` when the data folder is not writable or free disk is under `ARYA_HEALTH_MIN_FREE_MB` (500).
- `python -m harness.ops report [--hours N] [--email]`: spend vs caps, calls/failures/p50/p95 by type and feature, top accounts, frozen accounts, disk, accounts, waitlist, new feedback; `ARYA_OPS_EMAIL` for the digest.
- `assistant/docs/OPS.md`: VM setup (uptime check, cron, backups, restore test) and a break-glass list.
- compose passes `ARYA_OPS_EMAIL`, `ARYA_HEALTH_MIN_FREE_MB`.

Checks: `tests/test_ops.py`; full suite green (1539 tests, 1 skipped). No model calls, no UI change (Help and Ask knowledge unchanged).
Not done: refusals are not detected; no admin screen (mockup first); no client error reports; the report cannot see host backups (use the Healthchecks.io ping).
