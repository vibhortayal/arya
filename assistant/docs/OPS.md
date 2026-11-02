# OPS — watching Arya and what to do when it breaks

Written 2026-10-31 from the ops review. Everything here runs on the VM,
from `assistant/deploy`. The owner is the only operator.

## What watches the app
| Thing | Where | Alerts you when |
|---|---|---|
| Outside uptime check on `https://arya.teamnightshift.org/health` | UptimeRobot or Better Stack, free plan | The site is down, or `/health` answers 503 (data folder not writable, or free disk under `ARYA_HEALTH_MIN_FREE_MB`, default 500) |
| Daily report email | cron + `python -m harness.ops report --email` | Every morning; the subject starts `[Arya] Needs a look` when a model type fails more than 10% of calls (5 or more calls), is slow (p95 over 20 s), a budget is at 80%, an account is frozen, the disk is low, or new feedback came in |
| Backup dead-man ping | Healthchecks.io free plan, pinged at the end of `backup.sh` | The nightly backup did not finish |

## The Ops screen (owner only)
Settings, Account group, first row: **Ops and health** (shows "All quiet" or "Needs a look"). It needs `ARYA_OWNER_USERNAME` set, like the Registration switch. It shows what needs a look, the box (disk, newest backup), spend against the daily caps, model calls with failures and slow calls, and the controls:
- **Pause all paid reads** (asks first): no model call starts for anyone, demo included. Lists, Today and sign-in keep working.
- **Photo reader** Spark or Wonder: beats `ARYA_PHOTO_READER`, no redeploy.
- **Demo live reads**: off stops only the demo household's paid reads.
- **Registration**: the existing switch.
- **Unfreeze** on a frozen account.
- **Settings** (2026-11-01): three pages under the Ops screen. *Models and reading*: photo reader (Wonder, Spark only, or Spark first with Wonder as backup), Spark plan (Standard, which is what Arya runs; Contributor is a different Meta plan and is not used), Spark reasoning effort, open model name. *Dollar limits*: hourly freeze, freeze length, monthly heads-up and ceiling, daily budgets for the real app and the demo, per-demo-visit budget, and per-account overrides (for example $10 an hour for one account). *Other caps*: store-scan frames a day, Kroger calls a day, MCP calls an hour, feedback and waitlist emails, demo sign-ins. Each value is held to a safe range. A value set here beats the `.env` variable; "Use default" hands it back to `.env`. They live in `site.json` under `settings` and `overrides`.
- **Meta says spent**: type what Meta's dashboard shows; Ops shows the gap to Arya's ledger.
- **Recent changes**: the last changes from `ops-changes.jsonl`.
The switches live in `site.json` in the data folder (`ai_paused`, `demo_live`, `photo_reader`), apply within about 3 seconds, and every change is appended to `ops-changes.jsonl` with the time and account. The newest-backup row needs the backups folder: compose mounts `/home/ubuntu/arya-backups` read only at `/backups`; with no folder mounted the row is left out.

