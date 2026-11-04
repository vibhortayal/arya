# 2026-11-04 Put back on the Quest List sheet

Owner approved the mockup (https://claude.ai/artifact/EZKPctWJ55ydcAgSxg311h)
and chose "Tap List" wording and Put back on shelf empty rows.

- `game/core/trip.ts`: new `unreport` action. It clears a shelf report
  (shelf empty or somewhere else) and takes back a clear bonus that the
  report earned, like `ungrab` does.
- `game/ui/Play.tsx` ListSheet: a 44 pt Put back button on Got it rows and
  Revisit again (owner's wording) on shelf empty / somewhere else rows; a swapped row reads "took X instead". How to play gets step 2,
  "See every item".
- Help (shopping topic s4, quest card s3), Ask knowledge, README line.
- A shelf report already sent to the store map is not unsent; Put back only
  clears it on this trip.
- Tests: reducer (unreport, clear bonus), Play (both buttons restore items).
- Not done (suggested by the UI/UX review): a toast with Undo after Put back.
