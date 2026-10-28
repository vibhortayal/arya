# Game design

## Core mechanic

One mechanic, many skins: **navigate → find → collect → next.**

The quest log is the grocery list. The dungeon is the real store. The treasures are the items, on their real shelves. Everything else is presentation.

## Launch mode: Treasure Hunt

- The list becomes a route through the store's 3D model, ordered by the shelf graph — no backtracking by design.
- One target at a time: the suggested stop is presented in a contained store view, with the suggested-next card under it (Hunt v2 presentation, Discussion 45). Any stop can be grabbed in any order; the suggestion re-aims after each grab.
- Collect: tap the item in the model (at home, planning) or tap "Got it" at the shelf (in store).
- Score: time, completion, and a streak for consecutive full hauls.
- Finish ritual: the receipt photo at checkout. It scores the hunt and settles the data.

## Modes — the mood chooses, not the person

| | Quest mode (play) | Express mode (rush) |
|---|---|---|
| For | The fun shop — alone, with kids, whenever there is time to play | The get-it-done run — in, out, nothing extra |
| Shows | The hunt: trail, glowing treasures, collecting, timer, streaks | The fastest route through the model, the list in walking order, a live time estimate |
| Collecting | Tap the treasure on its shelf | Check items off as you pass them |
| Ends with | The receipt photo scores the haul | The receipt photo, same as always |

The mode is a mood, not an age. Quest mode with a child holding the phone is the family case: the kid hunts and collects, the adult runs quantities and checkout from the same hunt — the child hunts the list at pace — the game recommends a route but never rails it: any stop can be grabbed in any order, because items move and shoppers wander (Discussion 44). Express mode is the same store model and the same list with the game layer switched off.

## Future skins (same mechanic)

- **Escape room:** the store is closing in 20 minutes; sections lock as you clear them; the list is the key set. Narrative wrapper, zero new systems.
- **Speed run:** beat your household's best time for the same list size.
- **Mapper events:** a new store opens unmapped; first complete map wins the store's mapper credit and a leaderboard slot.

## Contribution design

The platform needs two things from players: store videos and receipts. The game pays for both in status, not money:

- **First-mapper credit** is permanent and displayed on the store ("Mapped by …").
- Store versions are credited per contribution; better maps replace older ones with credit kept.
- Receipts are private and never displayed — their reward is a smarter household brain and a hunt that pre-loads itself.

## Store drift & the Spotter economy — real-time, community-driven inventory

Stores change constantly: products move, sections reset, endcaps churn weekly. A store model that cannot heal itself is a dead model. Arya Quest heals from play itself, because every hunt is a shelf survey: a COLLECT confirms a product is present at its stop; a "Not here" reports it absent. Aggregated across players, those two signals are a **live inventory layer for stores that publish no inventory at all** — the receipt tells the platform what one household bought; hunts tell it what the store holds right now.

**Capture (two taps, in the moment).** The Hunt screen carries a "Not here" action. It branches into three reports — **Empty shelf** / **Something else here now** / **Can't tell** — plus an optional shelf photo. The shelf tag is the physical tell: a stockout leaves the product's tag over an empty slot; a move takes the tag and gives the slot to another product. The photo lets SAM 3.1 and Spark read the slot and confirm which case it is. The player is never asked to decide what happened — only to report what they see.

**Resolution (time separates stockout from drift).** A report edits nothing. It flags the stop *"reported missing"* — hunts still route there, with a warning marker — and opens a window:
- A later player collects the item at its modeled stop → it was a **stockout**; the flag clears itself.
- A second player confirms the item at a new location, and nobody collects it at the old one during the window → the **move applies** as a shelf-graph edit, credited to both spotters.
- Section-level and remodel reports escalate instead: the zone is flagged unverified, or the store's mapping reopens for a partial re-walk (one aisle video refreshes one aisle).

**Rewards — points on truth, never on reports (owner, 2026-10-27).**
- A report alone earns nothing. A report that resolves as a true stockout earns **2 Spotter points**; a verified move earns **10**. Honest reporting pays either way; model-changing truth pays most, so nobody is rewarded for calling everything a move.
- **Eagle Eye badge** — tiers at 1 / 10 / 50 verified spots, on the Profile shelf.
- **Store Guardian** — the player with the most verified fixes for a store is named on its page ("Kept true by …"), the maintenance twin of first-mapper credit.
- Spotter points fold into the **Top Contributor** board — one board, no competing currencies. A trust score sits underneath: proven spotters' reports corroborate faster; repeat false alarms decay it.
- Maintenance rewards are status only, never cash — cash invites farming, and a farmed model is worse than a stale one.

