import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Lists } from "./Lists";
import { cache, lensState } from "./lists/model";

/* Speed audit #1, #26: a tick shows at once, before the server answers,
 * offers Undo, and rolls back when the write fails. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));
vi.mock("../app/avatar", () => ({ useAvatar: () => ({ src: "" }) }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const item = (id: string, name: string) => ({ item_id: id, name, qty: 1, on_list: true, list: "l-costco" });
const home = { list: { items: [item("i-milk", "Milk"), item("i-eggs", "Eggs")] }, lists: [{ id: "l-costco", name: "Costco", stores: [] }] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
let answer: (r: Response) => void;

beforeEach(() => {
  cache.data = null;
  lensState.lens = "l-costco";
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn((u: string) => (String(u).includes("/api/list/check")
    ? new Promise<Response>(ok => { answer = ok; })
    : Promise.resolve(json(String(u).includes("/api/home") ? home : {})))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = async () => {
  render(<ToastProvider><NavProvider initial="list"><section id="view-list"><Lists /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("[data-row-id=i-milk] .check")).not.toBeNull());
};

test("a tick fills the row before the server answers, with Undo", async () => {
  await mount();
  act(() => { fireEvent.click($("[data-row-id=i-milk] .check")!); });
  // Painted in the same task as the tap: no server answer yet.
  expect($("[data-row-id=i-milk]")!.classList.contains("checked")).toBe(true);
  await act(async () => {});
  expect($("#toast")!.textContent).toContain("Milk checked off.");
  expect($("#toast .toastact")!.textContent).toBe("Undo");
  await act(async () => { answer(json({ ok: true })); });
});

test("a failed tick rolls back and says why", async () => {
  await mount();
  act(() => { fireEvent.click($("[data-row-id=i-milk] .check")!); });
  await act(async () => {});
  await act(async () => { answer(json({ detail: "server down" }, 500)); });
  await waitFor(() => expect($("[data-row-id=i-milk]")!.classList.contains("checked")).toBe(false));
  expect($("#toast")!.textContent).toContain("Server down");
});
