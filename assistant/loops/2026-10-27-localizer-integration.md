# Localizer integration — "Where am I?" (2026-10-27)

Discussion 34's spike, integrated: the Wonder-authored localizer
is now the mapped hunt's position anchor. In a Cloud hunt, the
corner stack carries a **Where am I?** button (drawn compass) in
the same slot Shelf Scan uses on the Strip rung — the two never
show together. A photo is matched locally against the store's
walkthrough index; on a match the hunt anchors (position jumps
to the nearest stop, the follow resumes from there, the anchored
stop is presented) and a toast says "Placed you at <shelf
label>". On no match: "Couldn't place that photo — keep
following the route." Manual navigation is untouched.

## What shipped

- **Matcher: vendored verbatim.** `api/localizer.py` is Wonder's
  round-1 spike code (`~/workspace/arya-3d/localize-spike/
  localize.py`) with an attribution header inside its module
  docstring and exactly two path adaptations: `DEFAULT_INDEX_PATH`
  points at the shipped artifact, `DEFAULT_INDEX_DIR` at a frames
  directory that does not exist in this repo, so the matcher's
  build-on-miss fallback can never fire on a server (a missing
  artifact is a null match → `no_index`). The algorithm — SIFT +
  RootSIFT, Lowe ratio vs first non-local competitor, RANSAC
  verification, score-weighted interpolation — is unchanged.
- **Index artifact.** `tools/build_localizer_index.py` runs the
  build over the 90 walkthrough frames, then (build step only,
  never in the matcher) subsamples descriptors per frame and
  saves compressed. Shipped: **cap 400 descriptors/frame, 36,000
  total, 10,593,628 bytes (10.6 MB)** at
  `assistant/models/trader-joes/localizer-index.npz` + a manifest
  JSON (frame count, build date, spike numbers). The
  full-descriptor uncompressed index was 38.4 MB — over the
  ~25 MB guide; the subsample is what the eval below proves.
- **Server.** `POST /api/quest/locate?session=<id>` (new
  `api/locate.py`): the query is resized to 1036 px wide (the
  index frames' width) with Pillow, then matched. Only Trader
  Joe's has an index (keyed by store display name, normalized
  exactly as the shelf matcher keys its graphs); any other store
  or a missing artifact answers `{found:false,
  reason:"no_index"}`. No model or API calls in this path —
  spend $0 — and the photo is processed, never stored. The demo
  household may use the door (position is ephemeral hunt state,
  like a collect): `/api/quest/locate` joined `_DEMO_LIVE_DOORS`.
  Deps added to `api/requirements.txt`: `opencv-python-headless`,
  `numpy`.
- **Confidence gate: 0.60.** Below it (or no estimate) the answer
  is `{found:false, reason:"low_confidence"}` — a wrong anchor is
  worse than none. The gate sits below every observed true
  placement (below).
- **Client anchor.** `qAnchorToU(u)` snaps u to the nearest
  session stop by `shelf_u`, clears the follow hold, re-bases
  step-advance at u (like a collect), jumps the scene cursor,
  and presents the anchored stop — or, if it is already in the
  basket, the next uncollected stop ahead of it.

## Proof — held-out eval, shipped artifact vs the spike

Same 45 held-out frames (t=240.5…329.5, never indexed), run
through the vendored code path against the **shipped** artifact
(`tools/eval_localizer.py`, path adaptation only):

| Metric | Spike (full index) | Shipped (cap-400, 10.6 MB) |
|---|---|---|
| Stop accuracy | 42/45 (93.3%) | **42/45 (93.3%)** |
| Neighborhood accuracy (\|Δu\| ≤ 0.03) | 45/45 | **45/45** |
| Median \|Δu\| | 0.00268 | 0.00299 |
| Confidence range (held-out) | 0.79–0.88 | 0.635–0.873 |
| Latency per query | 1.27–1.60 s | **0.97 s mean** |

The subsample holds the spike's numbers exactly on stop and
neighborhood accuracy. Latency measured on this build machine
(Hatch VM, x86_64, 2 vCPU) — the Oracle VM is the same class of
host, so ~1 s per locate is the honest expectation there; the
spike's 1.3–1.6 s was the full index on its run host. The gate
(0.60) sits below the shipped run's observed floor (0.635).

## Tests

- Suite: **232 green** (12 new in `tests/test_localizer.py`):
  endpoint with a stubbed matcher (found incl. the 1036 px
  resize proof, low-confidence both ways, no-index never calls
  the matcher, 404/415/400 guards), the demo carve-out (door
  live for the demo household), the artifact (loads, 90 frames,
  < 25 MB; skips cleanly without cv2), a real-matcher check on
  two held-out frames (both placed within ±0.03 of truth —
  runs when cv2 + the spike held-out set are present, skips on
  the VM), client shell pins, and a node harness for the anchor
  jump (position, follow resume, step re-base, the
  already-collected case).
- SW cache **arya-v25**. Shelf graph untouched (the duplicate
  Frozen Pizza stops stay; the session-stop snap absorbs them).
  **Not pushed, not deployed** — parent reviews and ships.

## Addendum — gating amendment (2026-10-27, photo-driver stage)

The Cloud-only gating written above was superseded the same
night by the owner's photo-walk decision (Discussion 43):
"Where am I?" now shows on any hunt in a mapped store —
Photo or Cloud driver — because the anchor is a path
fraction, driver-independent. The btn-locate pin in
tests/test_localizer.py was updated to the new rule in the
photo-driver commit; Shelf Scan remains Strip-only, so the
corner slot still never shows both.
