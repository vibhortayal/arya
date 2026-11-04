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
- Server side (Opus review): Put back on a Got it row goes through `act()`, so
  it posts `/check checked:false` like the 5-second Undo. Revisit again calls
  the new `AppSource.unreport`, which posts `/withdraw-report`; that sets the
  report to withdrawn and drops this shopper's shared row, so it stops
  counting toward other shoppers' alerts.
- Tests: reducer (unreport, clear bonus), Play (both buttons restore items and
  call the source), AppSource (check false, withdraw-report).
- Not done (suggested by the UI/UX review): a toast with Undo after Put back.
