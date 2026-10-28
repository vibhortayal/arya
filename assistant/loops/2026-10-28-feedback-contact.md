# 2026-10-28 — Feature request / Contact us

- Profile gets a "Feature request / Contact us" row and a small screen: kind (Idea, Bug, Question) plus one note (1,000 characters max).
- `POST /api/feedback` appends to `feedback.jsonl` in the data root. A note holds time, username, kind, text. No other personal data.
- Spam guard: login required, 5 notes per account per day (`ARYA_FEEDBACK_DAILY_CAP`), identical repeats refused. Closed to the demo household via `_DEMO_CLOSED`.
- `GET /api/feedback` is owner-only (the first account); the screen shows a "Received" list to the owner.
- No model calls, $0. Tests: `tests/test_feedback.py`. Full suite green.
