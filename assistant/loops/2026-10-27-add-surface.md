# Add is one surface — 2026-10-27 (night)

**Owner clarification.** Add is for adding items to the shopping
LIST. Receipts are separate: a receipt enters only as an image
(in the app) or via Spark/Muse. The five-door Add (Via Claude /
Photo / Voice / Paste / Type cards) was build-order thinking;
the final shape is ONE surface, not five doors.

**The surface** (view-scan, app.js):
- One text field that accepts typing AND paste — a pasted
  WhatsApp list and typed items are the same act. Placeholder:
  "Add items — type, or paste a list from WhatsApp". One Add
  button posts to /api/list/from-text.
- A mic button: the existing Muse Voice Transcribe flow; the
  transcript lands in the text field for edit before adding.
- A camera button: one Spark read with smart routing (below).
- One plain line under the surface: "You can also add from Muse
  chat — say 'add eggs to my list'." (a pointer, not a card).
- Demo: camera + mic make live calls and persist nothing (the
  read previews in the text field); the field and Add stay
  disabled, as typing always was in the demo.

**Server** (`api/list/intake.py`, routes in main.py):
- POST /api/list/from-text — deterministic split first ($0):
  lines/semicolons/commas; bullets, numbering, and checkboxes
  stripped; "add / please buy" lead-ins and trailing "x2"
  quantities stripped; chatter filtered (a candidate is sensible
  when it has a letter, is <= 5 words, is not a known chatter
  line, and does not open with a greeting). When the split yields
  nothing sensible — chat text has chatter in it — ONE Spark
  Standard extraction call runs (personal=True). Adds go through
  the same manual-add path as typed adds; duplicates merge
  there.
- POST /api/list/from-photo — one Spark vision read (Standard;
  prompt prompts/list_photo_v1.md) that classifies the image:
  kind "list" (handwritten / whiteboard) -> items extracted and
  added; kind "receipt" (store header / totals detected in the
  same read) -> NOTHING is added; the response reports the
  receipt and the client shows "This looks like a receipt." with
  a "File it as a receipt" button that posts the same image to
  the existing /decode/photo. Registered as a demo live door
  (preview, persists nothing). The server-side order-text intake
  endpoint is untouched — the connector's path is not the Add
  tab's business.
- The Add tab no longer offers receipt decode anywhere.

**Receipts view (B4)** gains its own "Add a receipt photo"
(image only), posting to /decode/photo through the same
fileReceiptPhoto helper the camera's file-it offer uses.

**Copy.** Door-enumeration copy fixed on the login demo banner,
the connect steps, and the Profile token card ("the camera and
microphone on the Add tab"). The invariant line stays: "Every
door runs on Meta models — Muse in chat, Spark on the Meta API
in the app."

**Tests.** New tests/test_add_surface.py (13): the single-surface
shell contract (one field, mic, camera, Muse line; no door
cards, no order-confirmation copy in any PWA file), the
Receipts-view photo action, splitter cases (WhatsApp message,
bullets/numbers/checkboxes, lead-ins, chatter -> empty), from-text
API ($0 split path with zero model calls; chatter -> exactly one
fallback call; adds land on the list), from-photo routing (list
-> added; receipt -> nothing added, nothing filed). Parity tests
gained the demo list-photo preview + from-text 403. SW cache
arya-v19. Suite: **180 green**. No live model calls were run.

---

## Addendum — light mode only (owner, same evening)

"i dont like dark mode - use only light mode." The Appearance
section (System/Light/Dark segmented control) is removed from
Profile entirely; there is no theme toggle anywhere. The token
architecture stays — the :root light token set is simply the
only theme now: the prefers-color-scheme dark media block and
the [data-theme="dark"] block are deleted from styles.css, the
dark theme-color meta is gone, and the boot script pins
data-theme="light" unconditionally while clearing any persisted
arya-theme preference (a stored dark choice is reset, never
applied). Pinned by test_light_mode_only in
tests/test_brain_restyle.py. SW cache arya-v20. Suite: 181 green.
