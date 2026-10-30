# 2026-10-30 — Quest colors: one job per color

Owner: "fix all" on the UI/UX pass (artifact 4xvL53GLpVAvUXrU6GQZ9h,
item 9), then "approved." on the mockup (artifact VSjtxY5hjsAofyAXVBf4bM)
with its recommendation to keep the blue 3D blueprint.

Before: Quest had its own palette (blue Simulated badges and Found it
here button, a teal walking bar and fog nudge, a purple Dream store
outline, black selected list chips), and some of it failed contrast:
"+10" 2.9:1, Mapped 3.5:1, Got it 4.1:1.

Now (game/game.css; written into DESIGN.md as the Quest sub-palette):
- Green #237A40 (pressed edge #17562C) only for grabbed or mapped: Got
  it, Found it here, Mapped, the "mapped" banner, done ticks, the fog
  nudge's Snap.
- Gold for the golden item only. Orange is the app accent (#C2410C).
- Everything else neutral: Simulated badges and the guess tag are
  #F1EEE8 with a #B8B2A7 dash, the walking bar is the panel fill, the
  selected list chip is outlined, Dream store has a neutral outline,
  and the simulated-store header fades to cream, not blue.
- Tags at least 11px (strip badge 9 -> 11, panel tag 10.5 -> 11);
  weights stop at 800.
- Kept: the 3D store's blue blueprint for a simulated store (blue there
  means "a guess, not a pin").

Test: tests/test_quest_palette.py.
