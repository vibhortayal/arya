# 2026-10-29 — Express mode: Arya's help, no game

**Ask (owner, 2026-10-29).** After the list is ready, the shopper
chooses Quest or Express. Express keeps the help Quest gives (aisle and
shelf image, report out of stock or wrong aisle, camera find, data that
feeds the store map) without the characters, points or badges, and ends
with the same receipt and haul share. Follow-ups: "give the option to
ask for the image, otherwise keep it clean like a simple grocery list
app"; "no See it in 3D"; "no i button for now". Wireframe approved
first (standing rule): https://claude.ai/artifact/6Vhf3TWkpRpW65WnTBmcAN

**What changed.**
- Express is a plain checklist in walking order. The next item carries a
  help row: Show me (the Quest store photo, only when asked; shelf card
  for a store with no photos), Not here? (the Quest report sheet) and
  Find with camera (the Quest Shelf Scan). More help opens Ask Arya and
  Teach Arya. No strip view, 3D, points, faces, combo or sound.
- The shelf scan overlay and the Not here sheet moved out of the hunt
  view so both modes can open them. A scan grab or a report repaints
  whichever mode is open (renderCurrent).
- Report sheet: new "It is in a different aisle" kind (wrong_aisle).
- Express finish: no haul points, level, album link, friend challenge,
  badges or character art, and no "+50 bonus" line. Receipt, haul card,
  receipt check and Share your haul stay.
- Mode chooser says what Express keeps and drops.
- SW arya-v80.

**Left out on purpose.** "Where am I?" stays Quest-only (it needs the
walking-photo tracker). A shelf photo on a report goes through the
existing camera offer after the report, not a separate upload. The
"Start shopping" entry on the list waits for the List overhaul (PR #105).
