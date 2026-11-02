# 2026-11-02 Local judge setup: plain sign-in, Demo Town seed, groups

Owner, 2026-11-02:
- local runs should have no waitlist and no Google sign-in, just a username and password, controlled by configuration;
- judges need rich seed data (households, store names, availability, out of stock) and step-by-step test steps.

All of it is configuration. Only `compose.yaml` changes, which is local only. The live deploy file and the app code are unchanged.

- `ARYA_DEMO_TOWN` now defaults to 1. The demo household shops in Demo Town: 800 simulated households, 8 stores, stock per item and store, out-of-stock and closed reports, busy hours, community prices, and the Director (`?director=1`, Settings) to stage moments. The flag must be on at the first start, because the seed writes the town's store names.
- `ARYA_REGISTRATION_OPEN` now defaults to 1. The landing page shows "Start my own list" and the sign-in sheet shows "New here? Create account", in place of the waitlist.
- `ARYA_GROUPS` now defaults to 1, so two local accounts can share a group.
- `ARYA_SUPABASE_AUTH` is pinned to "0", and no Supabase, Google OAuth, Resend or key-vault variables are passed. So there is no Google, no email codes and no own-key sign-up door. `tests/test_local_compose.py` checks this.
- Verified in a container:
  - `/auth/status` returns registration_open true and email_signin false;
  - the landing page has no "waitlist" and no "Google", and shows "Start my own list";
  - Today shows Near you today, out-of-stock Hummus at Trader Jill's and the cheaper-elsewhere card;
  - the Trader Jill's list shows its heads-up;
  - My stores shows the Demo Town stores;
  - Director "eggs_out" marks eggs out;
  - a quest starts with no key;
  - two accounts made a group, and an item added by one showed for the other.
- The judge steps (`TRY-THE-FEATURES.md`) went to the Doc maintainer for docs/.
