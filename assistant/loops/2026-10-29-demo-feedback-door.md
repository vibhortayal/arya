# 2026-10-29 Demo feedback door

What changed: `POST /api/demo/feedback`, the one demo write that reaches disk. Demo sessions only. The
visitor's email is required, lowercased and checked, and capped at 3 notes per email per day. Backstops:
10 an hour per IP, 200 a day in all, a honeypot field. Stored in `feedback.jsonl` as kind `beta`, user
`demo-visitor`, with the email as `contact`; the owner's inbox shows it. Never logged or mailed. The
old `/api/feedback` stays closed to the demo. Tests: `TestDemoFeedbackDoor` (9). No model calls, $0.

Next: the end-of-demo sheet in the demo tour (wireframe awaiting owner approval).

Also in this PR: the end-of-demo sheet (`web/src/ui/EndOfDemo.tsx`, owner-approved wireframe), opened from
a "Finish demo" link in the demo bar and by `openEndOfDemo()` (the demo tour's last step will call it).
Thanks, "open to a few people for now", feedback + email, LinkedIn, GitHub, "peek inside Arya's code".
