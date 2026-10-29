# Multilingual Ask Arya (spec, owner request 2026-10-29)

Ask Arya answers in the language the user writes in, and acts on
facts stated in any language. The answering layer is already a
model (Spark via `api/chat_service.py` + `prompts/chat_v1.md`), so
this is three thin layers, not a translation project. No new
services, no new model calls on the English path.

## Scope

**In:** Ask replies + actions in the user's language; a Profile
language setting; the add box's fast-path gating; voice-input
language behaviour (after the verification in §4).

**Out (explicitly):** translating the app's buttons and labels
(full PWA i18n is a separate strings-table project); translating
product names, store names, or receipt text — those are data and
stay exactly as printed; receipt decoding (already reads what is
printed); other model surfaces (identity proposals, staple judge)
beyond §2's reply surface.

**Tested languages for v1:** English, Spanish (es), Hindi (hi).
The mechanism is language-general; these three are what we verify.

## Build status (2026-10-29)

Backend and Ask logic are built (this spec's §1, §2, §3 server side).
All front-end work (Profile Language row, the one-time "Reply in
Español?" offer, speech-output language, strings) is handed to the
React port ("Improve Arya look and feel" thread), by the owner's rule.
Found while building: item ids and the dedupe key were ASCII-only, so
every Hindi item shared the id `manual-` (and Ask could not add one);
`item_slug` in `api/list/intake.py` fixes both. §3 is done server side
in `/api/list/from-text` (the PWA needs no change). §4 voice stays open
until a real Spanish and Hindi clip has been tried.

## 1. Reply language

- `prompts/chat_v1.md` gains, near the top:

  > Reply in the language the user wrote in. When a REPLY
  > LANGUAGE line is present, reply in that language instead.
  > Keep product names, store names, and list names exactly as
  > they appear in the snapshot, whatever language you reply in.
  > Amounts keep the household's currency symbol and format.

- `api/chat_service.py::chat()` appends one more context message,
  mirroring the CURRENT SCREEN pattern, when the account's
  language setting is not `auto`:

  `REPLY LANGUAGE: <name> (<code>)` — e.g. `Spanish (es)`.

  With `auto`, no line is sent and the model mirrors the user's
  language per message.

- Setting: `settings.json` field `language`, default `"auto"`,
  written through `POST /api/settings` (the currency field is the
  precedent). Profile gains a Language row beside Currency with
  options: Auto, English, Español, हिन्दी. The chat route reads it
  the same way other settings are read; demo accounts ignore it
  (demo replies stay English unless the visitor writes otherwise —
  `auto` semantics).

## 2. Actions parity

- The prompt's action contract is unchanged; add one sentence:
  "A fact or request stated in any language emits the same
  actions; the `item` and `list` values always use the snapshot's
  names, never a translation."
- Code-generated user text in the Ask flows localizes by the same
  setting (templates, not model calls): the risky-action
  confirmation lines in `chat_service._risky_text` ("Mark X as
  expired? …", "Stop suggesting X?", "Snooze X for N days?") and
  the "I don't track X yet" skip line get `es`/`hi` templates in a
  small dict keyed by language code, English otherwise. Keep the
  templates beside the current strings; no framework.

## 3. The add box fast-path gate

The unified add/ask field files plain English adds in code ($0).
That parser is English-shaped; a non-English add must never
misfire through it.

- In the `#add-submit` flow (`pwa/app.js`): if the input contains
  non-Latin script, or the account language setting is a non-English
  fixed language, skip the code fast-path and route the text to
  Ask (one Spark call, the same class as any Ask question — the
  model files it via `add_to_list`). English input on `auto` keeps
  the $0 path exactly as today.
- The receipt of the action is identical either way: the item
  lands on the list, translated names never enter the dictionary
  (the model emits the user's own words for a new item, snapshot
  names for known ones).

## 4. Voice — verify before building

`POST /api/transcribe` passes no language today. Before writing
code, read the Meta API docs for muse-voice-transcribe-1.0 and
record the finding in the implementing PR:

- If it auto-detects the spoken language: no change; the
  transcript returns in the spoken language and §1 handles the
  reply.
- If it accepts a language parameter: pass the account setting
  when it is a fixed language; omit it on `auto`.

Do not guess this in code.

## Tests

- Unit: with `language = "es"`, `chat()`'s messages contain the
  `REPLY LANGUAGE: Spanish (es)` line; with `"auto"` they do not.
  The prompt file contains the §1 block (pin).
- Unit: `_risky_text` returns the Spanish template under `es`,
  English under `auto`.
- Live eval (lane-run, logged in `assistant/loops/`): the demo
  household, ten canonical questions × {en, es, hi} — what is
  running low, what did I spend in October, add milk, we finished
  the eggs, is bread cheaper at Costco, snooze the almonds, what
  expires soon, add naan to the Indian Store list, how much was
  the shrimp, what should I buy today. Pass = reply in the asked
  language, product names untranslated, action set identical to
  the English run.

## Cost

No new calls on the English path. Non-English adds take the Ask
path they would take as questions. Everything stays on Spark
Standard, personal data as today.

## Demo note

The Nov 3 demo script gets one exchange: "¿Qué se está
acabando?" answered in Spanish from the same snapshot. It is a
feature of the shipped build, not a staged trick — it must run on
the live demo household.
