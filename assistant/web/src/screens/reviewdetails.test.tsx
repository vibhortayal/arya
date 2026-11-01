import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Receipts } from "./Receipts";

/* Receipts > To check (owner, 2026-11-01): the row names where, when and
 * how much; "More details" opens the rest in place, never leaves the screen. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: { code: "USD", symbol: "$" } }), clearOnSignOut: () => {} }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const review = { lines: [{ receipt_id: "r1", idx: 0, date: "2026-10-28", raw: "BL 3PC KING", decoded_name: "Sheet set, king (3 pc)",
  merchant: "Costco Newark", sku: "1730412", qty: 1, line_total: 18.99, confidence: 0.6, alternatives: ["Bath towel set"] }], unresolved: [] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/review") ? review : String(u).includes("/api/quest/receipts") ? { receipts: [] } : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("More details opens price, store, date and item number in place", async () => {
  render(<ToastProvider><NavProvider initial="receipts"><section id="view-receipts"><Receipts /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#review .name")).not.toBeNull());
  expect($("#review .sub")!.textContent).toContain("Costco Newark");
  expect($("#review .sub")!.textContent).toContain("$18.99");
  expect($(".detail")).toBeNull();
  fireEvent.click($("[data-more]")!);
  const d = $(".detail")!.textContent!;
  for (const s of ["$18.99", "Costco Newark", "Oct 28, 2026", "BL 3PC KING", "1730412", "Low (60%)"]) expect(d).toContain(s);
  fireEvent.click($("[data-more]")!);
  expect($(".detail")).toBeNull();
  await new Promise(r => setTimeout(r, 50)); // let the focus frame run while CSS is stubbed
});
