# 2026-10-27 — Motion navigation (Discussion 33)

Built against the SceneView interface (setLook / setProgress), so
every driver benefits and no driver forks: Cloud/Aisle rotate the
camera, a photo-style driver pans across its frame, Strip pans.

Landed AFTER the navigation-first hunt (Discussion 35/36) by owner
reprioritization — gyro was demoted to last/optional, so its
controls re-homed into the hunt's trip panel (the explore-mode
home) instead of the hunt screen itself, which Discussion 36
reserves for store + up-next + progress.

## What changed

- **SceneView contract:** setLook({yaw, pitch}) and
  setProgress(u) on all three drivers. The cloud driver queues
  calls made before its model loads and no-ops safely when only
  the loading view is up.
- **Gyro look-around:** one-tap enable ("Look around with your
  phone", iOS permission gesture; Android no prompt). The first
  reading becomes the baseline; turning the phone turns the view.
  Manual input suspends gyro for 2.5 s; no sensor or a denied
  permission retires it silently — today's behavior, no error
  noise. Pure mapping math (MotionMath) is shared and unit-pinned.
- **Step-advance EXPERIMENT:** behind the `arya-steps` flag,
  default OFF. A peak detector over devicemotion (HI 12.0 /
  LO 10.6, 300 ms refractory) advances the path fraction u by a
  stride estimate; every COLLECT re-anchors u to that stop
  (collects are ground truth); any manual navigation holds
  step-advance until the next collect.

## Simulated behavior (headless, synthetic step events)

22/22 node-harness checks: heading wrap math, look/pan mapping,
segment step math, the detector firing on a synthetic
walk-and-pause trace and staying silent on noise, collect
re-anchoring, manual-nav hold, flag-off = session untouched.

Obvious limits, stated plainly: stride length varies per person
and per pace, so u drifts between collects — the re-anchor is
what makes it usable at all; a seated demo produces no steps
(the demo walks by the auto-follow timer instead, Discussion 35);
pocket vs hand changes the signal. This is an experiment, not a
promised feature, and it ships dark.

## Verification

- Suite: **194 green** (7 new in tests/test_motion_nav.py).
- Not verified here: real-device sensor behavior — the owner's
  phone pass is the gate, as with the restyle.
