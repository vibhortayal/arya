"""Pack slice, client side: markup and string pins over index.html,
quest.js, pack.js and pack.css, plus behaviour pinned headless under
node (pack.js is loaded alone behind the same stub prelude the other
node harnesses use)."""
import json, os, re, subprocess, tempfile, unittest

from tests.test_hunt_nav import NODE, PRELUDE, read, section

PWA = os.path.join(os.path.dirname(__file__), "..", "pwa")


def exists(name):
    return os.path.exists(os.path.join(PWA, name))


class TestPackShell(unittest.TestCase):
    def test_index_wiring(self):
        html = read("index.html")
        self.assertIn('<link rel="stylesheet" href="pack.css">', html)
        self.assertLess(html.index('href="styles.css"'), html.index('href="pack.css"'))
        self.assertLess(html.index('<script src="app.js">'), html.index('<script src="pack.js">'))
        self.assertLess(html.index('<script src="pack.js">'), html.index('<script src="scene.js">'))
        self.assertLess(html.index('<script src="pack.js">'), html.index('<script src="quest.js">'))

    def test_newlist_block(self):
        html = read("index.html")
        nl = section(html, 'id="view-newlist"', 'id="view-store"')
        for el in ("nl-text", "nl-add", "nl-helper", "nl-deck", "nl-plan", "nl-foot", "nl-next",
                   "nl-mic", "nl-photo", "nl-status"):
            self.assertIn(f'id="{el}"', nl)
        # Wireframe order: the deck first (cards on screen at phone
        # height), then "Add something else" (kept above the rows by the
        # fun pass), then the bag rows.
        self.assertLess(nl.index('id="nl-deck"'), nl.index('id="nl-text"'))
        self.assertLess(nl.index('id="nl-text"'), nl.index('id="nl-plan"'))
        self.assertLess(nl.index('id="nl-plan"'), nl.index('id="nl-foot"'))
        self.assertLess(nl.index('id="nl-foot"'), nl.index('id="nl-next"'))
        self.assertEqual(nl.count("btn primary"), 1)
        self.assertIn('id="nl-next" class="btn primary', nl)
        self.assertIn('id="nl-text" rows="2"', nl)

    def test_quest_js_guards_pack(self):
        js = read("quest.js")
        uses = [m.start() for m in re.finditer(r"\bPACK\.", js)]
        self.assertTrue(uses)
        for pos in uses:
            line_start = js.rfind("\n", 0, pos) + 1
            if js[line_start:pos].lstrip().startswith(("*", "//", "/*")):
                continue  # a comment
            window = js[max(0, line_start - 400):js.find("\n", pos)]
            self.assertTrue('typeof PACK !== "undefined"' in window or 'typeof PACK === "undefined"' in window
                            or "hasPack" in window,
                            js[line_start:js.find("\n", pos)])
        # PACK is never touched while quest.js loads
        top = js.split("function renderPlan()")[0]
        code = [l for l in top.splitlines() if not l.lstrip().startswith(("*", "//", "/*"))]
        self.assertFalse([l for l in code if "PACK." in l])

    def test_quest_js_plan_block(self):
        js = read("quest.js")
        nxt = js.split('$("#nl-next").addEventListener')[1].split("\n});")[0]
        self.assertIn('post("/api/list/add", { name: r.name })', nxt)
        self.assertIn("PACK.flush()", nxt)
        self.assertIn("PACK.listJoins()", nxt)
        self.assertIn("creating", nxt)
        self.assertIn("finally", nxt)
        self.assertLess(nxt.index("PACK.flush()"), nxt.index("qParseText"))
        mode = js.split('querySelectorAll(".modecard")')[1].split("\n  }));")[0]
        self.assertIn("draft.creating", mode)
        self.assertIn("PACK.finish()", mode)
        self.assertIn("finally", mode)
        self.assertEqual(js.count("PACK.sessionItem("), 3)
        self.assertIn("PACK.rawItem(p)", js)
        self.assertIn("PACK.addFromText", js)
        self.assertIn("PACK.afterBulkAdd()", js)
        photo = js.split('$("#nl-photo").addEventListener')[1].split("fetch(")[0]
        self.assertIn("PACK.locked()", photo)
        self.assertIn("Helper mode is on. Turn it off first.", photo)
        self.assertIn("PACK.syncStart()", js)
        self.assertIn("Q.draft.pack = null", js.split("function qPickStore()")[1].split("\n}")[0])
        self.assertNotIn("Often bought here, not on your list", js)

    def test_pack_js_is_a_safe_module(self):
        js = read("pack.js")
        for s in ("pointerdown", "pointermove", "pointerup", "pointercancel", "BUSY",
                  "Back one card", "Pack all", "Skip the rest", "Pack it", "Helper mode",
                  "Any brand", "Take out of this trip",
                  "arya-pack-draft", "arya-pack-budget", "arya-helper-name",
                  "/api/pack/variants", "/api/quest/queued/finish", "Escape"):
            self.assertIn(s, js, s)
        self.assertNotIn("re-adding", js)
        self.assertNotIn("arya-carry", js)
        self.assertNotIn("arya-pack-queue", js)
        self.assertNotIn("packQueueAdd", js)
        # every mutator snapshots first and offers Undo through done()
        for fn in ("decide", "back", "sweep", "restore", "addFromText", "addStarter", "approve", "decline"):
            body = js.split(f"function {fn}(")[1].split("\n  }\n")[0]
            self.assertIn("snap()", body, fn)
        self.assertIn('action: "Undo"', js)
        # no emoji, no banned words in anything the shopper reads
        self.assertFalse([c for c in js if ord(c) >= 0x1F000])
        copy = " ".join(re.findall(r'"([^"\n]{6,})"|`([^`\n]{6,})`', js) and
                        [a or b for a, b in re.findall(r'"([^"\n]{6,})"|`([^`\n]{6,})`', js)])
        for bad in ("lives", "game over", "timer", "streak", "hurry", "penalty", "retake",
                    "try again", "incomplete", "last place", "failed", "verified", "cropped",
                    "Frame deleted"):
            self.assertNotIn(bad, copy.lower(), bad)
        # the estimate never leaves the phone
        for call in re.findall(r"post\([^)]*\)", js):
            self.assertNotIn("estimate", call)
            self.assertNotIn("budget", call)

    def test_pack_css_rules(self):
        css = read("pack.css")
        body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        self.assertEqual(re.findall(r"#[0-9a-fA-F]{3,8}\b", body), [])
        self.assertNotIn("gradient", body)
        self.assertNotIn("--danger", body)
        self.assertNotIn("red", re.sub(r"prefers-reduced[^{]*", "", body).lower().replace("reduce", ""))
        for sel in (".packdeck", ".packcard", ".packbtns", ".packlinks", ".packqty", ".packrow",
                    ".budgetrow", ".helperbar", ".pendingrow", ".packsheet"):
            self.assertIn(sel, body, sel)
        self.assertIn("touch-action: pan-y", body)
        self.assertIn("height: 340px", body)
        self.assertIn('.btn.primary[aria-disabled="true"]', body)
        self.assertIn("prefers-reduced-motion", body)
        self.assertRegex(body, r"\.packqty button \{[^}]*width: 44px; height: 44px")
        self.assertRegex(body, r"\.packlink \{[^}]*min-height: 44px")
        self.assertRegex(body, r"\.packedit, \.packback \{[^}]*min-height: 44px")
        for size in re.findall(r"font-size: (\d+)px", body):
            self.assertGreaterEqual(int(size), 12)

    def test_other_slices_never_mention_estimate_or_budget(self):
        for name in ("share.js", "album.js"):
            if exists(name):
                js = read(name).lower()
                self.assertNotIn("estimate", js, name)
                self.assertNotIn("budget", js, name)
        # haul.js shows the owner's own server-side "estimate vs actual"
        # row (from the ledger, haul view key "private"). It never reads
        # the pack draft, the pack estimate or the budget.
        if exists("haul.js"):
            js = read("haul.js").lower()
            self.assertNotIn("budget", js)
            self.assertNotIn("arya-pack", js)
            self.assertNotIn("pack.estimate", js)
            self.assertNotIn("packui", js)


