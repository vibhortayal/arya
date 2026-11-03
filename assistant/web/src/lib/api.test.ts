import { afterEach, describe, expect, test, vi } from "vitest";
import { get, post, forgetReads, forgetKept, SESSION_ENDED, friendlyError, noKeyMessage, SLOW_MS, SLOW_GRACE_MS } from "./api";
import { isSlowOnly, markLive, markSlow } from "./offline";

const reply = (body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

describe("get shares a read that is still on its way", () => {
  afterEach(() => vi.restoreAllMocks());

  test("two reads of one path make one request, each with its own copy", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(reply({ a: 1 }));
    const [x, y] = await Promise.all([get("/api/x"), get("/api/x")]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(x).toEqual({ a: 1 });
    expect(x).not.toBe(y);
  });

  test("a read after the first finished asks again", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(reply({ a: 1 }));
    await get("/api/y");
    await get("/api/y");
    expect(f).toHaveBeenCalledTimes(2);
  });

  test("a write in between means the next read is fresh", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(reply({ a: 1 }));
    const first = get("/api/z");
    await post("/api/z", {});
    const second = get("/api/z");
    await Promise.all([first, second]);
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe("offline copy", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  test("a failed read is answered from the last good copy; a server error is not", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ items: [1] }));
    await get("/api/home");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    expect(await get("/api/home")).toEqual({ items: [1] });
    await expect(get("/api/usage")).rejects.toBeInstanceOf(TypeError);
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("{}", { status: 500 })));
    await expect(get("/api/home")).rejects.toThrow();
  });

  test("the demo keeps a copy for the visit, and signing out deletes them", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "demo", demo: true }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ a: 1 }));
    await get("/api/today");
    expect(Object.keys(localStorage).filter(k => k.startsWith("arya.rc:")).length).toBe(1);
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    await get("/api/settings");
    expect(Object.keys(localStorage).filter(k => k.startsWith("arya.rc:")).length).toBe(2);
    forgetReads();
    expect(Object.keys(localStorage).filter(k => k.startsWith("arya.rc:"))).toEqual([]);
  });
});

describe("a structured refusal", () => {
  afterEach(() => vi.restoreAllMocks());
  test("reads as its message and keeps the rest for the screen", async () => {
    const detail = { code: "pick_list", message: "Which list should this go on? Open a list and add it there.", lists: [{ id: "l-1", name: "Costco" }] };
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ detail }), { status: 409 })));
    const e = await post("/api/lists/delete", { id: "l-1" }).catch(x => x);
    expect(e.message).toBe(detail.message);
    expect(e.status).toBe(409);
    expect(e.detail).toEqual(detail);
  });
});

describe("a lost session (re-audit N1)", () => {
  afterEach(() => vi.restoreAllMocks());
  const r401 = (detail: string) => () => Promise.resolve(new Response(JSON.stringify({ detail }), { status: 401 }));

  test("a 401 'login required' from /api/ says the session ended", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(r401("login required"));
    const heard = vi.fn();
    addEventListener(SESSION_ENDED, heard);
    await expect(get("/api/lost")).rejects.toThrow();
    removeEventListener(SESSION_ENDED, heard);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test("a wrong code at sign in is not a lost session", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(r401("wrong email or password"));
    const heard = vi.fn();
    addEventListener(SESSION_ENDED, heard);
    await expect(post("/auth/login", {})).rejects.toThrow();
    removeEventListener(SESSION_ENDED, heard);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("kept reads", () => {
  afterEach(() => { vi.restoreAllMocks(); forgetReads(); });

  test("Demo Town hints are kept 30 s; forgetKept drops them (N7, N11)", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockImplementation(reply({ ok: 1 }));
    await get("/api/town/hints");
    await get("/api/town/hints");
    expect(f).toHaveBeenCalledTimes(1);
    forgetKept();
    await get("/api/town/hints");
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("a copy of Arya with no Meta key (local Docker, #432)", () => {
  test("the no-key error is shown as it is, saying where the key goes", () => {
    const msg = friendlyError("MODEL_API_KEY not provisioned on this runtime");
    expect(msg).toContain("MODEL_API_KEY=");
    expect(msg).toContain("docker compose up -d");
    expect(noKeyMessage(new Error(msg))).toBe(msg);
    expect(noKeyMessage(new Error("MODEL_API_KEY not provisioned on this runtime"))).toBe(msg);
    expect(noKeyMessage(new Error("Meta's model is busy right now."))).toBeNull();
  });
});

describe("slow connection (owner, 2026-11-03: weak signal kept looking things up)", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); markLive(); });
  const hang = () => new Promise<Response>(() => {});

  test("a slow read shows the saved copy after a few seconds, then at once while slow", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ items: [1] }));
    await get("/api/home");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(globalThis, "fetch").mockImplementation(hang);
    const p = get("/api/home");
    await vi.advanceTimersByTimeAsync(SLOW_MS + 10);
    expect(await p).toEqual({ items: [1] });
    expect(isSlowOnly()).toBe(true);
    // While slow, another saved screen answers without waiting.
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ cards: 1 }));
    await get("/api/today");
    vi.spyOn(globalThis, "fetch").mockImplementation(hang);
    markSlow();
    const q = get("/api/today");
    await vi.advanceTimersByTimeAsync(SLOW_GRACE_MS + 10);
    expect(await q).toEqual({ cards: 1 });
  });

  test("a fast read never shows the saved copy", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ v: 1 }));
    await get("/api/powers");
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ v: 2 }));
    expect(await get("/api/powers")).toEqual({ v: 2 });
    expect(isSlowOnly()).toBe(false);
  });

  test("a copy from before this tab's last change is not used for a slow read", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ items: [1] }));
    await get("/api/stores/mine");
    await new Promise(r => setTimeout(r, 5));
    await post("/api/settings", {});
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let answer: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(r => { answer = r; }));
    const p = get("/api/stores/mine");
    let settled = false;
    p.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(SLOW_MS + 10);
    expect(settled).toBe(false);
    answer(new Response(JSON.stringify({ items: [2] }), { status: 200 }));
    expect(await p).toEqual({ items: [2] });
  });
});
