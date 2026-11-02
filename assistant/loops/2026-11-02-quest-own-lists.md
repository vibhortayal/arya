# 2026-11-02 Quest offers only your own lists

**Ask (owner, 2026-11-02):** "We don't need like an everything list. When we have segregated list, we want separate lists only." Then: no default "Everything else" either; a list the user names "Everything else" shows like any other. Mockup: claude.ai/artifact/1oq2Cw4XbzMwSkUZBcwnLq.

**Changes**
- `screens/quest/appSource.ts` `lists()`: one entry per named list with open items. The made-up "Everything" entry is gone, and items on no named list stay out of Quest until they are put on one (every item belongs to a list). Empty named lists come back too, so the game can tell "no lists yet" from "nothing to buy".
- `game/ui/Hub.tsx`: with no lists at all, "Create a list to start a quest" and a Create a list button (opens Lists), plus Practice. Chips only for lists with items.
- `game/QuestGame.tsx`: Quest opens on the list asked for, else the one picked last on this device (`arya.quest.lastList`), else the first with items.
- Lists and Today no longer pass `listId: "all"`.
- Help, guide cards and Ask never named the Everything chip, so none change.

**Tests:** `appSource.test.ts` (3 new cases) and `Hub.test.tsx` (no-lists state, chips). Web unit tests pass; screenshot at 390x844 on the demo household.
