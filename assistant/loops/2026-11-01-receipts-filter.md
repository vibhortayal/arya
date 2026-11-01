# 2026-11-01 Receipts search, Date and Sort

Owner approved the calmer layout A mockup (Receipts Filter Mockups). Receipts archive now has a search box (store, person or amount), a Date menu (All dates, This month, Last 30 days, This year, Custom range with From and To days) and a Sort menu (Newest first, Oldest first, Highest total, Lowest total, Store A to Z, the last added on the owner's pick). A summary line shows the count and total, with Clear while a filter is on. The Everyone and Mine strip stays above the search. Trips with no receipt yet and the To check row are never filtered. Menus are native selects styled as pills, so the phone shows its own picker.

Help (receipts topic note), arya_features.md and USER-JOURNEYS updated. Filter logic is pure code, tests in screens/receiptsfilter.test.tsx. No model calls, no cost.

Next: owner check on a phone after deploy.
