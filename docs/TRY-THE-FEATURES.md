# Try every feature on your own copy of Arya

These steps were written by the builder and checked on a local copy (`docker compose up --build`, http://localhost:8080) on 2026-11-02. "Needs your key" means the step calls a Meta model, so `MODEL_API_KEY` must be set in `.env`. Everything else works without a key.

Arya is a phone app. For the closest view, use your browser's phone mode (for example 390 × 844), or open the address from a phone on the same network.

## 0. Start

1. Copy the settings file and add your key: `cp .env.local.example .env`, then put your key from dev.meta.ai after `MODEL_API_KEY=`.
2. Run `docker compose up --build`, then open http://localhost:8080.
3. A **Create your account** sheet opens. You can either:
   - **Make your account now** (any username, plus a password). Use it for section 9, your own receipts.
   - **Tap Close, then Try it now** to open the demo household (sections 1 to 8).

Sign-in here is a plain username and password. There is no waitlist, no Google and no email code. To make more accounts, use **Start my own list** at the bottom of the landing page.

## 1. The demo household and its neighbourhood

Tap **Try it now**, then **Skip for now** (or **Show me every screen** for the 2-minute tour).

The household shops in **Demo Town**, a simulated neighbourhood of 800 households and 8 stores: Trader Jill's, Safeday, Costcozy, Whole Meadows, Aldo's, Targot, Sprout Street and Corner Market. Anything from the neighbours is marked **SIMULATED**.

**Today** shows these cards, top to bottom:

- **Next trip**: Trader Jill's, 4 items, with "Hummus 10 oz is out here today".
- **Near you today**: "Hummus 10 oz is out at Trader Jill's. 3 neighbors reported it… Safeday has it at $4.29" and "Whole Milk 1 gal is cheapest at Aldo's, $3.50".
- **Running low**: Whole Milk and Sourdough Loaf, each with how often you buy it.
- **Cheaper elsewhere**: "Pasture Eggs: cheaper at Costcozy, $6.03 there, $6.96 at Trader Jill's".
- **Use soon**: 6 things from your receipts that can expire.
- **Still good?**: one item to check.
- **Spending**: October total.
- **Price watch**: Sourdough Loaf is 6.6% more than in July.

## 2. Pick a store and see its news and stock

1. Tap **More**, then **Stores**. **My stores** lists Costcozy and Trader Jill's (starred), plus Aldo's and Safeday. Each is marked Demo Town (simulated).
2. Tap **Find stores** to search all stores by name, ZIP or address.
3. Tap **More**, then **Lists**, then **Trader Jill's**. The list opens with a heads-up: "Hummus 10 oz is out. Safeday has it…". Hummus is marked **Out here · 3 neighbors**.
4. Under **Suggested for Trader Jill's**, tap an item to see why Arya suggests it, then **+ Add**.

## 3. Make things happen in the town (Director)

1. Open http://localhost:8080/?director=1 and go into the demo.
2. Tap **More**, then **Settings**. A **Director · Stage a moment for the demo** panel appears.
3. Tap **Eggs run out**, **Store closes**, **Saturday rush** or **Incident**, then go back to **Today** and the lists to see the new reports. **Reset** clears them.

## 4. Lists and adding items

- Type into the box at the top of a list. You can type amounts too, like "3 avocados" or "1.5 lb salmon".
- Tap the circle to tick an item. Tap an item to edit its name, amount or note, or to move it to another list.
- Every item lives on a list. Adding from Today with two lists asks which list.
- **Needs your key:** the microphone (talk your list), or a photo of a paper list.
- Turn off your network (browser devtools, Offline), then add, tick and remove items. They save on the phone. Turn the network back on and they sync with a "Synced" note.

## 5. Shopping trip (Quest)

1. On the **Trader Jill's** list, tap **Start shopping**. The quest walks you item to item. Tap **Got it** on each.
2. **Needs your key and a camera:** **Find it for me** (SAM 3.1 finds the shelf, and Spark checks it) and **Map my store** on the Quest tab.

## 6. Ask Arya (needs your key)

Tap **Ask**, then try:

- "We finished the Greek yogurt": the list updates.
- "Where is milk cheaper?": it answers from the receipts.
- "What's running low?"

## 7. Spending and prices

- **Spending**: by month, by store and by item. Tap an item to see its price by store.
- **More, Receipts**: the household's 39 receipts. Search by store or amount.

## 8. Use soon

On **Today**, tap **Use soon** and add dates. Arya reminds you before things go off. You can try the date-reading sample without a camera.

## 9. Your own account: receipts end to end (needs your key)

1. Sign in with the account from step 0, or make one with **Start my own list**.
2. Go to **More**, then **Receipts**, then **Add receipt**, and snap or upload a receipt photo or PDF.
   - Spark reads it first, and Arya checks the lines against the printed total.
   - Wonder re-reads it only if the checks flag it.
   - Items land in your data, and a store you choose for a list joins **My stores**.

The demo household can't add receipts, because it keeps nothing.

## 10. Share with your household (groups)

1. Make a second account: open a private window and use **Start my own list**.
2. In the first account, go to **Settings** and tap **Start a group**. Give it a name, then tap **Invite someone** for a code (it works for 48 hours).
3. In the second account, join with the code.
4. Add an item in one window. It appears in the other.

## 11. Use Arya from your own AI app

Go to **Settings**, then **About Arya**, then **Use Arya in Muse**, and tap **Make my code**. Paste it into Muse or any app that supports MCP connectors.

## Reset

Run `docker compose down -v`, then `docker compose up`. You get a fresh copy with the demo household written again.
