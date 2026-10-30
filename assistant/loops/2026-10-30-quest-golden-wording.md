# 2026-10-30 — Golden item: always from your own list

Owner: "'Golden Item' -> what is the logic? need to clarify to user that
it is from their list always, app is not pushing any items or ads".
Mockup (artifact M1sXdtfx7L67p4HDpZo79h); owner chose "mission card +
How to play, and refresh How to play".

Logic (unchanged, game/core/trip.ts pickGolden): one of the trip's own
items, picked at random by a seed, never one in fog. A trip's items are
the list the player chose (or Everything) plus what they add during the
trip; nothing else enters the pool. Practice uses its pretend list.

Copy (game/ui/Play.tsx):
- Mission card: "★ Golden: <item> · Picked at random from your list.
  Worth double." and "Arya never adds products or ads. No timer,
  nothing to lose."
- How to play, step 4: "Each trip, one item from your own list is picked
  at random and worth double. Arya never adds items or shows ads."
- Steps 1-3 now describe today's game: auto-walk and the list pictures,
  Got it / Can't find it / Later, Found it here.

Test: core.test.ts "the golden item is always one of the player's own
items".
