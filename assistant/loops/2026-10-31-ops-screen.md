# 2026-10-31 — Ops screen (owner approved the mockup RMftW9ZtxwxWfJXMbdKuXr, "full version now")

What changed
- `api/site_flags.py`: owner switches in `site.json` (`ai_paused`, `demo_live`, `photo_reader`), 3 s cache.
- `deps._reads_gate`: called by `_budget_guard` and `new_client()`; paused reads and demo-off answer 503 with a plain sentence. `decode.service.photo_reader()` reads the override first.
- `api/ops_summary.py` and `api/routes/ops.py`: `GET /api/ops`, `POST /api/ops/controls`, owner only; every change appended to `ops-changes.jsonl`. `/api/ops` is on the API-token blocked list. `harness/ops.py` takes its limits from `ops_summary`.
- `web/src/screens/Ops.tsx`, row in Settings (owner only, shows All quiet / Needs a look), strings under `ops.*` in `en.json`, chip and bar styles.
- compose mounts `/home/ubuntu/arya-backups` read only at `/backups` for the newest-backup row.

Checks: `tests/test_ops_screen.py`, `web/src/screens/ops.test.tsx`; the real built screen was checked at 390 x 844 as the owner against the mock.
Differences from the mock: calls group by feature (Photo and receipt reads, Ask, Store maps, Other helps, Voice); the Site row says "Up. This page just loaded from it." (no invented latency); the Last backup row says only the age. A failed-call rate over 10% (5 or more calls) turns a row red.
Help and Ask Arya knowledge: unchanged, owner-only screen, not a user feature.
