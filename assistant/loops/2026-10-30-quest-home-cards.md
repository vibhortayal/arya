# 2026-10-30 — Quest home: cards only when they matter

Owner approved the app-wide "show cards only when they matter" pass
("Yes, all of it", 03:49Z; mockup artifact KdXCaVPaLvhfXSu25LhrRS,
section 5 and the Quest rows). The Quest rows, in game/ui/Hub.tsx:

- Level chip, bar and "wk streak" in the hero: hidden until the player
  has shopped for real (a game trip, or any week the account shopped;
  `played(profile)` in core/meta.ts).
- Sticker album tile: hidden until the first sticker (no "0 of 20" with
  grey circles). The album screen itself is unchanged.
- "New here? Start with practice": only for a player who has never
  shopped and never practiced. The demo household (26 weeks of trips)
  now gets "Ready for a quest?" with its list; Practice stays as the
  ghost button.

Tests: src/game/ui/Hub.test.tsx; e2e/oneprogress still reads the level
and streak (the demo has played weeks).
