import { beforeEach, describe, expect, it, vi } from "vitest";

/* Quest review fixes (2026-11-04): an item added in the game is saved;
 * grabs on a weak signal are retried and kept; quantities ride along;
 * route notes really go somewhere. */
const calls: { method: string; url: string; body?: any }[] = [];
const replies: Record<string, unknown> = {};
let failNext: Record<string, number> = {};
vi.mock("../../lib/api", () => {
  class ApiError extends Error { status: number; constructor(status: number, msg = "") { super(msg); this.status = status; } }
  return {
    ApiError,
    api: vi.fn(async () => ({})),
    get: vi.fn(async (url: string) => { calls.push({ method: "GET", url }); const k = Object.keys(replies).find(p => url.startsWith(p)); if (!k) throw new Error("404 " + url); return replies[k]; }),
    post: vi.fn(async (url: string, body: any) => {
      calls.push({ method: "POST", url, body });
      const f = Object.keys(failNext).find(p => url.startsWith(p) && failNext[p] > 0);
      if (f) { failNext[f]--; throw new TypeError("Failed to fetch"); }
      const k = Object.keys(replies).filter(p => url.startsWith(p)).sort((a, b) => b.length - a.length)[0];
      return k ? replies[k] : {};
    }),
    put: vi.fn(async () => ({})),
  };
});
vi.mock("../../lib/characters", () => ({ loadCharacters: async () => {}, charFor: () => "" }));

import { AppSource, sendWithRetry } from "./appSource";

const SESS = { id: "q1", store: "Safeway", state: "not_started", mode: "quest", items: [{ name: "Milk" }, { name: "Eggs" }] };
beforeEach(() => {
  calls.length = 0; failNext = {};
  for (const k of Object.keys(replies)) delete replies[k];
  replies["/api/storemap"] = { segments: [] };
  replies["/api/quest/maps"] = { maps: [] };
  replies["/api/quest/sessions"] = SESS;
});
const open = (src: AppSource) => src.open("s1", { id: "l1", name: "Costco", items: [{ name: "Milk" }, { name: "Eggs", qty: 2 }] });
const waitWaits = [1, 1];

describe("Quest review fixes", () => {
  it("quantities reach the trip (Eggs x2 stays 2)", async () => {
    const src = new AppSource();
    await open(src);
    const draft = calls.find(c => c.url === "/api/quest/sessions");
    expect(draft?.body.items).toEqual([{ name: "Milk" }, { name: "Eggs", qty: 2 }]);
    expect(draft?.body.game).toBe(true); // a game trip: its grabs score once, in the game (P3)
  });

  it("an item added during the trip joins its list and the trip before its grab is sent", async () => {
    const src = new AppSource();
    await open(src);
    src.progress({ kind: "grab", item: "Milk" });
    src.addItem("Butter");
    src.progress({ kind: "grab", item: "Butter" });
    await src.finish();
    const urls = calls.filter(c => c.method === "POST" && c.url !== "/api/quest/sessions" || (c.url === "/api/quest/sessions" && !c.body.draft)).map(c => c.url + (c.body?.item ? ":" + c.body.item : c.body?.name ? ":" + c.body.name : ""));
    const add = urls.indexOf("/api/list/add:Butter"), item = urls.indexOf("/api/quest/sessions/q1/items:Butter"), grab = urls.indexOf("/api/quest/sessions/q1/check:Butter");
    expect(add).toBeGreaterThan(-1);
    expect(calls.find(c => c.url === "/api/list/add")?.body).toEqual({ name: "Butter", list_id: "l1" });
    expect(item).toBeGreaterThan(add);
    expect(grab).toBeGreaterThan(item);
  });

  it("an item added before the first grab rides on the trip it creates", async () => {
    const src = new AppSource();
    await open(src);
    src.addItem("Butter");
    src.progress({ kind: "grab", item: "Butter" });
    await src.finish();
    const create = calls.filter(c => c.url === "/api/quest/sessions" && !c.body.draft);
    expect(create).toHaveLength(1);
    expect(create[0].body.items.map((i: any) => i.name)).toEqual(["Milk", "Eggs", "Butter"]);
  });

  it("a grab on a weak signal is retried, and one that never went is sent at checkout", async () => {
    vi.useFakeTimers();
    try {
      const src = new AppSource();
      await open(src);
      failNext["/api/quest/sessions/q1/check"] = 3; // three tries all fail
      src.progress({ kind: "grab", item: "Milk" });
      await vi.runAllTimersAsync();
      expect(calls.filter(c => c.url === "/api/quest/sessions/q1/check")).toHaveLength(3);
      const p = src.finish();
      await vi.runAllTimersAsync();
      await p;
      const checks = calls.filter(c => c.url === "/api/quest/sessions/q1/check");
      expect(checks).toHaveLength(4);
      expect(checks[3].body).toEqual({ item: "Milk", checked: true });
    } finally { vi.useRealTimers(); }
  });

  it("no signal when the trip is first saved: the grab waits and goes with the next one", async () => {
    const src = new AppSource();
    await open(src);
    failNext["/api/quest/sessions"] = 1;
    src.progress({ kind: "grab", item: "Milk" });
    src.progress({ kind: "grab", item: "Eggs" });
    await src.finish();
    const checks = calls.filter(c => c.url === "/api/quest/sessions/q1/check").map(c => c.body.item);
    expect(checks).toEqual(["Milk", "Eggs"]);
  });

  it("a refusal is not retried", async () => {
    const { ApiError } = await import("../../lib/api") as any;
    let n = 0;
    expect(await sendWithRetry(async () => { n++; throw new ApiError(404, "no such item"); }, waitWaits)).toBe(true);
    expect(n).toBe(1);
  });

  it("route notes go to the feedback inbox, and say when they could not", async () => {
    const src = new AppSource();
    await open(src);
    expect(await src.sendRoute("Safeway", ["Great route", "Order felt off"])).toBe(true);
    expect(calls.find(c => c.url === "/api/feedback")?.body).toEqual({ kind: "idea", text: "Quest route at Safeway: Great route, Order felt off" });
    failNext["/api/feedback"] = 1;
    expect(await src.sendRoute("Safeway", ["Too much walking"])).toBe(false);
  });
});
