# 2026-11-01 Reminders: greyed row when they are off

**Ask (owner group test, item 6):** "Couldn't find reminders." The cause: `ARYA_PUSH_REMINDERS` is off on live, so `/api/push/config` returns `enabled:false`, and Settings hid the whole Remind me section. On 23:17Z the owner said yes to a greyed row in place of a hidden one. Mockup: claude.ai/artifact/Sd3QzuunUFwao1AC5QSU9t, section 4.

**Changes**
- `Profile.tsx` `Reminders`: when reminders are off on the server, it shows a greyed Remind me row with a disabled switch and the line "Reminders aren't switched on yet. They're coming soon." When they are on, nothing changes.
- Help "Get reminders" n2 and the Ask reminders line now describe the greyed row.

**Tests:** `screens/reminders.test.tsx` covers both states. `test_push_reminders` now expects both branches. Web: 483 tests pass. Python: 0 failures.

**Not in this PR:** turning reminders on for real. That needs `ARYA_PUSH_REMINDERS=1` plus VAPID keys on the VM, which is an owner and Ops decision.
