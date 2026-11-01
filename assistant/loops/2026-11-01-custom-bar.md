# 2026-11-01 The shopper's bottom bar

Owner approved the mockups (artifacts KCGzi6BZ8dadWt8y4oiKum, 7icjAbBu8egXBZ94WrXvg4, PTRdHtv8EBtsgXnsLuthdM) and picked the default Today, Lists, Quest, Ask, More.

What changed:
- `web/src/lib/bar.ts`: places, default, cleaning, which button lights (Receipts and Spending light Lists or themselves; places in More light More), first screen.
- `web/src/ui/Bar.tsx`: the bar, the More sheet, the Customize bar editor (EditList, Undo, four at most, new place at the end). Touch and hold opens the editor.
- Server: `layouts.bar` in settings (`api/routes/account.py`). Ask: `/api/chat` takes `bar`; `chat_service.bar_line` adds YOUR BAR (falls back to the saved bar, then the default).
- Tour: `firstRunTour(bar)` and `demoTour(go, bar)` follow the bar, then More, Help and Settings, then "Make the bar yours" (Customize now opens the editor and does not also open the demo's guide).
- Guide: Your bar card (16 cards). Help: Change the bar topic. `arya_features.md`: bar header, bar section, "Lists and Quest are both core".
- Today's tab icon is a calendar (the sparkle is Ask's AI mark).

Tests: vitest green (one timing-flaky pack test passes alone); Python suite has the same 12 failures as main, none new. Demo run at 390x844 against a local API: all 19 Tour steps, 16 guide cards, Help topic and its button, More sheet, editor (remove, add, reset, hold), reload keeps the bar, a custom bar's Tour, and Ask requests carry the bar.

Not tested: Ask's real answers (no model key in this environment); check after deploy.
