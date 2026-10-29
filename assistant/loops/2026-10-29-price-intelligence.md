# 2026-10-29 — Price intelligence (own receipts), Arya's powers

Owner asked for price comparison, deal alerts and similar items. Owner
rules: prices only from the household's own receipts or (later) opted-in
households; no APIs, scraping, flyers or web search; caveats only behind
an (i) button; no line graphs; Quest not on the Powers list; live store
busyness is called "Arya Shoppers". Wireframe approved the same day.

Changed:
- api/prices.py (new, $0, deterministic): per-store unit prices, cheaper
  store (25 cents and 5% minimum), trend (3+ buys over 4+ weeks, 2%+),
  own inflation (same items, 60-120 days ago vs last 30), split smarter
  (last 6 months), food waste (items marked expired this month), similar
  items (same head word, per-oz when sizes parse), Ask facts.
- api/routes/prices.py: /api/prices/item/{id}?at=, /api/prices/insights,
  /api/powers, /api/powers/share (opt-in choice only; nothing is shared yet).
- Ask: snapshot carries `prices`; chat_v1 prompt says use only those and
  never outside prices; arya_features lists the new powers.
- PWA: why-sheet rows (trend, cheaper, similar) with (i); Analysis
  "Your prices"; Profile > Arya's powers (collapsible, one line each);
  one "Did you know?" card a day on Today; "Shop smarter together" sheet;
  thank-you wording after a receipt and a "Not here?" report. SW arya-v82.
- Demo household: prices drift a little over the 26 weeks and differ by
  store per item; a Kirkland Organic Milk at Costco for Similar items.

Tests: tests/test_prices.py (21). Suite: 1129 OK, 2 skipped.
Next (after Nov 4): opt-in community price store (5+ households, 30 days),
Deals, Arya Shoppers presence.
