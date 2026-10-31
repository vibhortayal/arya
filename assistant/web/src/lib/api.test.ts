import { afterEach, describe, expect, test, vi } from "vitest";
import { get, post, forgetReads } from "./api";

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
