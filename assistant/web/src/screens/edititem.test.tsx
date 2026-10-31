import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Lists } from "./Lists";
import { cache, lensState } from "./lists/model";

/* Edit item (owner, 2026-10-31): tap a row to change its name, amount,
 * unit and note. The row shows a clean name with the size under it. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));
vi.mock("../app/avatar", () => ({ useAvatar: () => ({ src: "" }) }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const home = { list: { items: [
  { item_id: "demo-papertowel", name: "Paper Towels", qty: 6, unit: "ct", on_list: true, list: "l-costco" },
  { item_id: "manual-basil", name: "Basil", qty: 1, on_list: true, list: "l-costco" },
] }, lists: [{ id: "l-costco", name: "Costco", stores: [] }] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
let posts: { url: string; body: any }[] = [];

beforeEach(() => {
  cache.data = null; posts = [];
  lensState.lens = "l-costco";
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    if (init?.method === "POST") posts.push({ url: String(u), body: JSON.parse(String(init.body || "{}")) });
    return json(String(u).includes("/api/home") ? home : {});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  render(<ToastProvider><NavProvider initial="list"><section id="view-list"><Lists /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($(".listrow")).not.toBeNull());
}

test("a row shows a clean name with the amount and unit under it", async () => {
  await mount();
  const row = $("[data-row-id=demo-papertowel]")!;
  expect(row.querySelector(".name")!.textContent).toBe("Paper Towels");
  expect(row.querySelector(".size")!.textContent).toBe("6 ct");
  expect($("[data-row-id=manual-basil] .size")).toBeNull();
});

test("tapping a row opens the edit sheet and Save posts name, amount, unit and note", async () => {
  await mount();
  act(() => { fireEvent.click($("[data-row-id=demo-papertowel] .name")!); });
  await waitFor(() => expect($("#es-name")).not.toBeNull());
  expect(($("#es-name") as HTMLInputElement).value).toBe("Paper Towels");
  expect(($("#es-qty") as HTMLInputElement).value).toBe("6");
  expect(($("#es-unit") as HTMLInputElement).value).toBe("ct");
  act(() => { fireEvent.change($("#es-name")!, { target: { value: "Kitchen Towels" } }); });
  act(() => { fireEvent.change($("#es-qty")!, { target: { value: "8" } }); });
  act(() => { fireEvent.change($("#es-note")!, { target: { value: "Kirkland" } }); });
  act(() => { fireEvent.click($("#es-save")!); });
  await waitFor(() => expect(posts.some(p => p.url.includes("/api/list/edit"))).toBe(true));
  expect(posts.find(p => p.url.includes("/api/list/edit"))!.body).toEqual(
    { item_id: "demo-papertowel", name: "Kitchen Towels", qty: 8, unit: "ct", note: "Kirkland" });
});

test("an empty name is not saved, and ticking the circle does not open the sheet", async () => {
  await mount();
  act(() => { fireEvent.click($("[data-row-id=demo-papertowel] .check")!); });
  expect($("#es-name")).toBeNull();
  act(() => { fireEvent.click($("[data-row-id=manual-basil] .name")!); });
  await waitFor(() => expect($("#es-name")).not.toBeNull());
  act(() => { fireEvent.change($("#es-name")!, { target: { value: "  " } }); });
  act(() => { fireEvent.click($("#es-save")!); });
  expect(posts.some(p => p.url.includes("/api/list/edit"))).toBe(false);
});
