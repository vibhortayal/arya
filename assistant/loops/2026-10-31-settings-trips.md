# 2026-10-31 — Trips with no receipt move to Today; Sign out moves up

From the 2026-10-30 audit, M9 (owner approved the mockups).

- Settings no longer lists "Trader Joe's · No receipt yet · Add receipt /
  Dismiss" cards. Today shows one row, "N trips need a receipt" (stores
  and dates under it), that opens Receipts, which already lists those
  trips with Add receipt and Dismiss. Today reads `/api/quest/receipts`
  for it (one more read, in parallel with the others).
- Sign out sits above Export my data and Delete my account, away from
  the red row. Delete my account already asks for the password.
- The phone-wrap rule for these rows (pilot, 2026-10-30) moved from
  `#pf-missing` (gone) to Receipts' trip rows (`#rc-archive div.sessrow`).
- Removed what this orphaned: the Settings receipt sheet, its dismiss
  handler, the `Unsettled` type and `settings.finishedReceiptMissingOfCollected`.
- Tests: `test_hunt_v2_screens` pins updated to the new home of these
  rows (they passed on main against the old one). Every test that reads
  `Profile.tsx`, `Today.tsx` or `Receipts.tsx` (21 modules, 292 tests),
  `test_parity`, `test_multilingual_ask`, vitest i18n and screen tests,
  `tsc`: green.
- Not seen with real data yet: the demo has no trips without a receipt.
  After deploy, check on tester-a (3 such trips).
