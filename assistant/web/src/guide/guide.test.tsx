import { act, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/en.json";
import { NavProvider, useNav } from "../app/nav";
import { GuideProvider, openGuide, useGuide } from "../ui/Guide";
import { TourProvider, useTour } from "../ui/Tour";
import { FIRST_RUN_TOUR } from "../onboarding/firstRunTour";
import {
  GUIDE_CARDS, GUIDE_FOR_POWER, GUIDE_IDS, HOWTOS, SAMPLE_RECEIPT, SAMPLE_TWO_STORES, addSampleItems, byCategory,
  compareStores, guessAisle, guideIndex, parseItems, total, type GuideId,
} from "./cards";

/* The Arya guide (#154): card data, the overlay's swipe / keys / Back
 * / Next / open-at-a-card, Try it on sample data only (no fetch), and
 * the first-run tour's "Want the full guide?" link. */

// jsdom has no window.scrollTo (NavProvider calls it on every show).
beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });

function hasKey(key: string) {
  let d: unknown = en;
  for (const p of key.split(".")) d = d && typeof d === "object" ? (d as Record<string, unknown>)[p] : undefined;
  return typeof d === "string";
}

describe("cards", () => {
  test("the owner's eight sections then the how-tos, every text an en.json key", () => {
    expect(GUIDE_CARDS.map(c => c.id)).toEqual([...GUIDE_IDS]);
    expect(GUIDE_IDS).toEqual(["lists", "share", "maps", "news", "receipts", "prices", "usesoon", "ask", "howto"]);
    const art = GUIDE_CARDS.flatMap(c => c.art?.kind === "rows" ? [c.art.headKey, ...(c.art.faces || []), ...c.art.rows.flatMap(r => [r.k, r.v])] : []);
    expect(art.filter((k): k is string => !!k).filter(k => !hasKey(k))).toEqual([]);
    const keys = GUIDE_CARDS.flatMap(c => [c.kickerKey, c.titleKey, c.bodyKey, ...(c.pointKeys || []), c.try?.labelKey,
      ...(c.howtos || []).flatMap(h => [h.titleKey, ...h.stepKeys])]).filter((k): k is string => !!k);
    expect(keys.filter(k => !hasKey(k))).toEqual([]);
    const samples = [SAMPLE_RECEIPT, ...SAMPLE_TWO_STORES].flatMap(r => [r.storeKey, ...r.lines.flatMap(l => [l.nameKey, l.catKey])]);
    expect(samples.filter(k => !hasKey(k))).toEqual([]);
  });
  test("five how-tos of 2 to 4 steps", () => {
    expect(HOWTOS.map(h => h.id)).toEqual(["receipt", "shop", "share", "expiry", "ask"]);
    for (const h of HOWTOS) { expect(h.stepKeys.length).toBeGreaterThanOrEqual(2); expect(h.stepKeys.length).toBeLessThanOrEqual(4); }
  });
  test("open at a card id; an unknown id opens card 1; powers point at real cards", () => {
    expect(guideIndex("prices")).toBe(5);
    expect(guideIndex("nope")).toBe(0);
    expect(guideIndex(undefined)).toBe(0);
    for (const id of Object.values(GUIDE_FOR_POWER)) expect(GUIDE_IDS).toContain(id);
  });
});

describe("sample data", () => {
  test("typed items: split, trimmed, capitalised, no repeats", () => {
    expect(parseItems(" oat milk, bananas,,Oat milk\nbread ")).toEqual(["Oat milk", "Bananas", "Bread"]);
    expect(parseItems(" , ")).toEqual([]);
  });
  test("a small local aisle table guesses the aisle", () => {
    expect(guessAisle("Oat milk")).toBe("guide.try.list.aisle.dairy");
    expect(guessAisle("Bananas")).toBe("guide.try.list.aisle.produce");
    expect(guessAisle("Sourdough bread")).toBe("guide.try.list.aisle.bakery");
    expect(guessAisle("Dragon fruit jam")).toBe("guide.try.list.aisle.produce");
    expect(guessAisle("Batteries")).toBe("guide.try.list.aisle.other");
    for (const k of ["dairy", "produce", "bakery", "frozen", "pantry", "meat", "snacks", "drinks", "other"]) expect(hasKey(`guide.try.list.aisle.${k}`)).toBe(true);
  });
  test("added items go on top, tagged Just added; a repeat moves up", () => {
    const start = [{ name: "Eggs", aisleKey: "a" }, { name: "Bread", aisleKey: "b" }];
    const out = addSampleItems(start, "oat milk, bread");
    expect(out.map(i => [i.name, !!i.justAdded])).toEqual([["Oat milk", true], ["Bread", true], ["Eggs", false]]);
    expect(addSampleItems(start, "  ")).toBe(start);
  });
  test("receipt totals, spending by category, and the two-store comparison", () => {
    expect(total(SAMPLE_RECEIPT)).toBe(34.83);
    const cats = byCategory(SAMPLE_RECEIPT);
    expect(cats[0]).toEqual({ catKey: "guide.sample.cat.pantry", amount: 13.68 });
    expect(cats.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(34.83, 2);
    const cmp = compareStores(SAMPLE_TWO_STORES);
    expect(cmp[0]).toMatchObject({ nameKey: "guide.sample.item.oil", cheapKey: "guide.sample.store.tj", cheap: 8.99, dear: 11.49 });
    expect(cmp.find(c => c.nameKey === "guide.sample.item.pasta")!.cheapKey).toBe("guide.sample.store.safeway");
  });
});

let nav!: ReturnType<typeof useNav>;
let guide!: ReturnType<typeof useGuide>;
function Probe() { nav = useNav(); guide = useGuide(); return <p data-testid="view">{nav.view}</p>; }
const mount = () => render(<NavProvider initial="profile"><TourProvider><GuideProvider><Probe /></GuideProvider></TourProvider></NavProvider>);
const count = () => document.getElementById("gd-count")?.textContent;
const card = () => document.querySelector(".gd")?.getAttribute("data-card");
const open = (at?: GuideId) => act(() => guide.open(at));
const key = (k: string) => act(() => { fireEvent.keyDown(document.activeElement || document.body, { key: k }); });
const swipe = (dx: number, dy = 0) => {
  const el = document.querySelector(".gd")!;
  act(() => {
    fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 400 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 400 + dy }] });
  });
};

