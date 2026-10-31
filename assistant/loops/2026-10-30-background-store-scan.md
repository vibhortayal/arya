# 2026-10-30 — Map my store: full-screen walk, read in the background

Owner report: the scan started outside the store, found nothing, then quit as soon as it found one shelf ("kicked me out") and sat on "Reading the shelves and building the map…". Owner direction: coaching only while walking, process in the background, tell me later; frames must survive no signal; photo mode stays instant; offer upload of an own recording. Mockup FUb4AYjHUUVUWMVKdYTQcZ approved ("approved. build with the fixes").

## Root causes (old Capture.tsx)
- `WALK_MAX_MS = 45000` ended the walk at 45 s with no countdown; `SCAN_FULL = 10` ended it too.
- Each live frame ran 4-5 model calls in series and only one was in flight, so ~3-4 reads per 45 s.
- With 0 kept frames, Done fell into the old `teachSend`: 6 frames re-sent one at a time behind "Reading the shelves…", no camera, no way out.
- Two failed reads silently switched live reading off.
- The camera was a 3:4 box (max 62vh).

## Change
- Capture: a teach walk is now full screen (tab bar hidden), coaching only (Good, keep going / slower / dark / glare), a timer, a first-time tip to pan across the aisle signs, Done as the only exit (nudge at 4 min, stop at 6). The sharpest frame of each 2 s is saved to IndexedDB at once; a frame showing what the last did is skipped. No live reads.
- lib/scanQueue.ts: walks on the phone; after Done, and whenever the app opens or comes back online, opens a job, sends frames one by one, deletes each once the server has it, commits. Long walks keep an even spread of 40.
- api/scanjobs.py + /api/storemap/jobs (create, PUT frame, commit, list, seen): frames wait under the account's folder and are deleted as read; one worker thread reads 3 frames at a time with storescan.read_and_keep (same privacy order as the live scan: scrub first, fail closed); jobs are listed in the data root and resumed at start. Demo visits keep frames in memory and run in the visit's context.
- storescan.read_and_keep: the live scan route's per-frame pipeline, now shared.
- Map my store: card for Saved on your phone / Sending / Building your map / Your map is ready (Check the N sections opens the confirm sheet with Not a section ✕). "Upload a video or photos": consent tick, frames picked on the phone (video never uploads), same background job.
- Quest home row says when a map is building or ready; a toast anywhere when a walk finishes.
- In-game Snap and Snap the aisle still use the instant routes.

## Tests
tests/test_scanjobs.py (8): summary, seen, scrub failure keeps nothing, missing frame, caps, bad requests, no key keeps the walk on the phone, resume after restart. e2e/scan.e2e.mjs rewritten (full screen, no live reads, frames sent, ready card, check sheet). e2e capture, mapper, mapstore, fogsnap, home, album, quest-progress pass. Vitest pass (scanQueue spread added; scanBox test removed with the live overlay). Full unittest suite: green.

## Not measured
Real read time and cost per walk need the Meta key on the VM: about 4 calls a frame, 40 frames max.
