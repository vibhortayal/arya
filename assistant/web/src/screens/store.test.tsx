import { act, cleanup, render, waitFor } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Store } from "./Store";

/* The hunt's store picker, as the plain-JS app's node harness ran
 * quest.js questBack (tests/test_places.py TestPickerRefreshOnBack):
 * a store added through Find / Add a store can be picked when Back
 * returns to the picker, because the picker reloads My Stores. */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

let nav!: ReturnType<typeof useNav>;
function Host() {
  nav = useNav();
  // As App.tsx: one screen, keyed by the stack entry.
  return <section key={nav.key}>{nav.view === "store" ? <Store /> : <p>{nav.view}</p>}</section>;
}

let mine: { id: string; name: string }[];
let mineCalls: number;
beforeEach(() => {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  mine = []; mineCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    let body: unknown = {};
    if (u.startsWith("/api/stores/mine")) { mineCalls++; body = { stores: mine }; }
    else if (u.startsWith("/api/quest/plan")) body = { list: [], items: [] };
    else if (u.startsWith("/api/storemap/stores")) body = { stores: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("Back to the picker reloads My Stores and draws the new store", async () => {
  const r = render(<ToastProvider><NavProvider initial="community"><Host /></NavProvider></ToastProvider>);
  act(() => nav.show("store"));
  await waitFor(() => expect(r.container.textContent).toContain("No stores in your stores yet"));
  const before = mineCalls;
  act(() => nav.show("stores-find"));
  mine = [{ id: "gplace-1", name: "Trader Joe's", street: "4455 W Armitage Ave", city: "Chicago", state: "IL", zip: "60639" } as any];
  act(() => nav.back());
  expect(nav.view).toBe("store");
  await waitFor(() => expect(r.container.querySelector('[data-pick="gplace-1"]')).not.toBeNull());
  expect(mineCalls).toBeGreaterThan(before);
});

test("Back elsewhere leaves the picker alone", async () => {
  render(<ToastProvider><NavProvider initial="home"><Host /></NavProvider></ToastProvider>);
  act(() => nav.show("stores-find"));
  act(() => nav.back());
  expect(nav.view).toBe("home");
  expect(mineCalls).toBe(0);
});
