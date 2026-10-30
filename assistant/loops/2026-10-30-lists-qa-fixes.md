# 2026-10-30 — Lists usability fixes (behaviour)

The owner asked for a full UI/UX test of the Lists tab (report artifact
4ctg1fogt5AdDytS1G7LmB, 26 findings), then said "fix. add tests". This
pass fixes the behaviour bugs; anything that changes how a screen looks
waits for a mockup.

- C1: a new account (no receipts) could not tick anything: per-cycle
  flags were keyed on `as_of()`, which is None without receipts.
  `state.cycle()` stands in (`before-first-receipt`) for every write and
  read of checked_on, dismissed_on and check_ok.
- H1/H2: typing a name Arya already knows inside a list files it on that
  list, and re-adding a ticked item unticks it. from-text now returns
  `back`, `moved` and `already_names`; the toast names the items
  ("Bananas moved here from Costco.", "Milk is already on Trader Joe's.").
- H3: a quest grab ticks the matching list row, a put back unticks it.
- H4: the phone's Back closes an open sheet, then select/rename, then a
  list's page, then goes back a view (one history guard entry,
  `useBackHandler` in app/nav.tsx). It used to leave the app.
- H6: the tap from a long press's release is swallowed, so select mode
  starts with only the pressed row.
- M2: "3 avocados" reads as avocados ×3; amounts with a unit keep one
  decimal ("1.5 lb salmon", the quantity editor's 1.5 gal).
- M6: a photo of a list taken on a list's page files its items there.
- M8: a new list named after one of your stores links it.
- L5: "MODEL_API_KEY not provisioned" reads as a sentence.

Tests: tests/test_lists_qa_oct30.py (12), web addtoast.test.ts and the
nav Back test. Full suite: 1284 run, only test_demo_town's clock-
dependent reset test fails (fails on main too).

Next: mockup for the add row (owner 05:31Z: Add button still cramped),
toasts at the bottom, keyboard, tiles, New list, Start shopping on a new
account. Not done: seeded Chino Hills stores (owner call).
