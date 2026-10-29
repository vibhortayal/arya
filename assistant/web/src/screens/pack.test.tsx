import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import {
  NewList, aisleFor, budgetLine, buildDeck, dragDecision, estimate, estimateLine, exactRow, matchRow, packFinish,
  parseLine, rawItem, reasonFor, sessionItem, splitInput,
} from "./NewList";
import { Mode } from "./Mode";

/* The Pack (the dealt-card deck, the bag rows, the estimate and the
 * budget), as the plain-JS app's node harnesses ran pwa/pack.js
 * (tests/test_pack.py PURE, MACHINE, REVIEW, COMBINED), against the
 * port in NewList.tsx. Helper mode was hidden in the old app
 * (HELPER_ENABLED = false) and is not ported, so its checks retire
 * with it. The browser run is web/e2e/newlist.e2e.mjs. */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

const anyD = (o: unknown) => o as any;

describe("pure helpers", () => {
  const plan = anyD({
    has_history: true,
    list: [{ item_id: "i-milk", name: "Whole Milk 1 gal", qty: 1 }],
    items: [
      { item_id: "i-milk", name: "Whole Milk 1 gal", stores: { "Trader Joe's": 5 }, every_days: 9, days_since: 8, due: true, typical_qty: 1, price: 4, prices: { "Trader Joe's": 3, Costco: 5 } },
      { item_id: "i-eggs", name: "Pasture Eggs 12 ct", stores: { "Costco Wholesale": 6, "Trader Joe's": 2 }, every_days: 10, days_since: 12, due: true, typical_qty: 2, price: 8, prices: { Costco: 7, "Trader Joe's": 6 } },
      { item_id: "i-pasta", name: "Pasta 1 lb", stores: { "Trader Joe's": 3 }, every_days: 14, days_since: 7, due: false, typical_qty: 1, price: 2, prices: {} },
      { item_id: "i-rare", name: "Saffron", stores: { "Trader Joe's": 1 }, every_days: null, days_since: 3, due: false, price: null, prices: {} },
      { item_id: "i-elsewhere", name: "Beer", stores: { Costco: 9 }, due: true, days_since: 5, every_days: 7, price: 20, prices: { Costco: 20 } },
    ],
    carried: [{ name: "Tortillas", qty: 2, group: "name:tortillas", note: "large" }, { name: "Pasta 1 lb", qty: 1, group: "g" }],
    queued: [{ id: "q1", name: "Hummus", from: "priya" }, { id: "q2", name: "Whole Milk 1 gal", from: "priya" }],
  });

  test("parseLine: quantity, size note, brands with numbers, markup kept as text", () => {
    const exp: Record<string, [string, number, string]> = {
      "2x tortillas": ["Tortillas", 2, ""], "tortillas x2": ["Tortillas", 2, ""],
      "2 tortillas": ["Tortillas", 2, ""], "tortillas 2": ["Tortillas", 2, ""],
      "tortillas 2x": ["Tortillas", 2, ""], "salsa 16oz": ["Salsa", 1, "16oz"],
      "eggs 1 dozen": ["Eggs", 1, "1 dozen"], "12 ct eggs": ["Eggs", 1, "12 ct"],
      "milk 2 l": ["Milk", 1, "2 l"], "7 up": ["7 up", 1, ""], "": ["", 1, ""],
      "  ": ["", 1, ""], "2 lb bananas": ["Bananas", 1, "2 lb"],
      "dozen eggs": ["Eggs", 1, "dozen"], "2 lemons": ["Lemons", 2, ""],
    };
    for (const [k, [n, q, note]] of Object.entries(exp)) {
      const p = parseLine(k);
      expect([p.name, p.qty, p.note], k).toEqual([n, q, note]);
    }
    for (const k of ['"organic" milk', "<b>milk</b>"]) expect(parseLine(k).name).not.toMatch(/[<>]/);
    expect(parseLine('"organic" milk').name).toContain('"organic"');
  });

  test("splitInput", () => {
    expect(splitInput("milk, eggs; 2x bread\nsalsa,,")).toEqual(["milk", "eggs", "2x bread", "salsa"]);
  });

  test("aisleFor", () => {
    const want: Record<string, string> = {
      Eggs: "Dairy", Bananas: "Produce", Bread: "Bakery", "Frozen peas": "Frozen",
      "Paper towels": "Household", Pasta: "Pantry", Hummus: "Deli",
      "Peanut butter": "Pantry", Quasar: "", "Oat milk": "Dairy",
    };
    for (const [n, a] of Object.entries(want)) expect(aisleFor(n), n).toBe(a);
  });

  test("matchRow: exact, plural, a unique core name; never a wrong guess", () => {
    const rows = [{ key: "a", name: "Pasture Eggs 12 ct" }, { key: "b", name: "Whole Milk 1 gal" }, { key: "c", name: "Oat Milk 1 L" }];
    const k = (r: { key: string } | null) => (r ? r.key : null);
    expect(k(matchRow("pasture egg 12 ct", rows))).toBe("a");
    expect(k(matchRow("Pasture Eggs", rows))).toBe("a");
    expect(matchRow("Eggs", rows)).toBeNull();
    expect(matchRow("milk", rows)).toBeNull();
    expect(k(matchRow("whole milk", rows))).toBe("b");
    expect(k(matchRow("oat milk", rows))).toBe("c");
    expect(matchRow("bread", rows)).toBeNull();
    expect(matchRow("butter", [{ key: "p", name: "Peanut Butter" }])).toBeNull();
    expect(matchRow("milk", [{ key: "o", name: "Oat Milk 1 L" }])).toBeNull();
    expect(matchRow("egg", [{ key: "n", name: "Egg Noodles" }])).toBeNull();
    expect(matchRow("pepper", [{ key: "b", name: "Bell Pepper" }])).toBeNull();
    expect(matchRow("bread", [{ key: "c", name: "Bread Crumbs" }])).toBeNull();
    expect(matchRow("whole milk", [{ key: "a", name: "Whole Milk 1 gal" }, { key: "b", name: "Whole Milk 2 L" }])).toBeNull();
    expect([k(exactRow("whole milk", rows)), k(exactRow("Whole Milk 1 gal", rows))]).toEqual([null, "b"]);
  });

  test("the deck: carried, queued, due before usual; dedupe; cap; approved helper rows are not dealt", () => {
    const deck = buildDeck({ plan, store: "Trader Joe's", pick: {} });
    expect(deck.map(c => c.kind + ":" + c.name)).toEqual(["carried:Tortillas", "carried:Pasta 1 lb", "queued:Hummus", "due:Pasture Eggs 12 ct"]);
    expect(deck.satisfied).toEqual(["q2"]);
    expect(buildDeck({ plan, store: "Trader Joe's", pick: anyD({ pasta: { name: "Pasta 1 lb", on: true } }) }).map(c => c.name)).not.toContain("Pasta 1 lb");
    expect(buildDeck({ plan: anyD({ has_history: false, list: [], items: plan.items }), store: "Trader Joe's", pick: {} }).length).toBe(0);
    expect(buildDeck({ plan: anyD({ has_history: false, list: [], items: [], carried: plan.carried }), store: "X", pick: {} }).map(c => c.name)).toEqual(["Tortillas", "Pasta 1 lb"]);
    const many = anyD({ has_history: true, list: [], items: Array.from({ length: 30 }, (_, i) => ({ item_id: "x" + i, name: "Thing " + String.fromCharCode(97 + i), stores: { S: 5 }, every_days: 5, days_since: i, due: false })) });
    expect(buildDeck({ plan: many, store: "S", pick: {} }).length).toBe(12);
    const added = buildDeck({ plan: anyD({ has_history: true, list: [{ item_id: "m", name: "Juice boxes", qty: 1, added_by: "Mia" }], items: [] }), store: "S", pick: {} });
    expect(added.map(c => [c.name, c.chip, reasonFor(c)])).toEqual([["Juice boxes", "Added by Mia", "Mia added this."]]);
    expect(buildDeck({ plan: anyD({ has_history: true, list: [
      { item_id: "m", name: "Juice boxes", qty: 1, added_by: "Mia", approved: true },
      { item_id: "n", name: "Gum", qty: 1, added_by: "Sam", approved: false }], items: [] }), store: "S", pick: {} }).map(c => c.name)).toEqual(["Gum"]);
    expect(reasonFor(deck.find(c => c.name === "Pasture Eggs 12 ct")!)).toBe("You buy this about every 10 days. Last bought 12 days ago. You usually get 2.");
    expect(reasonFor(deck[0])).toBe("Left from last trip.");
    const q = deck.find(c => c.kind === "queued")!;
    expect(reasonFor(q)).toBe("From @priya's haul.");
    expect(q.chip).toBe("From @priya's haul");
  });

  test("drag boundaries", () => {
    expect([dragDecision(79, 300), dragDecision(81, 300), dragDecision(-79, 300), dragDecision(-81, 300),
      dragDecision(80, 300), dragDecision(90, 400), dragDecision(101, 400), dragDecision(0, 300)])
      .toEqual([null, "pack", null, "skip", null, null, "pack", null]);
  });

  test("the estimate: the store's price first, unpriced items said so; the budget line is calm", () => {
    const est = estimate([{ name: "Whole Milk 1 gal", qty: 2 }, { name: "Pasture Eggs 12 ct", qty: 1 }, { name: "Mystery", qty: 3 }, { name: "Saffron", qty: 1 }], plan, "Trader Joe's");
    expect(est).toEqual({ total: 12, priced: 2, count: 4 });
    expect(estimate([{ name: "Pasta 1 lb", qty: 1 }], plan, "Nowhere").total).toBe(2);
    expect([estimateLine(est), estimateLine({ total: 74.4, priced: 9, count: 9 }), estimateLine({ total: 0, priced: 0, count: 3 })]).toEqual([
      "About $12 for 2 of your 4 items. Only you see this.", "About $74 for your 9 items. Only you see this.", ""]);
    const b = [budgetLine(74, "80"), budgetLine(74, ""), budgetLine(74, "0"), budgetLine(80, "74"), budgetLine(74.4, "74")];
    expect(b.slice(0, 3)).toEqual(["", "", ""]);
    expect(b[3]).toBe("About $6 over your budget. Want to leave something for next trip?");
    expect(b[4]).toBe("");
    for (const l of b) expect(l.toLowerCase()).not.toMatch(/alert|warning|error|exceed|stop|!/);
  });

  test("the shapes sent on: the raw line and the session item", () => {
    expect(rawItem(anyD({ name: "Eggs", qty: 2, note: " 12 ct ", variant: "", by: "Mia", src: "typed", aisle: "" })))
      .toEqual({ name: "Eggs", qty: 2, note: "12 ct", by: "Mia", src: "typed", aisle: "Dairy" });
    expect(rawItem(anyD({ name: "Milk", qty: 1, on: true }))).toEqual({ name: "Milk", qty: 1, src: "list", aisle: "Dairy" });
    expect(sessionItem({ name: "Salsa", qty: 1, group: "g", checked: false, note: "mild" }, { by: "Mia", note: "hot" }))
      .toEqual({ name: "Salsa", qty: 1, group: "g", note: "mild", by: "Mia" });
    expect(sessionItem({ name: "Salsa", qty: 1 })).toEqual({ name: "Salsa", qty: 1 });
  });
});

