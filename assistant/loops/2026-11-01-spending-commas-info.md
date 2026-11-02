# 2026-11-01 Spending: thousands commas and (i) on each heading

**Ask (owner):** "Use currency format with commas. Add little info icons to the headings": people could not tell Groceries, Other purchases and All-time spending apart.

**Mockup:** claude.ai/artifact/Sd3QzuunUFwao1AC5QSU9t, section 1, approved 23:30Z.

**Changes**
- `lib/format.ts` `money()` groups digits in thousands for every currency. Rupees use Indian grouping (₹1,23,456.00), and the dot stays the decimal mark. The app shows money only through `money()`.
- Receipts search ignores commas, so "1,115" finds $1,115.42.
- Spending card: an (i) sits after the month total, All-time spending, Groceries, Other purchases, Returns, You saved and Bought for others. Each one opens one "What these mean" sheet: a new `INFO.spend` entry in `ui/Info.tsx`, which reuses the existing InfoBtn and InfoSheet.
- Help: the "Receipts and spending" topic gets note n3. Ask: the spending section in `arya_features.md` explains each line.

**Tests:** `screens/spendinfo.test.tsx` covers grouping (USD, EUR, INR) and checks that there are 6 (i) buttons that open the sheet. Web: 483 tests pass. Python: the same 8 failures by name as on main.
