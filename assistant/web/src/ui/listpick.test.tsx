import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "./Toast";
import { ListPickHost } from "./ListPick";
import { addItem, addOnList, askDelete } from "../lib/listPick";
import { post } from "../lib/api";

/* "Which list?" (owner-approved mockup 2026-11-02): an add with no list
 * asks which list (usual first), makes one first when there are none,
 * and a list with items asks where they go before it is deleted. */
vi.mock("../app/session", () => ({ useIsDemo: () => false, useSession: () => ({ demo: false, user: null }), clearOnSignOut: () => {} }));

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
let calls: [string, any][];
let answer: (path: string, body: any) => Response;
const serve = () => vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push([String(u), body]);
  return answer(String(u), body);
}));
const host = () => render(<ToastProvider><NavProvider initial="home"><ListPickHost /></NavProvider></ToastProvider>);
const LISTS = [{ id: "a", name: "Trader Jill's" }, { id: "b", name: "Costcozy" }];

beforeEach(() => { calls = []; vi.stubGlobal("scrollTo", () => {}); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("pick_list: the usual list comes first and ticked; tapping a list sends the add again there", async () => {
  answer = (_p, b) => b.list_id ? res({ ok: true }) : res({ detail: { code: "pick_list", message: "Which list?", lists: LISTS, suggested: "b", names: ["Whole Milk"] } }, 409);
  serve(); host();
  const p = addItem("milk", "Whole Milk");
  await waitFor(() => expect($("#listpick")).not.toBeNull());
  expect($("#listpick h3")!.textContent).toContain("Add Whole Milk to");
  const rows = [...document.querySelectorAll<HTMLElement>("#listpick [data-pick]")];
  expect(rows.map(r => r.dataset.pick)).toEqual(["b", "a"]);
  expect(rows[0].getAttribute("aria-pressed")).toBe("true");
  expect(rows[0].textContent).toContain("Usual for Whole Milk");
  fireEvent.click(rows[1]);
  const out = await p;
  expect(out?.list).toEqual({ id: "a", name: "Trader Jill's" });
  expect(calls.map(c => c[1])).toEqual([{ item_id: "milk" }, { item_id: "milk", list_id: "a" }]);
});

test("Cancel adds nothing", async () => {
  answer = () => res({ detail: { code: "pick_list", lists: LISTS, suggested: null, names: ["Eggs"] } }, 409);
  serve(); host();
  const p = addItem("eggs", "Eggs");
  await waitFor(() => expect($("#listpick")).not.toBeNull());
  fireEvent.click([...document.querySelectorAll<HTMLElement>("#listpick button")].find(b => b.textContent === "Cancel")!);
  expect(await p).toBeNull();
  expect(calls.length).toBe(1);
});

test("no_lists: pick a store, make its list, and the add goes there", async () => {
  answer = (path, b) => {
    if (path === "/api/stores/mine") return res({ stores: [{ name: "Costcozy" }, { name: "Safeday" }] });
    if (path === "/api/lists") return res({ id: "n1", name: b.name });
    return b?.list_id ? res({ added: 1 }) : res({ detail: { code: "no_lists", message: "Make a list first", names: ["Bread"] } }, 409);
  };
  serve(); host();
  const p = addOnList(l => post("/api/list/from-text", l ? { text: "bread", list_id: l } : { text: "bread" }), { names: ["Bread"] });
  await waitFor(() => expect($("#listpick [data-store]")).not.toBeNull());
  expect($("#listpick h3")!.textContent).toBe("Make a list first");
  fireEvent.click($('#listpick [data-store="Safeday"]')!);
  expect($("#listpick-make")!.textContent).toBe("Make the Safeday list and add it");
  fireEvent.click($("#listpick-make")!);
  const out = await p;
  expect(out?.list).toEqual({ id: "n1", name: "Safeday" });
  expect(calls.find(c => c[0] === "/api/lists")![1]).toEqual({ name: "Safeday", stores: ["Safeday"] });
  expect(calls[calls.length - 1][1]).toEqual({ text: "bread", list_id: "n1" });
});

test("offline: asks from the lists saved on this phone before the add is kept", async () => {
  vi.stubGlobal("navigator", { ...navigator, onLine: false });
  const offline = await import("../lib/offline");
  vi.spyOn(offline, "savedRead").mockReturnValue({ at: 1, data: { lists: LISTS, list: { items: [] } } } as any);
  const sent: (string | undefined)[] = [];
  host();
  const p = addOnList(async l => { sent.push(l); return "ok"; }, { names: ["Basil"] });
  await waitFor(() => expect($("#listpick [data-pick]")).not.toBeNull());
  expect($("#listpick-offline")).not.toBeNull();
  fireEvent.click($('#listpick [data-pick="b"]')!);
  expect((await p)?.list?.id).toBe("b");
  expect(sent).toEqual(["b"]);
});

test("delete a list with items: move to another list by default, or delete them too", async () => {
  host();
  const need = { code: "list_has_items" as const, count: 4, lists: [{ id: "b", name: "Costcozy" }] };
  let p = askDelete("Trader Jill's", need);
  await waitFor(() => expect($("#listdelete")).not.toBeNull());
  expect($("#listdelete h3")!.textContent).toBe("Delete Trader Jill's?");
  expect($('#listdelete [data-move="b"]')!.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click($("#listdelete-go")!);
  expect(await p).toEqual({ move_to: "b" });
  p = askDelete("Trader Jill's", need);
  await waitFor(() => expect($("#listdelete-drop")).not.toBeNull());
  fireEvent.click($("#listdelete-drop")!);
  fireEvent.click($("#listdelete-go")!);
  expect(await p).toEqual({ remove_items: true });
});
