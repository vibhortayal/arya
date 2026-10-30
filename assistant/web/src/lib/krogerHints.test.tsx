/* Kroger aisle hints must never get in the way: the screen renders and
 * works before the fetch answers, a slow or failed fetch is silent, and
 * the hints live in component memory only. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { formatHint, useKrogerHints } from "./krogerHints";

const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe("formatHint", () => {
  it("spells out the side and keeps Kroger's words", () => {
    expect(formatHint({ department: "Aisle 2", aisle: "2", side: "L", bay: "10", shelf: "6" })).toBe("Aisle 2 · left side · bay 10");
    expect(formatHint({ department: "DAIRY", side: "R", bay: "15" })).toBe("DAIRY · right side · bay 15");
    expect(formatHint({ department: "Fruit" })).toBe("Fruit");
  });
});

describe("useKrogerHints", () => {
  it("returns at once with no hints, then fills in without blocking", async () => {
    let answer!: (r: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(res => { answer = res; }));
    const { result } = renderHook(() => useKrogerHints("k1", ["Pasta", "Milk"], true));
    expect(result.current).toEqual({});                      // first render did not wait
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ store_id: "k1", items: ["Pasta", "Milk"] });
    await act(async () => { answer(reply({ enabled: true, hints: { Pasta: { aisle: "2", department: "Aisle 2" } } })); });
    await waitFor(() => expect(result.current.pasta?.aisle).toBe("2"));
    expect(result.current.milk).toBeUndefined();
  });

  it("stays silent when the call fails or the feature is off", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    const a = renderHook(() => useKrogerHints("k1", ["Pasta"], true));
    await act(async () => { await Promise.resolve(); });
    expect(a.result.current).toEqual({});
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ enabled: false, hints: {} }));
    const b = renderHook(() => useKrogerHints("k1", ["Pasta"], true));
    await act(async () => { await Promise.resolve(); });
    expect(b.result.current).toEqual({});
  });

  it("does not call the server for practice trips or an empty list", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderHook(() => useKrogerHints("practice", ["Pasta"], false));
    renderHook(() => useKrogerHints("k1", [], true));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks only for items it has not asked about, and keeps nothing in storage", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply({ enabled: true, hints: { Milk: { department: "DAIRY" } } }));
    const { rerender, result } = renderHook(({ names }) => useKrogerHints("k1", names, true), { initialProps: { names: ["Pasta"] } });
    await act(async () => { await Promise.resolve(); });
    rerender({ names: ["Pasta", "Milk"] });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).items).toEqual(["Milk"]);
    await waitFor(() => expect(result.current.milk?.department).toBe("DAIRY"));
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("drops late answers after the screen is gone", async () => {
    let answer!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(res => { answer = res; }));
    const { result, unmount } = renderHook(() => useKrogerHints("k1", ["Pasta"], true));
    unmount();
    await act(async () => { answer(reply({ enabled: true, hints: { Pasta: { aisle: "2" } } })); });
    expect(result.current).toEqual({});
  });
});
