# Market and landscape

A short, honest map of what already exists around grocery shopping and running
a household, where Arya could connect to it, and where Arya is different.
Written 2026-11-02 during the hackathon. It is desk research from public web
pages, not user interviews, and it is not a business plan.

**How to read it.** Every outside claim has a link. A claim marked *(vendor
source)* comes from a company describing itself or a competitor, so treat it as
unverified. A claim marked *(not checked)* is something we believe but did not
confirm in this pass. Prices change often; check the linked page before
quoting one. What Arya itself does is described by the README and `STATUS.md`;
this page does not add to it.

**Positioning (from [`ROADMAP.md`](ROADMAP.md)).** Arya does not try to out-do
apps that do one thing better. It aims to be the core platform where a
community can use shared grocery information (lists, receipts, prices, stores)
and connect to other tools through import and export.

## 1. The grocery and household workflow, and who serves each step

| Step | What people do today | Examples | What is usually missing |
|---|---|---|---|
| Plan and remember | Shared list, notes app, memory | AnyList, Bring!, OurGroceries, Cozi, Listonic | The list is only what you typed. It does not know what you buy, how often, or where. |
| Decide what to cook | Recipes, meal plans | Samsung Food, Paprika, Plan to Eat, Eat This Much | Plans rarely know what is already at home or what you paid last time. |
| Find deals | Weekly flyers, coupons, price apps | Flipp, Basket, cash-back apps | Sale prices only, or national averages, not what you actually pay at your stores. |
| Buy | In store, or delivery | Instacart and retailer apps | Prices can differ by app and by session; the receipt is the only record of what really happened. |
| Record spend | Bank feed, budgeting app | Monarch, YNAB, Copilot | A grocery charge is one number. The items are lost unless a receipt is read. |
| Use it up | Memory, fridge look | Pantry apps, smart fridges | Waste is tracked by hand or not at all. |

Sources for the examples are in section 2.

## 2. Competitors, by category

All entries are as of the linked pages, read on 2026-11-02.

### Shared list apps (closest to what the user sees first)

