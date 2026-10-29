# 2026-10-29 — Adaptive layout for many lists (#156)

Owner-approved mockup (after-ten, after-thirty, after-today-thirty,
after-wide-ten). Built with the existing classes and tokens.

**Lists home** (`screens/Lists.tsx`, logic in `screens/lists/adaptive.ts`):
- 1 to 3 named lists: the large cards, as before (pixel-identical to main).
- 4 to 11: compact tiles in the `.listcards` grid (name, "N items", the
  first two item names). 2 columns on a phone; from 600 px wide,
  `repeat(auto-fill, minmax(220px, 1fr))`.
- 12 or more: dense rows. Search ("Search N lists": list name or store,
  any case), Recent (5), "All lists, A to Z" (`.group` / `.navrow`, open
  count in tabular numerals, chevron). A search shows one filtered group.
- Hysteresis: denser at 4 and 12, back only at 3 and 10. The last
  automatic mode is kept per account in localStorage
  (`arya-lists-mode:<user>`), so 12 -> 11 stays dense.
- Cards | List switch from 4 lists, right-aligned; the choice wins over
  the automatic mode and is kept per device (`arya-lists-view`).
- Recent: the server keeps no updated-at on a list, so the device stamps
  a list when it is opened or an item is moved to it
  (`arya-list-opened`). A shared group's last change per list (from
  `/api/group` recent) counts too. With no stamps: the list order.
- Everything else: as before in the large cards (always). In tiles and
  rows it shows when it has open items or suggestions (one row at the
  end of A to Z in the dense view).
- The first-run "Create your first list" card (#180) is unchanged.

**Today** (`screens/Today.tsx`): more than 4 lists -> 4 tiles, then
"See all N lists ›" (opens Lists); the "Open Lists ›" header link is
hidden then (visibility, so the header keeps its height as in the
mockup). Running low, Store alerts and Use soon show 3 rows, then a
"See N more" row in the group that opens the rest in place
(`capRows`, `capLists`). 4 lists or fewer, 3 rows or fewer: unchanged.

**My stores** (`StoresMine.tsx`): a search field above the groups at 12
stores or more (name, street, city or ZIP).

Strings: en.json `lists.*`, `today.*`, `storesMine.*` with plurals.

Checks: tsc, vitest 263 (new `screens/adaptive.test.ts`: thresholds and
hysteresis at 3/4 and 10/12, override, search, Recent, Today caps),
build; Python suite 1257 (only the 3 sandbox test_decode errors); e2e
40/40 including the new `e2e/adaptive.e2e.mjs` (12 lists dense + search,
delete to 11 stays dense, 10 goes to tiles, the switch sticks, Today
See all). Screenshots in `arya-design-pass/adaptive-built/`: 1 and 3
lists are pixel-identical to main; 10 lists and Today with 30 are
pixel-identical to the mockup; 30 lists differs only in the Recent
order (the mockup picked one by hand); 10 at 1100 wide differs only
behind the tab bar (the mockup kept an empty Everything else tile).

No model calls, $0. Next: owner review; no PR opened.
