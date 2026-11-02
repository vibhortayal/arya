# 2026-11-02 — "Which list?" picker UI (on #419)

- Ask: owner, "it should ask you to which list it should add it to. If you don't have any list, it should ask you to create a list before you add any items." Mockup approved as drawn, one-list shortcut included (claude.ai/artifact/YTrF6swGujXdmr1ZxZUtXL).
- Built: lib/listPick.ts (addOnList / addItem: send, on 409 pick_list or no_lists ask, send again), ui/ListPick.tsx (pick sheet, make-a-list-first sheet, delete-choice sheet), mounted once in the shell.
- Wired: Today Running low Add and Add all, Used it then Add (two places), item page Add to list, Lists typed add, card add, suggestion add, list photo (needs_list), undo of a remove (keeps its list), Quest trip extras, haul photo extras, Ask list photo (one chip per list).
- Offline (or with list changes waiting): asks first from the lists saved on the phone, so a queued add never fails with "couldn't sync".
- Delete list with items: move (default) or delete them too; Undo sends the items back too.
- Ask knowledge: the which-list section shortened; the feature sheet was 24262 on main (limit 24000), now under it after trimming the offline section.
- Not built: the "N items aren't on a list yet" card. The server now files old rows on Today load (file_unlisted); the few it can't place still show under the existing "Not on a list yet" card, where Move works.
