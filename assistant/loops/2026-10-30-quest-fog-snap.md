# 2026-10-30 — Fog nudge: snap a shelf inside the game

Owner: "small nudge at shopping is fine. It shouldn't take up the whole
screen"; mockup (artifact AXxAsedDfnGzj577dBujyN) then "build both in one
go, I want to test the in game snap".

Before: "Found it here" in a fog section only told Arya the section
name, and a grab in a guessed section told it nothing about the shelf.

Now:
- After a find in a section Arya has not located (a fog find, or a grab
  in a guessed section), one line beside the map button says "Spotted in
  Aisle 2! Snap the shelf to clear the fog for good." ("Found in ... put
  it on the map" at a store nobody mapped). Once per section, gone after
  8 seconds or when the shopper walks on; two ✕ stop it for the trip.
  Real trips only; practice never nudges and never writes.
- Snap opens the phone camera with a file input (capture), so the trip
  never leaves the game. The photo is cut to 1600px and sent to
  /api/storemap/scan (Map my store's guided scan: people blurred first
  or nothing is kept, the reader names the section, daily frame cap),
  at the same map address the game's fog reports use (mapRef).
  The nudge then says it is on the map, or why not, with Retry.
- Finish: "Clear the fog you spotted" (or "Map the shelves you found")
  lists up to four of those sections with Snap each; "Map the whole
  store" stays under it. Sections snapped in the store show as done.

Game side: Trip.snapped, the "snapped" action, unmappedFinds(trip);
QuestSource.snap (AppSource implements it).

Tests: core.test (finds, snapped), Play.test (nudge, snap ok, refused
with Retry, practice), e2e/fogsnap (real trip, in-game snap; this
runtime has no reader key so the scan refuses and the nudge says why).
