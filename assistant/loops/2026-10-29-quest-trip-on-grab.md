# 2026-10-29: A Quest trip is saved on its first grab

Usability audit: opening a trip and leaving it still put an empty-handed
trip on Your trips as Resume.

## Now
- `POST /api/quest/sessions` takes `draft: true`: the session (shelf
  labels, boss) comes back with `draft: true` and nothing is saved.
- `screens/quest/appSource.ts`: `open()` asks for a draft for the shelf
  hints. The first grab (or a Not here / Empty shelf report, or Finish)
  creates the real session once; grabs and put-backs run in order behind
  it. End quest abandons it if it was created.
- `game/ui/Play.tsx`: the quit sheet on a trip with nothing in the cart
  says it is not saved and offers plain Leave; End quest and Keep it for
  later show once something is grabbed.

## Tests
`tests/test_quest.py::test_draft_is_not_saved`; `e2e/questempty.e2e.mjs`
now checks no session before the first grab, one after, none after End
quest. Full e2e (demo household seeded) and Python pass.
