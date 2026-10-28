# Photo-walk driver — 2026-10-27

Job 5 of the Oct 27 queue (after receipt-image retention),
folding in the urgent localizer amendment. Owner decision
(2026-10-27 22:22): "photo walk" — after the splat spike's
NO-GO verdict (pose drift; parked until pose refinement),
the photo-walk becomes the DEFAULT view for mapped stores.

## What shipped

- **Assets**: the prototype's web tier ships in the app —
  `pwa/models/trader-joes/frames-web/` holds all 90 frames
  (1600x900), **17.45 MB total**, under the ~20 MB guide (no
  tightening needed). Initial load: the driver preloads -1/+4
  around the current frame at open = the first 5 frames =
  **~1.27 MB** (the prototype's ~1.3 MB), then widens to the
  rolling -2/+5 window (~1.5 MB in flight) as the walk moves.
  Frames are runtime cache only, never precached (pinned).
- **Driver** (`SceneDrivers.photo` in pwa/scene.js): the
  prototype's treatment rebuilt in app conventions — sharp
  frame over a blurred fill of itself, two-img crossfade
  (0.45 s), stop dots on the frame track placed by path
  fraction, the next stop's shelf label as a chip, gyro look
  panning within the (slightly zoomed) frame, glide between
  stops on the cloud's duration curve. `photoFrameForU(u)` =
  round(u x 89) reproduces the prototype stops.json frame for
  all 18 stops exactly (node-tested). No frames directory ->
  the driver falls back to strip in place, like the cloud.
- **Defaults** (`qResolveDriver` in pwa/quest.js): the stored
  toggle choice wins when the store can serve it; else the
  session's rung — with two defaults corrected: a session
  recorded under the old mapped default (cloud) opens in
  photo, and a "strip" recorded for a mapped store counts as
  the silent server/legacy default, not a choice (a real
  strip preference lives in the toggle), so it too opens in
  photo. Session creation for a store with a walk now records
  "photo". Mid-hunt switching mounts the new driver and
  re-renders — no state or check traffic (pinned).
- **Honest labels**: the toggle chip reads "Photos"; the
  unmapped map note now invites mapping to "unlock its photo
  walk and 3D view"; nowhere is Photo called a 3D model or a
  live view (pinned in tests).

## The localizer amendment (folded in here per instruction)

"Where am I?" gating moves from Cloud-only to **any hunt in a
mapped store** (Photo or Cloud driver): the anchor is a path
fraction, driver-independent, and qAnchorToU already drives
setProgress, which the photo driver honours. Shelf Scan stays
Strip-only, so the two corner buttons still never coexist.
Verified live: in a Photo hunt the compass button is visible
and Shelf Scan hidden.

## Verification

- tests/test_photo_driver.py (7 tests): node frame-mapping
  against the prototype's 18-stop table; node driver
  resolution (mapped default, legacy cloud, recorded-strip
  correction, stored-choice wins, unmapped fallbacks);
  asset completeness/weight/initial-window; no precache;
  wiring pins; switch-preserves-session; honest labels.
  tests/test_localizer.py's gating pin updated to the new
  rule. Full suite: **260 passed** (was 253). SW arya-v29.
- Live smoke (headless Chromium, local server): a Trader
  Joe's hunt opens pressed on the Photos rung, frame f034
  (the Pasta Sauce stop's own frame) loaded in .photoview with
  the chip reading "Pasta Sauce Shelf", 3 stop dots, the
  arrival pop over the real aisle photo, locate visible /
  scan hidden.
- Docs: DISCUSSION 43; UX.md scene ladder rewritten to four
  drivers; docs/quest/README.md game bullet; STATUS section.
