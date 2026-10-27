# 2026-10-27 — Quest Stage C: the cloud driver (VGGT point cloud in the PWA)

The 3D spike's reconstruction is now a playable SceneView rung.
Owner go-ahead for the Stage B follow-on was given in chat
("build the playable game UI, plug in the 3D when the spike lands").

## C1 — data prep (`41cf728`)

- `assistant/tools/prep_cloud.py` (new `assistant/tools/` home, pure
  stdlib): VGGT PLY + poses.json -> `pwa/models/<store>/`:
  `cloud.bin` (positions uint16-quantized against bounds, then
  uint8 colors; 9 bytes/point) + `manifest.json` (count, layout,
  bounds, smoothed camera path). Master PLY untouched.
- Trader Joe's shipped asset: 1,200,000 -> **373,630 points**,
  3,362,670 bytes. Voxel decimation, binary-searched edge.
- Path cleaning: poses 19, 51, 57, 58, 59 dropped as spikes
  (deviation from the neighbour line + detour ratio). Two earlier
  rules failed on this data and are documented in the code: a
  step-magnitude rule cascades (VGGT scale drifts between aisle
  legs; fast walking is real), and a plain detour rule eats turns.
  Shipped path: 164 samples, max step 0.0885, length 6.82; two
  residual ~1.05–1.09 gaps are interpolated by the resample and
  crossed at walking speed. 91.8% of sampled cloud points lie
  within 0.30 (plan view) of the shipped path.

## C2 — driver + wiring (`3f562d3`)

- `scene.js`: the cloud stub is now the real driver. A proxy owns
  the contract: loading view -> the Three.js view on success ->
  strip in place on any failure (missing asset, no WebGL); the
  Hunt screen never hard-fails on a model. The real view: vendored
  Three.js 0.160 (`pwa/vendor/three.module.js`, sw arya-v14
  precaches it), points from the manifest buffers, numbered canvas
  sprite markers anchored along the path alternating shelf sides
  (green check when collected, amber badge when flagged), the next
  stop pulses, `glideTo` walks the camera along the path with the
  look target lerping to the stop, drag looks around (tap vs drag
  discriminated), tap raycasts sprites to `onTapStop`. Animation
  time comes from the RAF timestamp.
- Wiring: `quest.js` `STORE_MODELS` maps the squashed store name
  "traderjoes" -> the TJ manifest; `mountScene` passes it via
  `el.dataset.model`; the 3D toggle button (was a disabled
  placeholder) is enabled only for modeled stores; new TJ sessions
  start on cloud, reopened sessions return to their recorded rung;
  the hunt map note names the model instead of saying none exists.
  Strip stays the default everywhere else.
- Verification found and fixed a real bug: `adopt()` destroyed the
  loading view *after* the successor was built, and the loading
  view's destroy cleared the host — wiping the successor. Loading
  destroy is now a no-op; constructors own the host.

## Verification

- Suite: **83 green** (78 + 5 new in `tests/test_cloud.py`: prep
  pipeline on synthetic PLY/poses with a planted spike, decimation
  band, shipped-asset band/layout/path-smoothness, cloud session
  for Trader Joe's). `node --check` clean on all PWA scripts.
- Headless Chromium (SwiftShader) against the real asset, harness
  in `~/workspace/arya-3d/serve-check/` (scratch, not repo):
  the cloud renders with shelf/product color; numbered markers
  2/4/7 readable in frame; a queued `glideTo` demonstrably moves
  the camera (instrumented build logged cursor 0 -> 0.49 with the
  glide progressing; a completed short hop reframed the scene);
  a bogus model URL falls back to strip cards with no error.
  Frame budget in that environment is tiny (~30–60 RAF frames per
  run), so long glides were verified by instrumentation + the
  short hop rather than a full-length capture.

## Not done / next

- Not deployed — deploy is the owner's separate step (git pull).
- Point size/FOV are first-pass values from the headless renders;
  tune on a real phone during the Stage B device check.
- Next stages unchanged: SAM 3.1 shelf graph for stop placement
  (markers currently anchor by path fraction), Brain restyle after
  the wireframe verdict.
