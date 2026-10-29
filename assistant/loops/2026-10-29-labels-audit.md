# 2026-10-29 — Labels audit (React app words)

Branch `feat/labels-audit` (rebased on main 9c71e1d). Owner-approved
"Arya labels audit" applied to `web/src/i18n/en.json` and the screens.
No model calls, $0.

## What changed
- en.json: about 475 values changed, 40+ keys added (plural `_one/_other`
  splits, `today.cheaperElsewhere`, `today.place.*`, `lists.sighting.*`,
  `lists.photoKind.*`, `receipt.source.*`, `item.verdict.*`,
  `settings.yourData`, `album.alwaysFree`, `album.nextLevelAt`).
  Keys stay stable; only plural splits replace a base key
  (`today.needsYourEye`, `newList.nInBag`, `mapper.shoppers`,
  `settings.receiptsSub`, `receipts.countMine/countShared/bulkDone`).
- Glossary everywhere: quest (game) / trip (no game), race, Arya shoppers
  (coordinator update: replaces the audit's "other shoppers"; households
  only for privacy counts), friends (Crew as a word), username, map this
  store / mapped, in your cart, receipt added / no receipt yet / total
  checks out / total doesn't match, golden item (Boss retired), use-by
  date, Spending, Settings, To check, points / Level.
- Bugs: plurals, `money()` for budget and estimate lines (Currency
  setting), raw server values (sighting state, photo kind, receipt source,
  pattern verdict) shown as words, raw errors replaced in showErr.
- Glyphs out of strings: back chevrons, arrows, ▸, ✓, ✕, +, 📍 (CSS pin),
  NEW (CSS uppercase).
- Hidden, keys kept (judgement call 1, `web/src/lib/flags.ts` SHOW_RACE):
  Race entry points (Trips row, Friends Challenge, Score challenge, Check
  the list link), Fastest Hands sample boards and scope chips (one line
  instead), sample Crew haul post, Today tips for Deals and busy stores,
  Powers rows Deals and Arya Shoppers, level-up "Coming soon" rungs (now
  "Next level at N points" and one "Always free" line), Steps advance
  toggle (debug build or `?debug=1` only).
- Settings: "Your data" heading over Stores, Receipts, Spending; Language
  row is "Ask replies in". Today: Store alerts split from Cheaper
  elsewhere; Spending; "From your receipts up to <date>".
- Not touched: `src/game/**` (Quest thread), the logged-out landing in
  Login.tsx (landing branch).

## Tests
- tsc clean, vitest 262/262 (pack focus test is flaky under load; it
  failed on the base too), build ok.
- pytest 1230 passed; 4 failures exist on main too (3 pypdfium2
  test_decode in the sandbox, test_quest abandon order-dependent).
- e2e 42/43 on a fresh data dir; `questempty.e2e.mjs` fails the same way
  on unmodified main.
- Screenshots (390x844): `/mnt/project-files/arya-design-pass/labels-built/`.

## Next
- Quest thread: game strings in `src/game/ui/*` (handed off).
- Owner calls left open: Group vs Household; duplicate keys merge.