## Own Meta keys (BYOK, 2026-11-01)
- **Before the deploy that ships it:** set `ARYA_KEY_VAULT_SECRET` in `deploy/.env` (generate with `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`), then `docker compose up -d`. Without it the feature stays off and nothing is stored. Losing or changing the secret means every saved key must be entered again (the account sees "needs attention"). The image needs the `cryptography` wheel (in `api/requirements.txt`); check the ARM build before deploy day.
- **Two kinds of account:** "shared" (invited, Arya's key; may add its own key in Settings) and "own" (signed up with its own key; `key_mode: "own"` in `users.json`). An own account never reads on Arya's key: with no working key its reads answer 402 and the rest of the app works.
- **The sign-up door:** `POST /auth/own-key/door {"open": false}` (owner only) closes it at once; `ARYA_OWN_KEY_SIGNUP` is only the bootstrap default. It also closes itself when `own_key_signups_per_day` is used up. Limits: 3 key checks per IP an hour, 3 per email a day, 10 accounts per IP a day, one key on at most 3 accounts.
- **Caps for own-key reading:** the daily budget and monthly ceiling do not apply; the pause switch, scan frames, upload sizes and per-IP limits do, plus `own_key_hourly_usd` (default $5 an hour, a load guard). Own accounts get no open-weights second seat and `places_daily_lookups` Google store lookups a day.
- **Files:** `data/users/<user>/own_key.json` (encrypted key, last 4, a keyed hash, status), `data/pending_own_key/` (keys held 15 minutes while the email code is checked; swept on expiry), `data/own_key_signups.json` (today's count). Ledger rows for own-key calls have `bucket: "own_key"`.

## Accounts and data tools (Ops)
- **Accounts**: switch an account off or on, unfreeze, change the owner, and open the waitlist.
- **Data tools**: erase one account's receipts or learned names (owner types the account name; a copy is first saved to `ops-deleted/` in the data folder, restore by copying it back), and run the Supabase mirror **Backfill** (copies every file into the database) or **Verify** (compares every file to the database) as a background job. Both need `DATABASE_URL`.

## Recover the owner
Ops can name a different owner account (Settings, Ops and health, Accounts). Your old account keeps owner rights for 24 hours, so a wrong pick is undone by signing in with it and naming the right account. If both are lost: on the VM, remove the `"owner"` key from `site.json` in the data folder (the owner is then `ARYA_OWNER_USERNAME` from `.env` again), or set `ARYA_OWNER_USERNAME` in `.env` and run `docker compose up -d`. The environment account is always an owner. A switched-off account (Accounts) gets 403 on every call; switch it back on from the same page, or remove its name from `"disabled"` in `site.json`.

## Feedback emails
Each new feedback note (signed-in or end of demo) is emailed to `ARYA_OPS_EMAIL`, up to `ARYA_FEEDBACK_MAIL_CAP` a day (default 20; the daily report still counts them all). To email every note saved so far, once: `docker compose exec -T api python -m harness.feedback_mail`.

## One-time setup on the VM
1. Add to `assistant/deploy/.env`: `ARYA_OPS_EMAIL=you@example.com` (and `RESEND_API_KEY` is already there). `chmod 600 .env`.
2. `git pull`, then `GIT_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build` (not `restart`: restart does not re-read `.env`). `/health` then shows which commit is running (`curl -s https://arya.teamnightshift.org/health`); without `GIT_COMMIT` it says `"unknown"`.
3. Try it: `docker compose exec -T api python -m harness.ops report`. Then with `--email`.
4. Cron (`crontab -e`), times in the VM's zone:
   ```
   17 3 * * *  /home/ubuntu/arya/assistant/deploy/backup.sh >> /var/log/arya-backup.log 2>&1
   30 13 * * * cd /home/ubuntu/arya/assistant/deploy && docker compose exec -T api python -m harness.ops report --email >> /var/log/arya-ops.log 2>&1
   ```
5. Backups: set `ARYA_BACKUP_REMOTE` (rclone remote, for example a Cloudflare R2 bucket), then run `backup.sh` by hand once and check the file arrived off the VM.
6. Restore test (do it once, into a scratch folder, not over live data): `mkdir /tmp/restore-test && tar xzf ~/arya-backups/arya-data-*.tar.gz -C /tmp/restore-test` and open a few files. Read `restore.sh` before running it for real.
7. Take one Oracle boot-volume backup before judging.
8. Make sure `support@teamnightshift.org` forwards to you (Cloudflare Email Routing, free). Arya's paused-account message sends people there.

## Waitlist join emails
When a new address joins the waitlist the app emails you "[Arya] New waitlist join" with the address, the time and where to review it (Settings, Waitlist). Set `ARYA_WAITLIST_NOTIFY_EMAIL` in `.env`; if empty it uses `ARYA_OPS_EMAIL`; if both are empty or `RESEND_API_KEY` is missing nothing is sent. It is sent after the visitor's answer, so a slow or failing mail never blocks joining. A repeat of the same address sends nothing. At most `ARYA_WAITLIST_NOTIFY_PER_HOUR` (default 10) mails an hour per API process; past that one "many joins, emails paused" notice goes out and the rest stay on the Waitlist screen. The address is never written to the logs.

## What the numbers mean
The cost ledger (`cost-ledger.jsonl` in the data folder) has one row per model call. Since 2026-10-31 a row also has `ms` (how long the call took), and a failed call has a row with `ok: false`, `cost_usd: 0` and `err` (`http_429`, `timeout`, `unreachable`, `shape`, `error`). Older rows have none of these. Failed rows do not count toward anyone's usage or the daily budget. A refusal that comes back as a normal 200 answer is not a failure row.

## When something breaks
- **Site down**: `docker compose ps`, then `docker compose logs --tail 100 api caddy`. `docker compose up -d` brings it back.
- **503 from `/health`, "disk nearly full"**: `df -h`, `docker system df`. Old images: `docker image prune`. Do not delete the `arya-data` volume.
- **A model type failing**: the report shows the error kinds. `http_401` is a bad or expired key; `http_429` is a rate limit; `timeout` or `unreachable` is Meta or the network. Wonder failing while Spark works: set `ARYA_PHOTO_READER=spark` and `docker compose up -d`.
- **Pause all paid reads fast**: Settings, Ops and health, Pause all paid reads. If the app is unreachable, set `ARYA_DAILY_BUDGET_USD=0` and `ARYA_DEMO_DAILY_BUDGET_USD=0` in `.env` and run `docker compose up -d`.
- **A frozen account**: the Unfreeze button on the Ops screen.
- **Restore**: `restore.sh <archive>` after reading it; stop the api first.
