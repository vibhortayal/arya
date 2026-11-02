# 2026-11-01 Ask: no replayed actions, no prompt labels, friends and budget answers

From the Tester's live Ask run 2 (/mnt/project-files/tester-run1/ask-run-live2.json), owner said yes.

- Replay (top): "Remove rice" also re-added oat milk. Cause: an actions-only answer has an empty reply, and the server dropped empty assistant turns, so the model saw two user messages in a row and acted on both. Now `chat_service._turns` keeps that turn as "(done: <applied lines>)" (the web client sends `applied` with it; an old client gets "(done)"), and the prompt says actions are only for the last message.
- "ABOUT ARYA doesn't say more": the prompt says never to name its section labels, and `_scrub_labels` replaces any that slip through.
- "What did my friends buy" answered with this household's receipt: prompt rule to say Ask cannot see other households and point to Quest, Friends.
- "Am I over budget": no more "you can't be over budget"; say there is no monthly budget to compare against and give the spend.

Tests: tests/test_ask_replay.py (8). Python suite: 20 failures, same as main. Web screens 332 pass.