/* ---------------- the screen ---------------- */

let posts: [string, any][];
let planNow: any;
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
function stub() {
  posts = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
    if (init && init.method === "POST") posts.push([url, body]);
    if (url === "/api/quest/plan") return json(planNow);
    if (url === "/api/quest/optimize") return json({ items: body.items.map((i: any) => ({ ...i, checked: false, group: "name:" + i.name.toLowerCase() })),
      report: { in: body.items.length, out: body.items.length, merged: [], corrected: [], questions: [], unresolved: [] } });
    if (url === "/api/quest/sessions" && init && init.method === "POST") return json({ id: "s1", store: body.store, mode: body.mode, state: "not_started", items: body.items });
    if (url.startsWith("/api/pack/variants")) return json({ variants: [] });
    if (url.includes("/reports")) return json({ reports: [] });
    return json({});
  }));
}
let nav!: ReturnType<typeof useNav>;
function Host({ store }: { store: string }) {
  nav = useNav();
  if (nav.view === "newlist" && !nav.params.store) { nav.replace("newlist", { store }); return null; }
  if (nav.view === "mode") return <Mode />;
  return nav.view === "newlist" ? <NewList /> : null;
}
const mount = (store = "Trader Joe's") => render(<ToastProvider><NavProvider initial="newlist"><Host store={store} /></NavProvider></ToastProvider>);
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const deckName = () => $("#pack-card h3")?.textContent || null;
const toastText = () => $("#toast")!.textContent || "";
const settle = () => new Promise(r => setTimeout(r, 240)); // the card motion (ANIM_MS)
const addText = async (t: string) => {
  fireEvent.change($("#nl-text")!, { target: { value: t } });
  fireEvent.click($("#nl-add")!);
};
const bagNames = () => [...document.querySelectorAll("#nl-plan .plantick .name")].map(e => e.textContent);
const xOf = (name: string) => {
  const row = [...document.querySelectorAll("#nl-plan .packrow")].find(r => r.querySelector(".name")?.textContent === name);
  return row ? (row.querySelector(".packx")?.textContent || "x1") : null;
};

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

