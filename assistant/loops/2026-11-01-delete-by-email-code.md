# 2026-11-01 Delete my account by emailed code

The security and privacy review (project file arya-security-review/SECURITY-REVIEW.md) found that accounts made by email code or Google could not delete themselves: `/auth/account/delete` checked a password those accounts do not have, so it always failed. The privacy page promises deletion in Settings. Owner approved a 6-digit code emailed to the account, and approved the UI/UX thread's mockup (arya-delete-account-mockup/).

- `POST /auth/account/delete/code` (no-password accounts only) emails a code through Resend (`mailer.account_delete_code`). The code lasts 10 minutes, allows 5 wrong tries, and can be resent once a minute. Codes are kept in memory (one worker), hashed.
- `POST /auth/account/delete` takes `{code}` for those accounts and `{password}` for the others. A code never replaces a password.
- `/auth/me` returns `has_password` so Settings shows the right box.
- `auth.delete_user` also drops the account's Postgres rows (`pgstore.delete_owner`) in dual/pg mode. Live runs dual, so the Supabase copy used to stay.
- Settings: warning box, Email me a code, code field (one-time-code autofill), Erase everything, Send a new code in 0:SS, Cancel; email-failed state pointing to support@.
- Privacy page: how deleting works, the database copy and backups (deleted within 30 days); groups wording now says every member's receipts, older ones and photos included, and any member can share the code (owner: that behaviour is fine, only the wording was wrong).
- Help (Settings guide card s3, Share topic body) and `prompts/arya_features.md` updated to match.

Tests: `tests/test_delete_by_code.py` (12). Python has the same 12 failures as main; vitest green. Real-app run at 390x844: send, wrong code, mail failure, password account, and a successful erase that lands on the start page.
