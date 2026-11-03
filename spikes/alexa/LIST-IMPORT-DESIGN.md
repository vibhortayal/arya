# Generic one-way list import into Arya: design

Date: 2026-11-03. Private design note. Nothing built, no docs/Help/Ask Arya touched. Alexa parts stay behind ARYA_ALEXA and undocumented.

## Bottom line

**Build the no-API door first, then one connector.** Arya already has most of the engine: paste/CSV/JSON preview import (`api/list/importer.py`, `/api/list/import-preview`), the open `POST /api/v1/lists/import` (bearer token, 500 rows), and the Alexa "fix what was heard, review the unclear" pipeline (`alexa_brain.py`, `alexa_review.py`). A generic import is mostly **one adapter interface plus a shared "normalize, fix, dedupe, review" step** in front of what exists.

Recommended order:
1. **Phase 0 (before/at freeze, ~0.5 day, no new UI):** document-free groundwork only: define the adapter interface and the shared pipeline in code, route the existing paste import through it. Zero user-visible change.
2. **Phase 1 (after Nov 4, ~2 days):** "Import" with file / share-sheet / iOS Shortcut / email-in fallbacks. Works for every app, including those with no API (Apple Reminders, AnyList, OurGroceries, Bring, Keep).
3. **Phase 2 (after Phase 1, ~3 days each):** OAuth connectors for **Todoist** first, then **Google Tasks**, then **Microsoft To Do**. These are the only consumer apps with a supported public read API and OAuth.
4. Not building: Notion (only worth it as a generic "database" import, low grocery usage), and any unofficial/reverse-engineered route (Bring, AnyList, Alexa cookies).

## Which apps have what (verified from vendor docs where noted)

| App | Official read API + OAuth? | Change feed | Fallback that needs no API | Verdict |
|---|---|---|---|---|
| Todoist | **Yes.** OAuth2 code flow, scope `data:read`, 1h access tokens + rotating refresh tokens, Sync API with incremental `sync_token` (docs verified) | Sync token (poll); webhooks exist for apps but not verified here | CSV export of a project | **Connector #1** |
| Google Tasks | **Yes.** `tasks.readonly` scope (docs verified). Unverified-app warning until Google verification; I could not confirm whether this scope needs a security review | Poll with `updatedMin` | none needed | **Connector #2** |
| Microsoft To Do | **Yes**, Microsoft Graph `/me/todo/lists` and `/tasks`, delta query supported (docs verified). Permission names and personal-account support not confirmed from the page I read | Delta query; Graph change notifications for To Do not confirmed | none needed | **Connector #3** |
| Google Keep | **No for consumers.** API is Workspace-enterprise only (domain-wide delegation) | n/a | Google Takeout export; copy/share text | Fallback only |
| Apple Reminders | **No web API.** Only on-device EventKit (native apps); iCloud has no public REST | none | **iOS Shortcut "Get Reminders" -> POST to Arya**, or Share/copy text | Shortcut fallback |
| Notion | Yes (public integration OAuth, database query, about 3 requests/s average) but a grocery list is free-form; user must pick a database and map columns | poll | CSV export | Later, generic "database" connector, low priority |
| AnyList | No official public API. Community clients use a private protobuf API with the user's password | none | Share/copy list text, in-app CSV export | Fallback only |
| OurGroceries | No official public API found | none | Share list as text/email | Fallback only |
| Bring! | **Unofficial only.** The popular library says it is unofficial and logs in with email and password | none | Share list as text | Fallback only. Do not store third-party passwords |
| Alexa lists | **Removed** by Amazon 2024-07-01 (see ALEXA-LISTS-SYNC-DESIGN.md) | n/a | Our voice skill; paste | Behind ARYA_ALEXA, undocumented |

Not verified here: Todoist numeric rate limits and webhook details, Google Tasks default quota, Microsoft permission scopes. Confirm each when its connector is scheduled; none changes the recommendation.

## One adapter interface

