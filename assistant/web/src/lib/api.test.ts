import { afterEach, describe, expect, test, vi } from "vitest";
import { get, post, forgetReads, forgetKept, SESSION_ENDED } from "./api";

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

  test("the demo keeps no copy, and signing out deletes them", async () => {
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "demo", demo: true }));
    vi.spyOn(globalThis, "fetch").mockImplementation(reply({ a: 1 }));
    await get("/api/today");
    expect(Object.keys(localStorage).filter(k => k.startsWith("arya.rc:"))).toEqual([]);
    localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
    await get("/api/settings");
    expect(Object.keys(localStorage).filter(k => k.startsWith("arya.rc:")).length).toBe(1);
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
