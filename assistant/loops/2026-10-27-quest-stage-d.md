# 2026-10-27 — Quest Stage D: the shelf graph (SAM 3.1 + Spark labels on the cloud path)

Stage C's cloud stops were the demo item set placed along the
walk; Stage D grounds them in the real shelves: what the camera
actually saw at each path position, segmented by SAM 3.1 and
labelled by Muse Spark 1.3 Standard. Build + test + commit
only — no deploy (owner step, git pull on the VM).

## API shape (pinned by probes before the run)

The connector helper has no SAM command, so the calls were
pinned from Meta's official `meta-sam` protocol repo and three
live probes ($0.0075):

- SAM 3.1: `POST /v1/responses`, model `sam-3.1`, one noun
  phrase per call (`input_text` + `input_image` data URI),
  `metadata.include_confidence`. Reply output_text carries the
  SAM wire format: `<Nf>` then per-instance
  `<|box;...|><|mask;...|>` records. Box fields are
  inclusive-pixel `x1 y1 x2 y2` + instance size `w h` (NOT the
  frame size) + confidence `c`. `usage.images_processed`
  bills at $2.50 / 1,000 images.
- Labels: Spark via `/v1/chat/completions` with the same
  image_url data-URI part shape the decode/eyes services use;
  price via `api.meta_client.estimate_cost("standard", ...)`.

## D1 — builder (`a7c8ef2`)

- `assistant/tools/build_shelf_graph.py`: frames = every 5th
  pose (u = arc-length fraction along prep_cloud's kept pose
  polyline, so graph stops and the driver path share one
  frame); SAM segments pooled per frame; side from the pose
  geometry (ray through the box centroid; VGGT world is y-down,
  and prep_cloud's (x, -y, -z) conversion is a proper rotation,
  so left/right survive into driver space); clustering = per
  side, horizontal bands in normalized center-y (gap > 0.16
  splits), area/confidence filters (0.004–0.65 of frame, SAM
  c >= 0.40), cap 6 regions/frame by merging nearest bands;
  each region labelled from a padded PIL crop with a JSON-only
  prompt. Labels are proposals: the graph stores `label`,
  `labelConfidence`, and `rawLabel` verbatim; an unparseable
  reply keeps label null. A Spend class enforces the cap
  before every call ($2.00 default).
- 14 fixture tests (wire parser incl. mask payloads, side
  geometry, banding/filters/cap, graph assembly, path
  fractions with a planted spike pose, label-reply parsing).

## The run

18 frames (poses 0,5,...,85 — none in the dropped set), 36 SAM
images, 614 pooled segments -> 55 regions, 55 Spark calls.
**Actual spend from API usage: $0.2414** (SAM $0.0900 +
Spark $0.1514; Spark usage in 16,047 / cached 4,752 / out
32,137 tokens) — 12% of the $2 cap.

Walk-order sanity (known: cheese wall -> pasta sauce ->
honey/syrups -> bread): cheese at u=0.000–0.024, pasta at
0.266, pasta sauce at 0.368, bread & bakery at 0.479–0.568,
frozen pizza wall at 0.889–0.908, dairy/dips at the end.
The honey/syrup stretch (u ~0.32–0.44) was read as condiments,
hot sauce, and peanut butter & jam at crop granularity — no
label was invented to fill it; 14 regions carry Spark's own
"Unidentified Shelf" (low) wording, stored verbatim.

## D2 — shipped graph (`3e10b45`)

- `pwa/models/trader-joes/shelf-graph.json` committed with a
  run block (calls, token usage, cost). 3 shipped-data tests:
  shape/path invariants vs the manifest, labels-as-proposals
  provenance, walk-order sanity.

## D3 — read side (`20fe982`)

- `scene.js`: buildCloudView fetches shelf-graph.json beside
  the manifest (any failure -> null). cloudView shows a
  `.cloud-shelf` chip with the label of the graph stop nearest
  the next stop's anchor (within du=0.055), preferring the
  shelf on the marker's own side (even markers sit left).
  Updated on setStops/setNext. Stop placement, glide, and
  scoring untouched; strip/aisle drivers untouched.

## Notes

- Test-count archaeology: the suite reads 116 during this
  stage because the intake-parity work landed concurrently
  (its logs say the same). Stage D adds 17 tests of its own
  (14 builder + 3 shipped-data); everything green at every
  commit.
- Next: deploy (owner step) + a real-device look at the chip;
  label quality could get a second pass later (tighter crops
  for the jar walls) — not needed for the demo.
