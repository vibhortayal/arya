import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NavProvider } from "../../app/nav";
import { ToastProvider } from "../../ui/Toast";
import { Album, progressText, slots, stickerSrc } from "../Album";
import { Q } from "../hunt/model";
import { maybeLevelUp } from "./levelup";
import { StickerCard, cardOpen, stickerUndoIndex } from "./StickerCard";

/* The behaviour the plain-JS app's album harness pinned under node
 * (tests/test_album_client.py TestAlbumNode), against the port. */

const BANNED = /\b(lives|game over|timer|streak|hurry|penalty|retake|try again|incomplete|last place|failed|verified|cropped|frame deleted)\b/i;
const st = (name: string, extra: Record<string, unknown> = {}): any => ({ id: "stk-" + name, name, key: "g-" + name, image: "art", art: "milk.webp", image_url: undefined, found_count: 1, first_found_at: "2026-10-28T10:00:00", store: "Trader Joe's", ...extra });

beforeEach(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; }); // jsdom has none
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test("pure helpers: slots, progress, sticker picture", () => {
  const three = { id: "a", kind: "aisle", size: 8, count: 3, stickers: [st("a"), st("b"), st("c")] };
  let ch = slots(three);
  expect(ch.length).toBe(1);
  expect(ch[0].length).toBe(8);
  expect(ch[0].filter(Boolean).length).toBe(3);
  expect(ch[0][3]).toBeNull();
  const eleven = { id: "a", kind: "aisle", size: 8, count: 11, stickers: Array.from({ length: 11 }, (_, i) => st("s" + i)) };
  ch = slots(eleven);
  expect(ch.map(c => c.length)).toEqual([8, 8]);
  expect(ch[1].filter(Boolean).length).toBe(3);
  expect(slots({ id: "a", kind: "aisle", stickers: [] })[0].every(x => x === null)).toBe(true);
  expect(slots({ id: "o", kind: "other", size: 4, count: 2, stickers: [st("a"), st("b")] })[0].length).toBe(4);
  expect(slots({ id: "o", kind: "other", size: 6, count: 6, stickers: Array.from({ length: 6 }, (_, i) => st("o" + i)) })[0].length).toBe(6);
  expect(progressText(three)).toBe("3 of 8");
  expect(progressText({ id: "o", kind: "other", size: 4, count: 2 })).toBe("2 of 4");
  expect(progressText(eleven)).toBe("11 stickers");
  expect(progressText({ id: "x", size: 8, count: 0 })).toBe("0 of 8");
  expect(stickerSrc({ id: "x", name: "x", image: "cutout", image_url: "/api/quest/stickers/x/image?v=1", art: "milk.webp" })).toBe("/api/quest/stickers/x/image?v=1");
  expect(stickerSrc({ id: "x", name: "x", image: "art", art: "milk.webp" })).toBe("/assets/characters/milk.webp");
  expect(stickerSrc({ id: "x", name: "x", image: "cutout", art: "egg.webp" })).toBe("/assets/characters/egg.webp");
  expect(stickerSrc(null)).toBe("/assets/characters/basket.webp");
});

