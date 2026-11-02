# 2026-11-02 Ask: tap a list instead of typing

- Ask (owner, approved mockup G6Q6JqZmx5u9zBck82PZYx): when Arya asks which list, show the options as tappable chips.
- Built on #475's `choices: [{label, send}]`. lib/replyChoices cleans the list (needs both fields, no repeats, max 6). Chat.tsx adds a "replies" row under Arya's answer; a tap sends `send` as the next message, same as typing. Sending anything (tap or typed) removes the row; it is disabled while Arya is busy.
- Style: white chip with orange outline (Ask's grey chips vanish next to her grey bubble); the photo-flow "Which list?" chips in a bubble match.
- Help ask.n1 and Ask sheet (net zero, cap test passes) say "tap a list under her question".
- Checked: web 538 + Python 1842 pass; Playwright with stubbed /api/chat at 360 and 390: 2 chips, tap sends "Add milk to Costcozy", chips gone after.