beforeEach(() => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  try { localStorage.clear(); } catch { /* jsdom has it */ }
  planNow = mkPlan();
  stub();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the deck", () => {
  test("deals in order; a double tap is one decision; the next card waits for the motion", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    expect($(".packcount")!.textContent).toBe("Card 1 of 5");
    const names: string[] = [];
    fireEvent.click($('[data-pack="pack"]')!);
    fireEvent.click($('[data-pack="pack"]')!);
    expect(deckName()).toBe("Hummus");
    expect(bagNames()).toContain("Tortillas");
    expect(xOf("Tortillas")).toBe("x2");
    fireEvent.click($('[data-pack="skip"]')!); // still moving: refused
    expect(deckName()).toBe("Hummus");
    await settle();
    fireEvent.click($('[data-pack="skip"]')!);
    expect(deckName()).toBe("Pasture Eggs 12 ct");
    await settle();
    for (let i = 0; i < 3; i++) { names.push(deckName()!); fireEvent.click($('[data-pack="skip"]')!); await settle(); }
    expect(names).toEqual(["Pasture Eggs 12 ct", "Pasta 1 lb", "Black Beans"]);
    expect($(".packcount")!.textContent).toBe("That was the last card. Your bag is below.");
  });

  test("Back one card undoes the last decision, then the one before", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    fireEvent.click($('[data-pack="pack"]')!); await settle();
    fireEvent.click($('[data-pack="skip"]')!); await settle();
    fireEvent.click($('[data-pack="back"]')!);
    expect(deckName()).toBe("Hummus");
    expect($('[data-packrestore="hummus"]')).toBeNull();
    fireEvent.click($('[data-pack="back"]')!);
    expect(deckName()).toBe("Tortillas");
    expect(bagNames()).not.toContain("Tortillas");
    expect($('[data-pack="back"]')).toBeNull();
  });

  test("Undo is exact; Pack all; Skip the rest; a skipped row comes back", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    fireEvent.click($('[data-pack="pack"]')!); await settle();
    fireEvent.click($('[data-pack="rest"]')!);
    expect(toastText()).toContain("The rest are skipped.");
    expect($(".packcount")!.textContent).toBe("That was the last card. Your bag is below.");
    fireEvent.click($('[data-packfold="skipped"]')!);
    expect(document.querySelectorAll("[data-packrestore]").length).toBe(4);
    fireEvent.click($("#toast .toastact")!); // Undo the sweep
    expect(deckName()).toBe("Hummus");
    expect(bagNames()).toContain("Tortillas");
    fireEvent.click($('[data-pack="all"]')!);
    expect(toastText()).toContain("All 4 cards packed.");
    for (const n of ["Tortillas", "Hummus", "Pasture Eggs 12 ct", "Pasta 1 lb", "Black Beans", "Whole Milk 1 gal"]) expect(bagNames()).toContain(n);
    fireEvent.click($("#toast .toastact")!);
    fireEvent.click($('[data-pack="rest"]')!);
    fireEvent.click($('[data-packfold="skipped"]')!);
    fireEvent.click($('[data-packrestore="hummus"]')!);
    expect(bagNames()).toContain("Hummus");
    expect($('[data-packrestore="hummus"]')).toBeNull();
  });

  test("arrow keys pack and skip, and focus follows the new card", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    $("#pack-card")!.focus();
    fireEvent.keyDown($("#pack-card")!, { key: "ArrowRight" });
    expect(deckName()).toBe("Hummus");
    await waitFor(() => expect(document.activeElement).toBe($("#pack-card")));
    await settle();
    fireEvent.keyDown($("#pack-card")!, { key: "ArrowLeft" });
    expect(deckName()).toBe("Pasture Eggs 12 ct");
    await waitFor(() => expect(document.activeElement).toBe($("#pack-card")));
  });
});