describe("the New sticker card", () => {
  const items = [{ name: "Eggs", group: "g-Eggs", checked: true }, { name: "Milk", group: "g-Milk", checked: true }];
  const grab = (name: string) => act(() => { document.dispatchEvent(new CustomEvent("arya:grabbed", { detail: { name, group: "g-" + name } })); });
  const card = () => document.getElementById("stk-card")!;
  const set = (s: Record<string, unknown> | null) => { (Q as any).current = s; };

  test("opens on a new sticker, closes by itself after 2600 ms, Undo puts back the right row", () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    render(<StickerCard onUndo={undo} />);
    expect(cardOpen()).toBe(false);
    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk"), is_new: true } });
    grab("Milk");
    expect(cardOpen()).toBe(true);
    expect(card().hidden).toBe(false);
    expect(card().textContent).toContain("New sticker");
    expect(card().textContent).toContain("Milk");
    expect(card().querySelector("button.undo")!.textContent).toBe("Undo");
    expect("new_sticker" in (Q.current as any)).toBe(false); // consumed
    act(() => { vi.advanceTimersByTime(2599); });
    expect(cardOpen()).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(cardOpen()).toBe(false);
    expect(card().textContent).toBe("");

    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk") } });
    grab("Milk");
    fireEvent.click(card().querySelector("[data-stk-undo]")!);
    expect(undo).toHaveBeenCalledWith("g-Milk", "Milk");
    expect(stickerUndoIndex(Q.current as any, "g-Milk", "Milk")).toBe(1);
    expect(cardOpen()).toBe(false);
  });

  test("a second card replaces the first; express, stale and repeat finds show none", () => {
    render(<StickerCard onUndo={() => {}} />);
    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Eggs") } });
    grab("Eggs");
    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk") } });
    grab("Milk");
    expect(card().textContent).toContain("Milk");
    expect(card().textContent).not.toContain("Eggs");
    // A grab with no new sticker closes the earlier item's card.
    set({ id: "s1", mode: "quest", items });
    grab("Eggs");
    expect(cardOpen()).toBe(false);
    // Express never shows it, and still drops the payload.
    set({ id: "s2", mode: "express", items, new_sticker: { sticker: st("Milk") } });
    grab("Milk");
    expect(cardOpen()).toBe(false);
    expect("new_sticker" in (Q.current as any)).toBe(false);
    // A stale payload for another item is ignored and deleted.
    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Bread") } });
    grab("Milk");
    expect(cardOpen()).toBe(false);
    expect("new_sticker" in (Q.current as any)).toBe(false);
    // No session: still safe.
    set(null);
    grab("Milk");
    expect(cardOpen()).toBe(false);
  });

  test("page badge line, cutout picture, put back closes", () => {
    render(<StickerCard onUndo={() => {}} />);
    set({ id: "s1", mode: "quest", items, new_sticker: { sticker: st("Milk", { image: "cutout", image_url: "/api/quest/stickers/q/image?v=1" }), page_badge: { id: "Dairy", name: "Dairy Royalty" } } });
    grab("Milk");
    expect(card().textContent).toContain("Page full. Add your receipt to earn Dairy Royalty.");
    expect(card().textContent).not.toContain("earned.");
    expect(card().querySelector("img")!.getAttribute("src")).toBe("/api/quest/stickers/q/image?v=1");
    expect(BANNED.test(card().textContent || "")).toBe(false);
    act(() => { document.dispatchEvent(new CustomEvent("arya:putback", { detail: { name: "Milk" } })); });
    expect(cardOpen()).toBe(false);
  });
});

describe("level up", () => {
  const LADDER = [
    { level: 2, title: "Avatar extras", kind: "expression", live: false, reached: true },
    { level: 4, title: "Pin a badge on your card", kind: "expression", live: false, reached: false },
  ];
  const prof = { level: 2, next_level_at: 300, unlocks: { ladder: LADDER, open_to_all: ["Shop-Off race with friends", "Celebration sound"], never_locked: ["Find it for me", "Receipts", "Lists", "Shop together", "Split the List"] } };

  test("first run is silent, then each new level shows once and never lowers", () => {
    localStorage.removeItem("arya-album-level");
    expect(maybeLevelUp({ level: 1, unlocks: { ladder: LADDER } })).toBe(false);
    expect(document.getElementById("alb-level")).toBeNull();
    expect(localStorage.getItem("arya-album-level")).toBe("1");
    expect(maybeLevelUp({ level: 1 })).toBe(false);
    act(() => { expect(maybeLevelUp(prof)).toBe(true); });
    const card = document.getElementById("alb-level")!;
    const text = card.textContent || "";
    expect(text).toContain("Level up");
    expect(card.querySelector(".levelnum")!.textContent).toBe("2");
    // Only unlocks that work today show (labels audit): no "Coming soon"
    // rungs, one "Next level at N points" line, one "Always free" line.
    expect(text).not.toContain("New at this level");
    expect(text).not.toContain("Avatar extras");
    expect(text).not.toContain("Coming soon");
    expect(text).not.toContain("Live");
    expect(text).toContain("Keep going. Next level is close.");
    expect(text).toContain("Next level at 300 points");
    expect(text).toContain("Always free: Celebration sound, Find it for me, Receipts, Lists, Shop together, Split the List.");
    expect(text).not.toContain("Shop-Off");
    expect(/padlock|\u{1F512}/u.test(card.innerHTML)).toBe(false);
    expect(BANNED.test(text)).toBe(false);
    expect(localStorage.getItem("arya-album-level")).toBe("2");
    act(() => { fireEvent.click(card.querySelector("[data-alb-close]")!); });
    expect(document.getElementById("alb-level")).toBeNull();
    expect(maybeLevelUp(prof)).toBe(false);
    expect(maybeLevelUp({ level: 1 })).toBe(false);
    expect(localStorage.getItem("arya-album-level")).toBe("2");
    expect(maybeLevelUp(null)).toBe(false);
    expect(maybeLevelUp({})).toBe(false);
  });
});

