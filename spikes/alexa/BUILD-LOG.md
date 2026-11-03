# Alexa skill: build log

Status: built and merged to `main` behind `ARYA_ALEXA` (off by default). Not advertised anywhere. Real-device test still pending. No secrets, client secret values or `.env` contents are recorded here.

## Goal
"Alexa, ask my arya to add milk" puts milk on the right Arya list.

## Decisions (owner, 2026-11-03)
- **Hidden behind a flag.** `ARYA_ALEXA` is off by default. When off, every `/alexa/*` and `/api/alexa/*` path returns 404 and nothing changes in the UI, Help, guide cards, Ask Arya knowledge, docs, STATUS or README. No documentation until it is built and working.
- **Invocation name "my arya".** Amazon refuses one-word names such as plain "arya" unless you prove brand ownership. The console accepted "my arya". Backup if it is misheard: "arya shopper".
- **Hybrid AI with a Spark fallback.** Clear adds go on the list at once and Alexa says what was added. Unclear adds (sound-alike names, uncertain list) answer "Sent to Arya" and run in the background; Spark (standard tier, budget guard, 60 per hour) picks only real lists. If Spark fails, the item is added as heard. It is never dropped.
- **Async "Sent to Arya".** Alexa must answer fast, so the slow fix-up happens after the reply.
- **"From Alexa" Today card.** Only unclear adds appear, with tags "Arya's guess" or "Not checked". Buttons: Right (keeps it, Undo toast) and Fix (change list, edit name, remove). Hideable in Customize, gone when empty, rows clear after 7 days.
- **Consent page.** Plain HTML served by the API, mockup approved first. Includes an unlink note and a Close button on error screens.
- **Demo refused, registration stays closed.** Demo Town visitors cannot link.
- **One-way pull from Alexa's own lists is not possible.** Amazon removed the List Management API on 2024-07-01. See `ALEXA-LISTS-SYNC-DESIGN.md`.

## What was built
- PR #515 (`f25e014`): account linking and the skill endpoint.
  - `/alexa/authorize` and `/alexa/token`: OAuth authorization-code linking to an existing Arya account. Codes and tokens are hashed and one-time, and are revoked when the account is deleted.
  - `/alexa/skill`: checks Amazon's certificate URL, chain, signature and the 150 s timestamp window, plus the skill ID. Retries are answered once per `requestId`.
  - `/api/alexa/review`: feeds the Today card.
  - Files: `assistant/api/routes/alexa.py`, `alexa_link.py`, `alexa_brain.py`, `alexa_verify.py`, `alexa_review.py`, with compose env wiring and 26 tests in `assistant/tests/test_alexa.py`.
- PR #516 (`43dd148`): the hidden "From Alexa" card on Today (`todayAlexa.tsx`, with tests).

## Amazon console setup
Full steps are in `CONSOLE-STEPS.md`; the interaction model is `interaction-model.json`. In short:
1. Create a Custom skill named Arya (English US, provision your own).
2. Invocation name "my arya".
3. Paste the interaction model and build.
4. Endpoint: HTTPS, `https://arya.teamnightshift.org/alexa/skill`, trusted-CA certificate. Copy the Skill ID (not a secret).
5. Account linking: Auth Code Grant, authorize URL `/alexa/authorize`, token URL `/alexa/token`, client ID `arya-alexa`, a long random client secret (typed by the owner, never pasted in chat), HTTP Basic, scope `lists` (a leftover name with no Amazon-side effect), token expiry 3600.
6. Copy back the three public Alexa redirect URLs.

## VM environment
Add to `deploy/.env` on the VM, then recreate the API container (a plain restart does not reload env). Ops does this, and the secret is typed on the VM by the owner:
- `ARYA_ALEXA=1`
- `ARYA_ALEXA_CLIENT_ID=arya-alexa`
- `ARYA_ALEXA_CLIENT_SECRET=<owner types it on the VM>`
- `ARYA_ALEXA_SKILL_ID=<Skill ID from the console>`
- `ARYA_ALEXA_REDIRECTS=<the three redirect URLs, comma separated, no spaces>`

Leave `ARYA_ALEXA` at 0 or unset to keep everything hidden.

## What was tested
- Automated: 26 backend tests for linking, token handling, signature and time checks, retries, clear and unclear adds, Spark failure fallback, the flag-off 404s and demo refusal; frontend tests for the Today card.
- Not yet done (as of 2026-11-03): an end-to-end test with the flag on, account linking from the Alexa app, and a spoken add on a real Echo or phone. Confirm with Ops whether the VM env has been set.

## Open risks
- **"my arya" mishearing.** Alexa may hear "maria" or "my area". Test with real voices; fall back to "arya shopper".
- **Longer phrase.** Users must say "ask my arya to add ...", not "add to my shopping list". That is Amazon's limit.
- **Add-only.** No edit or delete sync from Alexa.
- **Development mode only works on the owner's own Amazon account.** Public use needs certification.
- **Spark cost and rate.** Bounded by the daily budget and 60 per hour, and a failure adds as heard.
- **Privacy wording.** Do not say Meta may train on receipt photos. Not relevant to Alexa text, but keep user-facing text consistent with that rule.
