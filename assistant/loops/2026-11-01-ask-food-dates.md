# 2026-11-01 — Ask Arya sees food dates

Owner: "fix 1-3" on the intelligence review (item 3: give Ask the use-by dates).

## What changed
- `chat_service.snapshot()` adds `today`, `use_by` (printed dates the household saved, 30 days ahead, up to 7 days past, snoozed rows kept, at most 20) and `still_good` (Today's "Still good?" questions with the purchase date).
- `routes/home.still_good_checks()`: the Still good rule moved out of `/api/home` into one function that Today and Ask both read. No behaviour change on Today.
- `expiry.use_soon()` takes `ahead` and `skip_snoozed`; defaults unchanged.
- `prices.ask_facts(first=...)`: items on a list lead the price facts, so "Where is my list cheapest?" has the list's prices.
- Ask's chat call sends `cache_key="arya-ask-v1"` (the system prompt is a stable prefix).
- `chat_v1.md`: how to answer date questions (quote pack dates, Still good is an estimate, never say food is safe, start meal ideas from these items).
- Help upkeep: `arya_features.md` use soon section and the Help "Use soon" topic (new note n2) say Ask knows these dates.

## Tests
`tests/test_ask_food_dates.py` (window, list-first prices, snapshot dates + cache key). Fakes in `test_chat_photo.py` and `test_eyes_chat.py` accept extra kwargs. Full suite: same 12 failures as main before this change (pre-existing, unrelated), no new ones. Web: help, guide and i18n tests pass.

## Models
No model runs. Cost effect: a few hundred more input tokens per Ask turn; the cache key should make the static prefix cheaper.

## Next
Measure real Ask token counts on the VM ledger.
