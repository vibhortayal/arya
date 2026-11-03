# Hide a store alert (2026-11-03)

Owner approved the mockup (UI/UX, artifact TZDyQ24wGw7bWK72cBunEq): a ✕ on each
"out at a store" row on Today.

- ✕ hides that alert for this account only (news_hidden.json, keyed store key | item key).
  Other shoppers still see it; the list does not change.
- The hide lasts while that report is open, however many shoppers add to it. It is
  forgotten when the report clears (3 days, or someone found it). A report whose every
  entry is newer than the hide (cleared and reopened while Today was not opened) shows again.
- Only an open report can be hidden (404 otherwise); at most 200 hides per account.
- Undo (the app's standard toast) calls /api/quest/news/unhide.
- Price rows ("cheaper at") get no ✕: they come from the household's own receipts.
- Demo: writes go to the visit's sandbox, so a hide lasts for that visit only.
- Help (Store news), the guide card, Ask knowledge and SPEC FR-8.8 each gained one line.
