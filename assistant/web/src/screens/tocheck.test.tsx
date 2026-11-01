import { cleanup, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { ToCheck } from "./ToCheck";

/* The To check screen never shows a raw {{placeholder}}: the "Show N more"
 * button and the count line carry real numbers. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: { code: "USD", symbol: "$" } }), clearOnSignOut: () => {} }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const lines = Array.from({ length: 14 }, (_, i) => ({ receipt_id: "r" + i, idx: 0, date: "2026-10-28", raw: "ITEM " + i,
  decoded_name: "Item " + i, merchant: "Costco", sku: String(1000 + i), qty: 1, line_total: 3, confidence: 0.5 }));

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/review") ? { lines, unresolved: [] } : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("Show more and the count line carry real numbers", async () => {
  render(<ToastProvider><NavProvider initial="tocheck"><ToCheck /></NavProvider></ToastProvider>);
  await waitFor(() => expect(document.querySelector("#tc-more")).not.toBeNull());
  expect(document.querySelector("#tc-more")!.textContent).toBe("Show 4 more");
  expect(document.querySelector("#tc-count")!.textContent).toContain("14");
  expect(document.body.textContent).not.toContain("{{");
});
