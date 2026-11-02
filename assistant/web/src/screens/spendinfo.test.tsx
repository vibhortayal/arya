import { act, fireEvent, render } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { money } from "../lib/format";
import { Analysis } from "./Analysis";

/* Spending card (owner, 2026-11-01): thousands commas in every amount,
 * and an (i) on each heading that opens one "What these mean" sheet. */
vi.mock("../app/session", () => ({
  useSession: () => ({ currency: { code: "USD", symbol: "$" }, layouts: {}, saveLayout: async () => {} }),
  useSavedBar: () => null,
}));
vi.mock("../lib/api", async orig => ({
  ...(await orig<typeof import("../lib/api")>()),
  get: async (path: string) => {
    if (path === "/api/dashboard") return {
      spend_by_month: { "2026-10": 790.81 }, spend_by_store: {}, top_items: [],
      returns_total: 2293.37, returns_count: 50, savings_total: 942.5, trip_count: 114, spend_total: 13243.58,
      spend_groceries: 12122.97, spend_other: 1120.61, other_by_kind: { pharmacy: 86.98 },
    };
    if (path === "/api/quest/receipts") return { receipts: [] };
    return null;
  },
}));

beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });

test("money groups thousands, the Indian way for rupees", () => {
  expect(money(13243.58)).toBe("$13,243.58");
  expect(money(-2293.37)).toBe("$2,293.37");
  expect(money(5)).toBe("$5.00");
  expect(money(1234567.5, { code: "EUR", symbol: "€" })).toBe("€1,234,567.50");
  expect(money(123456, { code: "INR", symbol: "₹" })).toBe("₹1,23,456.00");
});

test("each Spending heading's (i) explains only that heading", async () => {
  render(<ToastProvider><NavProvider initial="analysis"><Analysis /></NavProvider></ToastProvider>);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const card = document.getElementById("an-spend")!;
  expect(card.textContent).toContain("$13,243.58");
  expect(card.textContent).toContain("−$2,293.37");
  const btns = [...card.querySelectorAll<HTMLElement>('[data-info^="spend."]')];
  expect(btns.length).toBe(6);
  expect(new Set(btns.map(b => b.dataset.info)).size).toBe(6);
  act(() => { fireEvent.click(card.querySelector('[data-info="spend.all"]')!); });
  const sheet = document.getElementById("info-sheet")!;
  expect(sheet.querySelector("h3")!.textContent).toBe("All-time spending");
  expect(sheet.textContent).toContain("Groceries plus Other purchases, minus Returns");
  expect(sheet.textContent).not.toContain("Food and household things");
  expect(sheet.textContent).not.toContain("What these mean");
});
