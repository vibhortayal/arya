import { act, render } from "@testing-library/react";
import { enqueue, pendingIds } from "../lib/listQueue";
import { QueueNote, useWaitingIds } from "./listSync";

/* Offline lists UI (owner, 2026-11-02): a yellow note while offline or
 * while changes wait, and "Waiting to sync" on each waiting item. */
let demo = false;
vi.mock("./session", () => ({ useSession: () => ({ demo, user: "a@test.arya" }) }));
const setOnline = (v: boolean) => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => v }); dispatchEvent(new Event(v ? "online" : "offline")); };

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("arya.lastUser", JSON.stringify({ user: "a@test.arya", demo: false }));
  demo = false;
  setOnline(true);
});

test("pendingIds names every waiting item, local adds included", () => {
  enqueue("/api/list/check", { item_id: "milk" });
  const r = enqueue("/api/list/from-text", { text: "eggs, bread" }) as { item_ids: string[] };
  const ids = pendingIds();
  expect(ids.has("milk")).toBe(true);
  for (const id of r.item_ids) expect(ids.has(id)).toBe(true);
});

test("the note: nothing online with nothing waiting; offline; waiting; syncing; never in the demo", () => {
  render(<QueueNote id="qn" />);
  expect(document.getElementById("qn")).toBeNull();
  act(() => setOnline(false));
  expect(document.getElementById("qn")!.textContent).toContain("You're offline");
  act(() => { enqueue("/api/list/check", { item_id: "milk" }); enqueue("/api/list/check", { item_id: "eggs" }); });
  expect(document.getElementById("qn")!.textContent).toContain("2 changes waiting to sync");
  act(() => setOnline(true));
  expect(document.getElementById("qn")!.textContent).toContain("Syncing 2 changes");
});

test("the demo shows no note", () => {
  demo = true;
  setOnline(false);
  render(<QueueNote id="qn2" />);
  expect(document.getElementById("qn2")).toBeNull();
});

test("useWaitingIds keeps the same set until the queue changes", () => {
  const seen: Set<string>[] = [];
  function Probe() { seen.push(useWaitingIds()); return null; }
  const { rerender } = render(<Probe />);
  rerender(<Probe />);
  expect(seen[0]).toBe(seen[1]);
  act(() => { enqueue("/api/list/check", { item_id: "milk" }); });
  expect(seen[seen.length - 1].has("milk")).toBe(true);
});
