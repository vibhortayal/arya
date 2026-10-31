import { afterEach, describe, expect, test, vi } from "vitest";
import { get, post } from "./api";

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
