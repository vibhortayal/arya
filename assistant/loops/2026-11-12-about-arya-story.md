# 2026-11-12 About Arya: who built it, why, free, work in progress

Owner: a page that tells people who built Arya and why, like agents.teamnightshift.org/about.html, to build trust and say plainly that Arya is free and still being built. About Arya already exists (Settings, About Arya), so this extends it instead of adding a second page.

- About Arya opens with a short note: who built it and why, "It's free", "It's a work in progress", "Why it's built this way". Wording comes from docs/PRINCIPLES.md and the README, no new claims.
- New Send feedback row (opens the existing Feedback screen). The credit line gains a GitHub link.
- Help topic "Who built Arya, and why" (opens About Arya); the Settings row subtitle and `arya_features.md` match.

Tests: vitest green (607); the one `window.scrollTo` jsdom error is also on main. Python suite not run here (no dependencies installed). Checked at 390x844 in the dev server with a mocked demo session.
