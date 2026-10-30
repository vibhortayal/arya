# 2026-10-30 Keeping Arya running

Owner approved the mock (artifact KaKqKgw9RG8BJ66cSWpWVC): show each person what the
paid AI reading has cost them, lifetime first, and what it costs for everyone, Wikipedia
style with no money ask. Owner rules in the thread: never nudge or annoy; warn or act only
on heavy use; disable an account's spending past a dollars-per-hour line.

What changed
- `api/cost_ledger.py`: rows carry `kind` (reads, ask, maps, helps, from the URL via the login
  middleware) and, for real accounts, `user`. `usage(user)` and `whole()`.
- `api/deps.py`: `reading_off()` in the budget guard: monthly ceiling ($5, until the 1st) and
  hourly trip-wire ($1, freezes paid reads for 24 h in `frozen-accounts.json`). Owner exempt.
- `api/routes/account.py`: `GET /api/usage`, owner-only `POST /api/usage/unfreeze`.
- App: Settings row "Keeping Arya running" and `screens/Usage.tsx`.
- Tests: `tests/test_usage.py` (7), `web/src/screens/usage.test.tsx` (4).

Notes
- Old ledger rows have no user, so lifetime starts at deploy. The whole-Arya totals count only
  rows with a user.
- A frozen account keeps sign-in, lists and Today; only calls that pass `_budget_guard` stop.
  Store-walk frames have their own daily cap too.
- The ceiling and trip-wire are env values; 0 turns one off.
- Cost: no model calls added.

Next: owner to say if the hourly line ($1) is right; a screen for the owner to see frozen accounts.
