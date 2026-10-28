# 2026-10-27 — Shelf Scan demo slice (Discussion 37)

The unmapped-store mode, built to the feasibility spike's
measured spec (~/workspace/arya-3d/shelf-scan/REPORT.md). One
commit carries the still mode and the live frame-feed extension
(owner-approved follow-on) — the extension arrived before the
slice was committed, so they land together.

## Server — POST /api/quest/scan-shelf?session=<id>

- Stateless: one shelf photo against the session's REMAINING
  items; the frame is processed, never stored, for any account.
  Demo household: the door is in _DEMO_LIVE_DOORS (live calls,
  nothing persists — the same carve-out as the Photo door).
- api/shelfscan.py runs the spike's pipeline with its three
  fixes as requirements:
  1. SAM's TOP-3 boxes per item are verified in rank order
     (confidence, then area) — the cookies rescue.
  2. Box-area cap 0.35 of frame area: over-cap boxes are
     region candidates, tried only when no in-cap box exists,
     one deep, and a pop from one is graded "region".
  3. A per-item phrasing bank seeded verbatim from the spike
     (winners first — "rows of oil and vinegar bottles on a
     shelf" leads olive oil), a descriptive general fallback
     for unlisted items.
- Verify = Muse Spark 1.3 Standard on the crop (20% context
  margin, the spike's YES/NO instruction). SAM runs through a
  new MetaClient.segment() (/responses surface, box tokens
  parsed as the spikes parsed them); both models log spend to
  the cost ledger like every other door (SAM per image, Spark
  per token). Pillow joins api/requirements.txt for crops.

## Client — the scan view

- Entry: a camera button in the hunt's corner stack, present
  only on the Strip rung (renderHunt gates it on the driver);
  mapped (Cloud) hunts and Express never show it.
- The view opens LIVE first (getUserMedia viewfinder) and
  falls back to a still photo when the camera is unavailable —
  the still path (file capture → same endpoint) is unchanged.
- Live feed: still frames only, no video streaming. A 250 ms
  tick diffs a 48×36 downscale; a frame is sent when the scene
  changed materially vs the last sent frame (≥0.06 mean abs
  diff) and then held ~1 s — settle sends floored at one per
  3 s; a scene that never settles still sends at a ceiling of
  one per 2 s (only after a first send). One scan in flight;
  the send clock spaces the next frame. Pops overlay the live
  view and are replaced wholesale by the next scan; they clear
  early when the view has clearly moved on (diff ≥0.18,
  sustained). The bar shows "Live scan · Last scan <time>" —
  the ~4–8 s chain lag is visible, not hidden. A visible Stop
  ends the feed; closing the view or leaving the hunt releases
  the camera too. A screen wake lock is held while live where
  the platform allows, re-taken on visibility return.
- Pops are buttons over the photo/view: item grade solid,
  region grade dashed + "· this shelf". Tapping one collects
  through qCheck + qOnCollected — the same hook the GRAB uses,
  so the celebration fires identically when it lands.
- No-pop copy is the spike's honest sentence, verbatim:
  "Nothing from your list spotted here — that doesn't mean it
  isn't here. Keep looking." Nothing anywhere claims real-time
  or finds-everything.

## Verification

- Suite: **203 green** (9 new in tests/test_shelf_scan.py).
- Endpoint tests use stubbed SAM/Spark scripted from the
  spike's outcomes: pizza item-pop on the in-cap box despite a
  higher-confidence wall box, cookies rescued by the second
  box, pasta sauce rejected into not_found, olive oil region
  pop, cheese silent after its 4 bank phrasings, collected
  items never scanned, 404/415 guards, demo 404-not-403.
- The node harness pins the live policy over synthetic diffs
  (calm never sends; settle send at the hold mark; 3 s floor;
  2 s continued-change ceiling; stale-clear fires once per
  move), pop replacement, the exact no-pop copy, and — with
  mocked devices — stop releasing both camera tracks and the
  wake lock.
- Not verified here: a real camera or a live model call — the
  endpoint's live behavior is the demo account's phone pass,
  as with every door.
