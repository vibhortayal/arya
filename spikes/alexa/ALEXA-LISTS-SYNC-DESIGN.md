# Alexa Shopping/To-Do list sync for Arya: research and recommendation

Date: 2026-11-03. Private to the project. Nothing here goes into Help, Ask Arya or any doc (Alexa stays undocumented until the owner says it is built and working).

## Bottom line

**The one-way pull from Alexa's built-in Shopping and To-Do lists cannot be built the supported way. Amazon removed that API on July 1, 2024.** Recommendation: do not build list sync. Keep the voice skill we already have as the way items get from Alexa into Arya, and add at most a tiny manual "paste your Alexa list" import after Nov 4.

## What I found

1. **The List Management API is deprecated.** Amazon's Deprecated Features page says "List skills and the List Management REST API to access Alexa lists" are no longer supported, as of July 1, 2024. That covers the Shopping and To-Do lists, read and write. No replacement is named. The old docs pages (access-the-alexa-shopping-and-to-do-lists, list-events, list FAQ) now just redirect to that page.
   Sources: https://developer.amazon.com/en-US/docs/alexa/ask-overviews/deprecated-features.html (section "List Skills and Alexa Shopping and To-Do Lists"), https://developer.amazon.com/docs/custom-skills/access-the-alexa-shopping-and-to-do-lists.html (redirect notice).
2. **Real-world effect matches.** AnyList and Todoist lost their native Alexa-list sync in July 2024; users now have to say "tell AnyList to add milk". One reader reports older phrasing also fails on Alexa+. Source: https://criticalx.substack.com/p/is-anylist-via-alexa-dead (a blog; the Amazon page above is the authoritative part).
3. **List-change events went with it.** The "ItemsCreated / ItemsUpdated / ItemsDeleted" list events and the lists read/write permissions were part of the same feature, so there is no event feed or polling endpoint to build on.
4. I could not read the old scope names and payload shapes from a live Amazon page (all redirect). I am not going to document them from memory because they no longer apply.

Not verified: whether Amazon has launched any new list access for Alexa+ developers. I found nothing, and the Deprecated Features page names no replacement. Worth one more look at developer.amazon.com in a few weeks, not before Nov 4.

## Options for getting Alexa items into Arya

| Option | Works? | Pros | Cons |
|---|---|---|---|
| A. Official List Management API, one-way pull | No, removed 2024-07-01 | n/a | n/a |
| B. Our voice skill ("Alexa, ask my arya to add milk") | Yes, already built behind ARYA_ALEXA | Supported, account linking done, sound-alike + Spark fixing and "From Alexa" card already approved | Users must say "ask my arya", not "add to my shopping list"; does not import what is already on Alexa's list |
| C. Unofficial route (reverse-engineered Alexa web cookies, as Home Assistant add-ons do) | Technically, today | Reads the native list | Breaks Amazon terms, needs the user's Amazon login or cookies, fragile, a privacy and security liability. **Reject.** |
| D. Manual import: user shares/copies the list from the Alexa app and pastes it into Arya's add bar | Yes | Zero Amazon dependency, reuses existing text-add and sound-alike fixing, about half a day | Manual, not live, only worth it if users ask |
| E. Alexa Routine that triggers our skill | Partly | Can give shortcut phrases | Still goes through our skill, so no new data path |

## What I would do instead (design if the owner wants more than B)

Treat B as the integration and make it feel like "Alexa syncs to Arya":
- **Permission:** account linking already grants it (scope `lists` in the console is now a leftover name; the console step 5 scope can stay, it has no Amazon-side effect). No Amazon list permission is needed or available.
- **Arrival:** push, not pull. Each spoken add arrives at /alexa/skill instantly. No events or polling.
- **Dedupe/edit/delete:** Alexa side is add-only, so no edit or delete sync. Dedupe by the existing in-list duplicate check; unclear items go to the approved "From Alexa" card.
- **Optional D** later: a "Paste from Alexa" path in the add bar, flagged with ARYA_ALEXA, using the same fixing pipeline. Effort roughly 0.5 day build plus a mockup and Tester pass. Not before the Nov 3 noon ET UI freeze.

## Effort

- Recommended path (B only): 0 extra days.
- Add D: ~0.5 day, post-freeze.
- Full one-way pull (A): impossible. Option C would be ~2 days and I recommend against it.

## Pros and cons of the recommendation

Pros: honest to what Amazon supports, no new risk before submission, keeps the hidden-flag promise, judges can't hit a broken integration.
Cons: no import of an existing Alexa list; the voice phrase is longer than the native one. This is Amazon's limit, not ours.

## Decision for the owner

Drop list sync, keep skill B as is. Say "yes" to D only if you want a manual paste import after submission.