```python
class ListSource:                      # api/importers/base.py (new)
    id: str                            # "todoist", "gtasks", "mstodo", "file", "email", "shortcut"
    kind: "pull" | "push"              # pull = we call them; push = they send to us
    def lists(self, cred) -> list[SourceList]          # pull only: pick which list(s)
    def fetch(self, cred, source_list, since=None) -> FetchResult
        # -> {items: [RawItem], cursor: str|None}
    # RawItem: {source_id, name, qty?, unit?, checked, note?, updated_at}
```

Everything after `fetch` is shared and does not know which app it came from:

1. **Normalize:** `RawItem -> {name, qty, unit, checked}` using the existing `importer._item` / `split_list_items_units` ($0, deterministic).
2. **Fix:** names that Arya does not already know go through the same step as Alexa: free first (known items, sound-alike list match), otherwise **one batched Spark Standard call** for the whole import (not one per item), which tidies words and returns `sure: false` when guessing. Import text is data, never instructions (same prompt rule as Alexa).
3. **Dedupe:** three layers. (a) by `(source, source_id)` in an import ledger so re-running never re-adds; (b) by Arya's existing in-list duplicate check; (c) "also_on" rule from API v1: an import never moves an item from another list.
4. **Review:** unsure items land in an "unclear" review row, generalizing `alexa_review.py` to `import_review.py` (reason `guess` | `fallback`). Items are already on the list; the card lets the person keep, rename, move or remove. No second UI is invented: reuse the approved "From Alexa" card pattern, retitled per source.
5. **Preview before add** for the first run of any source (the paste import already works this way). Later polls add silently and show only the unclear ones.

**One-way means one-way.** We never write back, never delete in the source, and a source deletion does not remove an item in Arya. Arya also never auto-adds on its own initiative (owner rule): an import is something the person set up and approved, so this stays inside "only the household adds".

## Pull, poll or webhook

- **Poll, not webhook, for v1.** Webhooks need a public endpoint per provider, signature checks and a registration lifecycle; polling needs only a cursor.
- Cadence: on app open and a manual "Sync now", plus a slow background poll (every few hours, one worker thread like `alexa_jobs`). Use the provider cursor (`sync_token`, `updatedMin`, Graph delta) so a poll with no change is one cheap call.
- Push sources (file, share, Shortcut, email-in) are naturally event-driven.

## Tokens and privacy

- **Arya-issued tokens** (Shortcut/email-in/API): store only a SHA-256 hash, show once. This matches how the existing API/MCP tokens work (`auth.py` hashes tokens).
- **Third-party OAuth tokens** can't be hashed because we must send them. Store encrypted at rest with a server key outside the data folder, read-scope only (`data:read`, `tasks.readonly`), per user, delete on disconnect and on account delete, and revoke at the provider on disconnect (Todoist supports revoke). Never log them. Refresh tokens rotate (Todoist), so write back the newest one atomically.
- **Never store third-party passwords** (rules out Bring/AnyList unofficial routes). 
- Data minimization: fetch only the chosen list(s); keep only names, qty, checked and the source id; drop notes/assignees/due dates unless the person opts in.
- Imported text is untrusted: length caps (existing 80 chars/item, 500 rows), strip formulas as CSV export already does, prompt-injection rule for the Spark step.
- Spark stays on the Standard tier for personal data (existing rule). No "may train" wording anywhere.
- Public OAuth apps need provider verification (Google, Microsoft publisher). That is calendar time, not just code, so it argues for Todoist first (self-serve app).

## Rate limits and cost

