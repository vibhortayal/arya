# 2026-11-01 Voice: a Listening card

**Ask (owner group test, item 7):** "When speaking, people don't realize it is listening." The owner picked option B: no live words, for privacy. The 23:31Z UI pass asked "why 2 send buttons?" and the answer was "just cancel is good". So the card has one Stop and send plus Cancel, and the old Stop toggle hides while the card is up.

**Changes**
- `ui/Listening.tsx` `ListeningCard`:
  - A pulsing red dot, "Listening…", and a timer.
  - 18 bars driven by the mic level. `lib/recorder.ts` Capture gains `level()`, the RMS of the last buffer.
  - A hint line, and Cancel plus Stop and send.
  - After Stop, the card reads "Got it, reading…" with no buttons until the words come back.
- Wired into Ask (inside `#chat-form`), a list's add box, New list Record, and the in-store Ask sheet. In each place the mic button hides while the card shows.
- Help "Ask Arya" n3 and an Ask knowledge line describe the card.

**Tests:** `ui/listening.test.tsx`. Web: 483 tests pass. Python: 0 failures. Built app checked with a fake mic at 360x640 and 390x844: Ask and a list both show the card, and Cancel brings the mic back.
