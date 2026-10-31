# 2026-10-31 — Speed, feel and UX audit fixes

Owner's audit (38 issues). One PR, no mockups (owner's word for this PR).
No model calls, $0.

## What changed
- Lists: tick, remove and quantity show at once; the write goes behind,
  in order per item; one quiet reload once the taps stop; a failed write
  rolls back with a toast. A tick fills and strikes the row, holds 400 ms,
  then moves to Checked off, with an Undo toast and a 10 ms vibration.
- Quest 3D: `frameloop="demand"`; frames only while the shopper, a
  flight, the camera or a practice stroller moves. Low-end phones
  (4 cores or fewer): no shadows, no antialias, 1x pixels.
- Today: `GET /api/today` answers the ten reads in one; a module cache
  paints a return visit at once; a skeleton on the first load and a Retry
  card when it fails; group live sync reloads in place. `boot.js` starts
  settings and Today for a returning account.
- Server: per-request memo for `derived()` and `receipts()` (cleared by
  any write); sessions read from memory until `sessions.json` changes;
  `price_by_store` one pass; tick, remove, qty and move writes off the
  event loop.
- Ask: typing dots at once; Send waits while an answer is on its way.
- Service worker: `/app/` cache first; page loads race the network for
  2.5 s, then the cached shell; registered after load and idle; a
  "New version" toast with Reload.
- Error boundary with Retry around each screen; a stale chunk after a
  deploy reloads once. Lazy screens show skeleton rows; tab chunks
  preload so Help and Settings never flash blank.
- Smaller: request timeouts (20 s reads, 130 s writes), 30 s keep for
  `/api/group` and `/api/settings`, memoized session value, memo list
  rows, Developers lazy, opaque bars on low-end or Motion off, transform
  level bar, Tour measures once per frame, one column width for Quest,
  `scrollbar-gutter: stable`, tab taps reset Back, `touch-action: pan-y`
  on rows, practice quest leaves without a confirm, "Got it" in the coach
  tip, "Edit Today", toast live region kept mounted.

## Measured (local, old main vs this branch, 60 ms added latency, demo household)
- Tick feedback: 136-138 ms to 3-4 ms.
- Today revisit: 10 API calls to 1; paint 132 ms to 53 ms.
- Today warm reload: 262-279 ms to 173-258 ms.
- Ask first sign of life: none until the answer (70 ms here only because
  no model key: an error) to 5 ms (typing dots).
- Quest, real trip, standing still: 24.8 frames/s to 0.

## Not done
- #11 two workers, #13 one three.js, #37 demo data cleanup: skipped (risk
  of regressions / needs the owner).
- Ask streaming (SSE): next step; the reply is JSON with actions, so it
  needs a streaming parser and streamed cost logging.
- #25 icons: Pillow's 256-colour quantize banded the shadows; needs
  pngquant on a machine that has it.

## Tests
Full Python suite green (1,520); web 415 tests green; build passes.
New: `tests/test_speed_audit.py`, `web/src/screens/optimistic.test.tsx`.
