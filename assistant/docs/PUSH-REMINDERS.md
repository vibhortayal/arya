# Push reminders (flag, off by default)

A phone can opt in from Profile > Reminders. Arya then sends one push a
day, at most, when a staple will run out inside the notice window
(1 to 7 days, default 2). The same staples as Today's running-low list
qualify, plus the ones due inside the window. A cycle is announced once;
a new receipt for the item starts a new cycle.

## Turn it on (VM)
1. `python tools/make_vapid_keys.py deploy/.env` (writes the keys to the
   file; the private key is not printed).
2. In `deploy/.env`, set `ARYA_VAPID_SUBJECT=mailto:<your email>` and
   `ARYA_PUSH_REMINDERS=1`.
3. Rebuild the api container (pywebpush is a new requirement).
4. Add one daily cron line on the VM, for example 9:00 local:
   `0 9 * * * cd /home/ubuntu/arya/assistant/deploy && docker compose exec -T api python -m api.reminders`

Without the flag and both keys, `/api/push/*` answers 404 (config says
`enabled: false`) and the Profile section stays hidden. To turn off,
remove `ARYA_PUSH_REMINDERS`.

## Notes
- iPhone: works only after Add to Home Screen (iOS 16.4 or newer).
- Demo accounts never see the section.
- Subscriptions live per account in `push.json`; a phone that answers
  404 or 410 is dropped.
- No model calls; cost is $0.
