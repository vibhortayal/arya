import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { ToCheck } from "./ToCheck";
import { Receipts } from "./Receipts";

/* A bulk receipt add that fails says why (114 files once answered only
 * "114 could not be read") and stops when every file would be refused. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: "USD" }), clearOnSignOut: () => {} }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
let decodeReply: (n: number) => Response;
let decodeCalls = 0;

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  decodeCalls = 0;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const s = String(u);
    if (s.includes("/decode/")) return decodeReply(++decodeCalls);
    return json(s.includes("/api/review") ? { lines: [], unresolved: [] } : s.includes("/api/quest/receipts") ? { receipts: [] } : {});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function pick(n: number) {
  render(<ToastProvider><NavProvider initial="receipts"><Receipts /></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#rc-photo")).not.toBeNull());
  const files = Array.from({ length: n }, (_, i) => new File(["x"], `r${i}.png`, { type: "image/png" }));
  await act(async () => { fireEvent.change($("#rc-photo")!, { target: { files } }); });
}

test("a refused read stops the batch and shows the reason", async () => {
  decodeReply = () => json({ detail: "daily model budget reached" }, 503);
  await pick(5);
  await waitFor(() => expect($("#rc-photo-failures")).not.toBeNull());
  expect(decodeCalls).toBe(1);
  expect($("#rc-photo-failures")!.textContent).toContain("daily model budget reached");
  expect($("#toast")!.textContent).toContain("Reason: daily model budget reached");
  expect($("#toast")!.textContent).toContain("4 not tried");
});

test("a file that cannot be read does not stop the rest, and each reason is listed", async () => {
  decodeReply = n => n === 2 ? json({ detail: "could not read the date on this receipt" }, 422)
    : json({ receipt: { receipt_id: "r" + n, merchant: "Costco", lines: [] } });
  await pick(3);
  await waitFor(() => expect($("#rc-photo-failures")).not.toBeNull());
  expect(decodeCalls).toBe(3);
  expect($("#rc-photo-failures")!.textContent).toContain("r1.png: could not read the date");
  expect($("#toast")!.textContent).toContain("Added 2 receipts");
});

test("lines of one product on several receipts become one row, fixed with one tap", async () => {
  const mk = (rid: string) => ({ receipt_id: rid, idx: 0, decoded_name: "KS LBC", raw: "KS LBC", sku: "1736931", merchant: "Costco", date: "2025-05-01", line_total: 13.99 });
  const posts: [string, any][] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    const s = String(u);
    if (init?.method === "POST") { posts.push([s, JSON.parse(String(init.body || "{}"))]); return json({ ok: true, also: 2, undo: [{ receipt_id: "b", idx: 0 }] }); }
    if (s.includes("/api/review")) return json({ lines: [mk("a"), mk("b"), mk("c"), { ...mk("d"), sku: "5", decoded_name: "Other", raw: "OTHER" }], unresolved: [] });
    if (s.includes("/api/quest/receipts")) return json({ receipts: [] });
    return json({});
  }));
  render(<ToastProvider><NavProvider initial="tocheck"><ToCheck /></NavProvider></ToastProvider>);
  await waitFor(() => expect($("[data-group-confirm]")).not.toBeNull());
  expect(document.querySelectorAll("[data-group-confirm]")).toHaveLength(1);
  expect($("[data-group-confirm]")!.textContent).toBe("Looks right, all 3");
  expect(document.querySelectorAll("[data-confirm]")).toHaveLength(1);
  await act(async () => { fireEvent.click($("[data-group-confirm]")!); });
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/line"))).toBe(true));
  expect($("#toast")!.textContent).toContain("Also fixed 2 other receipt lines.");
  await act(async () => { fireEvent.click($("#toast .toastact")!); });
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/undo"))).toBe(true));
});
