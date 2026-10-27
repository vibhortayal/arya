# 2026-10-27 — Intake parity: the five doors, live in the app

Owner ruling (chat, 2026-10-27 evening; DISCUSSION entry 26): intake
is NOT Muse-only. "Every door runs on Meta models — Muse in chat,
Spark on the Meta API in the app." The wireframes (B2 Add) already
showed five doors; the live app still pushed everything through
Muse, and Ask's mic used the browser's speech engine. This stage
makes the app match the paper. Owner chose "build Intake parity now,
ahead of the restyle."

## 1 — Transcription surface, verified before building

From Meta's docs (via the connector doc + docs read 2026-10-27):
**Muse Voice Transcribe** is real and live on this team's key
(`muse-voice-transcribe-1.0` appears in GET /v1/models).

- Batch: `POST https://api.meta.ai/v1/asr/transcribe`, multipart
  upload, Bearer-header auth. Input is narrow: **mono 16-bit PCM WAV
  at 16 or 24 kHz only**; caps 32 MB / 10 min per request.
- Streaming alternative: `wss://api.meta.ai/v1/asr/realtime`
  (auth in the first frame, not the header) — not used; record-then-
  send fits both doors.
- Price: **$0.18 per audio hour**, same as MODEL-POLICY.md already
  records. No live probe was run from the dev box (the raw key lives
  only on the Oracle runtime); the batch response envelope is parsed
  defensively (`text` / `transcript` / ordered `turns` / `segments`)
  and the deploy smoke should confirm the exact shape once.

## 2 — Server (`a4634f5`, `584e051`)

- `api/meta_client.py`: `transcribe()` — the only module that calls
  the API gains a multipart send (fields + file part over the same
  injectable transport); cost = duration × $0.18/hr, ledger row with
  mode "voice". `api/voice/service.py`: WAV validation against the
  endpoint contract (mono / 16-bit / 16 or 24 kHz / ≤10 min / ≤32 MB)
  and transcript extraction. Nothing is persisted — a transcript is
  a return value, not a record.
- `POST /api/transcribe` (auth-gated by the existing middleware,
  budget-guarded like every model route): WAV in, `{text,
  duration_s, model, demo}` out. 415 wrong type, 400 empty, 413 over
  10 MB, 422 a WAV the endpoint would refuse, 502 empty transcript,
  503 no key.
- Demo carve-out: the middleware's read-only rule now exempts
  exactly two POSTs — `/decode/photo` and `/api/transcribe`. In the
  demo the photo route runs the same live decode and returns the
  lines as a preview (`{demo: true, added: 0}`) without filing or
  judging; transcription is stateless, so demo voice is live by
  construction. Every other demo write is still 403 (tested).
- Found on the way: session records live in the root store, but
  `state.data_dir()` is per-user once the middleware sets the
  context — a route that re-reads the session after that point sees
  nothing. `_is_demo()` reads the session with the context cleared.

## 3 — PWA (`6abc9bf`)

- Add tab is now the five doors: **Via Muse** (connector status,
  as before), **Photo** ("Spark on the Meta API" — file input posting
  the raw image to the existing `/decode/photo`, exactly as the
  Quest receipt finish does; filed receipts refresh the review queue
  below; in the demo, the read lines render as a preview card),
  **Voice** ("Muse Voice Transcribe" — record, transcribe, edit,
  Add to my list, one `/api/list/add` per parsed item), **Paste**
  (order text → `/api/intake/order-text`), **Type** (one item →
  `/api/list/add`). Paste/Type are disabled in the demo with the
  reason stated; Photo/Voice are live there.
- Recording: browsers cannot record WAV, so app.js captures the mic
  with Web Audio and encodes mono 16-bit PCM WAV at 16 kHz
  client-side — the exact shape the endpoint accepts. No server-side
  transcoding dependency.
- Ask Arya's mic now uses the same path and REPLACES the device
  SpeechRecognition input (removed entirely — grep-clean). Spoken
  replies stay device TTS and are labeled as nothing more
  (MODEL-POLICY rule 5; Meta has no TTS API).
- Copy: the invariant line stands at the top of Add and in Profile's
  Connect Muse card; the demo blurb on the login screen no longer
  claims "no model calls" (the two doors do call, on camera); the
  connect flow's last step names the Add doors too. SW → arya-v15.

## Tests / cost

Suite **83 → 116 green** across the session (Quest Stage D landed
concurrently; this stage adds 16: 9 unit in test_voice.py — multipart
shape, Bearer key, per-hour cost, ledger row, WAV validation,
transcript shapes — and 7 endpoint in test_intake_parity.py — login
required, statelessness, type/size/key failures, demo preview saves
nothing, demo transcribe works, other demo writes stay 403).
Model spend by this stage: $0 (all tests run on fakes; no live call
was made from the dev box).

## Next

Parent reviews, pushes, deploys (git pull on the VM), and smokes:
real mic → transcript in Ask and in the Voice door, demo photo
preview, and one live ASR call to confirm the response envelope
matches the defensive parser.
