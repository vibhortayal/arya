# 2026-10-31 — Settings trimmed and grouped

Owner approved mockups (artifact "Arya Settings: trim and group") in the
"Trim and group Settings" thread: option B, About Arya page, Stores on
Lists, Receipts and Spending on Today, Sign out last, About Arya below
Account.

- Settings (`screens/Profile.tsx`): Group, Preferences (Currency and
  language, When I start shopping on one line, Display, Reminders), Account
  (Export my data, Delete my account), About Arya, then Sign out. The
  email shows under the avatar card instead of a "Signed in as" row. Removed:
  Stores, Receipts, Spending, Help and guide, Send feedback, Powers, other
  AI app, Keeping Arya running, Add to Home Screen rows (moved or already in
  the Help tab).
- About Arya (`screens/About.tsx`, view `about`): Arya's powers, Use Arya in
  another AI app, Add to Home Screen, Keeping Arya running, credits.
- Lists: a Stores row under New list. Today: a fixed Receipts and Spending
  card at the bottom (one small `/api/group` read after first paint, for the
  "only you see them" line that Settings used to show with a count).
- `app/views.ts`: Receipts, Receipt, Spending keep the Today tab lit;
  Stores and Find stores keep Lists lit. Back fallbacks follow.
- Words: guide cards, tour, Ask's `arya_features.md`, SPEC, ARCHITECTURE,
  USER-JOURNEYS, STATUS name the new paths.
- Tests: vitest 415 green; `test_*` that pinned the old rows updated; e2e
  profile, about, muse, guide, language, stores-mine, quest-progress,
  receipts, group-join pass. e2e analysis, home, oneprogress, login, firstrun
  need demo data or a second account that the local API did not have.
- Not seen with real data: a real account with a group and push reminders on.
- Next: after merge, the guide-cards thread adds the seven new cards with
  these paths. Receipts count was dropped from the row (Settings showed
  "39 receipts"); Receipts itself still lists them.
