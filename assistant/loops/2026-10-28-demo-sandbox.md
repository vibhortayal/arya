# 2026-10-28 — demo sandbox, judge front door, one set of numbers

Source: the hackathon gap review (Claude Doc "Arya hackathon gap
review", 2026-10-28) and the owner's go-ahead: "proceed with all the
fixes. make quest hunt play usable and demoable in all modes".

## What changed

- **Demo sandbox.** `api/state.py` gains a per-request overlay
  (`set_overlay`, `in_sandbox`). `_load` reads the overlay first;
  `_save` writes into it and never to disk (2 MB cap per file).
  `shelf_matches.json` writes through — it is a cache of
  item-to-shelf verdicts, not visitor state. `add_receipts` keeps
  no media bytes in the sandbox.
- **Middleware.** A demo session gets its own overlay (LRU of 500
  sessions). Demo writes are open except `_DEMO_CLOSED` (imports,
  PDF/text decode, fridge photos, Curator/judge runs, Resolver,
  order intake). Doors that can call the Meta API share the
  existing per-IP live-door cap. `_budget_guard` and the new
  `_ledger()` put sandbox spend in the demo bucket.
- **Demo filing.** In the demo, a receipt photo files into the
  sandbox (marked `live`) so a hunt can finish on it; a list photo
  adds its items to the sandbox list.
- **Present-week demo.** `state.receipts()` shifts the demo
  household's fictional trips so the last one is 3 days before
  today; live receipts keep their dates.
- **Client.** Landing page with the store photo, one-paragraph
  pitch, the Meta models, and "Try the demo — play the Trader Joe's
  hunt"; sign-in folds below. Demo Ask and typing are enabled;
  demo copy says changes last for the visit. Tab bar centers on
  laptops. SW arya-v33. No quest UI file changed (Hunt v2 freeze).
- **Docs.** README "Measured results" is the one source for the
  receipt-photo numbers (Wonder 97/98 hand-adjudicated, Spark
  92/98; Gate 0 Spark 90/98) and the localizer number (held-out
  mapping frames, not fresh photos). "How this was built" note.
  SUBMISSION-DRAFT lists Wonder, Image, Shelf Scan; SUBMISSION.md
  leads the tooling row with the event's models; META-PRODUCTS
  moves VGGT below them. DEMO.md judge path and SPEC Gate 0 status
  updated. Test counts 181 → 321.

## Tests

Six demo tests encoded the old read-only contract; they now assert
the sandbox contract instead (writes succeed, disk unchanged, a
second visitor starts clean, batch doors closed). New: a demo hunt
end to end, and the present-week shift. Suite: 321 green.

## Browser check (local, demo household, 390 px)

Quest at Trader Joe's: optimize, start, Photos / 3D / Aisle / Strip,
grab, finish, score — all 200s, no page errors. Quest at Costco
(Aisle, Strip), Express at both stores: start, finish, score.

## Not done / next

- Quest UI defects seen in the check (dense overlay over the scene,
  toast over the rail, the Express list button covered) belong to
  the Hunt v2 rebuild, frozen pending the owner's approval.
- The Optimizer merged "pasta sauce" into "Pasta 1 lb" on the demo
  dictionary (token-subset match); Undo recovers it. Worth a rule.
- Open-weights job (Spark Open on Modal/Baseten) not started.

## Wireframes (owner go-ahead, 2026-10-28)

`docs/quest/wireframes.html` updated on the same PR so the Hunt v2
rebuild keeps what already ships: Photos is the hunt's default view
(3D Cloud renamed 3D); a tools row adds 📷 Scan shelf (SAM 3.1 +
Spark confirm, pop card with GRAB) and 🧭 Where am I? beside Not
here; the collect card carries the Muse Image character and a fun
fact; Finish and Add receipt show a dashed demo-only "Use a sample
receipt"; a new Screen 0 Landing is the signed-out front door; the
Today sample staples drop the duplicate almonds. Clicked through in
Chromium: no console errors; Scan → GRAB counts; sample receipt
reaches Score.
