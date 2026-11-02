# 2026-11-02 In-app wording: no oversold claims

Owner "go" on the Researcher's accuracy report (/mnt/project-files/arya-researcher/ACCURACY-REPORT-2026-11-02.md), items 1, 4 and 7 plus the Powers unlock text. App text only. Docs go to the Doc maintainer.

- **Prices "from Arya shoppers" (item 1):** community prices are not live. `routes/prices.py` only records the `share_prices` choice, and every price comes from the account's own receipts. Reworded in these places:
  - the AI notice (`ai.pricesSub`);
  - the landing prices card;
  - the guide prices card;
  - Help prices (body and n1);
  - the Powers community card (sub, what, unlock and when);
  - the sharing sheet (you give, you get);
  - the tip;
  - "Every receipt and report…";
  - the guide Powers step 3, which told people to turn on Community prices;
  - Ask knowledge (lines 3 and 56).
  Stock reports, store maps and "Not here?" reports from other shoppers are real and unchanged. So are the Demo Town simulated prices, which are labelled "Simulated".
- **"Your photo stays private to you. Nothing here is shared." (item 7):** group members can see each other's receipts. It now reads "Your receipt photo stays with your account. If you are in a group, group members can see your receipts."
- **"We blur every person" (item 4):** detection-based. It now reads "Arya blurs the people it can find before it saves a photo, and keeps none if that step fails." Ask knowledge got the same change.
- **Offline (item 3) and Spark Open (item 5):** the in-app text is already accurate. The offline bar names what needs a connection, the demo now queues offline list changes (#476), and the app has no Spark Open privacy line. No change.

The Ask knowledge sheet is 72 characters shorter. No test pinned the changed strings.
