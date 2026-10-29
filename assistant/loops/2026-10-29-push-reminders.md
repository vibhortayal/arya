# 2026-10-29 push reminders (flag)
- Owner approved the wireframe. Built api/reminders.py, /api/push/* routes
  (404 unless ARYA_PUSH_REMINDERS=1 and VAPID keys set), push.js, Profile
  "Reminders" section (hidden by default), sw.js push + notificationclick.
- Daily job: `python -m api.reminders` (cron). One push per account per day.
- 11 new tests; suite 995 green. No model calls.
- Next: owner generates keys on the VM, adds the cron line, tries a test
  reminder on a phone (iPhone needs Add to Home Screen).
