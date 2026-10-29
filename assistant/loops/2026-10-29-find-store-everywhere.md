# 2026-10-29: Find or add a store where you need one

Owner (screenshots of Quest > Build a store and Teach Arya your store):
"should be able to find and add store here too". Both screens only
listed My Stores, a dead end for a new shopper.

## Now
- `screens/StoresFind.tsx`: the search and add is one component,
  `FindStorePanel({ onAdded })` (directory Add plus Google
  suggestions). Find stores renders it as before; `onAdded(name)` lets
  another screen stay put instead of jumping to My stores.
- Teach Arya your store (`Mapper.tsx`): a "+ Find or add a store" chip
  at the end of the store chips opens the panel inline; adding a store
  selects it and closes the panel. With no stores, it opens on its own.
- Quest Build a store, "Which store?": the same panel, passed in from
  `QuestMode` as `findStore` (the game stays decoupled from the app).
  Adding reloads the store choices; with none it opens on its own.

## Tests
`e2e/findstore.e2e.mjs`. Python suite and vitest green.
