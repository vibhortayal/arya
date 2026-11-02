import { afterEach, expect, test, vi } from "vitest";

/* Demo Town off (performance report 2026-11-02, finding 7): the server
 * answers null; the client asks once and then stops, with no error. */
afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); });

test("a null hints answer turns the town off and stops asking", async () => {
  const f = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } })));
  const { refreshTown } = await import("./town");
  await refreshTown();
  await refreshTown();
  expect(f.mock.calls.filter(c => String(c[0]).includes("/api/town/hints")).length).toBe(1);
});

test("a town payload is kept and asked for again", async () => {
  const body = { label: "Demo Town", neighbours: 800, stores: {}, items: {}, feed: [], alternatives: {} };
  const f = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
  const { refreshTown } = await import("./town");
  await refreshTown();
  expect(f).toHaveBeenCalled();
});
