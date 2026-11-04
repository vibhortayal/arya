# Built in the hackathon window

The hackathon window opened on Oct 27, 2026. This page says what existed
before it, what I made in it and when, taken from git. Times are US Eastern.
What git cannot show is listed under "What git cannot confirm".

## What existed before the window

- **The idea search.** By my own account it took about two days. The commits for
  it are in a separate research repo ([`vibhortayal/meta-hackathon-research`](https://github.com/vibhortayal/meta-hackathon-research)). They start
  on Oct 26 at 12:37. The 28 commits that day, up to 16:51, hold candidate ideas
  and a plan for spikes, with no spike results. This is before Oct 27, and I
  say so plainly.
- **My 114 Costco receipts** (back to 2023) are my own purchase history, imported
  as data. They are not in this repo.
- **The server.** The Oracle VM already existed for my other hobby projects.
  Setting up Arya on it began on Oct 27.
- **Nothing in the Arya repo is older than Oct 27, 15:13 ET.** Its first commit
  already holds the design documents (`SPEC.md` and `IMPLEMENTATION.md`, about
  900 lines), which I wrote before committing them.

## What I made, and when

| When (ET) | What | Evidence |
|---|---|---|
| Oct 27, morning | Grocery Navigator brainstorm notes, stamped 11:37 and 11:46 | research repo, `IDEAS-owner-brainstorm.md` |
| Oct 27, 13:50 | Spike 1: receipt decode on 7 real Costco PDFs with Muse Spark, arithmetic matched 7 of 7, $0.20 | research repo, `89ff3ab` |
| Oct 27, 14:26 | Spike 2: photo receipts with Spark, 32 of 32 lines on 4 receipts (5 photos) | research repo, `218f332`, `6ca6d7f` |
| Oct 27, 14:29 | Spike B: the Costco pull test hit a bot wall, so I chose receipt uploads | research repo, `a2ef346` |
| Oct 27, 15:03 to 15:06 | My Costco receipts staged: 63, then 114 | research repo, `25cba97`, `f1cbdd0` |
| Oct 27, 15:13 | **First Arya commit** | `ca9d3ee` |
| Oct 27, 15:31 to 15:38 | Decode, item dictionary, ledger and patterns, and the first phone app land in four commits | `e134814` to `b210863` |
| Oct 27, 15:43 to 15:52 | Public HTTPS, then the DuckDNS address | `e326e348`, `c2430d6d` |
| Oct 27, 16:02 to 16:03 | Photo decode path and Gate 0 verdict, PASS (9 public photos, hand labels) | `cb907e3d`, `e7ebb235`; research repo `39d6433` |
| Oct 27, 21:00 | Muse Wonder commissioned to author the store-frame localizer | `881b115` |
| Oct 27, 21:12 | Model policy amendment: Wonder reads photos through Nov 4 (superseded Nov 2: Spark first, Wonder on flagged receipts, through Nov 9) | `c01c007a` |
| Oct 27, 22:19 | Wonder's first localizer spike vendored as `api/localizer.py` (removed Oct 29, `51cab53`) | `47b2471` |
| Oct 27, 22:59 | Photo decode switched to Wonder | `7f32f2f` |
| Oct 27, 23:02 | Wonder-vs-Spark eval committed in the research repo | `b39a961` |
| Oct 28 | Accounts, the judge front door; Supabase, Resend and Baseten set up | |
| Oct 30 | teamnightshift.org registered at Cloudflare; live site moved to arya.teamnightshift.org with invite-only sign-in | |
| Oct 31 to Nov 2 | Hardening, the navigation tab, lists, the Kroger aisle lookup, docs, "Run it yourself" | |

The Wonder eval is the one the model policy cites. On the 9 Gate 0 photos (98
hand-labeled lines), Wonder scored 97/98 and Spark 92/98. The Wonder figure is after hand adjudication; Spark's is from the automatic scorer, which gives Wonder 86 of 98. Price errors were 0 for Wonder and
4 for Spark, for $4.47 of model spend. Why Spark shows 92 here and 90 at Gate 0 is
explained once, under the model map in [For judges](../JUDGES.md#which-model-does-which-job).

## What git cannot confirm

- **Who wrote the first engine commits.** Muse Code, running Muse Wonder, wrote
  the first version of the engine with me. Git lists those commits under the author name "Spark", at 15:31 to
  15:38 on Oct 27. Git records no model or tool, so the author name alone does
  not show it. That is my account of it.
- **The other "Spark" commits.** 253 of the 1,333 commits are named "Spark".
  They come from the Meta Muse agent on my VM. It ran Muse Spark and used
  Muse Wonder through the agent, and it coded in parallel with Claude. Git records the
  author name only, so the name alone does not show it. That is my account of it.
- **When the Muse Wonder spike sessions ran.** No start or end time is recorded
  for them, and the spike folders the docs mention are in neither repo. I give
  no date for them.

## What exists today

The 3-minute video cannot show everything. This list is the standout parts
of Arya that exist today, each with why it matters and where the detail lives.
Everything here is built and in the code. Ideas that are not built are on the
[After the hackathon](ROADMAP.md) page. For the product in full, see
[`assistant/docs/SPEC.md`](../assistant/docs/SPEC.md) and
[`assistant/docs/USER-JOURNEYS.md`](../assistant/docs/USER-JOURNEYS.md).

## Receipts you can trust
- **A model reads, code checks.** Muse Spark reads a receipt photo first (Wonder is the backup
  reader). Plain code then checks every line
  against the printed total before anything posts. *Why:* a wrong price never
  goes in silently. [`assistant/docs/MODEL-POLICY.md`](../assistant/docs/MODEL-POLICY.md), [`docs/evals/`](evals/)
- **Returns net out** against purchases.
- **"To check"** marks lines Arya is unsure about. **Fix this line** edits the
  name, quantity and price, with Undo. The printed total never changes.
  The original photo is kept. *Why:* you stay in control of your record.
- **Background reading with progress:** several receipts at once, and you can
  leave while Arya reads them.

## A list that learns
- **Patterns from your own receipts:** how often you buy each item and what you
  pay at each store. From that, the list shows what is **running low** and what to
  **use soon**, each with a reason (the "why" sheet).
- **A staple judge with two seats:** Muse Spark decides what counts as a staple.
  Muse Spark Open (open weights, hosted on Baseten) judges again from item names
  only. Disagreements are kept for review. *Why:* names advise, purchase facts
  decide. [`assistant/docs/ARCHITECTURE.md`](../assistant/docs/ARCHITECTURE.md)
- **The Curator** proposes product merges and splits with reasons; nothing
  changes until you apply it.
- **Your own lists, and every item sits on one:** you make your own lists, for example, one for each store, such as Trader Jill's or Costcozy. When you add an item, it goes to the list you say,
  or to your only list, or Arya asks "Which list?".
- **Works offline (signed-in accounts):** lists and other screens show as last saved, and list edits
  queue until you are back online. Receipts, Ask, photos, voice and sharing need a connection. Signed-in accounts keep a cached copy. The demo saves offline list changes for that visit only.

## Prices from your own receipts
- Cheaper store, price trend, similar items per ounce, which store to buy each
  item at, and the cost of food waste, on a Spending screen. *Why:* nothing
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
- **Map my store:** a guided camera scan. SAM 3.1 pixelates the people it
  detects before anything is kept. If that fails, the frame is discarded. Detection is not perfect and is not scored. A store counts as mapped only where it has a usable,
  fresh photo, so the status is earned. [`docs/quest/MAP-MY-STORE.md`](quest/MAP-MY-STORE.md)
- **Build a store** from three questions, practice in it, and save it.

## Groups and everyday use
- **Groups** share lists between the people you live with, joined by a
  single-use code or an invite link. Receipts stay with whoever filed them.
- **Daily reminders** for what is running low. Live on the hosted app. You opt in, and on iPhone the app must be added to the Home Screen first.
- **Add to Home Screen**, so it opens like an app.
- A navigation tab (the bottom buttons) you arrange yourself.

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

## In the code but switched off
- **Use your own Meta key (unfinished, not used).** A Settings row, a Help topic,
  an Ask answer and a sign-up door. An account with its own key would never fall
  back to Arya's keys. I decided not to use it, so it is switched off
  and not part of the demo.
  [After the hackathon](ROADMAP.md)
- **Alexa skill (built, switched off, not tested on a real device).** An Alexa
  skill that adds items to your Arya list by voice. The code is merged (#515,
  #516) behind the `ARYA_ALEXA` flag, which is off. I paused it until after the
  hackathon, and it has not been tried on a real Echo. It is voice add only.
  Amazon has retired its Alexa list API, so Arya cannot sync with Alexa's
  own lists.
