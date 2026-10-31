# 2026-10-31 — Disk checks made hermetic in tests

What changed
- Four tests failed on any host whose temp filesystem is short on space
  (this VM's /tmp is a 512 MB tmpfs, ~0.5 GB free): the /health disk floor
  from the ops work (free < `ARYA_HEALTH_MIN_FREE_MB`, default 500 MB)
  fired inside tests that boot the app on a `tempfile.mkdtemp()` data dir,
  and the ops report warns at `free < max(4x floor, 2 GB)`, which no env
  pin can quiet.
- `tests/test_csp.py` (health liveness) and `tests/test_event_loop.py`,
  `tests/test_decode.py` (import route): pin `ARYA_HEALTH_MIN_FREE_MB=0`
  where the app is booted; the floor is read per request, so no reload.
- `tests/test_ops.py` (report quiet otherwise): stub `shutil.disk_usage`
  with ample free space for the duration of the report build.
- No production change: the checks keep their thresholds, and the firing
  paths stay covered by `test_ops.test_full_disk_answers_503` (huge floor)
  and the report's failing-mode half.

Checks: the 4 touched modules pass (39 tests); full suite green on this
VM (1546 tests, 1 skipped) — the same host where the 4 failed before.
No model calls, no UI change (Help and Ask knowledge unchanged).
