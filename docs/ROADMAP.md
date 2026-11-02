# After the hackathon

These are ideas the owner is thinking about for where Arya could go. They are
not commitments, and he needs more time to figure out and understand them.

**What ships now is a limited-scope MVP:** a list that learns from receipts,
Ask, groups, Quest and the connector, as described in the README and
`STATUS.md`. **This page is what could come later.** Nothing on it is built
unless it says so, and nothing is promised for the submission. "Idea" means
nobody has designed it yet. Sources are named so you can check them.

**Positioning.** Arya does not try to out-do apps that do one thing better. It
aims to be the core platform where a community can use shared grocery
information (lists, receipts, prices, stores) and connect to other tools
through import and export.

## Devices
- **Ray-Ban Meta glasses.** Idea, raised by the owner for the store scan.
  Spark's check during the hackathon found no public live-camera API for
  third-party apps; the flow that works today is to capture on the glasses,
  sync to the phone and ingest the video there. The demo uses the phone camera
  throughout. Source: `docs/quest/DISCUSSION.md` (item 38).
- **Meta Ray-Ban Display glasses.** Idea. Not researched yet; what is possible
  depends on what Meta offers developers for that device.
- Both would reuse the shelf reading that exists today (SAM 3.1 plus Muse
  Spark). Live guidance on glasses is outside the spec for now (`assistant/docs/SPEC.md`,
  section "Not in scope").

## Store data and community
- **Capture more store data.** Item-level locations from scan captures,
  reports that close themselves, flags that expire when nobody confirms them,
  and mapping quietly from Find it for me frames. Source:
  `docs/quest/MAP-MY-STORE.md`, "Not built yet".
- **Arya shoppers and community prices.** Opt-in prices, deals and live
  presence (Quiet, Busy, Packed). Today the opt-in records a choice only. A
  community figure would need 5 or more households over 30 days, a median and
  no names. Source: `assistant/docs/SPEC.md` (FR-11.7), `assistant/docs/SCALE-SIM.md`.
- **Quest community layer.** Leaderboards, badges the data makes funny, team
  Shop-Offs settled by receipt time and Clue Hunts. Designed, not built.
  Source: `docs/quest/GAME-DESIGN.md`.
- **Density first.** Win one metro's stores completely before expanding; a thin
  layer over many stores is worth little. Source: `docs/quest/BUSINESS.md`.
- **Shared price data from receipts.** Today every price comes from your own
  receipts only. A shared figure across households is not built (see Arya
  shoppers above).
- **User-contributed store maps.** Shoppers already map a store with the guided
  scan, and no store ships pre-mapped. What is not built: sharing one
  shopper's map with others at scale, and consensus between several maps.
  Source: `assistant/docs/SPEC.md`, section "Not in scope".
- **Shared household lists.** Groups already share lists between the people you
  live with. Not built: split lists inside a group and sharing a list with
  another account through the API (`docs/API.md`, "Later").
- Item and store profile pages; split the list (kids or a partner); friend run
  notifications (designed, not built); reimbursement tracking for items bought
  for others.
- Invite links work today (`/?join=CODE` opens Join a group). Ideas for growth
  as a community product, none designed: shared recipe or meal lists, and a
  public page for a store's map status.

## AI and open weights
- **Bring your own Meta key: turn it on.** Built and tested, switched off in the
  live app for now (see "Use your own Meta key" below).
- **Replay mode** (recorded answers, so the AI parts work without a key).
  Planned, not built.
- **More use of open weights.** Muse Spark Open is a second seat on the staple
  judge and labels dictionary names today. Wider use would need the personal
  data rule kept (names only).
- **More languages.** Ask answers in the language you write; Spanish and Hindi
  were the ones verified, and the app's buttons and labels are English only
  (`assistant/docs/MULTILINGUAL-ASK.md`). Translating the app itself is a separate project.
- **A hosted open-weights option.** Today one open model (Muse Spark Open) is
  hosted on Baseten for two small jobs. A fuller option for people who want
  their reads on open weights is an idea only.
- A non-English Ask currently sends the whole feature guide (about 19 KB) on
  each question; trimming that is planned.

## Trust and privacy
- A photo opt-in and a full privacy policy; store permission for mapping.
  Source: `docs/quest/ARCHITECTURE.md`.
- Security review items that were deferred, tracked as GitHub issues.
- A community tier with user opt-in is an idea only
  (`assistant/docs/MODEL-POLICY.md`).
- Forgot-password flow and per-user spend caps are held, by choice
  (`assistant/docs/ARCHITECTURE.md`, section 13, "Not built / held").
- The licence is undecided; the repository is all rights reserved for now
  (`LICENSE`).

## Running it yourself
- A Docker setup that runs on a laptop with a short env file and your own Meta
  key. Today the Compose file is the production one; see the README.
- Off-site backups with rclone (`ARYA_BACKUP_REMOTE` exists; no bucket is set
  up) and a staging address to check a deploy before the live one.
- Cost proposals from the cost watcher, tracked as GitHub issues.

## Developer platform and integrations
Starting point today: the Lists API and the developer portal at `/developers`
(with a quickstart and an interactive reference; `docs/API.md`), and the MCP
connector that lets an AI agent read and edit your lists
(`assistant/docs/AGENT-CONNECTOR.md`). The API is for your own data, with a
personal token. Everything below is future work and not built:
- **A bigger developer portal,** so other platforms can integrate with Arya
  with Arya's household data as the shared source: more endpoints (receipts,
  spend, what is running low), webhooks, OAuth sign-in instead of a personal
  token, SDKs and sample apps.
