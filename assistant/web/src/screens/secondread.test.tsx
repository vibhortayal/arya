import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Receipts, secondReason, SECOND_POLL_MS } from "./Receipts";

/* The demo's receipt second read (owner, 2026-11-03, demo only): Spark's
 * read shows first with "Double-checking with Muse Wonder…", then the
 * lines change in place, or a note says Wonder agreed or didn't finish. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: true, user: "demo", currency: { code: "USD", symbol: "$" } }), clearOnSignOut: () => {} }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const spark = { receipt_id: "dec-1", merchant: "Corner Market", total: 16.2, decoded_by: "muse-spark-1.3",
  lines: [{ decoded_name: "Whole milk", line_total: 3.49 }, { decoded_name: "Cheese", line_total: 2.79 }] };
let checkReply: () => Response;
let checks = 0;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("scrollTo", () => {});
  checks = 0;
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const s = String(u);
    if (s.includes("/decode/photo")) return json({ demo: true, added: 1, receipt: spark, check: { id: "j1", reasons: ["lines_do_not_add_up"] } });
    if (s.includes("/decode/check/")) { checks++; return checkReply(); }
    return json(s.includes("/api/review") ? { lines: [], unresolved: [] } : s.includes("/api/quest/receipts") ? { receipts: [] } : {});
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

async function pick() {
  render(<ToastProvider><NavProvider initial="receipts"><Receipts /></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#rc-photo")).not.toBeNull());
  await act(async () => { fireEvent.change($("#rc-photo")!, { target: { files: [new File(["x"], "r.png", { type: "image/png" })] } }); });
  await waitFor(() => expect($("#rc-second-read")).not.toBeNull());
}
const poll = async () => { await act(async () => { vi.advanceTimersByTime(SECOND_POLL_MS + 10); }); };

test("Spark's read shows at once while Wonder checks, and the button waits", async () => {
  checkReply = () => json({ state: "pending", reasons: ["lines_do_not_add_up"] });
  await pick();
  expect($("#rc-second-read")!.textContent).toContain("Double-checking with Muse Wonder…");
  expect($("#rc-second-read")!.textContent).toContain("The lines don't add up to the total, so Wonder is reading the photo again.");
  expect($("#rc-photo-preview")!.textContent).toContain("Read by Muse Spark · checking");
  expect($("#rc-photo-preview")!.textContent).toContain("Cheese");
  expect($("label.receiptbtn")!.textContent).toBe("Checking…");
  expect(($("#rc-photo") as HTMLInputElement).disabled).toBe(true);
  await poll();
  await waitFor(() => expect(checks).toBeGreaterThan(0));
  expect($("#rc-second-read")!.textContent).toContain("Double-checking");
});

test("Wonder's fix replaces the lines in place and marks what changed", async () => {
  checkReply = () => json({ state: "changed", fixed: 2, reasons: ["lines_do_not_add_up"], receipt: { ...spark, decoded_by: "muse-wonder-1.0",
    lines: [{ decoded_name: "Whole milk", line_total: 3.94, was: { price: 3.49 } }, { decoded_name: "Cheddar, 8 oz", line_total: 2.79, was: { name: "Cheese" } }] } });
  await pick();
  await poll();
  await waitFor(() => expect($("#rc-second-read")!.textContent).toContain("Muse Wonder fixed 2 lines"));
  expect($("#rc-second-read")!.textContent).toContain("Spark's lines didn't add up to the total. Wonder read the photo again.");
  const rows = document.querySelectorAll("#rc-photo-preview .row.rc2-chg");
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("Changed");
  expect(rows[0].textContent).toContain("Spark read $3.49");
  expect(rows[1].textContent).toContain("Spark read Cheese");
  expect($("#rc-photo-preview")!.textContent).toContain("Read by Muse Wonder");
  expect($("label.receiptbtn")!.textContent).toBe("Add receipts");
});

test("Wonder agreeing shows a green note and nothing moves", async () => {
  checkReply = () => json({ state: "same", reasons: ["lines_do_not_add_up"], receipt: { ...spark, decoded_by: "muse-wonder-1.0" } });
  await pick();
  await poll();
  await waitFor(() => expect($("#rc-second-read.same")).not.toBeNull());
  expect($("#rc-second-read")!.textContent).toContain("Muse Wonder read it the same way");
  expect($("#rc-photo-preview")!.textContent).toContain("Checked by Muse Wonder");
  expect(document.querySelectorAll(".rc2-chg")).toHaveLength(0);
});

test("Wonder not finishing keeps Spark's read and says to check the prices", async () => {
  checkReply = () => json({ state: "failed", reasons: ["lines_do_not_add_up"], receipt: spark });
  await pick();
  await poll();
  await waitFor(() => expect($("#rc-second-read.gave")).not.toBeNull());
  expect($("#rc-second-read")!.textContent).toContain("Muse Wonder didn't finish");
  expect($("#rc-second-read")!.textContent).toContain("so check the prices against your receipt");
  expect($("#rc-photo-preview")!.textContent).toContain("Read by Muse Spark");
});

test("the reason line follows the check that failed", () => {
  expect(secondReason(["total_mismatch"])).toBe("addUp");
  expect(secondReason(["item_count_mismatch"])).toBe("count");
  expect(secondReason(["price_changed"])).toBe("price");
  expect(secondReason(["many_unsure_lines"])).toBe("unsure");
  expect(secondReason(["no_lines"])).toBe("other");
});
