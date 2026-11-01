# Architecture — Arya Quest

Perception at the edge, reasoning in the platform, the game on the
phone. Two data planes never mix:

| Plane | Contents | Shared? |
| --- | --- | --- |
| Platform | Store maps: sections, shoppers' scrubbed aisle photos, sightings, opted-in shelf prices | Yes, with every player of that store |
| Account | Lists, receipts, patterns, spend | Never |

## Pipelines

### 1. Store mapping (platform)
`guided camera scan → SAM 3.1 people scrub → Spark reads the section, signs, prices → SAM shelf and sign boxes → store map sections`

The shopper pans; a frame goes up every few seconds. People are blurred
first and the frame is dropped if that fails. No store ships pre-mapped
(the old Trader Joe's walkthrough model was removed 2026-10-29); a
section counts as mapped only with a usable, fresh picture.

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
store: photos or shelf cards. Any stop can be grabbed in any order.
Shelf Scan and Find it for me
send a frame to `POST /api/quest/scan-shelf` (`?item=` aims at one
item): SAM 3.1 proposes boxes, Spark verifies each crop. Verified pops
are stored as sightings (item, store, shelf, time). A frame is kept as
a fresh shelf photo only after SAM finds every person and pixelates
them; if that step fails, nothing is kept.

### 5. Settle (account)
`receipt photo → Muse Spark → arithmetic check (flagged: Muse Wonder re-reads) → ledger, patterns`

Totals must reconcile or lines queue for review. Returns net against
purchases. The receipt banks the hunt's points; the original image is
kept in the account.

## Cost rules
- Math, routing, planning and patterns are code, $0.
- Spark (Contributor tier since 2026-11-01) for volume judgment; content sent to Spark may train Meta models.
- Engine spend caps: $10/day for the app, $2/day for the demo bucket.
- Find it for me scans one item: one item's SAM and Spark calls.

## Known limits
- Store permission and a photo opt-in policy are post-hackathon.
- No store ships mapped; coverage grows only from shoppers' scans.
