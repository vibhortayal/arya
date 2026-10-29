# 2026-10-29 Multilingual Ask (backend)

Built on branch feat/multilingual-ask, from docs/MULTILINGUAL-ASK.md.

- chat_v1.md: reply-language and action-parity rules; the "US dollars"
  line is replaced by the snapshot's currency (chat now follows the
  currency setting).
- chat_service: `REPLY LANGUAGE: <name> (<code>)` context line when the
  language setting is fixed; es/hi templates for applied, skipped and
  confirmation lines (hi to be checked by a native speaker).
- `/api/settings`: `language` (auto, en, es, hi); POST takes currency,
  language, or both.
- `/api/list/from-text`: non-Latin text, or a fixed es/hi language, takes
  the one-call model extraction instead of the English split. English on
  auto stays $0.
- `item_slug` / `_key`: non-Latin names get their own item ids.
- Not done: voice `languageBias` (needs the doc's exact shape and a real
  clip); all UI (handed to the port thread). Live 10x3 eval not run.
- Tests: tests/test_multilingual_ask.py; full suite green (1207).
