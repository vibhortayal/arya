# 2026-10-29 — Expiry dates

Owner ask: snap the date on a package, Arya reads it and nudges for what
to use soon. Wireframe approved first (artifact 6g4tpYnWmo5M4gnuFCmUmr);
owner said yes to "offer to add back" and yes to a demo sample button.

What changed
- `api/expiry.py`: one Spark Standard vision read (`prompts/expiry_photo_v1.md`),
  date checks, item match, use-soon window. Everything after the read is code at $0.
- Routes: `POST /api/expiry/read` (`?sample=1` is demo-only, no model call),
  `POST /api/expiry/save`, `POST /api/expiry/{id}/done|snooze|stop`.
  `/api/home` carries `use_soon`. `/api/expiry/read` is a demo live door.
- Flags: `use_by`, `use_by_kind`, `use_by_set`, `use_by_snooze` (no migration).
  A real date replaces the "usually turns about now" guess for that item; a new
  receipt for the item (bought after the date was set) drops the old date.
- PWA: `expiry.js`, hint card on Today, link in the List composer, Use soon on
  Today and List (plus a tab dot), confirm / can't-read / item sheets. SW arya-v69.

Cost: about 0.2 cents per snap on Spark Standard (estimate; the ledger will show real numbers).
Checked: unit and route tests, plus a browser pass of the demo flow at 390x844.
Not run: a live Muse read on a real package (needs a phone and the key).
Next: owner tries a real package; decide whether Wonder is ever worth it for glare cases.