**The by-product is a product.** Resolved stockouts stream into the household brain: "Eggs were reported out at this Trader Joe's last night" is a pre-trip warning no list app can give, because no list app has players standing at the shelf. Inventory truth is the moat the game builds while people play.

*Demo scope:* "Not here" with the three reports + photo, the candidate queue with its resolution states, the reported-missing flag, Eagle Eye on the badge shelf, and spots counted on Profile. Telemetry clustering, trust weighting, and re-walk prompts are rollout.

## Community layer — leaderboards, badges, teams

The community game runs on one unfair advantage: **every metric is receipt-verified.** Start time = hunt start, end time = the receipt's timestamp, spend and items from the parsed receipt. The receipt is the referee — nobody can fake a board position, and the funny badges exist only because the data is real.

### Leaderboards (scopes: household → friends → store-local → global)

| Board | Metric | Why it is fun |
|---|---|---|
| Fastest Hands | Fastest full-list hunt, scored as time per item (min. 8 items to qualify) | The speedrun board; Express mode feeds it |
| Clean Sweep | Most 100%-completion hunts in a row | Found everything on the list, no misses |
| Top Contributor | Most receipts uploaded this month | Feeds the household brains of the whole community |
| Big Haul | Largest single verified receipt | Pure flex, opt-in |
| World Mapper | Most stores mapped (platform plane) | The Waze board — status for the supply side |
| Globetrotter | Most distinct stores hunted | Rewards playing everywhere |

### Badges — the weirder, the better (all receipt-awarded)

- **Egg Baron** — most eggs bought this month (the 60-count flat is a strategy, not a mistake)
- **Banana Republic** — bananas on every hunt for a month
- **Dairy Royalty** — 10 gallons of milk in a month
- **Midnight Shopper** — a verified hunt finished after 11 PM
- **Speed Demon** — a full hunt in under 10 minutes
- **Return Regret** — most returns netted this month. Only Arya can award this; nobody else nets returns
- **First Mapper** — first verified map of a store; permanent, displayed on the store
- **Perfect Week** — every planned hunt completed, list fully found, receipts all in

### Teams and live races — the game-show layer

- **Shop-Off:** two players (or teams), same store, same list size, live countdown. First verified receipt wins. The receipt timestamp is the photo finish.
- **Split the List:** a team divides one big list by aisle sections and races its own clock; the app routes each member their section.
- **Clue Hunt:** Spark rewrites list items as riddles from the shelf graph ("Cold, white, and moo-born" → milk). Kids hunt answers, not items. This is the escape-room skin's engine — same mechanic, story on top.
- Async by default (receipts settle results whenever they land), live when players choose it.

### Friends and profiles (owner: "needs to be there")

- **Friends** are handle-based: add by handle or QR, accept/decline, no contact-list scraping. A friend's row shows their top badge and last hunt — and a challenge button. Friends are who you Shop-Off.
- **Run notifications (designed, Discussion 24; NOT built).** When a friend starts a run, the ping carries the store and the moment — never the list. The actions: ⚔️ Challenge, ➕ Add one thing (a request; bought-for-others rules apply — ledger yes, patterns never), 👁 Follow. No engine exists yet; this is the top known gap in the social layer.
- **Profile** has two faces. The **public card** (what the community sees): handle, hunt/receipt/streak stats, the badge shelf (earned + locked with criteria), mapper credits ("Mapped by you"). The **private archive** (only the account sees): every receipt photo saved with its **digitized twin** — the parsed line items and the verified total, one tap from photo to record. Analysis and dashboards (patterns, spend — the current Arya dashboard) are the declared future layer on top of this archive, not v1.

### Community rules

- Public identity is a handle, never a real name; household boards are private by default; spend boards are opt-in only.
- Kid-safe by construction: no chat, no DMs, no location sharing — boards and badges only.
- Scope (owner call 2026-10-27): community is the hackathon's virality clincher — a demo-grade slice ships Nov 4: playable Shop-Off, household board, live badges on the score screen. Global boards, public handles, and mapper leaderboards stay rollout.

## Anti-design (what the game never does)

- No random spawns that send a player to the wrong shelf for engagement.
- No ads, no sponsored placements in routes.
- No dark patterns on children: the hunt view has no purchases, no external links, no chat.
