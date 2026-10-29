# 2026-10-29 — docs refresh and architecture diagram

What changed (docs only, no app code, no service worker change):
- `assistant/docs/architecture.svg`: one-page diagram of the app as built.
- `assistant/docs/ARCHITECTURE.md` section 0: front end, routers, engines,
  models and photo-reader fallback, storage modes, auth, price intelligence,
  Groups and live sync, push, deploy, flag table, cost guards.
- README: architecture image and link, test count 1,187, Settings tab.
- PRODUCT.md: list-first positioning, five tabs, no prepared cart, orange
  light-only theme. DESIGN.md: tokens, type scale, five-tab bar rewritten from
  `styles.css` (it still described a green, dark-mode design).
- STATUS.md: SW cache arya-v91, 1,187 tests, Settings tab, design pass, A2HS,
  PDF receipts, main.py split, price PR merged.
- DEMO.md: prepared-cart beat replaced by Start shopping.
- deploy/.env.example: every variable compose passes.

Verified: full suite 1,187 tests OK (2 skipped) on main af69cc4.
Next: owner deploy; SPEC.md still describes the prepared cart (spec wins, owner decides).
