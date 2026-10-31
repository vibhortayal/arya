import { render, screen, fireEvent, act } from "@testing-library/react";
import { GetStartedCard, getStartedView } from "./Today";
import { listsEmpty } from "./Lists";
import type { HomeData } from "./lists/model";
import { showWelcome } from "../ui/FirstRun";
import { TourProvider, tourLayout, useTour, type TourStep } from "../ui/Tour";
import { FIRST_RUN_TOUR } from "../onboarding/firstRunTour";

/* First run (#153, #163): who sees the welcome, the Get started card's
 * states, the Lists first-list card, and the tour. */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

describe("welcome", () => {
  test("only a signed-in, non-demo account the server calls new", () => {
    expect(showWelcome("ann", false, false)).toBe(true);
    expect(showWelcome("ann", false, true)).toBe(false);
    expect(showWelcome("ann", false, null)).toBe(false); // settings not loaded: no flash
    expect(showWelcome("demo", true, true)).toBe(false); // demo: only after "Try it now"
    expect(showWelcome("demo", true, true, true)).toBe(true);
    expect(showWelcome(null, false, false)).toBe(false);
  });
});

describe("get started", () => {
  test("hidden for an existing account (no get_started)", () => {
    expect(getStartedView(null).show).toBe(false);
    expect(getStartedView(undefined).show).toBe(false);
  });
  test("counts real progress and goes when all four are done (#207)", () => {
    const none = { list: false, store: false, shop: false, receipt: false };
    expect(getStartedView(none)).toMatchObject({ show: true, done: 0 });
    const one = getStartedView({ ...none, list: true });
    expect(one).toMatchObject({ show: true, done: 1 });
    expect(one.steps.map(s => s.key)).toEqual(["list", "store", "shop", "receipt"]);
    expect(one.steps.map(s => s.done)).toEqual([true, false, false, false]);
    expect(getStartedView({ list: true, store: true, shop: true, receipt: true }).show).toBe(false);
  });
  test("the card ticks done steps, lights only the next one and routes taps", () => {
    const onStep = vi.fn(), onDismiss = vi.fn();
    const { container } = render(<GetStartedCard gs={{ list: true, store: false, shop: false, receipt: false }} onStep={onStep} onDismiss={onDismiss} />);
    expect(screen.getByText("Get started · 1 of 4")).toBeTruthy();
    expect(screen.getByText("Your first trip with Arya")).toBeTruthy();
    const lis = container.querySelectorAll(".fr-steps li");
    expect([...lis].map(l => l.className)).toEqual(["done", "next", "later", "later"]);
    expect(lis[0].querySelector(".fr-dot")!.textContent).toBe("✓");
    expect(lis[1].querySelector(".fr-dot")!.textContent).toBe("2");
    expect(container.querySelector(".gs-wait")).toBeNull();
    fireEvent.click(container.querySelector('[data-gs="store"]')!);
    expect(onStep).toHaveBeenCalledWith("store");
    fireEvent.click(container.querySelector("#gs-dismiss")!);
    expect(onDismiss).toHaveBeenCalled();
  });
  test("list and store done, no trip yet: the card waits without nagging", () => {
    const { container } = render(<GetStartedCard gs={{ list: true, store: true, shop: false, receipt: false }} onStep={() => {}} onDismiss={() => {}} />);
    expect(container.querySelector(".gs-wait")!.textContent).toContain("No rush");
    expect(container.querySelector(".fr-steps li.next [data-gs]")!.getAttribute("data-gs")).toBe("shop");
  });
});

describe("lists first-list card", () => {
  const data = (items: Partial<HomeData["list"]["items"][number]>[], lists: { id: string; name: string }[] = []) =>
    ({ list: { items }, lists } as unknown as HomeData);
  test("only while there are no lists, no items and no suggestions", () => {
    expect(listsEmpty(null)).toBe(false);
    expect(listsEmpty(data([]))).toBe(true);
    expect(listsEmpty(data([], [{ id: "l1", name: "Costco" }]))).toBe(false);
    expect(listsEmpty(data([{ item_id: "m", name: "Milk", on_list: true }]))).toBe(false);
    expect(listsEmpty(data([{ item_id: "m", name: "Milk", on_list: false }]))).toBe(false);
  });
});

describe("tour layout", () => {
  const tab = { left: 78, top: 785, width: 78, height: 50 };
  test("above a tab: bubble bottom 16px over it, arrow under its centre", () => {
    const l = tourLayout(tab, 390, 844, "above");
    expect(l.above).toBe(true);
    expect(l.tip).toEqual({ bottom: 844 - 785 + 16 });
    expect(l.arrowX).toBe(78 + 39 - 16 - 9);
    expect(l.hole).toEqual({ left: 82, top: 787, width: 70, height: 42 });
  });
  test("auto picks the side with room; the arrow stays off the corners", () => {
    const top = tourLayout({ left: 0, top: 40, width: 30, height: 30 }, 390, 844);
    expect(top.above).toBe(false);
    expect(top.tip).toEqual({ top: 86 });
    expect(top.arrowX).toBe(18);
  });
  test("a tall bubble flips to the roomy side and never leaves the screen (short phones)", () => {
    const card = { left: 20, top: 434, width: 320, height: 160 };
    const l = tourLayout(card, 360, 640, "below", 202);
    expect(l.above).toBe(true);
    const mid = tourLayout({ left: 20, top: 200, width: 320, height: 200 }, 360, 640, "below", 240);
    expect(mid.above).toBe(false);
    expect((mid.tip as { top: number }).top + 240).toBeLessThanOrEqual(640 - 12);
  });
  test("the first-run tour is six tab steps", () => {
    expect(FIRST_RUN_TOUR.map(s => s.id)).toEqual(["today", "lists", "ask", "quest", "help", "settings"]);
  });
});

function Starter({ steps, onDone, onSkip }: { steps: TourStep[]; onDone: () => void; onSkip: () => void }) {
  const { startTour } = useTour();
  return <button onClick={() => startTour(steps, { onDone, onSkip })}>Go</button>;
}

describe("tour", () => {
  const steps: TourStep[] = [
    { id: "a", target: "#ta", titleKey: "firstRun.tour.today.title", bodyKey: "firstRun.tour.today.line" },
    { id: "b", target: () => document.getElementById("tb"), titleKey: "firstRun.tour.settings.title", bodyKey: "firstRun.tour.settings.line" },
  ];
  const mount = (onDone = vi.fn(), onSkip = vi.fn()) => {
    render(<TourProvider><div id="ta" /><div id="tb" /><Starter steps={steps} onDone={onDone} onSkip={onSkip} /></TourProvider>);
    act(() => { fireEvent.click(screen.getByText("Go")); });
    return { onDone, onSkip };
  };
  test("walks the steps with focus on Next and ends with Done", () => {
    const { onDone } = mount();
    expect(screen.getByRole("dialog").getAttribute("data-tour-step")).toBe("a");
    expect(document.activeElement!.id).toBe("fr-tour-next");
    expect(screen.getByText("Next")).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText("Next")); });
    expect(screen.getByText("Settings")).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText("Done")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDone).toHaveBeenCalled();
  });
  test("Esc and Skip close it", () => {
    const { onSkip } = mount();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSkip).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.click(screen.getByText("Go")); });
    act(() => { fireEvent.click(screen.getByText("Skip")); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSkip).toHaveBeenCalledTimes(2);
  });
});
