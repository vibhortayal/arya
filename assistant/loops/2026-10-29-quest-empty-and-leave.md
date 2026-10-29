# 2026-10-29: No empty quests, and Leave can end the quest

From the usability audit (pain points 1 and 2). An empty list still
showed "Start a quest", and picking a store created a session with no
items that then sat in Your trips as Resume. Leave in the 3D game only
left the screen, so the trip stayed open for good.

## Now
- `game/ui/Hub.tsx`: Start a quest and "Skip to a real quest" show only
  when the list has items. An empty list says "Your list is empty. Add
  what you need, or try practice." with Add items (opens the Lists tab).
- `game/QuestGame.tsx` and `screens/quest/appSource.ts`: a quest on an
  empty list is refused before any session is posted.
- `QuestSource.end()` (new, optional): marks the server session
  `abandoned`. The quit sheet of a real trip offers End quest (closes it),
  Keep it for later (the old Leave), and a note that grabbed items stay
  checked off. Practice keeps plain Leave.

## Tests
`e2e/questempty.e2e.mjs` (empty list, and End quest closes the server session); community and build specs now add an item
first, since a quest needs one.