describe("guide overlay", () => {
  test("opens at card 1 as a dialog, focus on Next; Next, Back and Done", () => {
    mount();
    open();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
    expect(count()).toBe("Arya guide · 1 of 9");
    expect(document.activeElement!.id).toBe("gd-next");
    expect(document.getElementById("gd-back")).toBeNull();
    expect(document.querySelectorAll(".gd-dots i.on").length).toBe(1);
    act(() => { fireEvent.click(document.getElementById("gd-next")!); });
    expect(count()).toBe("Arya guide · 2 of 9");
    expect(screen.getByText("Share lists, shop together or apart")).toBeTruthy();
    act(() => { fireEvent.click(document.getElementById("gd-back")!); });
    expect(card()).toBe("lists");
    expect(document.activeElement!.id).toBe("gd-next");
    open("howto");
    expect(document.getElementById("gd-next")!.textContent).toBe("Done");
    expect(document.querySelectorAll(".gd-howto details").length).toBe(5);
    act(() => { fireEvent.click(document.getElementById("gd-next")!); });
    expect(document.querySelector(".gd")).toBeNull();
  });
  test("arrow keys move, and stop at the ends; Esc closes", () => {
    mount();
    open();
    key("ArrowLeft");
    expect(card()).toBe("lists");
    key("ArrowRight");
    key("ArrowRight");
    expect(card()).toBe("maps");
    key("ArrowLeft");
    expect(card()).toBe("share");
    open("howto");
    key("ArrowRight");
    expect(card()).toBe("howto");
    key("Escape");
    expect(document.querySelector(".gd")).toBeNull();
  });
  test("a left swipe goes forward, a right swipe back; short or upright drags do nothing", () => {
    mount();
    open();
    swipe(-120);
    expect(card()).toBe("share");
    swipe(-120);
    expect(card()).toBe("maps");
    swipe(90);
    expect(card()).toBe("share");
    swipe(-30);
    expect(card()).toBe("share");
    swipe(-80, 200);
    expect(card()).toBe("share");
  });
  test("opens at a card id (the Powers links), and from code (openGuide)", () => {
    mount();
    open("prices");
    expect(count()).toBe("Arya guide · 6 of 9");
    expect(screen.getByText("Know where it's cheaper")).toBeTruthy();
    act(() => { fireEvent.click(document.getElementById("gd-close")!); });
    expect(document.querySelector(".gd")).toBeNull();
    act(() => openGuide("ask"));
    expect(card()).toBe("ask");
  });
  test("Store maps' Try it opens the game's Practice Market; Store news has no Try it", () => {
    mount();
    open("news");
    expect(document.getElementById("gd-try")).toBeNull();
    open("maps");
    act(() => { fireEvent.click(document.getElementById("gd-try")!); });
    expect(document.querySelector(".gd")).toBeNull();
    expect(nav.view).toBe("community");
    expect(nav.params.practice).toBe(true);
  });
});

