# 2026-10-30 — Start shopping goes straight into the store; 44pt targets

Owner: "fix all" on the UI/UX pass report (artifact
4xvL53GLpVAvUXrU6GQZ9h), items 3 and 6. Neither needed a visual call.

3. Start shopping took 5–6 taps: a "Shop Costco" sheet with one Quest
row, the Quest lobby, "Start at Costco", then "Where are you shopping?"
asking for Costco again. Why: the list says "Costco", the store is
"Costco Wholesale", and the exact name match failed, so the auto-start
gave up and left the player in the lobby, and the lobby sent them to
the picker.
- game/QuestGame.tsx: the list's store matches ignoring case and
  punctuation, then by prefix ("Costco" finds "Costco Wholesale"), then
  the first search hit. Start shopping now lands in the store.
- screens/Lists.tsx: in Demo Town the sheet opens only when the list's
  store is closed or has an incident (`storeTrouble` in ui/Town.tsx),
  so the store notice still shows when it has something to say.
- A first-timer still gets practice first (unchanged).

6. In-store tap targets were 28–38pt. Each is now at least 44pt with
the same look (game/game.css, end): strip chips are 40x44 buttons with
the 30px tile drawn on the picture; the Map it cue, "List · N left" and
the header icons reach out with an invisible ::before.

Test: e2e/shopgo.e2e.mjs (fails on main at the picker, passes here).
