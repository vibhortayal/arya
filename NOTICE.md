# Third-party notices and asset provenance

Arya's own code and documents are all rights reserved (see `LICENSE`).
The items below are not covered by that grant, or need attribution.

## Code
- **three.js r160** — `assistant/pwa/vendor/three.module.js`. MIT License,
  Copyright 2010-2023 Three.js Authors. The license header is kept in the file.
- **impeccable** design skill — `.claude/skills/impeccable/`. Apache License 2.0
  (see `SKILL.md`). A development aid, not part of the shipped app.
- Python dependencies (FastAPI, NumPy, OpenCV headless and others) are listed in
  `assistant/api/requirements.txt` and installed, not bundled.

## Art
- The characters and scenes in `assistant/pwa/assets/` were generated with
  Meta's Muse Image during the hackathon (see `docs/quest/DISCUSSION.md`, items
  32 and 53).

## Store walkthrough data
- None ships. The Trader Joe's walkthrough data (frames, VGGT point cloud,
  shelf graph, localizer index) was removed on 2026-10-29; it remains only
  in git history.