describe("try it", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("no network in Try it")));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const tryAt = (id: GuideId) => {
    open(id);
    act(() => { fireEvent.click(document.getElementById("gd-try")!); });
    const sheet = document.getElementById("gd-try-sheet")!;
    expect(sheet.querySelector(".samp")!.textContent).toBe("Sample");
    expect(sheet.textContent).toContain("Try it here. Nothing is saved.");
    return sheet;
  };
  const click = (sel: string) => act(() => { fireEvent.click(document.querySelector(sel)!); });

  test("every Try it runs on sample data and never calls fetch", () => {
    mount();
    // Lists: typed items go on top with a guessed aisle and Just added.
    let sheet = tryAt("lists");
    act(() => { fireEvent.change(document.getElementById("gd-list-input")!, { target: { value: "oat milk, bananas" } }); });
    act(() => { fireEvent.submit(document.querySelector(".gd-addrow")!); });
    const rows = Array.from(sheet.querySelectorAll("#gd-list-items .row"));
    expect(rows.map(r => r.querySelector(".name")!.textContent)).toEqual(["Oat milk", "Bananas", "Eggs", "Sourdough bread"]);
    expect(rows[0].querySelector(".sub")!.textContent).toBe("Dairy · aisle 4");
    expect(rows[1].querySelector(".samp.new")!.textContent).toBe("Just added");
    expect(rows[2].querySelector(".samp.new")).toBeNull();
    // Arrow keys and Esc belong to the sheet while it is up.
    key("ArrowRight");
    expect(card()).toBe("lists");
    key("Escape");
    expect(document.getElementById("gd-try-sheet")).toBeNull();
    expect(card()).toBe("lists");

    // Household: a sample code, then Priya joins.
    sheet = tryAt("share");
    expect(sheet.querySelector(".gd-code")!.textContent).toBe("K7Q 2MX");
    expect(document.getElementById("gd-start-group")).toBeNull();
    click("#gd-join");
    expect(document.getElementById("gd-share-members")!.textContent).toContain("@priya");
    expect(document.getElementById("gd-share-after")).toBeTruthy();
    key("Escape");

    // Use soon: Snap turns the sample into a Use by Friday row.
    tryAt("usesoon");
    click("#gd-snap");
    expect(document.getElementById("gd-usesoon-row")!.textContent).toContain("Use by Friday");
    key("Escape");

    // Receipts: File it, then spending by category as bars.
    tryAt("receipts");
    click("#gd-file");
    expect(document.getElementById("gd-filed")).toBeTruthy();
    expect(document.querySelectorAll("#gd-cats .month-row .bar").length).toBe(4);
    key("Escape");

    // Prices: two stores, then the comparison.
    sheet = tryAt("prices");
    expect(sheet.querySelectorAll(".gd-receipt").length).toBe(2);
    click("#gd-compare");
    expect(document.getElementById("gd-compare-out")!.textContent).toContain("Cheaper at Trader Joe's");
    key("Escape");

    // Ask: three chips, scripted answers in the Ask bubbles.
    sheet = tryAt("ask");
    const chips = sheet.querySelectorAll<HTMLButtonElement>(".chip[data-ask]");
    expect(chips.length).toBe(3);
    chips.forEach(c => act(() => { fireEvent.click(c); }));
    expect(sheet.querySelectorAll("#gd-chat .bubble.me").length).toBe(3);
    expect(sheet.querySelectorAll("#gd-chat .bubble.arya").length).toBe(3);
    expect(chips[0].disabled).toBe(true);
    key("Escape");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("Start my group closes the guide and opens Settings at Group", () => {
    mount();
    tryAt("share");
    click("#gd-join");
    click("#gd-start-group");
    expect(document.querySelector(".gd")).toBeNull();
    expect(nav.view).toBe("profile");
    expect(nav.params.group).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("Make my real list closes the guide and opens the real new-list flow", () => {
    mount();
    tryAt("lists");
    click("#gd-real-list");
    expect(document.querySelector(".gd")).toBeNull();
    expect(document.getElementById("gd-try-sheet")).toBeNull();
    expect(nav.view).toBe("list");
    expect(nav.params.newList).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function TourStarter() {
  const { startTour } = useTour();
  return <button onClick={() => startTour(FIRST_RUN_TOUR.slice(-1), { onDone })}>Go</button>;
}
const onDone = vi.fn();

describe("first-run tour", () => {
  test("the last step offers the guide; the link ends the tour as Done, then opens it", () => {
    expect(FIRST_RUN_TOUR[FIRST_RUN_TOUR.length - 1].more?.labelKey).toBe("firstRun.tour.guideLink");
    expect(FIRST_RUN_TOUR.slice(0, -1).every(s => !s.more)).toBe(true);
    render(<NavProvider><TourProvider><GuideProvider><div id="tabs" /><TourStarter /></GuideProvider></TourProvider></NavProvider>);
    act(() => { fireEvent.click(screen.getByText("Go")); });
    expect(screen.getByText("Want the full guide?")).toBeTruthy();
    act(() => { fireEvent.click(document.getElementById("fr-tour-more")!); });
    expect(document.querySelector(".fr-tour")).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(card()).toBe("lists");
  });
  test("Replay the tour sits on card 1 only; it closes the guide and starts the tour", () => {
    render(<NavProvider><TourProvider><GuideProvider><div id="tabs" /><Probe /></GuideProvider></TourProvider></NavProvider>);
    open("share");
    expect(document.getElementById("gd-tour")).toBeNull();
    open();
    expect(document.getElementById("gd-tour")!.textContent).toBe("Replay the tour");
    act(() => { fireEvent.click(document.getElementById("gd-tour")!); });
    expect(document.querySelector(".gd")).toBeNull();
    expect(document.querySelector(".fr-tour")).not.toBeNull();
  });
});
