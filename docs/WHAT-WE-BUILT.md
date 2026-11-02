# What we built

The 3-minute video cannot show everything. This page lists the standout parts
of Arya that exist today, each with why it matters and where the detail lives.
Everything here is built and in the code. Ideas that are not built are on the
[After the hackathon](ROADMAP.md) page. For the product in full, see
[`assistant/docs/SPEC.md`](../assistant/docs/SPEC.md) and
[`assistant/docs/USER-JOURNEYS.md`](../assistant/docs/USER-JOURNEYS.md).

## Receipts you can trust
- **A model reads, code checks.** Muse Spark reads a receipt photo first; Muse
  Wonder re-reads one the checks flag; plain code then checks every line
  against the printed total before anything posts. *Why:* a wrong price never
  goes in silently. [`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md), [`docs/evals/`](evals/)
- **Returns net out** against purchases, and items bought for someone else are
  tracked but never suggested.
- **"To check"** marks lines Arya is unsure about; **Fix this line** edits the
  name, quantity and price with Undo, and the printed total never changes.
  The original photo is kept. *Why:* you stay in control of your record.
- **Background reading with progress:** several receipts at once, and you can
  leave while Arya reads them.

## A list that learns
- **Patterns from your own receipts:** how often you buy each item and what you
  pay at each store, so the list shows what is **running low** and what to
  **use soon**, each with a reason ("why" sheet).
- **A staple judge with two seats:** Muse Spark decides what counts as a staple;
  Muse Spark Open (open weights, hosted on Baseten) judges again from item names
  only. Disagreements are kept for review. *Why:* names advise, purchase facts
  decide. [`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md)
- **The Curator** proposes product merges and splits with reasons; nothing
  changes until you apply it.
- **Named lists, and every item has a home:** adds go to the list you name, the
  only list, or Arya asks "Which list?".
- **Works offline:** lists and other screens show as last saved, and list edits
  queue until you are back online.

## Prices from your own receipts
- Cheaper store, price trend, similar items per ounce, which store to buy each
  item at, and the cost of food waste, with a Spending screen. *Why:* nothing
  is fetched from store sites, flyers or the web, so every figure is yours.
  [`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md)
- Community prices and live "how busy is the store" are not live; the opt-in
  records a choice only (`SPEC.md`, FR-11.7).

## Ask Arya
- A chat over a snapshot of your household's data that can also act on
  statements such as "we finished the yogurt".
- Answers in the language you write; Spanish and Hindi were the ones verified
  ([`assistant/docs/MULTILINGUAL-ASK.md`](../assistant/docs/MULTILINGUAL-ASK.md)).
- Voice dictation and a photo of a handwritten list.

## Quest, the optional game
- A hunt through a model of your store with **no clock and no way to lose**.
  Start shopping on a list opens it at that list's store and ends on your
  receipt. [`docs/quest/GAME-DESIGN.md`](quest/GAME-DESIGN.md)
- **Find it for me:** point the camera at a shelf; SAM 3.1 boxes candidates and
  Muse Spark checks each one.
- **Map this store:** a guided camera scan where SAM 3.1 blurs every person
  before anything is kept. A store counts as mapped only where it has a usable,
  fresh photo, so status is earned. [`docs/quest/MAP-MY-STORE.md`](quest/MAP-MY-STORE.md)
- **Build a store** from three questions, practice in it, and save it.

## Groups and everyday use
- **Groups** share lists between the people you live with, joined by a
  single-use code or an invite link. Receipts stay with whoever filed them.
- **Daily reminders** for what to use soon (opt-in, on the Home Screen app).
- **Add to Home Screen**, so it opens like an app.
- A bottom bar you arrange yourself.

## Transparency about AI and cost
- **Keeping Arya running** (Settings, About Arya) shows your own AI use by kind
  (receipts and photos, Ask, store maps, lists and voice), this month and since
  you joined, and the whole app's AI cost and who pays. *Why:* Arya is free, and
  the paid AI reading is shown openly.
- **How Arya uses AI** says where AI is used and when to double-check, and that
  Arya is not a food-safety check.
- **Arya's powers** lists what Arya does for you now and what turns on as you
  add receipts.
- **Guards:** a daily budget for the real app and a separate one for the demo,
  a per-visit cap on the demo, and a heads-up and pause for unusually heavy use.
  [`assistant/docs/OPS.md`](../assistant/docs/OPS.md)

## Open, and bring your own tools
- **Lists API and developer portal** at `/developers` (quickstart in curl, Python
  and JavaScript, interactive reference). [`docs/API.md`](API.md)
- **A connector for your own AI agent (MCP):** Make my code, then ask the Muse
  agent to connect. [`assistant/docs/AGENT-CONNECTOR.md`](../assistant/docs/AGENT-CONNECTOR.md)

## Built to run
- One image, also run locally with Docker in a few steps
  ([`docs/RUN-IT-YOURSELF.md`](RUN-IT-YOURSELF.md)).
- A `/health` check that shows the running commit, nightly backups, and an
  owner-only Ops screen with a daily report, a pause switch for paid reads,
  spend ceilings and a cost ledger with one row per model call.
- Tests and measured results: [`STATUS.md`](../STATUS.md), [`docs/evals/`](evals/).

## Built and tested, currently disabled
- **Use your own Meta key.** A Settings row, a Help topic, an Ask answer and a
  sign-up door, where an account with its own key never falls back to Arya's
  keys. It is off in the live app only because the key vault secret is not set.
  [After the hackathon](ROADMAP.md)
