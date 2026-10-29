# 2026-10-29 — remaining risks from the codebase map

Owner: "fix all the risks after refactor is done". Follows PRs #106 and #108.

## Done
- **Strict script CSP.** `script-src` drops `'unsafe-inline'`; the one inline
  theme script in `index.html` is allowed by its sha256 hash. `/auth/callback`
  now loads `pwa/auth-callback.js` instead of an inline script. The haul
  image fallback no longer uses an inline `onerror`. `tests/test_csp.py`
  keeps it that way (hash matches, no inline handlers).
- **Demo sessions stay in memory.** They were written to `sessions.json` on
  every demo visit; now an in-memory LRU of 5,000, never on disk.
- **Rate buckets pruned.** Per-IP buckets drop idle IPs and are capped at
  10,000 entries.
- **/health is liveness only.** It no longer reads the receipt count.
- **Compose:** unused `db` (Postgres) service removed. The VM's existing
  `arya-db` volume is not touched; delete it by hand if wanted.

## Not changed
- `main.py` split: waiting on the owner's pick (after Nov 4 recommended).
- Federated takeover rule from PR #97 kept as designed.
- Password-less Supabase account delete: needs a Profile wireframe first.

## Checked
- Suite: 1,110 tests OK, 2 skipped.
- Playwright at 390x844 with the new CSP header: demo loads, tabs work,
  theme script runs, no CSP violations; `/auth/callback` runs its script.
