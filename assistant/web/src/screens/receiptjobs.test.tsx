import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Receipts } from "./Receipts";

/* Several receipts are sent to the server first, which reads them in the
 * background: sending bar, reading card, paused with Resume, done card. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: "USD" }), clearOnSignOut: () => {} }));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const base = { id: "j1", total: 3, received: 3, done: 0, filed: 0, duplicate: 0, failed: 0, failures: [], reason: null, seen: false, at: "2026-11-01T10:00:00" };
let jobs: any[]; let calls: [string, string][];

beforeEach(() => {
  jobs = []; calls = [];
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u), m = init?.method || "GET";
    calls.push([m, s]);
    if (s.endsWith("/api/receipts/jobs") && m === "POST") return json({ ...base, status: "uploading" });
    if (s.includes("/files/")) return json({ ...base, status: "uploading" });
    if (s.endsWith("/commit")) { jobs = [{ ...base, status: "reading", done: 1 }]; return json(jobs[0]); }
    if (s.endsWith("/api/receipts/jobs")) return json({ jobs });
    if (s.endsWith("/resume")) { jobs = [{ ...base, status: "reading", done: 2 }]; return json(jobs[0]); }
    if (s.endsWith("/seen")) { jobs = []; return json({}); }
    if (s.includes("/api/review")) return json({ lines: [], unresolved: [] });
    if (s.includes("/api/quest/receipts")) return json({ receipts: [] });
    return json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = async () => {
  render(<ToastProvider><NavProvider initial="receipts"><Receipts /></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#rc-photo")).not.toBeNull());
};

test("several files are sent to the server, then it reads them in the background", async () => {
  await mount();
  const files = ["a", "b", "c"].map(n => new File(["x"], `${n}.png`, { type: "image/png" }));
  await act(async () => { fireEvent.change($("#rc-photo")!, { target: { files } }); });
  await waitFor(() => expect($("#rc-job")?.textContent).toContain("Reading your receipts in the background"));
  expect($("#rc-job")!.textContent).toContain("1 of 3 read.");
  expect(calls.filter(c => c[1].includes("/files/") && c[0] === "PUT")).toHaveLength(3);
  expect(calls.some(c => c[1].includes("/decode/"))).toBe(false);
});

test("a paused batch shows why and Resume continues it", async () => {
  jobs = [{ ...base, status: "paused", done: 1, reason: "Arya's reading is switched off for this account after unusual use." }];
  await mount();
  await waitFor(() => expect($("#rc-job")?.textContent).toContain("Reading paused at 1 of 3"));
  expect($("#rc-job")!.textContent).toContain("switched off");
  await act(async () => { fireEvent.click($("#rc-job-resume")!); });
  await waitFor(() => expect($("#rc-job")?.textContent).toContain("Reading your receipts in the background"));
});

test("a finished batch says what was filed and why files failed, and Dismiss marks it seen", async () => {
  jobs = [{ ...base, status: "ready", done: 3, filed: 2, failed: 1, failures: [{ name: "c.png", reason: "could not read the date on this receipt" }] }];
  await mount();
  await waitFor(() => expect($("#rc-job")?.textContent).toContain("3 receipts read"));
  expect($("#rc-job")!.textContent).toContain("2 filed · 0 already here · 1 could not be read.");
  expect($("#rc-job")!.textContent).toContain("c.png: could not read the date");
  await act(async () => { fireEvent.click($("#rc-job-dismiss")!); });
  await waitFor(() => expect($("#rc-job")).toBeNull());
  expect(calls.some(c => c[1].endsWith("/seen"))).toBe(true);
});

test("one file is also sent to the server and read in the background (owner, 2026-11-01)", async () => {
  await mount();
  const files = [new File(["x"], "one.png", { type: "image/png" })];
  await act(async () => { fireEvent.change($("#rc-photo")!, { target: { files } }); });
  await waitFor(() => expect(calls.some(c => c[1].endsWith("/commit"))).toBe(true));
  expect(calls.filter(c => c[1].includes("/files/") && c[0] === "PUT")).toHaveLength(1);
  expect(calls.some(c => c[1].includes("/decode/"))).toBe(false);
});
