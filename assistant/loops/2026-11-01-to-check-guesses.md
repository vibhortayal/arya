# 2026-11-01 To check: Arya's guesses

Owner approved the mockup (/mnt/project-files/arya-tocheck-smart/) and said: sure means 0.85 or higher, build before Nov 4. Built on #366 (guesses are made by `/api/review/smart-pass` and stored on each line as `suggested`).

What changed:
- `web/src/screens/ToCheck.tsx`: one card per product (same item number on several receipts is one card). The card leads with Arya's guess ("Arya's guess" or "Arya's guess · not sure"), then `Printed "..."`, item number, price, receipts and a section tag. Buttons: Use this name, Fix (opens with the guess and its section filled in, Save or Save, all N), Keep printed; a card with no guess offers Type the name and Keep printed. Details opens the old detail rows in place. Order: sure guesses, unsure, no guess; bigger groups first.
- Bulk card at the top: "Use the N sure guesses" sets every guess at 0.85 or more in one call; the toast names them and one Undo puts every line back.
- States: on open, lines with no guess and not yet tried are read (`smart-pass`) and say "Arya is reading this name…"; lines Arya tried and could not read say "Arya could not read this one".
- Server: `POST /api/review/accept {items:[{receipt_id, idx, name, section}]}` (1 to 200) renames each group and returns one `undo` list that includes the tapped lines; `_rename` is shared with `/api/review/line`.
- Help: Receipts topic note; `arya_features.md`: To check cards, Use this name, Fix, Keep printed, Use the sure guesses.

Tests: new `tocheckguess.test.tsx` (6), updated `bulkreceipts` and `reviewdetails`; Python `test_accept_many_in_one_call_with_one_undo`. vitest green; Python suite has the same 12 failures as main. Demo run at 390x844 with a mocked review queue: reading state, guesses, Fix prefill, Use the sure guesses, Undo, Use this name, Keep printed; plus the Tour (19 steps), guide (16 cards), Help and Ask's bar. No page errors.

Not tested: real guesses on live data and Ask's real answers (no model key here); check after deploy by running the To check backfill (`python -m harness.clean_names <email> --suggest`).
