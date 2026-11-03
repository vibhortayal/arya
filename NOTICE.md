# Third-party notices and asset provenance

Arya's own code and documents are all rights reserved (see `LICENSE`).
The items below are not covered by that grant, or need attribution.

## Code
- **three.js** (npm `three`, bundled by the web build) — MIT License,
  Copyright 2010-2025 Three.js Authors.
- **Scalar API Reference 1.76.4** — `assistant/pwa/vendor/scalar/standalone.js`. MIT License,
  Copyright (c) Scalar. Draws the Lists API schema at `/developers/reference`.
- **impeccable** design skill — `.claude/skills/impeccable/`. Apache License 2.0
  (see `SKILL.md`). A development aid, not part of the shipped app.
- Python dependencies are listed in `assistant/api/requirements.txt` and
  installed, not bundled. Licenses (from PyPI, 2026-11-02): FastAPI MIT;
  uvicorn, httpx, pypdf BSD-3-Clause; NumPy BSD-3-Clause and other permissive
  terms; Pillow MIT-CMU; OpenCV headless Apache-2.0 (its wheels bundle other
  libraries under their own licenses); cryptography Apache-2.0 or
  BSD-3-Clause; pypdfium2 BSD-3-Clause or Apache-2.0; pywebpush MPL-2.0;
  psycopg LGPL-3.0.
- JavaScript dependencies are in `assistant/web/package.json`: React, React
  DOM, `@react-three/fiber`, i18next, react-i18next, motion, Vite,
  vite-plugin-pwa and Vitest are MIT; canvas-confetti is ISC; TypeScript is
  Apache-2.0.
- **Caddy** and the Docker base images (Node, Python) are used as container
  images, not copied into this repository.
- **App Store and Google Play badges** (`assistant/pwa/assets/badges/`) are
  trademarks of Apple and Google, used only to point at an install.

## Models and services
- **Meta Model API** (Muse Spark, Muse Wonder, SAM 3.1, Muse Voice Transcribe,
  Muse Image): hosted by Meta under Meta's API terms. No weights are in this
  repository.
- **Muse Spark Open** (`meta-models/muse-spark-open-1026`): open weights from
  Meta, hosted on Baseten; used under the Muse Model License (Oct 15, 2026)
  and its Exhibit A Usage Policy
  (https://huggingface.co/meta-models/Muse-Spark-Open-816B-A42B/blob/main/LICENSE.md).
  No weights are in this repository.

  **Built with Muse Spark Open.**
  Arya uses Muse Spark Open (open weights, hosted on Baseten) as a second seat
  on the staple judge and for dictionary labels, and its outputs appear in the
  app. It sees item names only, never personal data.
- **Baseten, Supabase (optional), Resend**: hosted services under their own
  terms.

## Art
- The characters and scenes in `assistant/pwa/assets/` were generated with
  Meta's Muse Image during the hackathon (see `docs/quest/DISCUSSION.md`, items
  32 and 53).

## Store walkthrough data
- None ships. The Trader Joe's walkthrough data (frames, VGGT point cloud,
  shelf graph, localizer index) was removed on 2026-10-29; it remains only
  in git history.
