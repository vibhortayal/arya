# Architecture — Arya Quest

Perception at the edge, reasoning in the platform, the game on the
phone. Two data planes never mix:

| Plane | Contents | Shared? |
| --- | --- | --- |
| Platform | Store models: photos, point cloud, camera path, shelf graph, sightings, fresh shelf photos | Yes, with every player of that store |
| Account | Lists, receipts, patterns, spend | Never |

## Pipelines

### 1. Store mapping (platform)
`walkthrough video → frames → VGGT → point cloud + path → SAM 3.1 + Spark labels → shelf graph`

Frames at ~1 fps; VGGT infers poses and the cloud; SAM 3.1 segments
shelves; Muse Spark names the regions. The graph carries the game
logic; the photos and cloud carry the look. Shipped walk photos are
scrubbed of people with SAM (`harness/scrub_walk_frames.py`).

### 2. List and plan (account)
One Add surface (text, mic, camera, Muse connector) feeds one list.
Plan a hunt reads where each item was bought from the ledger
(`GET /api/quest/plan`, counting only, $0) and sorts the list for the
picked store.

### 3. The Optimizer
Runs after the store is picked. Merge repeats into quantities; correct
typos against the dictionary (shown, with Undo); ask when a name could
be two real products. Deterministic first; Spark only where code
cannot settle. A clean list skips the screen.

### 4. The hunt (client PWA)
Installable, works offline (grabs queue and sync). One store view per
store: photos or shelf cards; 3D peek. Stops follow the shelf graph;
any stop can be grabbed in any order. Where am I? matches a photo
against the walk index locally ($0). Shelf Scan and Find it for me
send a frame to `POST /api/quest/scan-shelf` (`?item=` aims at one
item): SAM 3.1 proposes boxes, Spark verifies each crop. Verified pops
are stored as sightings (item, store, shelf, time). A frame is kept as
a fresh shelf photo only after SAM finds every person and pixelates
them; if that step fails, nothing is kept.

### 5. Settle (account)
`receipt photo → Muse Wonder (Spark fallback) → arithmetic check → ledger, patterns`

Totals must reconcile or lines queue for review. Returns net against
purchases. The receipt banks the hunt's points; the original image is
kept in the account.

## Cost rules
- Math, routing, planning and patterns are code, $0.
- Spark Standard for volume judgment; personal data is Standard-only.
- Engine spend caps: $10/day for the app, $2/day for the demo bucket.
- Find it for me scans one item: one item's SAM and Spark calls.

## Known limits
- VGGT weights are non-commercial; a launch needs a license path.
- Store permission and a photo opt-in policy are post-hackathon.
- One aisle stretch is mapped; a whole store is rollout.
