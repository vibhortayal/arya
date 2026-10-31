import { act, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/en.json";
import { NavProvider, useNav } from "../app/nav";
import { GuideProvider, openGuide, useGuide } from "../ui/Guide";
import { TourProvider, useTour } from "../ui/Tour";
import { FIRST_RUN_TOUR } from "../onboarding/firstRunTour";
import { GUIDE_CARDS, GUIDE_FOR_POWER, GUIDE_IDS, guideIndex, type GuideId } from "./cards";

/* The Arya guide (#154): card data, the overlay's swipe / keys / Back
 * / Next / open-at-a-card, numbered steps on every card (no links out,
 * no Try it), and the first-run tour's "Want the full guide?" link. */

// jsdom has no window.scrollTo (NavProvider calls it on every show).
beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });

function hasKey(key: string) {
  let d: unknown = en;
  for (const p of key.split(".")) d = d && typeof d === "object" ? (d as Record<string, unknown>)[p] : undefined;
  return typeof d === "string";
}

describe("cards", () => {
  test("the owner's fifteen sections, in a new user's order, each an en.json key", () => {
    expect(GUIDE_CARDS.map(c => c.id)).toEqual([...GUIDE_IDS]);
    expect(GUIDE_IDS).toEqual(["lists", "share", "running", "news", "shopping", "quest", "maps", "friends", "receipts", "usesoon", "prices", "ask", "today", "powers", "settings"]);
    const keys = GUIDE_CARDS.flatMap(c => [c.kickerKey, c.titleKey, c.bodyKey, ...c.stepKeys]);
    expect(keys.filter(k => !hasKey(k))).toEqual([]);
  });
  test("every card has 2 to 4 numbered steps", () => {
    for (const c of GUIDE_CARDS) { expect(c.stepKeys.length).toBeGreaterThanOrEqual(2); expect(c.stepKeys.length).toBeLessThanOrEqual(4); }
  });
  test("open at a card id; an unknown id opens card 1; powers point at real cards", () => {
    expect(guideIndex("prices")).toBe(10);
    expect(guideIndex("nope")).toBe(0);
    expect(guideIndex(undefined)).toBe(0);
    for (const id of Object.values(GUIDE_FOR_POWER)) expect(GUIDE_IDS).toContain(id);
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
    expect(count()).toBe("Arya guide · 1 of 15");
    expect(document.activeElement!.id).toBe("gd-next");
    expect(document.getElementById("gd-back")).toBeNull();
    expect(document.querySelectorAll(".gd-dots i.on").length).toBe(1);
    act(() => { fireEvent.click(document.getElementById("gd-next")!); });
    expect(count()).toBe("Arya guide · 2 of 15");
    expect(screen.getByText("Share lists, shop together or apart")).toBeTruthy();
    act(() => { fireEvent.click(document.getElementById("gd-back")!); });
    expect(card()).toBe("lists");
    expect(document.activeElement!.id).toBe("gd-next");
    open("settings");
    expect(document.getElementById("gd-next")!.textContent).toBe("Done");
    expect(document.querySelectorAll("ol.steps li").length).toBe(4);
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
    expect(card()).toBe("running");
    key("ArrowLeft");
    expect(card()).toBe("share");
    open("settings");
    key("ArrowRight");
    expect(card()).toBe("settings");
    key("Escape");
    expect(document.querySelector(".gd")).toBeNull();
  });
  test("a left swipe goes forward, a right swipe back; short or upright drags do nothing", () => {
    mount();
    open();
    swipe(-120);
    expect(card()).toBe("share");
    swipe(-120);
    expect(card()).toBe("running");
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
    expect(count()).toBe("Arya guide · 11 of 15");
    expect(screen.getByText("Know where it's cheaper")).toBeTruthy();
    act(() => { fireEvent.click(document.getElementById("gd-close")!); });
    expect(document.querySelector(".gd")).toBeNull();
    act(() => openGuide("ask"));
    expect(card()).toBe("ask");
  });
  test("no card links out: no Try it button or sheet, and each card's steps are plain text", () => {
    mount();
    for (const id of GUIDE_IDS) {
      open(id);
      expect(document.getElementById("gd-try")).toBeNull();
      expect(document.getElementById("gd-try-sheet")).toBeNull();
      expect(document.querySelector(".gd .try")).toBeNull();
      expect(document.querySelector(".gd-card a, .gd-card ol.steps button")).toBeNull();
      expect(document.querySelectorAll(".gd-card ol.steps li").length).toBe(GUIDE_CARDS.find(c => c.id === id)!.stepKeys.length);
    }
    expect(nav.view).toBe("profile");
  });
  test("Quest is never called optional, and the maps card does not send you to the game", () => {
    mount();
    open("maps");
    expect(document.querySelector(".gd")!.textContent).not.toMatch(/optional/i);
    expect(nav.params.practice).toBeUndefined();
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
  test("Replay the tour is the last card's closing action only; it closes the guide and starts the tour", () => {
    render(<NavProvider><TourProvider><GuideProvider><div id="tabs" /><Probe /></GuideProvider></TourProvider></NavProvider>);
    open();
    expect(document.getElementById("gd-tour")).toBeNull();
    open("usesoon");
    expect(document.getElementById("gd-tour")).toBeNull();
    open("settings");
    expect(document.getElementById("gd-tour")!.textContent).toBe("Replay the tour");
    act(() => { fireEvent.click(document.getElementById("gd-tour")!); });
    expect(document.querySelector(".gd")).toBeNull();
    expect(document.querySelector(".fr-tour")).not.toBeNull();
  });
});