describe("typed rows", () => {
  test("added, merged, matched only when sure", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    await addText("2x tortillas");
    expect(xOf("Tortillas")).toBe("x2");
    expect(toastText()).toContain("Tortillas x2 is in your bag.");
    // The pending card for the same thing is dropped.
    expect(deckName()).toBe("Hummus");
    await addText("tortillas");
    expect(toastText()).toContain("Tortillas is already in your bag. Now x3.");
    expect(bagNames().filter(n => /tortilla/i.test(n!)).length).toBe(1);
    await addText("milk");
    expect(bagNames()).toContain("Milk");
    expect(xOf("Whole Milk 1 gal")).toBe("x1");
    await addText("whole milk");
    expect(xOf("Whole Milk 1 gal")).toBe("x2");
    await addText("bread, salsa 16oz; 3 apples");
    expect(toastText()).toContain("3 items are in your bag.");
    expect(xOf("Apples")).toBe("x3");
    const salsa = [...document.querySelectorAll("#nl-plan .packrow")].find(r => r.querySelector(".name")?.textContent === "Salsa")!;
    expect(salsa.querySelector(".packnote")!.textContent).toBe("16oz");
    await addText("   ");
    expect(toastText()).toContain("Type an item first.");
    // Taken out, then typed again: back in.
    fireEvent.click($('[data-plan="salsa"]')!);
    await addText("salsa");
    expect(toastText()).toContain("Salsa is back in your bag.");
    expect($('[data-plan="salsa"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  test("plain milk is not the oat milk row; butter is not peanut butter; an exact name links", async () => {
    planNow = { has_history: true, list: [{ item_id: "i-oat", name: "Oat Milk 1 L", qty: 1 }], carried: [], queued: [],
      items: [
        { item_id: "i-oat", name: "Oat Milk 1 L", stores: { S: 3 }, price: 4, prices: {} },
        { item_id: "i-pb", name: "Peanut Butter", stores: { S: 3 }, price: 5, prices: {} },
        { item_id: "i-ban", name: "Bananas", stores: { S: 3 }, price: 1, prices: {} },
      ] };
    mount("S");
    await waitFor(() => expect(bagNames()).toContain("Oat Milk 1 L"));
    await addText("milk");
    expect(toastText()).toContain("Milk is in your bag.");
    expect(xOf("Oat Milk 1 L")).toBe("x1");
    await addText("butter");
    await addText("banana");
    await addText("oat milk");
    expect(xOf("Oat Milk 1 L")).toBe("x2");
    fireEvent.click($("#nl-next")!);
    await waitFor(() => expect(posts.some(p => p[0] === "/api/quest/optimize")).toBe(true));
    const adds = posts.filter(p => p[0] === "/api/list/add").map(p => p[1]);
    expect(adds).toContainEqual({ name: "Milk" });
    expect(adds).toContainEqual({ name: "Butter" });
    expect(adds).toContainEqual({ item_id: "i-ban" });
    expect(adds.some(a => a.item_id === "i-pb")).toBe(false);
  });

  test("an empty bag keeps Start disabled", async () => {
    planNow = { has_history: true, list: [], items: [], carried: [], queued: [] };
    mount();
    await waitFor(() => expect($("#nl-next")!.textContent).toBe("Add an item to start"));
    expect($("#nl-next")!.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change($("#nl-text")!, { target: { value: "milk" } });
    expect($("#nl-next")!.getAttribute("aria-disabled")).toBe("false");
    expect($("#nl-next")!.textContent).toBe("Start the quest · 1 item →");
  });

  test("names are text, never markup", async () => {
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    await addText("<img onerror=1>");
    expect(document.querySelector("#nl-plan img[onerror]")).toBeNull();
    expect(bagNames()).toContain("Img onerror=1"); // the brackets are dropped
    const row = [...document.querySelectorAll("#nl-plan .packrow")].find(r => r.querySelector(".name")?.textContent === "Img onerror=1")!;
    for (const s of [".plantick", ".packedit", ".packchip"]) expect(row.querySelector(s)).not.toBeNull();
    expect(row.querySelector("[data-planrm]")).toBeNull();
    const milk = [...document.querySelectorAll("#nl-plan .packrow")].find(r => r.querySelector(".name")?.textContent === "Whole Milk 1 gal")!;
    expect(milk.querySelector('[data-planrm][data-item="i-milk"]')).not.toBeNull();
  });
});

describe("the saved draft, the budget, the end", () => {
  test("saved on a decision, restored at the same store, fresh elsewhere or after 12 hours", async () => {
    let r = mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    fireEvent.click($('[data-pack="pack"]')!);
    expect(localStorage.getItem("arya-pack-draft")).not.toBeNull();
    r.unmount();
    r = mount();
    await waitFor(() => expect(deckName()).toBe("Hummus"));
    expect(toastText()).toContain("Welcome back. Your bag is saved.");
    r.unmount();
    r = mount("Costco");
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    r.unmount();
    const old = JSON.parse(localStorage.getItem("arya-pack-draft")!);
    old.t = Date.now() - 13 * 3600 * 1000;
    localStorage.setItem("arya-pack-draft", JSON.stringify(old));
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
  });

  test("packFinish posts the dealt queued cards once and clears the draft", () => {
    localStorage.setItem("arya-pack-draft", "{}");
    const d = anyD({ pack: { deck: [{ queued_id: "q1" }, { queued_id: "q9" }], deal: 1, satisfied: [] } });
    expect(packFinish(d)).toEqual(["q1"]);
    expect(posts).toEqual([["/api/quest/queued/finish", { ids: ["q1"] }]]);
    expect(localStorage.getItem("arya-pack-draft")).toBeNull();
    expect(d.pack).toBeNull();
    posts.length = 0;
    packFinish(anyD({ pack: { deck: [], deal: 0, satisfied: [] } }));
    expect(posts).toEqual([]);
  });

  test("every storage call survives a throwing store", async () => {
    const thrower = () => { throw new Error("blocked"); };
    const spies = (["getItem", "setItem", "removeItem"] as const).map(m => vi.spyOn(Storage.prototype, m).mockImplementation(thrower));
    try {
      mount();
      await waitFor(() => expect(deckName()).toBe("Tortillas"));
      fireEvent.click($('[data-pack="pack"]')!);
      fireEvent.change($("#nl-budget")!, { target: { value: "80" } });
      expect(packFinish(anyD({ pack: { deck: [], deal: 0, satisfied: [] } }))).toEqual([]);
    } finally { spies.forEach(s => s.mockRestore()); }
  });

  test("the budget keeps digits and a dot, and persists", async () => {
    mount();
    await waitFor(() => expect($("#nl-budget")).not.toBeNull());
    fireEvent.change($("#nl-budget")!, { target: { value: "$7x4.5" } });
    expect(localStorage.getItem("arya-pack-budget")).toBe("74.5");
    expect(($("#nl-budget") as HTMLInputElement).value).toBe("74.5");
  });
});

describe("with the quest (pack.js + quest.js on one page)", () => {
  test("the plan draws the deck and the bag apart; Start flushes the box, joins the list, then optimizes; a mode makes one session and finishes the queue", async () => {
    planNow = {
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
    mount();
    await waitFor(() => expect(deckName()).toBe("Tortillas"));
    expect($(".packcount")!.textContent).toBe("Card 1 of 4");
    const dealt = [deckName()];
    expect(bagNames()).toContain("Whole Milk 1 gal");
    expect(bagNames()).toContain("Gum");
    expect(bagNames()).not.toContain("Juice boxes");
    expect(bagNames()).not.toContain("Tortillas");
    fireEvent.click($('[data-pack="pack"]')!);
    await settle();
    dealt.push(deckName());
    fireEvent.click($('[data-pack="all"]')!);
    expect(dealt).toEqual(["Tortillas", "Hummus"]);
    for (const n of ["Hummus", "Juice boxes", "Peanut Butter"]) expect(bagNames()).toContain(n);
    fireEvent.change($("#nl-text")!, { target: { value: "butter" } });
    fireEvent.keyDown($("#nl-text")!, { key: "Enter" });
    expect(($("#nl-text") as HTMLTextAreaElement).value).toBe("");
    fireEvent.change($("#nl-text")!, { target: { value: "milk" } }); // still in the box at Start
    posts.length = 0;
    fireEvent.click($("#nl-next")!);
    await waitFor(() => expect(nav.view).toBe("mode"));
    const adds = posts.filter(p => p[0] === "/api/list/add").map(p => p[1]);
    expect(adds).toContainEqual({ name: "Butter" });
    expect(adds).toContainEqual({ name: "Milk" });
    expect(adds).toContainEqual({ item_id: "i-jb", approved: true });
    expect(adds.some(a => a.item_id === "i-pb")).toBe(false);
    const opt = posts.findIndex(p => p[0] === "/api/quest/optimize");
    const lastAdd = Math.max(...posts.map((p, i) => (p[0] === "/api/list/add" ? i : -1)));
    expect(lastAdd).toBeGreaterThanOrEqual(0);
    expect(opt).toBeGreaterThan(lastAdd);
    const sent = posts[opt][1].items;
    const tort = sent.find((i: any) => i.name === "Tortillas");
    expect(tort).toMatchObject({ qty: 2, note: "large", src: "carried" });
    expect(sent.some((i: any) => i.name === "Juice boxes" && i.by === "Mia")).toBe(true);
    for (const n of ["Butter", "Milk"]) expect(sent.map((i: any) => i.name)).toContain(n);
    posts.length = 0;
    await waitFor(() => expect($('.modecard[data-mode="express"]')).not.toBeNull());
    await act(async () => { fireEvent.click($('.modecard[data-mode="express"]')!); });
    await waitFor(() => expect(posts.some(p => p[0] === "/api/quest/queued/finish")).toBe(true));
    const paths = posts.map(p => p[0]);
    expect(paths.slice(0, 2)).toEqual(["/api/quest/sessions", "/api/quest/queued/finish"]);
    expect(posts[1][1]).toEqual({ ids: ["q1"] });
    expect(posts[0][1].items.map((i: any) => i.name)).toContain("Butter");
  });
});
