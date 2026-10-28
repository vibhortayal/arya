# 2026-10-28 — game shell, part 1: install, mobile, keyboard

Owner brief: make Arya Quest a complete, installable, offline,
mobile-first game inside Arya. Plan (state machine, loop, assets):
Claude Doc "Arya Quest game shell: state machine and asset plan".
The in-place vs. lives vs. separate-game call is with the owner; this
part is common to every option. Branch `feat/game-shell`, on top of
`fix/hunt-v2-rebuild`.

- Manifest: id/scope, standalone, light colors (#EFEFF1, matching the
  theme-color meta), 192/512 PNG icons and a maskable 512 (glyph in
  the 80% safe zone), plus an Apple touch icon and install metas.
  The icon moves from the old green to the app accent #E4572E.
- Hunt gestures: `body.hunting` is `touch-action: pan-y`,
  `overscroll-behavior: none`, `min-height: 100dvh` — no pinch or
  double-tap zoom, no pull-to-refresh mid-hunt; zoom stays available
  everywhere else (no maximum-scale in the viewport meta).
- Keyboard: Space/Enter start or grab, ←/→ aim at the previous/next
  open stop, P pause, F Finish, Esc Back (hunt, Express, Finish; an
  open sheet keeps Esc). Keys press the buttons the screen already
  has, so no rule is bypassed.
- Service worker arya-v37 pre-caches the icons.

Verification: suite 357 OK (1 skipped), new `test_pwa_install.py`;
Playwright keyboard drive on the demo household — all checks passed.
