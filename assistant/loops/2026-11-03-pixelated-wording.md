# 2026-11-03 "blurred" -> "pixelated" in app text

- Ask (owner "finish now" via coordinator): the code pixelates people (shelfscan.scrub_people), so the app should say "pixelated", not "blurred".
- Changed: en.json (maps sub, mine sub, capture progress, people count, spots items, fresh photo, mapper line, Help n2), game Play.tsx x2 and Finish.tsx, Ask sheet line 61, privacy page line, two storemap.py tips and the storescan error text. test_rewards pinned strings updated.
- Left as is: key names (capture.blurring, peopleBlurred), code comments, model prompts, "blurry photo" wording (that one is about photo quality). SPEC/STATUS belong to the Doc maintainer.
- Text only, same length, so no layout change and no mockup.
