import { act, fireEvent, render } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider } from "./Toast";
import { BottomBar, openBarEditor } from "./Bar";

/* The shopper's bottom bar (owner, 2026-11-01): four places, More always
 * last; More lists the rest; the editor saves at once, holds four, and
 * a new place lands beside More. */
let saved: string[] | null = null;
const saves: unknown[] = [];
vi.mock("../app/session", () => ({
  useSavedBar: () => saved,
  useSession: () => ({ layouts: { bar: { on: saved } }, saveLayout: async (_k: string, v: { on: string[] }) => { saves.push(v.on); saved = v.on; } }),
}));

let nav: ReturnType<typeof useNav>;
const Probe = () => { nav = useNav(); return null; };
const mount = () => render(<ToastProvider><NavProvider><Probe /><BottomBar /></NavProvider></ToastProvider>);
const labels = () => Array.from(document.querySelectorAll("#tabs > button")).map(b => b.textContent);

beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });
beforeEach(() => { saved = null; saves.length = 0; });

describe("BottomBar", () => {
  test("the default bar is Today, Lists, Quest, Ask, then More", () => {
    mount();
    expect(labels()).toEqual(["Today", "Lists", "Quest", "Ask", "More"]);
    expect(document.querySelector('#tabs button[data-view="view-home"]')!.className).toBe("active");
  });
  test("a saved bar shows; Receipts opened from it lights Receipts", () => {
    saved = ["list", "receipts", "stores-mine"];
    mount();
    expect(labels()).toEqual(["Lists", "Receipts", "Stores", "More"]);
    act(() => { nav.show("receipt"); });
    expect(document.querySelector("#tabs button.active")!.textContent).toBe("Receipts");
  });
  test("More opens a sheet with everything not on the bar and opens a place", () => {
    mount();
    act(() => { fireEvent.click(document.getElementById("tab-more")!); });
    const rows = Array.from(document.querySelectorAll("#more-sheet [data-more]")).map(r => r.getAttribute("data-more"));
    expect(rows).toEqual(["receipts", "stores-mine", "analysis", "help", "profile"]);
    act(() => { fireEvent.click(document.querySelector('#more-sheet [data-more="help"]')!); });
    expect(nav.view).toBe("help");
    expect(document.getElementById("tab-more")!.className).toBe("active");
  });
  test("the editor adds a place at the end, refuses a fifth, and removes to More", () => {
    saved = ["list", "receipts"];
    mount();
    act(() => { openBarEditor(); });
    act(() => { fireEvent.click(document.querySelector('#bar-edit [data-add="stores-mine"]')!); });
    expect(saves.pop()).toEqual(["list", "receipts", "stores-mine"]);
    act(() => { fireEvent.click(document.querySelector('#bar-edit [data-add="home"]')!); });
    expect(saves.pop()).toEqual(["list", "receipts", "stores-mine", "home"]);
    act(() => { fireEvent.click(document.querySelector('#bar-edit [data-add="chat"]')!); });
    expect(saves.length).toBe(0);
    expect(document.body.textContent).toContain("The bar holds four. Remove one first.");
    act(() => { fireEvent.click(document.querySelector('#bar-edit .eminus')!); });
    expect(saves.pop()).toEqual(["receipts", "stores-mine", "home"]);
  });
  test("touch and hold on the bar opens the editor and is not a tap", () => {
    vi.useFakeTimers();
    try {
      mount();
      const lists = document.querySelector('#tabs button[data-view="view-list"]')!;
      act(() => { fireEvent.pointerDown(lists); vi.advanceTimersByTime(700); });
      act(() => { fireEvent.pointerUp(lists); fireEvent.click(lists); });
      expect(document.getElementById("bar-editor")).toBeTruthy();
      expect(nav.view).toBe("home");
    } finally { vi.useRealTimers(); }
  });
});