| App | Notes | Source |
|---|---|---|
| AnyList | Free tier; AnyList Complete $9.99/yr individual, $14.99/yr household (per NerdWallet). Real-time sharing, recipes add ingredients, voice assistants. Meal planner and web app are paid. | [NerdWallet](https://www.nerdwallet.com/finance/learn/best-grocery-list-apps) |
| Bring! | Free with ads; Premium $1.99/mo or $8.99/yr. Pictures per item, pre-made lists, loyalty cards. | same |
| OurGroceries | Free; ad removal $0.99/mo, $5.99/yr or $19.99 once. Barcode or photo add, recipes. Simple, no calendar or chores. | same |
| Out of Milk | Free. Barcode scan, pantry notes, running total. Described as basic. | same |
| Cozi | Free; Gold $39/yr. Family calendar, meal planner, chores, grocery list. | same |
| Listonic | Compared itself favourably against AnyList and others on its own site *(vendor source)*. | [Listonic](https://fpdev.listonic.com/compare-apps/listonic-vs-anylist) |

Takeaway: these are good, mature and cheap. They own "type it, share it, tick it
off". None of the pages we read say they learn what a household buys from
receipts. *(Based on the review pages above; we did not install each app.)*

### Receipt scanning for rewards

Fetch, CoinOut, ReceiptPal and Receipt Hog pay points or gift cards for
scanned receipts. Fetch's own page says it awards at least 25 points per
receipt, redeems from 5,000 points for a $5 card, and caps scans at 35 per
rolling 7 days *(vendor source)*. The page does not describe item-level price
tracking for the user's own benefit. These apps serve brands and advertisers
first; the shopper's reward is the point total.
Source: [Fetch blog](https://fetch.com/blog/smart-shopping/best-apps-for-scanning-digital-receipts).

### Price comparison and flyers

- **Flipp** digitises retailer weekly flyers and matches them to a shopping
  list ([TechCrunch](https://techcrunch.com/?p=1121022)). A competitor's blog
  notes it shows only what retailers choose to promote and has no real-time
  product price search *(vendor source)*
  ([GroceryChop](https://grocerychop.com/blog/basket-vs-flipp-vs-grocerychop)).
- **Basket** compares list totals across nearby stores using retailer and
  user-contributed prices, about 50 US chains, with some stale prices; the same
  competitor blog says it may no longer be available in app stores *(vendor
  source, not confirmed)*.

Takeaway: deal data is either promotional or approximate. A household's own
receipts are the one price source that is exact for that household.

### Budgeting and spend apps

Monarch lets users match Amazon and Target orders to bank charges and split by
item through a Chrome extension (US only, up to three months of orders), and
also reads receipt photos for line items ([Sacra summary of Monarch's
help pages](https://sacra.com/chat/h/fa871fa4-1efc-4d62-bf70-137ba55e524f/)).
YNAB and Copilot were not read in this pass *(not checked)*. Budgeting apps are
the natural home for "how much did we spend"; they are not built around a
grocery list.

### Meal planning and pantry

A 2026 side-by-side review lists AnyList, Paprika 3 ($4.99 once on iOS),
Plan to Eat, Samsung Food (pantry awareness only on the paid tier) and others.
It is written by a competitor and says nothing about receipt scanning
*(vendor source)* ([FoodiePrep](https://www.foodieprep.ai/blog/meal-planning-apps-with-builtin-grocery-lists-a-2026-sidebyside-review)).
The same page says Mealime was discontinued on 21 Oct 2026 with no data export;
we did not confirm that with Mealime *(not checked)*. If true, it is a reminder
of why export matters.

### Delivery and smart fridges

- **Instacart** sells through retailers and has a developer platform for
  shoppable recipe and shopping-list pages, retailer lookup and checkout
  ([docs](https://docs.instacart.com/developer_platform_api/)). Access needs an
  API key; the docs do not describe approval.
- **Pricing trust.** A Dec 2025 study by Groundwork Collaborative, Consumer
  Reports and More Perfect Union had shoppers add identical items at the same
  stores and reported that the same item was shown at different prices.
  Instacart called the differences "price tests" with a small group of retail
  partners and reportedly ended item price tests on 23 Dec 2025 ([APH Networks](https://aphnetworks.com/news/31190-instacart-ends-ai-pricing-tests-showing-different-prices-same-items)).
  The headline numbers (share of items with several prices, basket difference)
  are left out here because we could not confirm them in a source the reviewer
  could open; see the study coverage at [ConsumerAffairs](https://www.consumeraffairs.com/news/study-found-instacart-showed-different-prices-to-different-shoppers-121025.html)
  *(could not be opened by the reviewer)*. Why it matters here: a record of
  what you actually paid has value.
- **Samsung** announced a multi-year Instacart partnership in Jan 2025 for
  fridges that watch contents and reorder; the AI recognises up to 37 food
  items and cannot see door bins or the freezer ([Retail Dive](https://www.retaildive.com/news/instacart-samsung-shoppable-smart-fridge-tech/736630)).

## 3. Real problems at each step, and where Arya fits

| Problem | Evidence | Does Arya touch it? |
|---|---|---|
| Food is forgotten and wasted | UK survey of 2,000 adults (OnePoll for GS1 UK, Sept 2025, published Mar 2026): 33% forget food they bought is in the fridge, 49% throw food away because it goes off, 43% call it a waste of money ([GS1 UK](https://www.gs1uk.org/insights/news/As-grocery-prices-rise-again-UK-households-are-throwing-away-hundreds-of-pounds-on-forgotten-food)). UK data, not US. *(GS1 UK page could not be opened by the reviewer.)* | Partly built: "Use soon" and a food-waste cost figure from your own receipts. Not tested for effect on waste. |
| Prices are hard to judge, and may differ by session | Instacart study above. | Partly built: cheaper store and price trend, from your own receipts only. No outside prices are fetched. |
| Spend is one number, items are lost | Monarch needs a browser extension or receipt photo to split items. | Built: receipts are read, every line is checked against the printed total, returns net out. Small test set (see README "Known limits"). |
| The list does not know the household | Reviews above describe lists as typed or recipe-driven. | Built: staples due show as suggestions with a reason. |
| Everyone adds things differently | Voice, photo, barcode, recipes across apps. | Built: type, voice, photo of a note, and an MCP connector for your own assistant. |
| Switching apps is painful | Mealime item above *(not confirmed)*. | Not built: import and export are roadmap ideas. A Lists API exists. |

We did not find a reliable, current source for "how many households struggle
with X" that we trust enough to quote for the US; we left those numbers out
rather than guess.

## 4. Collaboration and integration opportunities

Ordered roughly by how real the door is today. None of these is built; they
extend the roadmap's "Developer platform and integrations".

| Partner type | Example | What the link would do | Door today | Risk |
|---|---|---|---|---|
| Delivery | Instacart Developer Platform | Send a list for ordering; bring the real receipt back | Public docs; API key needed | Arya has no cart or payment today; brand and terms review; Instacart owns the checkout |
| AI assistants | MCP clients, Muse agent | Read and edit lists by voice or chat | **Built** (MCP connector) | Needs the user's own sign-in |
| Meta glasses | Wearables Device Access Toolkit; Ray-Ban Display preview | Capture shelves or show the list on the glasses | Display-glasses developer preview announced 14 May 2026: native SDK (Swift/Kotlin) and web apps; example uses include grocery lists; public store distribution not mentioned ([PPC Land](https://ppc.land/meta-opens-display-glasses-to-developers-with-two-sdk-paths/)). The earlier toolkit passes camera and mic data to a phone app ([Road to VR](https://roadtovr.com/meta-ray-ban-smart-glasses-third-party-app-sdk-device-access-toolkit/)) | Preview APIs may change; glasses cost $799; today's demo uses the phone camera |
| Budgeting | Monarch, YNAB, Copilot | Export grocery spend by store and category | Not checked | Needs CSV export first; the roadmap says not built |
| Recipes and meal planning | Paprika, Samsung Food | Recipe to list, using household store history | Not checked | Each has its own format; Mealime item suggests export is not guaranteed |
| Smart fridges | Samsung Family Hub | Tell Arya what is empty or expiring | Samsung uses Instacart | Closed ecosystems; limited recognition (37 items) |
| Open price data | Open Food Facts "Open Prices" | Share receipt-derived prices as a community commons | *(not checked: pages did not load in this pass)* | Needs the opt-in and privacy design the roadmap already requires |
| List apps | AnyList, Bring!, OurGroceries | Import a list from a file or link | Not checked | Formats unknown |

Honest note on tone: the cleanest first step is import and export, because it
makes Arya safe to try (you can leave) and fits the "core platform" idea. It
needs no partner's permission for the file route.

## 5. Where Arya is different

What is built today, in plain terms (see README and `STATUS.md`):

- A list that learns from your own receipts: what is running low, what to use
  soon, and where you usually buy it, each with a reason.
- Receipt reading with a code check: Muse Spark reads first, Muse Wonder
  re-reads flagged receipts, and every line is checked against the printed
  total before anything posts.
- Prices from your own receipts only. Nothing is fetched from store sites,
  flyers, APIs or the web.
- Groups that share lists; an Ask chat; the MCP connector; a Lists API.
- Quest, an optional game that turns the trip into a hunt, and a guided store
  scan.

What Arya is not, so the comparison stays fair:

- It has no cart, payment or delivery.
- Community prices are not built; opt-in records a choice only.
- It was tested on one household's receipts and a small public set, on one
  real phone.
- It does not match the maturity, store coverage or price of the list apps
  above, which have had years of polish.
- Registration is closed for the hackathon; the demo needs no account.

The honest pitch: apps above are strong at one step. Arya's bet is the
connective tissue: a household's own receipts as a shared source of truth that
lists, spend, prices and (later) a community can all read, with import and
export so people can bring data in and take it out.

## 6. Suggested next steps (for the owner to decide)

1. After Nov 4: CSV export of spend and receipts, and list import. Cheapest
   proof of the platform idea.
2. Read the Instacart and Open Prices terms before any outreach.
3. Check Meta's glasses preview terms before promising anything on glasses.
4. Verify the *(not checked)* items above, and read at least five people who
   use these apps today, before relying on this page for anything public.

## Wording note

Spark and Wonder run in Meta's Standard mode, which Meta does not use to train
its models. This page makes no other claim about model training.
