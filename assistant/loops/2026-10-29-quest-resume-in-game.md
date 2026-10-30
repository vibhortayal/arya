# 2026-10-29: Resume a Quest trip in the Quest game

Usability audit pain 3: Your trips › Resume opened every open trip in
the old hunt screen (photos, 3D cloud, Boss items), so a trip started in
the 3D Quest came back as a different game.

## Now
- `screens/Quest.tsx`: an open Quest trip (mode quest, not a Shop-Off)
  resumes with `nav.show("community", { resume: id })`. Express and
  Shop-Off keep their screens; closed trips open their Score.
- `QuestSource.resume(id)` (optional) and `appSource.resume`: reads the
  session, rebuilds the layout and hints for its store and items (shared
  `lay()` with `open()`), and returns the keys already checked.
- `QuestGame` (prop `resume`): opens the trip with those items in the
  cart; anything the game cannot play falls back to the Quest home.

## Tests
`e2e/questresume.e2e.mjs`: grab one item, Keep it for later, Resume from
Your trips, back in the game with "Cart: 1 of N". Full e2e and Python
pass.