- Arya side: reuse the 600/h per-token allowance for push routes (`ARYA_MCP_RATE`), plus a per-user import cap (suggest 5 imports/hour, 500 rows each) and the daily AI budget (`ARYA_DAILY_BUDGET_USD`, default 10). Spark failure or budget hit means items go on as heard to the review card; nothing is dropped (same rule as Alexa).
- Provider side: one `lists` call plus one `fetch` per list per poll. At a few-hour cadence this is a handful of calls per user per day, far under every provider limit I know of (Notion's ~3/s is the tightest, and not a v1 target). Retry with the provider's `retry_after`.
- **Cost per import:** deterministic path $0. Model path: at most **one batched Spark Standard call per import** (only for unknown names), so cost is per import, not per item. Exact price: take from MODELS-BY-THREAD.md at build time; I have not measured it.

## Fallbacks that need no API (build these first)

| Door | How it works | Reuses | Works for | Limits |
|---|---|---|---|---|
| Paste | Copy list text, paste in Add | Already built (`import-preview`) | Everything | Manual |
| File upload (CSV, text, JSON) | Pick a file, preview, add | importer + v1 import | Todoist/Keep Takeout/AnyList/Notion exports | Manual |
| Share sheet | Share list text to Arya | Needs a PWA share target; **iOS Safari PWAs don't support it** as far as I know, so treat as Android-only | Android | Skip on iPhone |
| iOS Shortcut | Shortcut "Get Reminders (list)" then "Get contents of URL" POST to `/api/v1/lists/import?list=X` with bearer token | v1 import, **no new code** | Apple Reminders (the only route) | User must create a token and install the Shortcut; a Shortcut file + 4-step instructions is the work |
| Email-in | Forward or send a list to a per-user address; parsed like paste | Resend inbound is available; per-user address token hashed | Anything that can email text (OurGroceries, AnyList share) | Needs inbound-domain setup and spam/abuse limits; I have not tested Resend inbound end to end |
| Voice | Alexa skill | Existing, ARYA_ALEXA | Alexa | Behind flag, undocumented |

## Pros and cons of the options

| Option | Pros | Cons | Effort |
|---|---|---|---|
| A. Fallbacks only (file, Shortcut, email-in) | Covers every app, no provider approval, no third-party tokens, mostly built | Manual, not live | ~2 days |
| B. A + Todoist connector | Real "connect once" for the most popular API-friendly list app; self-serve OAuth | One app's users only; token storage and refresh to build and secure | +3 days |
| C. B + Google Tasks + Microsoft To Do | Covers the big three account ecosystems | Google/Microsoft verification delays; storage of more tokens | +3 days each |
| D. Unofficial connectors (Bring, AnyList, Alexa cookies) | Reach popular grocery apps | Breaks terms, stores passwords, fragile, security liability | **Reject** |
| E. Webhooks instead of polling | Instant | Per-provider registration, public endpoints, signatures | Defer |

## Effort summary

- Adapter interface + shared pipeline + import ledger: ~1.5 days (includes tests; existing importer, Alexa fixer and review store are reused).
- Fallbacks (file upload UI, Shortcut file + token flow, email-in): ~2 days, plus a phone mockup first (UI rule) and a Tester pass.
- Each OAuth connector: ~3 days (consent flow, encrypted token store, refresh, disconnect/revoke, tests, provider app registration).
- None of this fits before the noon ET Nov 3 UI freeze. Only Phase 0 plumbing could, and I would not rush even that.

## Decisions for the owner

1. Approve the order: shared pipeline, then fallbacks, then Todoist. (My recommendation: yes. Biggest coverage for least risk.)
2. Is the iOS Shortcut route acceptable for Apple Reminders? It is the only supported way, but needs a token and some user setup.
3. Do you want any OAuth connector before the third-party verification wait is worth it? (My recommendation: only Todoist, only after Nov 4.)
4. Confirm review reuse: generalize the "From Alexa" card into "Needs a look" per source (UI/UX thread, mockup first).

## Risks I want you to hear

- Marketing "sync" is not what this is: it is one-way import, and some apps (Keep, Apple, AnyList, Bring, OurGroceries) will never be "connect once". Say "import", not "sync", on anything user-facing.
- The more we hold third-party tokens, the larger the privacy surface; this is why fallbacks come first.
