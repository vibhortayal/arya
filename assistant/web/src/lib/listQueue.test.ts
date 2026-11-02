import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { get, post, syncLists } from "./api";
import { applyQueued, pendingCount, queued, SYNCED } from "./listQueue";

const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
const home = { list: { items: [
  { item_id: "milk", name: "milk", on_list: true, checked: false, qty: 1 },
  { item_id: "eggs", name: "eggs", on_list: true, checked: false, qty: 1 },
] } };
const offline = (on: boolean) => Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !on });

describe("list changes made offline (owner, 2026-11-01)", () => {
  beforeEach(() => { localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false })); });
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); offline(false); });

  test("offline, a tick is kept on the phone and shows on the list at once", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok(home));
    await get("/api/home");                         // the saved copy
    offline(true);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const r = await post("/api/list/check", { item_id: "milk", checked: true });
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(pendingCount()).toBe(1);
    const h = await get<typeof home>("/api/home");
    expect(h.list.items.find(i => i.item_id === "milk")!.checked).toBe(true);
  });

  test("a failed send is kept instead of lost", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await post("/api/list/remove", { item_id: "eggs" });
    expect(r).toMatchObject({ queued: true });
    expect(applyQueued(structuredClone(home)).list.items.find(i => i.item_id === "eggs")!.on_list).toBe(false);
  });

  test("an add offline draws a waiting row; later changes to it follow the real id", async () => {
    offline(true);
    const add = await post<{ item_ids: string[] }>("/api/list/from-text", { text: "oat milk" });
    const local = add.item_ids[0];
    expect(local.startsWith("local:")).toBe(true);
    await post("/api/list/check", { item_id: local, checked: true });
    const shown = applyQueued(structuredClone(home)).list.items.find(i => i.item_id === local)! as Record<string, unknown>;
    expect(shown).toMatchObject({ name: "oat milk", source: "queued", checked: true });

    offline(false);
    const sent: { path: string; body: Record<string, unknown>; op: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((p, init) => {
      const body = JSON.parse(String((init as RequestInit).body));
      sent.push({ path: String(p), body, op: new Headers((init as RequestInit).headers).get("X-Arya-Op") });
      return ok(String(p).endsWith("from-text") ? { all_item_ids: ["real-1"], names: ["oat milk"] } : { ok: true });
    });
    const heard = vi.fn();
    addEventListener(SYNCED, heard);
    await syncLists();
    removeEventListener(SYNCED, heard);
    expect(sent.map(s => s.path)).toEqual(["/api/list/from-text", "/api/list/check"]);
    expect(sent[1].body.item_id).toBe("real-1");
    expect(sent.every(s => s.op)).toBe(true);
    expect(pendingCount()).toBe(0);
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ done: 2, skipped: 0 });
  });

  test("while changes wait, a new one queues behind them so order holds", async () => {
    offline(true);
    await post("/api/list/check", { item_id: "milk", checked: true });
    offline(false);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("still flaky"));
    await post("/api/list/check", { item_id: "milk", checked: false });
    expect(queued().map(o => o.body.checked)).toEqual([true, false]);
  });

  test("a skipped (stale) change is reported by name; a refused one is dropped", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => ok(home));
    await get("/api/home");
    offline(true);
    await post("/api/list/check", { item_id: "milk", checked: true });
    await post("/api/list/edit", { item_id: "eggs", name: "" });
    offline(false);
    let n = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => (n++ === 0
      ? ok({ ok: true, stale: true })
      : Promise.resolve(new Response(JSON.stringify({ detail: "name is empty" }), { status: 400 }))));
    const r = await syncLists();
    expect(r).toMatchObject({ done: 0, skipped: 1, failed: 1, skipped_names: ["milk"], failed_names: ["eggs"] });
    expect(pendingCount()).toBe(0);
  });

  test("a sync with nothing waiting does not block the next one (Tester, #412)", async () => {
    await syncLists();                              // the app opens: nothing waiting
    offline(true);
    await post("/api/list/check", { item_id: "milk", checked: true });
    offline(false);
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => ok({ ok: true }));
    await syncLists();                              // back online
    expect(f).toHaveBeenCalledTimes(1);
    expect(pendingCount()).toBe(0);
  });

  test("a lost connection or a lost sign-in keeps the changes for later", async () => {
    offline(true);
    await post("/api/list/check", { item_id: "milk", checked: true });
    offline(false);
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ detail: "login required" }), { status: 401 })));
    await syncLists();
    expect(pendingCount()).toBe(1);
  });

  test("online, a list write goes straight out with an op id", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(() => ok({ ok: true }));
    await post("/api/list/check", { item_id: "milk", checked: true });
    expect(new Headers((f.mock.calls[0][1] as RequestInit).headers).get("X-Arya-Op")).toBeTruthy();
    expect(pendingCount()).toBe(0);
  });

  test("the demo never queues", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "demo", demo: true }));
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(post("/api/list/check", { item_id: "milk", checked: true })).rejects.toBeInstanceOf(TypeError);
  });

  test("other writes are not queued", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(post("/api/lists", { name: "Costco" })).rejects.toBeInstanceOf(TypeError);
    await expect(post("/api/chat", {})).rejects.toBeInstanceOf(TypeError);
    expect(pendingCount()).toBe(0);
  });
});
