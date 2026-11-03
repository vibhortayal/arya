# 2026-11-02 Ask hears misheard list names, and offers choices

Owner phone test, 2026-11-02: voice in Ask gave "Costcosi" for the Costcozy list, and Ask said it found no list. Owner asked for "intelligence around context", plus chips so the user doesn't have to type.

Finding: the server's list match already took "Costcosi" as Costcozy (a close spelling). The miss was the model answering on its own instead of passing the name on.

Changes:
- `prompts/chat_v1.md`: spoken names are often misheard ("Costcosi", "trader jail"). A list or store name that sounds like one in the snapshot is that one, for questions too, and Ask uses its exact name. The 26,000-character Ask knowledge sheet is untouched.
- `api/chat_service.py` `_list_matches`: a last-step sound-alike match (`_sound_key`):
  - It ignores spaces and apostrophes, and treats c/k, s/z and ee/ie/y/i as the same.
  - It compares against the user's own list names and list stores only.
  - It keeps only the matches within 0.1 of the best, at a score of 0.8 or more.
  - Two matches that fit ask "Which one?" as before.
  - No list is ever made from a near-miss.
- `/api/chat` answers now carry `choices`: [{label, send}] for a which-list question (two lists fit, no list named, or no such list). `send` is the words a tap sends, as if typed ("Add 2 naan to Costcozy", "Remove naan from …"). It is empty when the answer has two questions, so their options never mix. The chip row in the app waits for the UI/UX mockup.

Tests: `tests/test_ask_heard_names.py` (8). Seven fail on main.
