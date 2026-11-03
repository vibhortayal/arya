# 2026-11-03 A ✕ on every Today row

Owner: "all card should have hide, or delete option- cheaper else where,
running low. check what other candidates, i missed", then "all card items".
Mockups: store alerts https://claude.ai/artifact/TZDyQ24wGw7bWK72cBunEq
(approved), every row https://claude.ai/artifact/NoKoK8mGeV6cNDivqPMK7H.

A ✕ hides one row for this account only. It never deletes data, the toast
carries Undo, and other people (household, other shoppers) are unaffected.

- `api/routes/account.py`: `today_hidden` on /api/settings, a map of row key
  -> "signature|YYYY-MM-DD", merged like today_sizes; null shows a row again;
  the oldest drop past HIDDEN_MAX (300).
- `web/src/lib/todayHidden.ts`: `isHidden` decides when a row comes back —
  its signature changed (bought again, a new month, a different cheaper
  store) or the hide aged out (store alerts 4 days, price rows 30).
- `web/src/screens/hideX.tsx`: the shared ✕ button (ui/Town.tsx uses it too).
- `Today.tsx`: ✕ on Running low, Store alerts, Cheaper elsewhere, Use soon,
  Still good? (checks and seen), Your patterns, Price watch, the empty-lists
  row, the Quest row, and the demo's Near you today rows.
- No ✕ on Next trip (the main action; Customize hides the card) or on list
  tiles (not suggestions; a list is deleted from its own screen). The tip,
  the Quest invite and Get started already had one.
- Help (customize n2), the Today guide card, Help "Store news" n2 and
  prompts/arya_features.md say the same thing.

Gates: web 564 tests, tsc, build; Python 1926. test_feature_sheet's
whole-sheet guard moved 26000 -> 26500 (main measured 25992 of it).
