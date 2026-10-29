# 2026-10-29: One level, one streak, one sticker album

Usability audit pain 6 / keep-or-cut call 2 (owner approved "keep one:
the server's; the game reads and writes it"). The demo showed "Lv 1 ·
0 wk streak" on the Quest home and "Level 1 · 0 pts · 26 wk streak" in
Settings: the game kept its own profile on the phone.

## Now
- `api/game_profile.py` + `GET/PUT /api/quest/game`: the game's profile
  (xp, weeks, stickers, ...) is kept on the server, validated and capped
  at 200 KB. GET also returns `base_points` (receipt-closed hunts) and
  every played week.
- `social.profile()`: points = hunt points + the game's xp; the streak
  counts receipt weeks, closed hunts and the game's weeks by the game's
  rule (two rest weeks). Same curve as the game (level n at 100·n(n-1)/2).
- `screens/quest/serverProfile.ts`: the game's ProfileStore. It shows
  the whole account (xp + base points, every week) and saves back only
  the game's part; a phone that played before carries its profile up
  once; offline falls back to the phone's copy. First-run flags stay
  on the phone.
- The game's album is the album: Your trips lost the old server Album
  row in #202. The receipt Score screen's "See my album" still opens the
  older receipt-sticker album; folding that in is left for after Nov 4.

## Tests
`tests/test_game_profile.py`, `serverProfile.test.ts`,
`e2e/oneprogress.e2e.mjs` (Quest home level and streak equal the
account's). Full e2e and Python pass.