- **Smart fridges and kitchen devices** that know what is inside, to add what
  is empty or expiring to the list and to tell Arya what was used.
- **Smart cooking devices** that understand what a household cooks, to feed
  recipes and quantities back to the list.
- **Humanoid and home robots** that shop, restock or check the pantry from the
  household's list and habits.
- **Online grocery delivery services and apps,** to send a list for ordering
  and to bring back the real receipt and prices. (There is no cart or payment in
  Arya today; see `assistant/docs/SPEC.md`, "Not in scope".)
- **Any app that understands a household's food and purchase habits** (meal
  planners, nutrition and budgeting apps), connected through the same API and
  the import and export below.
- Every integration would be opt-in, per household, with scoped permissions
  and a clear way to revoke it.

## Spending, import and export
- **Richer spend tracking and analysis,** with filters (by store, category,
  person, period, price per unit). The Spending screen exists today; deeper
  analysis and filters are not built.
- **Export to other budgeting apps** (spend and receipts as CSV or a direct
  connection). Today the API lists your own data (`docs/API.md`); a budgeting
  export is not built.
- **Import lists from other list apps** (a file or a link). Not built.

## More ideas for growing the app and its community
All ideas. None is designed or built, and each would need the owner's word
and, where it touches personal data, a privacy review first.

**Everyday use**
- Meal planning from what is running low and what to use soon, with a
  shopping list that writes itself from the plan.
- **Recipe to shopping list, then to stores.** Build a list from a recipe
  (link, photo or typed), then use the household's own receipt and store
  history to suggest which store to buy each item at and which product or
  brand you usually buy, with the price you paid there last. Arya already
  learns store and price per item from receipts and groups a list by store;
  turning a recipe into list items and routing them is not built. Possible
  extras: spot what you already have at home, suggest a cheaper store for the
  whole recipe, and scale the recipe to the household's size.
- Recipe import from a link or a photo, turning a recipe into list items.
- Budget goals per store or per month on the Spending screen, with a gentle
  heads-up and never a lock.
- Barcode scan to add an item or check a price against your own history.
- Pantry and fridge check-in by photo (outside the current spec).
- Home Screen widgets and watch glances for the list and for use-soon items.
- Calendar-aware reminders, such as "you host on Saturday".
- Voice assistants (Siri, Google Assistant, Alexa) adding to the list, and
  more connectors beyond the Muse agent and MCP.
- Receipt import from email or a store account, so no photo is needed.
- Warranty and return reminders read from receipts (Return Regret already
  shows returns are tracked).
- Waste tracking and a monthly "what we threw away" view.
- Gift and event lists with a shared link and no account needed to view.
- Accessibility: a screen-reader review and a calmer Quest mode. (Text size
  and spacing already exist in Settings, under Display.)

**Community**
- Neighborhood and store pages with shared tips, labelled as opt-in.
- Verified store news from shoppers, expiring when nobody confirms it.
- Seasonal Quest events, themed skins (escape room) and household leaderboards
  that stay private by default.
- A mapper reputation and thanks for people who map stores, with no pay
  attached.
- Clubs and teams (families, roommates, offices, school pantries, food banks).
- A public gallery of store maps that are fresh and photo-backed.
- Shared price alerts when a household opts in to share a figure.

**AI and open weights**
- A hosted open-weights reader for receipts, for people who want that choice.
- A smaller on-device model for offline add and quick matches.
- Better product merge and split suggestions in the Curator, and learned
  substitutions (the usual brand when one is out of stock).
- Ask Arya acting on more things, with a confirm step for anything that
  changes data.
- A public set of evals so others can check the reader scores.

**Trust, privacy and operating it**
- One place for privacy controls. Export my data and Delete my account already
  exist in Settings, under Account; the idea is to gather them with the other
  privacy choices.
- A public status page and an uptime history.
- A staging address, and automated CI instead of manual runs.
- A published API with webhooks and OAuth (`docs/API.md`, "Later").
- A real licence choice, once the owner decides.
- Store permission programme for mapping, and a takedown route for stores.

**Partners (only after trust is earned; see `docs/quest/BUSINESS.md`)**
- Anonymous, aggregated shelf and stockout data for one chain in one region.
- Labelled brand offers at the shelf, shown outside the hunt, never as a stop.
- The mapping and game engine for other indoor places (hardware, pharmacy,
  warehouses, campuses).

## Use your own Meta key: built and tested, switched off
Built and tested (PRs #391 and #393). It is generic: a Settings row, a Help
topic, an Ask answer, and an "I have my own Meta key" sign-up door that the
owner opens or closes from Ops only. An account that signs up with its own key
never falls back to Arya's keys. It is off in the live app only because the key
vault secret (`ARYA_KEY_VAULT_SECRET`) is not set; with no secret nothing is
stored and none of it shows. There was not enough time during the hackathon to
polish the rollout, and the owner is still deciding when to turn it on. To
turn it on: set the secret and redeploy (operator notes: `assistant/docs/OPS.md`,
section "Own Meta keys (BYOK, 2026-11-01)"), then add the guide card. For
someone running Arya themselves, the key that matters today is `MODEL_API_KEY`,
a server key, not this feature.
