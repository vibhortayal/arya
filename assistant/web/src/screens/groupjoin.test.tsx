import { act, fireEvent, render } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { GroupJoin } from "./GroupJoin";

/* Join a group (owner, 2026-11-02): Join and Not now come right after
 * who invited you, above "What changes", so the button is above the
 * fold on a small phone. */
vi.mock("../lib/api", async orig => ({
  ...(await orig<typeof import("../lib/api")>()),
  get: async () => ({ name: "Home", invited_by: "kajal", people: 2, lists: 3, my_lists: 2 }),
  post: async () => ({ group: { name: "Home" } }),
}));
beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });

let nav: ReturnType<typeof useNav>;
let opened = false;
function Open() { nav = useNav(); if (!opened) { opened = true; nav.show("group-join", { code: "K7Q4MX" }); return null; } return nav.view === "group-join" ? <GroupJoin /> : null; }

test("Join and Not now sit under the inviter, before What changes; Not now leaves", async () => {
  render(<ToastProvider><NavProvider><Open /></NavProvider></ToastProvider>);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const order = Array.from(document.querySelectorAll(".gname, #gj-go, #gj-not-now, h3.sect")).map(e => e.id || e.className);
  expect(order).toEqual(["name gname", "gj-go", "gj-not-now", "sect"]);
  expect(document.getElementById("gj-go")!.textContent).toBe("Join Home");
  act(() => { fireEvent.click(document.getElementById("gj-not-now")!); });
  expect(nav.view).not.toBe("group-join");
});
