import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Lists } from "./Lists";
import { cache, lensState } from "./lists/model";

/* Pilot 2026-10-29: Select mode could be focused but not operated from
 * the keyboard. A row is a checkbox now: Enter or Space toggles it. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));
vi.mock("../app/avatar", () => ({ useAvatar: () => ({ src: "" }) }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const item = (id: string, name: string) => ({ item_id: id, name, qty: 1, on_list: true, list: "l-costco" });
const home = { list: { items: [item("i-milk", "Milk"), item("i-eggs", "Eggs")] }, lists: [{ id: "l-costco", name: "Costco", stores: [] }] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

beforeEach(() => {
  cache.data = null;
  lensState.lens = "l-costco";
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/home") ? home : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("in Select mode rows are checkboxes that Enter and Space toggle", async () => {
  render(<ToastProvider><NavProvider initial="list"><section id="view-list"><Lists /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#lp-select")).not.toBeNull());
  expect($("[data-row-id=i-milk]")!.getAttribute("role")).toBeNull();
  act(() => { fireEvent.click($("#lp-select")!); });
  const milk = $("[data-row-id=i-milk]")!;
  expect(milk.getAttribute("role")).toBe("checkbox");
  expect(milk.getAttribute("aria-checked")).toBe("false");
  act(() => { fireEvent.keyDown(milk, { key: "Enter" }); });
  expect($("[data-row-id=i-milk]")!.getAttribute("aria-checked")).toBe("true");
  act(() => { fireEvent.keyDown($("[data-row-id=i-milk]")!, { key: " " }); });
  expect($("[data-row-id=i-milk]")!.getAttribute("aria-checked")).toBe("false");
  expect($("[data-row-id=i-eggs]")!.getAttribute("aria-checked")).toBe("false");
});
