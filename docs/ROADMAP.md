# After the hackathon

These are ideas I am thinking about for where Arya could go. They are
not commitments, and I need more time to figure out and understand them.

**What ships now is a limited-scope MVP:** Arya learns from receipts,
Ask, groups, Quest and the connector, as described in the README and
`STATUS.md`. **This page is what could come later.** Nothing on it is built
unless it says so, and nothing is promised for the submission. "Idea" means
nobody has designed it yet. Sources are named so you can check them.

## Devices
- **Native iOS and Android apps; the PWA stays.** Plan. The PWA was the
  fastest way to build in a hackathon. Not designed or scheduled, and not in
  any app store today.
- **Ray-Ban Meta glasses.** Idea, raised by me for the store scan.
  Spark's check during the hackathon found no public live-camera API for
  third-party apps; the flow that works today is to capture on the glasses,
  sync to the phone and ingest the video there. The demo uses the phone camera
  throughout. Source: `docs/quest/DISCUSSION.md` (item 38).
- **Meta Ray-Ban Display glasses.** Idea. Not researched yet; what is possible
  depends on what Meta offers developers for that device.

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
- **A store-data partnership.** Online store videos are off limits (copyright,
  platform terms); a licensed source of in-store video and photos could power
  better maps. See [`docs/MODELS.md`](MODELS.md).
- **Density first.** Win one metro's stores completely before expanding; a thin
  layer over many stores is worth little. Source: `docs/quest/BUSINESS.md`.
- **Store maps at scale.** Maps already merge across shoppers. Not built:
  resolving conflicts between maps. Source: `assistant/docs/SPEC.md`, "Not in scope".
- **Shared lists, further.** Not built: split lists inside a group, and sharing a
  list with another account through the API (`docs/API.md`, "Later").
- Item and store profile pages; split the list (kids or a partner); friend run
  notifications (designed, not built); reimbursement tracking for items bought
  for others.
- Invite links work today (`/?join=CODE` opens Join a group). Ideas for growth
  as a community product, none designed: shared recipe or meal lists, and a
  public page for a store's map status.

## AI and open weights
- **Bring your own Meta key.** Decided against for now. The code is in the repo,
  unfinished and switched off (see "Use your own Meta key" below).
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
- **Models we did not use** (Spark Contributor for a community tier, Muse
  Glimmer self-hosted): see [`docs/MODELS.md`](MODELS.md).
- A non-English Ask currently sends the whole feature guide (about 19 KB) on
  each question; trimming that is planned.

## Trust and privacy
- A photo opt-in and a full privacy policy; store permission for mapping.
  Source: `docs/quest/ARCHITECTURE.md`.
- Security review items that were deferred, tracked as GitHub issues.
- A community tier with user opt-in is an idea only
  (`assistant/docs/MODEL-POLICY.md`).
- The forgot-password flow is held, by choice
  (`assistant/docs/ARCHITECTURE.md`, section 13, "Not built / held").
- The licence is undecided; the repository is all rights reserved for now
  (`LICENSE`).

## Running it yourself
- More for self-hosters: a one-command setup for a small server with TLS (the
  laptop setup is in `docs/RUN-IT-YOURSELF.md`).
- Off-site backups with rclone (`ARYA_BACKUP_REMOTE` exists; no bucket is set
  up) and a staging address to check a deploy before the live one.
- Cost proposals from the cost watcher, tracked as GitHub issues.
- **Scale out as the community grows.** Today Arya is one server process on
  one VM (see [Known limits](../README.md#what-are-the-known-limits)). The plan, not a
  promise: make Postgres the master copy, move demo and session state out of
  memory, run several processes, and move to a cloud provider in step with
  the number of shoppers. The design, phase by
  phase, is in [`SCALABILITY-DESIGN.md`](SCALABILITY-DESIGN.md) (a plan,
  not built).

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
- **Smart fridges, cooking devices and home robots** that add what is empty
  or expiring to the list and feed back what was used.
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
All ideas. None is designed or built, and each would need my word
and, where it touches personal data, a privacy review first.

**Everyday use**
- Meal planning from what is running low and what to use soon, with a
  shopping list built from the plan.
- **Recipe to shopping list, then to stores.** Turn a recipe (link, photo or
  typed) into list items, then use the household's receipt history to suggest
  where and which brand to buy. Not built.
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
- A real licence choice, once I decide.
- Store permission programme for mapping, and a takedown route for stores.

## Use your own Meta key: unfinished, switched off, not used
The code exists (PRs #391 and #393), it is unfinished, and it is switched off
in the live app and the demo. I decided on 2026-11-02 not to use it. Operator
notes: `assistant/docs/OPS.md`, "Own Meta keys (BYOK)".
