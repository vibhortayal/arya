import { act, fireEvent, render } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { linesMatch } from "../ui/LineFix";
import { Receipt } from "./Receipt";

/* Fix this line on a filed receipt (owner, 2026-11-01, "full"): tap a
 * line, change name, quantity or price; a price that breaks the printed
 * total warns first and saves with "Save anyway". */
const posts: [string, unknown][] = [];
let detail: Record<string, unknown>;
vi.mock("../app/session", () => ({ useSession: () => ({ currency: { code: "USD", symbol: "$" } }) }));
vi.mock("../lib/api", async orig => ({
  ...(await orig<typeof import("../lib/api")>()),
  get: async () => detail,
  post: async (url: string, body: unknown) => { posts.push([url, body]); return { ok: true, also: 2, undo: [] }; },
}));

beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });
beforeEach(() => {
  posts.length = 0;
  detail = {
    receipt_id: "r1", merchant: "Safeday", purchased_at: "2026-10-22", total: 10.39, subtotal: 10.39, tax: 0, totals_reconcile: true,
    lines: [{ name: "Whole Milk 1 gal", raw: "SFDY WHL MLK GAL", qty: 1, line_total: 4.40, line_type: "item" },
            { name: "Baby Spinach 16 oz", qty: 1, line_total: 5.99, line_type: "item", edited: true }],
  };
});
function Open() { const nav = useNav(); if (!nav.params.receipt_id) nav.show("receipt", { receipt_id: "r1" }); return nav.params.receipt_id ? <Receipt /> : null; }
const mount = async () => {
  render(<ToastProvider><NavProvider><Open /></NavProvider></ToastProvider>);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};
const type = (id: string, v: string) => act(() => { fireEvent.change(document.getElementById(id)!, { target: { value: v } }); });

test("linesMatch follows the server rule: subtotal, else total less tax", () => {
  expect(linesMatch([{ line_total: 4.4 }, { line_total: 5.99 }], { subtotal: 10.39 })).toEqual({ ok: true, diff: 0 });
  expect(linesMatch([{ line_total: 6 }], { total: 5, tax: 0.5 })).toEqual({ ok: false, diff: 1.5 });
  expect(linesMatch([{ line_total: 1 }], {})).toBeNull();
});

test("tap a line: the sheet shows what was printed; a name change saves only the name", async () => {
  await mount();
  expect(document.getElementById("rc-fix-hint")!.textContent).toContain("Tap a line");
  expect(document.querySelector("#rc-lines .lf-tag")!.textContent).toBe("edited");
  act(() => { fireEvent.click(document.querySelectorAll("#rc-lines .lf-row")[0]); });
  expect(document.getElementById("line-fix")!.textContent).toContain("Printed: SFDY WHL MLK GAL");
  type("lf-name", "Whole Milk, 1 gallon");
  await act(async () => { fireEvent.click(document.getElementById("lf-save")!); });
  expect(posts[0]).toEqual(["/api/receipts/r1/lines/0", { name: "Whole Milk, 1 gallon" }]);
  expect(document.body.textContent).toContain("Also fixed on 2 other receipts");
});

test("a price that breaks the printed total warns, then saves anyway", async () => {
  await mount();
  act(() => { fireEvent.click(document.querySelectorAll("#rc-lines .lf-row")[0]); });
  type("lf-qty", "2");
  type("lf-price", "7.90");
  expect(document.getElementById("lf-warn")!.textContent).toContain("$3.50 more than the total");
  expect(document.getElementById("lf-save")!.textContent).toBe("Save anyway");
  await act(async () => { fireEvent.click(document.getElementById("lf-save")!); });
  expect(posts[0]).toEqual(["/api/receipts/r1/lines/0", { qty: 2, line_total: 7.9 }]);
});

test("quantity 0 is refused before anything is sent", async () => {
  await mount();
  act(() => { fireEvent.click(document.querySelectorAll("#rc-lines .lf-row")[0]); });
  type("lf-qty", "0");
  expect((document.getElementById("lf-save") as HTMLButtonElement).disabled).toBe(true);
});
