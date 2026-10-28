# Game design

## Core loop

**Plan → find → grab → snap the receipt.** The quest log is the grocery
list, the dungeon is the real store, the treasures are the items on
their real shelves. Mobile first; the keyboard is for the demo only.

## Owner rules (2026-10-28)

- No lives, no game over, no clock, no way to lose. Points only go up.
- Dopamine during the hunt and after it, never stress or pressure.
- Upgrade the existing hunt; no separate game.
- The game must keep feeding four things: community shortage reports,
  store layout and shelf maps, consumption and spend from receipts and
  list completion (plus receipts for returns), and fun with kids or a
  partner.

## Plan a hunt

1. **Pick the store.** Each store says what you usually buy there,
   counted from your receipts ("my milk is from TJ, eggs from Costco").
2. **Move items into the quest.** The Arya list, sorted for that
   store: usually bought here and new items start ticked; items
   usually bought elsewhere stay on the list; usuals not on the list
   are suggested. ✕ removes an item from the list (Undo). Typed extras
   join the list. Planning is list management, not a second list.
3. **Check my list** appears only when Arya has a question.
4. **Mode:** Quest (play) or Express (rush). Same list, same store.

## The hunt (Quest)

- One store view, picked by the store: real photos of a mapped store
  (people blurred by SAM), shelf cards anywhere else. "See it in 3D"
  is a demo peek.
- The next-item card suggests a stop; any stop can be grabbed in any
  order. A fresh shopper photo shows the item boxed when one exists.
- **Find it for me:** the camera scans for that one item. SAM 3.1
  boxes candidates, Muse Spark checks each crop; the item lights up
  and one tap grabs it. A miss never says the item is not there.
- Tools: Scan shelf, Where am I? (mapped stores), Not here?, How to
  play (?), sound.
- Put back any grab; nothing finishes by itself.
- I'm done shopping works any time; leftovers are saved for next trip or dropped; nothing counts as failure.
- How to play shows once, on the first Quest hunt on a phone.

## Rewards

| Event | Reward |
| --- | --- |
| Grab | +10, the chip bumps, a fun fact |
| Combo | Combo: each grab of the suggested stop adds 1. It never resets and put back never lowers it. |
| Boss | +40, only when the boss item was grabbed; a boss is an item you reported missing here on 2 earlier trips. |
| Halfway, full haul | milestone; full haul +25 and confetti |
| Receipt snapped | +50; the trip's points bank |
| Level line crossed | level-up moment (L2 at 100, L3 at 300, L4 at 600, +100 more each level) |

Sound and buzz are opt-in, off by default. Express stays quiet.
Offline grabs queue on the phone and sync when the signal returns.

## Modes

| | Quest (play) | Express (rush) |
| --- | --- | --- |
| For | Time to play, alone or with kids | In and out |
| Shows | The hunt, points, milestones | The list in walking order, big checks |
| Ends with | The receipt | The receipt |

The mode is a mood, not an age. With a child holding the phone, the
kid hunts and grabs while the adult handles quantities and checkout.

## Store drift: Spotter

Every hunt is a shelf survey. A grab proves a product is there; "Not
here?" (Empty shelf / Something else here / Can't tell, optional photo)
says it is not. A report edits nothing: it flags the stop and opens a
window. A later grab at the stop means a stockout; a second player
finding it elsewhere means a move, applied as a shelf-graph edit.
Find it for me sightings add the same signal.

Points on truth, never on reports: +2 for a true stockout, +10 for a
verified move. Eagle Eye badge (1 / 10 / 50 verified spots), Store
Guardian per store. Status only, never cash.

## Community

Every metric is receipt-verified: the receipt is the referee.

- **Boards:** Fastest Hands, Clean Sweep, Top Contributor, Big Haul,
  World Mapper, Globetrotter.
- **Badges:** Egg Baron, Banana Republic, Dairy Royalty, Midnight
  Shopper, Speed Demon, Return Regret, First Mapper, Perfect Week.
- **Races:** Shop-Off (first verified receipt wins), Split the List
  (not built), Clue Hunt (rollout).
- **Friends:** handle-based; no chat, no DMs, no lists shared. Run
  notifications are designed (Discussion 24), not built.
- Handles, never real names; household boards private; spend boards
  opt-in.

## Contribution

Store videos earn permanent first-mapper credit. Receipts stay
private; their reward is a smarter list and a hunt that plans itself.

## Never

- No random spawns or sponsored placements in routes.
- No purchases, external links or chat in the hunt.
- No pictures of people kept: frames are kept only after SAM blurs
  every person in them.