describe("the Album screen", () => {
  const dairy = { id: "Dairy", title: "Dairy", kind: "aisle", size: 8, count: 3, stickers: [st("Milk"), st("Yogurt"), st("Cheese", { image: "cutout", image_url: "/api/quest/stickers/c/image?v=1" })],
    badge: { id: "Dairy", name: "Dairy Royalty", earned: false, to_go: 5, text: "5 to go. No rush." }, started: true, note: null };
  const other = { id: "Other finds", title: "Other finds", kind: "other", size: 4, count: 1, stickers: [st("Durian")], badge: null, started: true, note: "Items Arya cannot place yet land here." };
  const hall = { id: "Halloween", title: "Halloween", kind: "season", size: 8, count: 0, stickers: [], badge: { id: "Halloween", name: "Pumpkin King", earned: false, to_go: 8, text: "8 to go. No rush." }, started: false, note: "Seasonal page. It starts when you find your first pumpkin item and never expires." };
  const serve = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));
  const mount = () => render(<ToastProvider><NavProvider><Album /></NavProvider></ToastProvider>);

  test("pages as tabs, slots, progress, badge, chapter, the sticker sheet", async () => {
    serve({ total: 4, pages: [dairy, other, hall], chapters: [{ store: "Trader Joe's", pct: 71, earned: false, text: "Map all of Trader Joe's together: 71%. Each shelf you add helps." }] });
    mount();
    await screen.findByText("4 stickers collected");
    const body = document.getElementById("alb-body")!;
    for (const t of ["Dairy", "Other finds", "Halloween"]) expect(body.querySelector(`[data-alb-tab="${t}"]`)).not.toBeNull();
    expect(body.textContent).toContain("3 of 8");
    expect(body.querySelectorAll(".albslot.empty").length).toBe(5);
    expect(body.querySelectorAll("[data-alb-slot]").length).toBe(3);
    expect((body.querySelector(".albprog i") as HTMLElement).style.width).toBe("38%");
    expect(body.textContent).toContain("Dairy Royalty");
    expect(body.textContent).toContain("5 to go. No rush.");
    expect(body.textContent).toContain("Stickers from other Arya shoppers");
    expect(body.textContent).toContain("71%");
    expect(body.innerHTML).toContain("compass.webp");
    expect(body.innerHTML).toContain("/api/quest/stickers/c/image?v=1");
    expect(body.textContent).toContain("Your album is private.");
    fireEvent.click(body.querySelector('[data-alb-tab="Other finds"]')!);
    expect(body.textContent).toContain("1 of 4");
    expect(body.textContent).toContain("Items Arya cannot place yet land here.");
    expect(body.querySelectorAll(".albslot.empty").length).toBe(3);
    fireEvent.click(body.querySelector('[data-alb-tab="Halloween"]')!);
    expect(body.textContent).toContain("Seasonal");
    expect(body.textContent).toContain("0 of 8");
    expect(body.querySelector(".albslot.empty.season")).not.toBeNull();
    expect(body.textContent).toContain("never expires");
    fireEvent.click(body.querySelector('[data-alb-tab="Dairy"]')!);
    fireEvent.click(body.querySelector('[data-alb-slot="stk-Cheese"]')!);
    const sheet = document.getElementById("alb-sheet")!;
    expect(sheet.textContent).toContain("Cheese");
    expect(sheet.textContent).toContain("First found Oct 28, 2026 at Trader Joe's");
    expect(sheet.textContent).toContain("Found in 1 quest");
    expect(sheet.textContent).toContain("Only the product is kept in your album. No people.");
    fireEvent.click(sheet.querySelector("[data-alb-close]")!);
    fireEvent.click(body.querySelector('[data-alb-slot="stk-Milk"]')!);
    expect(document.getElementById("alb-sheet")!.textContent).toContain("stock art");
    expect(document.getElementById("alb-sheet")!.textContent).not.toContain("No people.");
    expect(BANNED.test(document.body.textContent || "")).toBe(false);
  });

  test("empty album and one sticker", async () => {
    serve({ total: 0, pages: [], chapters: [] });
    mount();
    await screen.findByText(/No stickers yet\./);
    expect(document.querySelector(".albtabs")).toBeNull();
    cleanup();
    serve({ total: 1, pages: [{ ...dairy, count: 1, stickers: [st("Milk")] }], chapters: [] });
    mount();
    await screen.findByText("1 sticker collected");
  });
});
