# 2026-10-30 Ask Arya friendly fallback
- Owner report: Hinglish test message ("main Hindi mein baat kar raha hun, this is a test") got only "Arya does not do that yet".
- Cause: no router; chat_v1.md told the model to say that line for anything not in ABOUT ARYA, and it used it for small talk.
- Change: prompts/chat_v1.md now asks for a kind not-listed reply, and a rule for greetings, tests, language chatter and unsupported asks: one friendly line in the user's language (Hinglish too), then 2-3 example asks, no actions.
- Prompt-text tests only; no model key here. Live check to run on the VM: "hi", "thanks", "this is a test", "main Hindi mein baat kar raha hun", "namaste", "order pizza", "what can you do?" — each should answer in kind and name examples.
- No model spend; no extra call.
