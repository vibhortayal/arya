# Spike: Alexa and list import (paused)

Status: **paused**. Nothing here is published, linked from docs, Help or Ask Arya.

- **Alexa skill:** the code is already on `main`, behind the `ARYA_ALEXA` flag (off by default; when off, `/api/alexa/*` returns 404). See `assistant/api/routes/alexa.py`, `alexa_link.py`, `alexa_brain.py`.
- **List import:** design only, no code. See `LIST-IMPORT-DESIGN.md`.
- **Alexa list sync:** not possible. Amazon removed the List Management API on 2024-07-01. See `ALEXA-LISTS-SYNC-DESIGN.md`.

Files:
- `ALEXA-LISTS-SYNC-DESIGN.md` - why one-way Alexa list pull fails, and the alternatives.
- `LIST-IMPORT-DESIGN.md` - options for importing lists from other apps.
- `CONSOLE-STEPS.md` - Alexa developer console setup steps (owner checklist).
- `interaction-model.json` - the skill's interaction model (invocation name "my arya").

## Resume first
1. Finish the Alexa console setup in `CONSOLE-STEPS.md` and set the `ARYA_ALEXA*` env vars on the VM.
2. Test account linking and a voice add end to end with the flag on.
3. Only then decide on a manual "paste your Alexa list" import, using `LIST-IMPORT-DESIGN.md`.
4. Keep it out of user-facing docs until the owner says it works.
