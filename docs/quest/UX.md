# UX — Arya Quest

Design bar: a first-time player finishes a hunt with no instruction
beyond the three-step How to play. One primary action per screen.
Mobile first. Plain words a tired parent reads once.

Design of record: `docs/quest/wireframes.html` (clickable, every
screen with its rule) and `docs/quest/game-flow-prototype.html` (the
game flow on one phone). Builds follow them; changes come back here
first.

## Sessions

- A session is one store trip: one store, one list, one mode.
- A day can hold many sessions; each is its own game. Pause one, run
  another, come back.
- States: Not started → Playing ⇄ Paused → Finished. A receipt settles
  a finished hunt; Skip leaves it "Finished · Receipt missing" until a
  receipt is added. A finished hunt never looks resumable.
- Navigation is a stack: Back returns where you came from.

## Flow

| Screen | Primary action | Rule |
| --- | --- | --- |
| Today | Resume | One quiet Quest row; the hero holds only a hunt being played |
| Pick store | Tap a store | Each store says what you usually buy there |
| Plan (move items) | Start the quest | The Arya list sorted for this store; ✕ removes from the list |
| Check my list | Answer, continue | Only when something needs a choice; Arya never guesses |
| Hunt (Quest) | Grab | One column, one target, rows never move, Put back in place |
| How to play | Got it | First Quest hunt only; ? reopens |
| Find it for me | Tap the lit item | Camera aimed at one item; a miss never says "not here" |
| Finish | Snap the receipt | Skip closes the hunt, never blocks |
| Score | Back to Today | Haul counts up, receipt banks it, level bar |
| Community, Shop-Off, Friends, Profile | — | Receipt-verified; no chat, no lists shared |

## The store view

The view is a viewport, not the game. One view, picked by the store:

- **Mapped store:** shoppers' aisle photos, people blurred by SAM.
  No store ships with photos (the old Trader Joe's walk was removed
  2026-10-29); every map is earned by shoppers' captures.
- **Any other store:** shelf cards in walking order. Playable, never
  gated; scanning the aisles adds photos.

Stops, scoring, Shop-Off timing and the receipt finish do not depend
on the view.

## Intake

Add is one surface: a text field (type or paste), a mic (Voice
Transcribe), a camera (a list photo becomes items; a receipt photo is
offered as a receipt), and Muse chat through the connector. Receipts
enter by image only. Items typed while planning a hunt join the list.

## Simplicity budget

- One primary button per screen.
- No settings before the first hunt.
- If a feature needs a paragraph to explain, it does not ship.
