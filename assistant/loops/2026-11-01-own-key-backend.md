# 2026-11-01 Your own Meta key: backend, sign-up path and never-fallback accounts

Owner decisions: own keys are a generic feature with no flag (on when the server has ARYA_KEY_VAULT_SECRET); a second way in is signing up with your own Meta key (no waitlist); such an account never falls back to Arya's keys or budget; Ops-only door like Registration's; the demo cap may point to own-key sign-up; Help and Ask lines only when available. Design reviewed twice by Fable (/mnt/project-files/arya-byok-review/REVIEW.md, REVIEW-2.md; plan PLAN-2.md).

- `api/own_key.py`: Fernet vault (ARYA_KEY_VAULT_SECRET), per-user own_key.json, keyed hash to cap 3 accounts per key, one-call Spark check, failure classification and key scrubbing, Ops door, pending sign-up keys (15 min), throttles.
- `api/meta_client.py`: own-key clients raise OwnKeyFailed on key failures, marking the key Needs attention.
- `api/deps.py`: own-key spend goes to the `own_key` ledger bucket with an hourly guard; key accounts with no working key get 402 + `X-Arya-Offer: own-key-fix`; cap errors carry `own-key`, demo caps `own-key-signup`.
- Routes: /api/account/own-key, /auth/own-key/start, /verify, /door; ~20 model guards use `own_key.need_model()`.
- Ask: `[if own_key]`/`[if byok]` lines follow `own_key.available()`.

Tests: tests/test_own_key.py (33). Python suite: same failures as main. Web suite 481 pass, pack.test.tsx flaky test passes alone.
