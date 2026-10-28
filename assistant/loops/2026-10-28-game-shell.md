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

# Part 2: rewards — dopamine, never pressure

Owner ruling (same day): mobile first (keyboard is demo-only), no
lives or game over, no stress; upgrade the existing hunt, no new
game; keep feeding the four data purposes. Wireframes for review:
the "Arya Quest game flow wireframes" canvas (11 screens).

- Server: `social.hunt_points` (+10 per item, +25 full haul, +50
  receipt) and `social.level_for` (L2 at 100, L3 at 300, L4 at 600,
  +100 more each level); `/api/quest/profile` carries points and
  level. Points bank only for receipt-settled hunts (Discussion 41:
  the receipt is the proof); an unsettled hunt shows them waiting.
- Hunt HUD: a points chip replaces the clock on the Quest HUD (time
  still shows on Score); every grab floats +10 and bumps the chip;
  banners at 1/4, 1/2, 3/4; a cosmetic hot streak at 3+ quick grabs;
  all collected = banner, confetti, fanfare, +25. Express stays
  quiet (Discussion 32).
- Score: the haul counts up; banked hunts fill the level bar and a
  new level bursts; unsettled hunts say +50 waits for the receipt.
- Today shows a level chip; Profile gains a Level tile.
- Sound (Web Audio square blips) and buzz (vibrate) are opt-in via
  the HUD speaker, off by default, remembered per device.
- Confetti is one canvas on one rAF loop, ~1.8s, theme colors only;
  reduced motion drops floats, banners' motion and confetti.
- Rewards are wrapped so a missing API never fails a grab.
- Service worker arya-v38.

Verification: suite 365 OK (1 skipped); new `test_points.py`,
`test_rewards.py` (node: milestones in order, one burst, put back
recounts, Express quiet, sound off by default). Playwright drive on
the demo household: every check passed (HUD points, +10 float,
milestones, confetti shows and hides, Score 65 → banked 115 with the
level bar, Today level chip).