PURE = r"""
;(async () => {
  const out = {};
  const P = PACK;
  const plan = {
    has_history: true,
    list: [{ item_id: "i-milk", name: "Whole Milk 1 gal", qty: 1 }],
    items: [
      { item_id: "i-milk", name: "Whole Milk 1 gal", stores: { "Trader Joe's": 5 }, every_days: 9, days_since: 8, due: true, typical_qty: 1, price: 4, prices: { "Trader Joe's": 3, "Costco": 5 } },
      { item_id: "i-eggs", name: "Pasture Eggs 12 ct", stores: { "Costco Wholesale": 6, "Trader Joe's": 2 }, every_days: 10, days_since: 12, due: true, typical_qty: 2, price: 8, prices: { "Costco": 7, "Trader Joe's": 6 } },
      { item_id: "i-pasta", name: "Pasta 1 lb", stores: { "Trader Joe's": 3 }, every_days: 14, days_since: 7, due: false, typical_qty: 1, price: 2, prices: {} },
      { item_id: "i-rare", name: "Saffron", stores: { "Trader Joe's": 1 }, every_days: null, days_since: 3, due: false, price: null, prices: {} },
      { item_id: "i-elsewhere", name: "Beer", stores: { "Costco": 9 }, due: true, days_since: 5, every_days: 7, price: 20, prices: { "Costco": 20 } },
    ],
    carried: [{ name: "Tortillas", qty: 2, group: "name:tortillas", note: "large" }, { name: "Pasta 1 lb", qty: 1, group: "g" }],
    queued: [{ id: "q1", name: "Hummus", from: "priya" }, { id: "q2", name: "Whole Milk 1 gal", from: "priya" }],
  };
  out.parse = {};
  for (const t of ["2x tortillas", "tortillas x2", "2 tortillas", "tortillas 2", "tortillas 2x", "salsa 16oz", "eggs 1 dozen",
                   "12 ct eggs", "milk 2 l", "7 up", "", "  ", "2 lb bananas", "dozen eggs", "\"organic\" milk", "<b>milk</b>", "2 lemons"]) out.parse[t] = P.parseLine(t);
  out.split = P.splitInput("milk, eggs; 2x bread\nsalsa,,");
  out.aisle = {};
  for (const n of ["Eggs", "Bananas", "Bread", "Frozen peas", "Paper towels", "Pasta", "Hummus", "Peanut butter", "Quasar", "Oat milk"]) out.aisle[n] = P.aisleFor(n);
  const rows = [{ key: "a", name: "Pasture Eggs 12 ct" }, { key: "b", name: "Whole Milk 1 gal" }, { key: "c", name: "Oat Milk 1 L" }];
  out.match = {
    exact: (P.matchRow("pasture egg 12 ct", rows) || {}).key,
    plural: (P.matchRow("Pasture Eggs", rows) || {}).key,
    bareEggs: P.matchRow("Eggs", rows),
    ambiguous: P.matchRow("milk", rows),
    unique: (P.matchRow("whole milk", rows) || {}).key,
    sized: (P.matchRow("oat milk", rows) || {}).key,
    none: P.matchRow("bread", rows),
    butter: P.matchRow("butter", [{ key: "p", name: "Peanut Butter" }]),
    milkVsOat: P.matchRow("milk", [{ key: "o", name: "Oat Milk 1 L" }]),
    eggVsNoodle: P.matchRow("egg", [{ key: "n", name: "Egg Noodles" }]),
    pepperVsBell: P.matchRow("pepper", [{ key: "b", name: "Bell Pepper" }]),
    breadVsCrumbs: P.matchRow("bread", [{ key: "c", name: "Bread Crumbs" }]),
    twoSizes: P.matchRow("whole milk", [{ key: "a", name: "Whole Milk 1 gal" }, { key: "b", name: "Whole Milk 2 L" }]),
    exactOnly: [(P.exactRow("whole milk", rows) || {}).key || null, (P.exactRow("Whole Milk 1 gal", rows) || {}).key],
  };
  const deck = P.buildDeck({ plan, store: "Trader Joe's", pick: {} });
  out.deck = deck.map(c => c.kind + ":" + c.name);
  out.satisfied = deck.satisfied;
  out.deckEarlyPick = P.buildDeck({ plan, store: "Trader Joe's", pick: { pasta: { name: "Pasta 1 lb", on: true } } }).map(c => c.name);
  out.deckFirstRun = P.buildDeck({ plan: { has_history: false, list: [], items: plan.items }, store: "Trader Joe's", pick: {} }).length;
  out.deckFirstRunCarried = P.buildDeck({ plan: { has_history: false, list: [], items: [], carried: plan.carried }, store: "X", pick: {} }).map(c => c.name);
  const many = { has_history: true, list: [], items: Array.from({ length: 30 }, (_, i) => ({ item_id: "x" + i, name: "Thing " + String.fromCharCode(97 + i), stores: { "S": 5 }, every_days: 5, days_since: i, due: false })) };
  out.deckCap = P.buildDeck({ plan: many, store: "S", pick: {} }).length;
  out.deckAdded = P.buildDeck({ plan: { has_history: true, list: [{ item_id: "m", name: "Juice boxes", qty: 1, added_by: "Mia" }], items: [] }, store: "S", pick: {} }).map(c => [c.name, c.chip, P.reasonFor(c)]);
  out.deckApproved = P.buildDeck({ plan: { has_history: true, list: [
    { item_id: "m", name: "Juice boxes", qty: 1, added_by: "Mia", approved: true },
    { item_id: "n", name: "Gum", qty: 1, added_by: "Sam", approved: false }], items: [] }, store: "S", pick: {} }).map(c => c.name);
  out.reasons = {
    due: P.reasonFor(deck.find(c => c.name === "Pasture Eggs 12 ct")),
    carried: P.reasonFor(deck[0]),
    queued: P.reasonFor(deck.find(c => c.kind === "queued")),
    chipQueued: deck.find(c => c.kind === "queued").chip,
  };
  out.drag = [P.dragDecision(79, 300), P.dragDecision(81, 300), P.dragDecision(-79, 300), P.dragDecision(-81, 300),
              P.dragDecision(80, 300), P.dragDecision(90, 400), P.dragDecision(101, 400), P.dragDecision(0, 300)];
  const est = P.estimate([{ name: "Whole Milk 1 gal", qty: 2 }, { name: "Pasture Eggs 12 ct", qty: 1 }, { name: "Mystery", qty: 3 }, { name: "Saffron", qty: 1 }], plan, "Trader Joe's");
  out.estimate = est;
  out.estimateOverall = P.estimate([{ name: "Pasta 1 lb", qty: 1 }], plan, "Nowhere");
  out.estimateLine = [P.estimateLine(est), P.estimateLine({ total: 74.4, priced: 9, count: 9 }), P.estimateLine({ total: 0, priced: 0, count: 3 })];
  out.budget = [P.budgetLine(74, 80), P.budgetLine(74, ""), P.budgetLine(74, 0), P.budgetLine(80, 74), P.budgetLine(74.4, 74)];
  out.raw = P.rawItem({ name: "Eggs", qty: 2, note: " 12 ct ", variant: "", by: "Mia", src: "typed", aisle: "" });
  out.rawList = P.rawItem({ name: "Milk", qty: 1, on: true });
  out.session = P.sessionItem({ name: "Salsa", qty: 1, group: "g", checked: false, note: "mild" }, { by: "Mia", note: "hot" });
  out.sessionBare = P.sessionItem({ name: "Salsa", qty: 1 });
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""

MACHINE = r"""
;(async () => {
  const out = {};
  const P = PACK;
  const toasts = [];
  globalThis.toast = (m, o) => toasts.push([m, o]);
  const posts = [];
  globalThis.post = async (path, body) => { posts.push([path, body]); return {}; };
  globalThis.api = async path => ({ variants: [] });
  const mkPlan = () => ({
    has_history: true,
    list: [{ item_id: "i-milk", name: "Whole Milk 1 gal", qty: 1 }],
    items: [
      { item_id: "i-milk", name: "Whole Milk 1 gal", stores: { "Trader Joe's": 5 }, every_days: 9, days_since: 8, due: false, price: 4, prices: { "Trader Joe's": 3 } },
      { item_id: "i-pasta", name: "Pasta 1 lb", stores: { "Trader Joe's": 3 }, every_days: 14, days_since: 7, due: false, price: 2, prices: {} },
      { item_id: "i-bean", name: "Black Beans", stores: { "Trader Joe's": 4 }, every_days: 20, days_since: 4, due: false, price: 1.5, prices: {} },
      { item_id: "i-eggs", name: "Pasture Eggs 12 ct", stores: { "Trader Joe's": 9 }, every_days: 10, days_since: 12, due: true, typical_qty: 2, price: 6, prices: {} },
    ],
    carried: [{ name: "Tortillas", qty: 2, group: "name:tortillas" }],
    queued: [{ id: "q1", name: "Hummus", from: "priya" }],
  });
  const fresh = () => {
    localStorage._m = {}; toasts.length = 0; posts.length = 0;
    const draft = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
    P.open(draft, mkPlan(), "Trader Joe's");
    draft.pick["whole milk 1 gal"] = { name: "Whole Milk 1 gal", qty: 1, on: true, src: "list" };
    return draft;
  };
  const cards = d => d.pack.deck.map(c => c.name);
  const snapStr = d => JSON.stringify([d.pick, d.pack]);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // open, deck, first card
  let d = fresh();
  out.deckNames = cards(d);
  out.firstId = d.pack.deck[0].id;
  // double tap = one decision
  out.dbl1 = P.decide("pack", d.pack.deck[0].id);
  out.dbl2 = P.decide("pack", d.pack.deck[0].id);
  out.decisions1 = d.pack.decisions.length;
  out.picked = d.pick.tortillas && d.pick.tortillas.on === true && d.pick.tortillas.qty === 2 && d.pick.tortillas.src === "carried" && d.pick.tortillas.extra === true;
  // busy: the next card is refused until the motion ends
  out.busyBlocks = P.decide("skip", d.pack.deck[1].id);
  out.busyFlag = P.busy();
  P._settle();
  out.afterSettle = P.decide("skip", d.pack.deck[1].id);
  out.skipRow = d.pick.hummus && d.pick.hummus.on === false && d.pick.hummus.skipped === true && d.pick.hummus.queuedId === "q1";
  // wrong card id is ignored
  P._settle();
  out.wrongId = P.decide("pack", "nope");
  // back after skip and after pack
  P._settle();
  out.back1 = P.back(); out.hummusGone = !("hummus" in d.pick); out.deal1 = d.pack.deal;
  P._settle();
  out.back2 = P.back(); out.tortGone = !("tortillas" in d.pick); out.deal0 = d.pack.deal;
  P._settle();
  out.backEmpty = P.back();
  // undo exactness
  d = fresh();
  const before = snapStr(d);
  P.decide("pack", d.pack.deck[0].id);
  P._settle();
  const mid = snapStr(d);
  P.skipRest();
  out.skipRestAll = d.pack.deal === d.pack.deck.length && Object.values(d.pick).filter(r => r.skipped).length === d.pack.deck.length - 1;
  out.undoRest = P.undo() && snapStr(d) === mid;
  out.undoFirst = P.undo() && snapStr(d) === before;
  out.undoNothing = P.undo();
  out.toastHasUndo = toasts.some(t => t[1] && t[1].action === "Undo");
  // pack all
  d = fresh(); P.packAll();
  out.packAll = Object.values(d.pick).every(r => r.on) && d.pack.deal === d.pack.deck.length && Object.keys(d.pick).length === d.pack.deck.length + 1;
  // restore a skipped row
  d = fresh(); P._settle(); P.skipRest();
  out.restore = P.restore("hummus") && d.pick.hummus.on === true && !d.pick.hummus.skipped;
  out.restoreNonSkipped = P.restore("hummus");
  // typed rows, merge, toast text
  d = fresh();
  P.addFromText("2x tortillas");
  out.typedRow = eq([d.pick.tortillas.qty, d.pick.tortillas.on, d.pick.tortillas.src, d.pick.tortillas.aisle, d.pick.tortillas.joinList], [2, true, "typed", "Bakery", true]);
  out.pendingDropped = !d.pack.deck.slice(d.pack.deal).some(c => c.name === "Tortillas");
  P.addFromText("tortillas");
  out.merged = d.pick.tortillas.qty === 3 && Object.keys(d.pick).filter(k => k.startsWith("tortilla")).length === 1;
  out.mergeToast = toasts[toasts.length - 1][0];
  P.addFromText("egg");
  out.eggsId = (d.pick["egg"] && d.pick["egg"].itemId) || null;
  P.addFromText("milk");
  out.milkMerged = d.pick["whole milk 1 gal"].qty === 1 && d.pick.milk && d.pick.milk.on === true && !d.pick.milk.itemId;
  P.addFromText("whole milk");
  out.wholeMilkMerged = d.pick["whole milk 1 gal"].qty === 2 && !("whole milk" in d.pick);
  out.multi = P.addFromText("bread, salsa 16oz; 3 apples");
  out.salsaNote = d.pick.salsa && d.pick.salsa.note;
  out.apples = d.pick.apples && d.pick.apples.qty;
  out.emptyAdd = P.addFromText("   ");
  out.joins = P.listJoins();
  // removed earlier then typed again: revived
  d.pick.salsa.on = false;
  P.addFromText("salsa");
  out.revived = d.pick.salsa.on === true;
  // empty bag keeps Start disabled
  d = fresh();
  delete d.pick["whole milk 1 gal"];
  out.zero = P.rows().length;
  const btnAttrs = {};
  const origQs = document.querySelector;
  document.querySelector = sel => {
    const e = origQs(sel);
    if (sel === "#nl-next") { e.setAttribute = (k, v) => { btnAttrs[k] = v; }; }
    return e;
  };
  out.startN = P.syncStart();
  out.startDisabled = btnAttrs["aria-disabled"];
  d.pick.milk = { name: "Milk", qty: 1, on: true };
  P.syncStart();
  out.startEnabled = btnAttrs["aria-disabled"] === "false";
  document.querySelector = origQs;
  // draft persistence
  d = fresh();
  P.decide("pack", d.pack.deck[0].id);
  out.saved = !!localStorage.getItem("arya-pack-draft");
  const d2 = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
  P.open(d2, mkPlan(), "Trader Joe's");
  out.restoredDeal = d2.pack.deal === 1 && "tortillas" in d2.pick;
  const d3 = { raw: [], store: "Costco", pick: {}, pack: null };
  P.open(d3, mkPlan(), "Costco");
  out.otherStoreFresh = d3.pack.deal === 0;
  const old = JSON.parse(localStorage.getItem("arya-pack-draft")); old.t = Date.now() - 13 * 3600 * 1000;
  localStorage.setItem("arya-pack-draft", JSON.stringify(old));
  const d4 = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
  P.open(d4, mkPlan(), "Trader Joe's");
  out.expiredFresh = d4.pack.deal === 0;
  // finish clears and finishes the queue (dealt cards only)
  d = fresh(); P.decide("pack", d.pack.deck[0].id); P._settle(); P.decide("skip", d.pack.deck[1].id);
  posts.length = 0;
  const ids = P.finish();
  await new Promise(r => setTimeout(r, 10));
  out.finishIds = ids;
  out.finishPost = posts.length === 1 && posts[0][0] === "/api/quest/queued/finish" && eq(posts[0][1], { ids: ["q1"] });
  out.draftCleared = localStorage.getItem("arya-pack-draft") === null;
  d = fresh(); posts.length = 0; P.finish();
  out.noQueuedNoPost = posts.length === 0;
  // storage that throws
  const real = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  try {
    d = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
    P.open(d, mkPlan(), "Trader Joe's");
    P.decide("pack", d.pack.deck[0].id);
    P.setBudget("80");
    P.setHelperName("Mia");
    P.finish();
    out.throwingStorage = true;
  } catch (e) { out.throwingStorage = String(e); }
  globalThis.localStorage = real;
  // budget persists
  localStorage._m = {};
  d = fresh(); P.setBudget("$7x4.5");
  out.budgetKept = localStorage.getItem("arya-pack-budget") === "74.5" && d.pack.budget === "74.5";
  // helper mode
  d = fresh();
  P.setHelperName("Mia"); P.setHelper(true);
  out.locked = P.locked();
  out.lockedPackAll = P.packAll(); out.lockedSkipRest = P.skipRest();
  P.addFromText("juice boxes");
  out.pending = d.pack.helper.pending.map(p => p.name);
  out.notInBag = !("juice boxes" in d.pick);
  out.nameStored = localStorage.getItem("arya-helper-name") === "Mia";
  const pid = d.pack.helper.pending[0].id;
  P.approve(pid);
  out.approved = d.pick["juice boxes"] && d.pick["juice boxes"].by === "Mia" && d.pack.helper.pending.length === 0;
  out.approveJoin = P.listJoins().filter(j => j.name === "Juice boxes").map(j => j.by);
  out.approveJoinApproved = P.listJoins().filter(j => j.name === "Juice boxes").map(j => j.approved);
  P.addFromText("gum");
  P.decline(d.pack.helper.pending[0].id);
  out.declined = !("gum" in d.pick) && d.pack.helper.pending.length === 0;
  P.setHelper(false);
  out.unlocked = !P.locked();
  // rows html is escaped and carries the contract classes
  d = fresh();
  d.pick["x"] = { name: "<img onerror=1>", qty: 2, on: true, extra: true, src: "typed", note: "a&b", aisle: "Pantry" };
  const html = P.rowHtml("x", d.pick["x"], {});
  out.escaped = !html.includes("<img") && html.includes("&lt;img") && html.includes("a&amp;b");
  out.rowParts = ["plantick", "packx", "packedit", "packchip", "x2"].every(s => html.includes(s));
  const listHtml = P.rowHtml("m", { name: "Milk", qty: 1, on: true }, { itemId: "i-milk" });
  out.listRowHasX = listHtml.includes("data-planrm") && !html.includes("data-planrm");
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


def run_node(driver):
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "harness.js")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(PRELUDE)
            fh.write(read("pack.js"))
            fh.write(driver)
        out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    res = json.loads(out.stdout.strip().splitlines()[-1])
    assert "error" not in res, res.get("error")
    return res


@unittest.skipUnless(NODE, "node not available")
class TestPackPure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_node(PURE)

    def test_parse_line_table(self):
        p = self.r["parse"]
        exp = {
            "2x tortillas": ("Tortillas", 2, ""), "tortillas x2": ("Tortillas", 2, ""),
            "2 tortillas": ("Tortillas", 2, ""), "tortillas 2": ("Tortillas", 2, ""),
            "tortillas 2x": ("Tortillas", 2, ""), "salsa 16oz": ("Salsa", 1, "16oz"),
            "eggs 1 dozen": ("Eggs", 1, "1 dozen"), "12 ct eggs": ("Eggs", 1, "12 ct"),
            "milk 2 l": ("Milk", 1, "2 l"), "7 up": ("7 up", 1, ""), "": ("", 1, ""),
            "  ": ("", 1, ""), "2 lb bananas": ("Bananas", 1, "2 lb"),
            "dozen eggs": ("Eggs", 1, "dozen"), "2 lemons": ("Lemons", 2, ""),
        }
        for k, (n, q, note) in exp.items():
            self.assertEqual((p[k]["name"], p[k]["qty"], p[k]["note"]), (n, q, note), k)
        for k in ('"organic" milk', "<b>milk</b>"):
            self.assertNotIn("<", p[k]["name"])
            self.assertNotIn(">", p[k]["name"])
        self.assertIn('"organic"', p['"organic" milk']["name"])

    def test_split(self):
        self.assertEqual(self.r["split"], ["milk", "eggs", "2x bread", "salsa"])

    def test_aisle(self):
        self.assertEqual(self.r["aisle"], {
            "Eggs": "Dairy", "Bananas": "Produce", "Bread": "Bakery", "Frozen peas": "Frozen",
            "Paper towels": "Household", "Pasta": "Pantry", "Hummus": "Deli",
            "Peanut butter": "Pantry", "Quasar": "", "Oat milk": "Dairy"})

    def test_match_row(self):
        self.assertEqual(self.r["match"], {
            "exact": "a", "plural": "a", "bareEggs": None, "ambiguous": None, "unique": "b",
            "sized": "c", "none": None, "butter": None, "milkVsOat": None, "eggVsNoodle": None,
            "pepperVsBell": None, "breadVsCrumbs": None, "twoSizes": None,
            "exactOnly": [None, "b"]})

    def test_deck_order_dedupe_cap(self):
        # carried first, queued next, then due before usual, by ripeness.
        # Pasta is carried and also usual: it appears once. The haul's
        # "Whole Milk" is on the list already: answered, not dealt.
        self.assertEqual(self.r["deck"], [
            "carried:Tortillas", "carried:Pasta 1 lb", "queued:Hummus", "due:Pasture Eggs 12 ct"])
        self.assertEqual(self.r["satisfied"], ["q2"])
        self.assertNotIn("Pasta 1 lb", [n for n in self.r["deckEarlyPick"]])
        self.assertEqual(self.r["deckCap"], 12)
        self.assertEqual(self.r["deckFirstRun"], 0)
        self.assertEqual(self.r["deckFirstRunCarried"], ["Tortillas", "Pasta 1 lb"])
        self.assertEqual(self.r["deckAdded"], [["Juice boxes", "Added by Mia", "Mia added this."]])
        # a row the grown-up already approved is not dealt again
        self.assertEqual(self.r["deckApproved"], ["Gum"])

    def test_reasons(self):
        self.assertEqual(self.r["reasons"]["carried"], "Left from last trip.")
        self.assertEqual(self.r["reasons"]["queued"], "From @priya's haul.")
        self.assertEqual(self.r["reasons"]["chipQueued"], "From @priya's haul")
        self.assertEqual(self.r["reasons"]["due"],
                         "You buy this about every 10 days. Last bought 12 days ago. You usually get 2.")

    def test_drag_boundaries(self):
        self.assertEqual(self.r["drag"], [None, "pack", None, "skip", None, None, "pack", None])

    def test_estimate_store_median_and_unpriced(self):
        # milk 2 x 3 (here) + eggs 1 x 6 (here); Mystery and Saffron have no price
        self.assertEqual(self.r["estimate"], {"total": 12.0, "priced": 2, "count": 4})
        self.assertEqual(self.r["estimateOverall"]["total"], 2.0)
        self.assertEqual(self.r["estimateLine"], [
            "About $12 for 2 of your 4 items. Only you see this.",
            "About $74 for your 9 items. Only you see this.", ""])

    def test_budget_line_is_calm(self):
        self.assertEqual(self.r["budget"][:3], ["", "", ""])
        self.assertEqual(self.r["budget"][3], "About $6 over your budget. Want to leave something for next trip?")
        self.assertEqual(self.r["budget"][4], "")
        for line in self.r["budget"]:
            self.assertNotRegex(line.lower(), r"alert|warning|error|exceed|stop|!")

    def test_session_shape(self):
        self.assertEqual(self.r["raw"], {"name": "Eggs", "qty": 2, "note": "12 ct", "by": "Mia",
                                         "src": "typed", "aisle": "Dairy"})
        self.assertEqual(self.r["rawList"], {"name": "Milk", "qty": 1, "src": "list", "aisle": "Dairy"})
        self.assertEqual(self.r["session"], {"name": "Salsa", "qty": 1, "group": "g", "note": "mild", "by": "Mia"})
        self.assertEqual(self.r["sessionBare"], {"name": "Salsa", "qty": 1})


@unittest.skipUnless(NODE, "node not available")
class TestPackMachine(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_node(MACHINE)

    def check(self, *keys):
        for k in keys:
            v = self.r[k]
            self.assertTrue(v is True or (v not in (False, None, 0)), f"{k} = {v!r}")

    def test_deal_and_double_tap(self):
        r = self.r
        self.assertEqual(r["deckNames"], ["Tortillas", "Hummus", "Pasture Eggs 12 ct", "Pasta 1 lb", "Black Beans"])
        self.assertIs(r["dbl1"], True)
        self.assertIs(r["dbl2"], False)
        self.assertEqual(r["decisions1"], 1)
        self.check("picked")
        self.assertIs(r["busyBlocks"], False)
        self.assertIs(r["busyFlag"], True)
        self.assertIs(r["afterSettle"], True)
        self.check("skipRow")
        self.assertIs(r["wrongId"], False)

    def test_back_after_pack_and_skip(self):
        r = self.r
        self.assertIs(r["back1"], True)
        self.check("hummusGone")
        self.assertEqual(r["deal1"], 1)
        self.assertIs(r["back2"], True)
        self.check("tortGone")
        self.assertEqual(r["deal0"], 0)
        self.assertIs(r["backEmpty"], False)

    def test_undo_is_exact(self):
        r = self.r
        self.check("skipRestAll", "undoRest", "undoFirst", "toastHasUndo", "packAll", "restore")
        self.assertIs(r["undoNothing"], False)
        self.assertIs(r["restoreNonSkipped"], False)

    def test_typed_rows_and_merge(self):
        r = self.r
        self.check("typedRow", "pendingDropped", "merged", "milkMerged", "wholeMilkMerged", "revived")
        self.assertEqual(r["mergeToast"], "Tortillas is already in your bag. Now x3.")
        self.assertIsNone(r["eggsId"])  # a close name never carries an item id
        self.assertEqual(r["salsaNote"], "16oz")
        self.assertEqual(r["apples"], 3)
        self.assertIsNone(r["emptyAdd"])
        names = [j.get("name") or j.get("item_id") for j in r["joins"]]
        self.assertIn("Tortillas", names)
        tort = [j for j in r["joins"] if j.get("name") == "Tortillas"][0]
        self.assertEqual(tort["qty"], 3)

    def test_empty_bag_keeps_start_disabled(self):
        r = self.r
        self.assertEqual(r["zero"], 0)
        self.assertEqual(r["startN"], 0)
        self.assertEqual(r["startDisabled"], "true")
        self.check("startEnabled")

    def test_draft_save_restore_clear(self):
        r = self.r
        self.check("saved", "restoredDeal", "otherStoreFresh", "expiredFresh", "finishPost", "draftCleared",
                   "noQueuedNoPost", "budgetKept")
        self.assertEqual(r["finishIds"], ["q1"])

    def test_every_storage_call_survives_a_throwing_stub(self):
        self.assertIs(self.r["throwingStorage"], True)

    def test_helper_mode(self):
        r = self.r
        self.check("locked", "notInBag", "nameStored", "approved", "declined", "unlocked")
        self.assertIs(r["lockedPackAll"], False)
        self.assertIs(r["lockedSkipRest"], False)
        self.assertEqual(r["pending"], ["Juice boxes"])
        self.assertEqual(r["approveJoin"], ["Mia"])
        self.assertEqual(r["approveJoinApproved"], [True])

    def test_rows_are_escaped(self):
        self.check("escaped", "rowParts", "listRowHasX")


REVIEW = r"""
;(async () => {
  const out = {};
  const P = PACK;
  const toasts = [];
  globalThis.toast = (m, o) => toasts.push([m, o]);
  globalThis.post = async () => ({});
  globalThis.api = async () => ({ variants: [] });
  const mkPlan = () => ({
    has_history: true,
    list: [],
    items: [
      { item_id: "i-oat", name: "Oat Milk 1 L", stores: { "S": 3 }, price: 4, prices: {} },
      { item_id: "i-pb", name: "Peanut Butter", stores: { "S": 3 }, price: 5, prices: {} },
      { item_id: "i-ban", name: "Bananas", stores: { "S": 3 }, price: 1, prices: {} },
    ],
    carried: [], queued: [],
  });
  const fresh = () => {
    localStorage._m = {}; toasts.length = 0;
    const draft = { raw: [], store: "S", pick: {}, pack: null };
    P.open(draft, mkPlan(), "S");
    return draft;
  };
  // history has Oat Milk 1 L and Peanut Butter; the bag has Oat Milk
  let d = fresh();
  d.pick["oat milk 1 l"] = { name: "Oat Milk 1 L", qty: 1, on: true, src: "list", itemId: "i-oat" };
  P.addFromText("milk");
  out.milkOwnRow = !!d.pick.milk && d.pick["oat milk 1 l"].qty === 1 && !d.pick.milk.itemId;
  out.milkToast = toasts[toasts.length - 1][0];
  P.addFromText("butter");
  out.butterOwnRow = !!d.pick.butter && !d.pick.butter.itemId;
  P.addFromText("banana");
  out.bananaId = d.pick.banana && d.pick.banana.itemId;
  P.addFromText("oat milk");
  out.oatMerged = d.pick["oat milk 1 l"].qty === 2;
  out.joins = P.listJoins();
  // keyboard: focus follows the new card
  d = fresh();
  d.pack.deck = [1, 2, 3].map(n => ({ id: "carried:c" + n, key: "c" + n, name: "C" + n, qty: 1, kind: "carried", src: "carried", chip: "Left from last trip" }));
  const focused = [];
  const origQs = document.querySelector;
  document.querySelector = sel => {
    if (sel === "#pack-card") { const e = origQs(sel); e.focus = o => focused.push(o); return e; }
    return origQs(sel);
  };
  const key = k => ({ key: k, target: { tagName: "DIV", closest: s => s === "#nl-deck" ? {} : null }, preventDefault() {} });
  P._onKey(key("ArrowRight"));
  out.afterRight = [d.pack.deal, focused.length, focused[0] && focused[0].preventScroll];
  P._settle();
  P._onKey(key("ArrowLeft"));
  out.afterLeft = [d.pack.deal, focused.length, d.pick.c2 && d.pick.c2.skipped];
  P._settle();
  P.decide("pack", d.pack.deck[2].id);
  out.clickNoFocus = focused.length === 2;
  document.querySelector = origQs;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestPackWrongGuesses(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.r = run_node(REVIEW)

    def test_plain_milk_is_not_the_oat_milk_row(self):
        self.assertIs(self.r["milkOwnRow"], True)
        self.assertEqual(self.r["milkToast"], "Milk is in your bag.")
        self.assertIs(self.r["oatMerged"], True)

    def test_butter_is_not_peanut_butter_and_goes_to_the_list_by_name(self):
        self.assertIs(self.r["butterOwnRow"], True)
        joins = {(j.get("name") or j.get("item_id")): j for j in self.r["joins"]}
        self.assertEqual(joins["Butter"], {"name": "Butter"})
        self.assertEqual(joins["Milk"], {"name": "Milk"})
        self.assertNotIn("i-pb", [j.get("item_id") for j in self.r["joins"]])
        # an exact name still links to the product
        self.assertEqual(self.r["bananaId"], "i-ban")
        self.assertEqual(joins["i-ban"], {"item_id": "i-ban"})

    def test_arrow_keys_keep_working_past_the_first_card(self):
        self.assertEqual(self.r["afterRight"], [1, 1, True])
        self.assertEqual(self.r["afterLeft"], [2, 2, True])
        self.assertIs(self.r["clickNoFocus"], True)


COMBINED_SETUP = r"""
const __els = {};
const __deckKeys = [];
function __mk(sel) {
  const e = __el();
  e._h = {}; e._sel = sel; e._focus = 0;
  e.addEventListener = (ev, fn) => { (e._h[ev] = e._h[ev] || []).push(fn); };
  e.focus = () => { e._focus += 1; };
  return e;
}
document.querySelector = sel => __els[sel] || (__els[sel] = __mk(sel));
const __modecard = __mk(".modecard"); __modecard.dataset = { mode: "quest" }; __els[".modecard"] = __modecard;
document.querySelectorAll = sel => sel === ".modecard" ? [__modecard] : [];
"""

COMBINED = r"""
;(async () => {
  const out = {};
  const log = [];
  const toasts = [];
  globalThis.toast = (m, o) => toasts.push(m);
  globalThis.post = async (path, body) => {
    log.push([path, body]);
    if (path === "/api/quest/optimize") {
      return { items: body.items.map(i => ({ ...i, checked: false, group: "name:" + i.name.toLowerCase() })),
               report: { in: body.items.length, out: body.items.length, merged: [], corrected: [], questions: [], unresolved: [] } };
    }
    if (path === "/api/quest/sessions") return { id: "s1", store: body.store, mode: body.mode, state: "not_started", items: body.items };
    return {};
  };
  globalThis.api = async path => path === "/api/quest/sessions" ? { sessions: [] } : { variants: [] };
  openHunt = () => {}; openExpress = () => {}; openScore = () => {};
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; return { ok: true, json: async () => ({ names: ["Soup"] }) }; };
  const fire = async (sel, ev, arg) => { for (const fn of (__els[sel] || {})._h[ev] || []) await fn(arg); };
  const plan = {
    has_history: true,
    list: [
      { item_id: "i-milk", name: "Whole Milk 1 gal", qty: 1, source: "pattern" },
      { item_id: "i-jb", name: "Juice boxes", qty: 2, added_by: "Mia", approved: false },
      { item_id: "i-gum", name: "Gum", qty: 1, added_by: "Mia", approved: true },
    ],
    items: [
      { item_id: "i-milk", name: "Whole Milk 1 gal", stores: { "Trader Joe's": 5 }, every_days: 9, days_since: 8, due: false, price: 4, prices: { "Trader Joe's": 3 } },
      { item_id: "i-pb", name: "Peanut Butter", stores: { "Trader Joe's": 3 }, price: 5, prices: {} },
    ],
    carried: [{ name: "Tortillas", qty: 2, note: "large" }],
    queued: [{ id: "q1", name: "Hummus", from: "priya" }],
  };
  Q.plan = plan;
  Q.draft = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
  renderPlan();
  const planHtml = __els["#nl-plan"].innerHTML;
  const deckHtml = __els["#nl-deck"].innerHTML;
  out.dealt = PACK.state().pack.deck.map(c => c.name);
  out.deckHasCard = deckHtml.includes("pack-card") && deckHtml.includes("Tortillas");
  out.listRowDrawn = planHtml.includes("Whole Milk 1 gal");
  out.approvedRowDrawn = planHtml.includes("Gum");
  out.heldRowsNotDrawn = !planHtml.includes("Juice boxes") && !planHtml.includes("Tortillas");
  // pack the first card (carried Tortillas) and go on
  PACK.decide("pack", PACK.state().pack.deck[0].id);
  PACK._settle();
  PACK.packAll();
  const picked = qPlanPicked();
  const tort = picked.find(r => r.name === "Tortillas");
  out.rawFromCard = tort && tort.qty === 2 && tort.note === "large" && tort.src === "carried";
  out.jbPacked = picked.some(r => r.name === "Juice boxes" && r.by === "Mia");
  // type "butter" and "milk" (the plain names are not the list rows)
  const box = __els["#nl-text"];
  box.value = "butter";
  await fire("#nl-text", "keydown", { key: "Enter", shiftKey: false, preventDefault() {} });
  out.boxCleared = box.value === "";
  box.value = "milk";   // still in the box at Start: PACK.flush adds it
  log.length = 0;
  await fire("#nl-next", "click");
  const adds = log.filter(l => l[0] === "/api/list/add").map(l => l[1]);
  out.addBodies = adds;
  const optIdx = log.findIndex(l => l[0] === "/api/quest/optimize");
  const lastAddIdx = Math.max(...log.map((l, i) => l[0] === "/api/list/add" ? i : -1));
  out.addsBeforeOptimize = optIdx > lastAddIdx && lastAddIdx >= 0;
  const optNames = (log[optIdx][1].items || []).map(i => i.name);
  out.optNames = optNames;
  out.finalItems = (Q.draft.finalItems || []).map(i => i.name);
  // pick a mode: one session, then the queue is finished
  log.length = 0;
  await fire(".modecard", "click");
  out.paths = log.map(l => l[0]);
  out.queueIds = (log.find(l => l[0] === "/api/quest/queued/finish") || [])[1];
  out.packCleared = Q.draft.pack === null;
  // helper mode blocks a photo before it is read
  Q.draft = { raw: [], store: "Trader Joe's", pick: {}, pack: null };
  renderPlan();
  PACK.setHelper(true);
  toasts.length = 0;
  const target = { files: [{ type: "image/jpeg" }], value: "x" };
  await fire("#nl-photo", "change", { target });
  out.photoBlocked = fetched === 0 && toasts[0] === "Helper mode is on. Turn it off first." && target.value === "";
  PACK.setHelper(false);
  await fire("#nl-photo", "change", { target: { files: [{ type: "image/jpeg" }], value: "x" } });
  out.photoRuns = fetched === 1;
  console.log(JSON.stringify(out));
  process.exit(0);
})().catch(e => { console.log(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(0); });
"""


@unittest.skipUnless(NODE, "node not available")
class TestPackWithQuest(unittest.TestCase):
    """pack.js and quest.js loaded together, as the page loads them."""

    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "harness.js")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(PRELUDE)
                fh.write(COMBINED_SETUP)
                fh.write(read("pack.js"))
                fh.write(read("quest.js"))
                fh.write(COMBINED)
            out = subprocess.run([NODE, path], capture_output=True, text=True, timeout=60)
        assert out.returncode == 0, out.stderr
        cls.r = json.loads(out.stdout.strip().splitlines()[-1])
        assert "error" not in cls.r, cls.r.get("error")

    def test_plan_draws_the_deck_and_the_bag_apart(self):
        r = self.r
        self.assertEqual(r["dealt"], ["Tortillas", "Hummus", "Juice boxes", "Peanut Butter"])
        self.assertIs(r["deckHasCard"], True)
        self.assertIs(r["listRowDrawn"], True)
        # a helper row the grown-up already approved is a bag row, not a card
        self.assertIs(r["approvedRowDrawn"], True)
        self.assertIs(r["heldRowsNotDrawn"], True)

    def test_card_extras_reach_the_hunt_items(self):
        self.assertTrue(self.r["rawFromCard"])
        self.assertTrue(self.r["jbPacked"])

    def test_start_flushes_then_joins_the_list_then_optimizes(self):
        r = self.r
        self.assertIs(r["boxCleared"], True)
        self.assertIs(r["addsBeforeOptimize"], True)
        adds = r["addBodies"]
        # fuzzy names go by name, never with an item id
        self.assertIn({"name": "Butter"}, adds)
        self.assertIn({"name": "Milk"}, adds)
        self.assertEqual([a for a in adds if a.get("item_id") == "i-pb"], [])
        # a packed helper row is marked approved, not re-added by name
        self.assertIn({"item_id": "i-jb", "approved": True}, adds)
        self.assertIn("Butter", r["optNames"])
        self.assertIn("Milk", r["optNames"])
        self.assertIn("Butter", r["finalItems"])

    def test_choosing_a_mode_makes_one_session_then_finishes_the_queue(self):
        r = self.r
        self.assertEqual(r["paths"][:2], ["/api/quest/sessions", "/api/quest/queued/finish"])
        self.assertEqual(r["queueIds"], {"ids": ["q1"]})
        self.assertIs(r["packCleared"], True)

    def test_helper_mode_blocks_the_photo(self):
        self.assertIs(self.r["photoBlocked"], True)
        self.assertIs(self.r["photoRuns"], True)


if __name__ == "__main__":
    unittest.main()
