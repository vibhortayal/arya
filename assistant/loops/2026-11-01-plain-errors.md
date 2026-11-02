# 2026-11-01 Plain error words: AI refusals and offline changes

Owner (approved "Yes"): the avatar Make showed "Meta API HTTP 400 … content_policy_violation". Owner's group test: adding to a list offline said only "no connection".

- `api/meta_client.py`: every failed Meta call raises `ModelError` (still a RuntimeError) with a plain sentence; the raw status and payload go to the `arya.meta` log, and `.status`/`.raw` stay on the error (ledger error kinds unchanged). Image refusals: "Meta's image model couldn't draw that. Try describing the picture without a show, film, game or brand name." Also busy (429), trouble (5xx), unreachable, and other.
- `api/errors.py` `safe_detail`: every 502 route (avatar, intake, chat, eyes, lists photo, shelf, expiry, quest, receipt jobs, Places, email code) passes the error through it; anything that still looks like raw machine text is logged and replaced by "Arya couldn't finish that just now. Try again in a minute."
- `web/src/lib/api.ts`: a change made with no signal fails at once with "You're offline. You can look at your lists as last saved, but changes need a connection. Try again when you're back online." (offline stays read-only).
- Ask knowledge: the "ai" section says what these messages mean.

Tests: tests/test_plain_errors.py; test_meta_client and test_offline_hunt updated. Python suite same failures as main.
