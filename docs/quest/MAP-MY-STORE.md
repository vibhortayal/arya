# Map my store — design

Owner, 2026-10-28: replace "take a photo or record a video" with a guided
mapper. Map only the aisles you use, over many visits. Many partial maps
merge into one store map. A "not found" or "map is outdated" asks for one
specific capture. The engine keeps the best images.
Wireframe: `docs/quest/map-my-store-wireframe.html`. Code: `api/storemap.py`,
`pwa/mapper.js`.

## Coverage model
A **segment** is one side of one aisle, or one wall or freezer run. A store
map is its list of segments. Shoppers add segments ("Add an aisle"); a store
with a walkthrough (Trader Joe's) starts seeded from `shelf-graph.json`, one
segment per labelled zone, each with its walk frame as a baseline photo.

Status of a segment, from its best capture:
- **unmapped**: no capture, no baseline.
- **mapped**: best capture is 60 days old or less and no open flag.
- **aging**: best capture older than 60 days, or only a walkthrough baseline.
- **stale**: a "not found" or "outdated" flag is newer than the best capture.

Coverage is mapped segments over known segments. The denominator grows as
people add aisles, so the bar means "of what is known so far".

## Capture prompts
`next_prompt()` returns one capture: kind, title, why, numbered steps, time.
Order of need: stale, then unmapped, then aging. The shopper's **focus**
("Mine" aisles, saved per account) is served first. Two or more unmapped
segments in one zone get one **walk** prompt (about 20 s; the phone sends up to 6 good frames
as photos; no video upload). Otherwise a
**photo** prompt (about 10 s). A stale prompt names the missing item.

## How contributions merge
One shared file per store (platform plane, like the stores directory).
Segments merge on `zone_key`: "Aisle 4", "aisle #4 - Pasta" are one zone;
other labels merge on normalized words, minus a trailing "shelf". Each
segment keeps its 3 best captures. Contributors are stored as a hash, never
the username. Demo visitors write to their sandbox overlay, never the shared
map.

## How the engine chooses frames
All deterministic, $0, except two model calls per upload in the route:
SAM 3.1 people scrub (fails closed) and a "grocery shelf" box for fill.
0. **No retake, ever** (owner, 2026-10-28). The capture screen is a live
   camera with no shutter. The phone grades frames as they stream
   (sharpness, light), shows one short coaching line ("Slow down a little",
   "A little dark. Face the shelf light."), and sends only frames that pass.
   A photo prompt waits for a steady, sharp view and takes it itself; a walk
   keeps up to 6 spread-out frames. The screen finishes by itself and opens
   the next capture. Anything the server still declines is dropped silently;
   after 30 s with nothing usable the shopper is thanked, not asked to retry.
   Without a camera, the phone's camera app takes one photo and the shopper
   is thanked either way.
1. Server grade before any model call (same thresholds): sharpness (Laplacian
   variance), exposure (mean grey level), shelf fill. A weak frame is dropped.
2. Score = 0.5 sharpness + 0.3 exposure + 0.2 fill (fill is neutral if the
   check failed).
3. Value = score x freshness; freshness halves every 30 days.
4. Same view as a kept capture (dhash distance 6 or less) is a
   **confirmation**: it refreshes the old capture's date, and swaps the image
   only if clearly sharper (+0.05). That clears a stale flag.
5. Keep the top 3 by value. The best one is shown for that segment.

## Refresh loop
`POST /api/storemap/outdated` or a "Not here" report marks a segment stale.
For an item, the segment is where the item was last seen (`note_sighting`
from Find it for me). If unknown, the item is parked as unplaced and the
shopper is asked which aisle they are in. The report response carries
`map_task`; the app offers "Take the photo".

## Privacy
Only scrubbed frames are kept. No opt-in screens yet (deferred by the owner
for the hackathon). Raw frames never touch disk.

## Not built yet
Splitting a long aisle into several segments; item-level locations from
captures (Muse Spark labels); rewards for mapping; automatic `resolved`
transitions for reports; stale flags expiring when no one confirms.
