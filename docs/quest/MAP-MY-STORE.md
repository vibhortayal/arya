# Map my store ("Teach Arya your store") — design

Owner, 2026-10-28: replace "take a photo or record a video" with a guided
mapper. Map only the aisles you use, over many visits. Many partial maps
merge into one store map. A "not found" or "map is outdated" asks for one
specific capture. The engine keeps the best images.
Wireframe (v2): `docs/quest/map-my-store-wireframe.html`. Code: `api/storemap.py`,
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
segments in one zone get one **walk** prompt (about 20 s, the phone sends its
6 sharpest of 12 sampled frames as photos; no video upload). Otherwise a
**photo** prompt (about 10 s). A stale prompt names the missing item.

## How contributions merge
One shared file per store (platform plane, like the stores directory).
Segments merge on `zone_key`: "Aisle 4", "aisle #4 - Pasta" are one zone;
other labels merge on normalized words, minus a trailing "shelf". Each
segment keeps its 3 best captures. Contributors are stored as a hash, never
the username. Demo visitors write to their sandbox overlay, never the shared
map.

## Framing (owner, 2026-10-28)
The shopper teaches Arya so Arya can help them: "Arya knows 64% of
Trader Joe's", and every capture says what it unlocks for you (a real
shelf photo in your next hunt). Helping other shoppers is the bonus.

## Capture: no retakes, ever
Owner: "I click pictures, then app says not good... this will cause
friction." So the shopper opens a live camera and the app does the work:
- **Photo:** the phone grades every frame (sharpness, light), shows one
  live hint ("Hold still…", "A bit dark. Face the shelf light."), and
  snaps the best frame after 1.5 s steady, or the best seen by 6 s.
- **Walk:** the sharpest frame of every 2 s is kept; no video upload.
- The server never refuses a shot. A weak one is kept as a **partial**
  (`weak: true`): the segment stays "aging", the next better capture
  replaces it, and the engine asks again on a later visit.
- If the people scrub fails, nothing is kept and the app says "No need
  to redo it." It never asks for a retake.
- Without a live camera (old browser, permission denied) the system
  camera is the fallback, under the same rules.

## Splitting a long aisle
The walk's length decides: about 8 s of walking per section, 1 to 6
sections. The app calls `POST /api/storemap/split` and spreads the
walk's frames over the sections in time order (front / middle / back,
or first half / second half). Parts keep the zone key, so sightings and
"not found" reports still find them. A split is idempotent: a second
shopper walking the same aisle fills the same sections. Old whole-aisle
captures are dropped on split; the walk that caused it fills the parts.

## When Arya asks
- **After a hunt:** one skippable card on the score screen ("Got 20
  seconds? Teach Arya Aisle 4. +10"). `GET /api/storemap/next?items=`
  puts an aisle where something on today's list was seen first. "Not
  now" mutes the store for 7 days (on the phone).
- **Can't find it:** a photo attached to the "Not here" report is
  ingested straight into the flagged section (no extra screen). Without
  one, the toast offers "Open camera". An item with no known aisle asks
  "Which aisle are you in?" as one tap.

## Rewards (no pressure)
+10 for a section that becomes mapped, +3 for a refresh or
confirmation. Titles: Scout 1, Pathfinder 5, Cartographer 15, Store
whisperer 40 sections. Each capture shows the store going from a% to
b% and the sections to the next 25% step. Credit is per account
(`map_credit.json`); nothing is ever taken away, and there are no
streaks or timers.

## How the engine chooses frames
All deterministic, $0, except two model calls per upload in the route:
SAM 3.1 people scrub (fails closed) and a "grocery shelf" box for fill.
1. Grade: sharpness (Laplacian variance), exposure (mean grey level),
   shelf fill. A weak frame is kept as a partial, never refused.
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
Item-level locations from captures (Muse Spark labels); automatic
`resolved` transitions for reports; stale flags expiring when no one
confirms; mapping silently from Find it for me frames during a hunt.
