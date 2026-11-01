import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { ToCheck, orderCards, SURE, type Line } from "./ToCheck";

/* To check smart suggestions (owner 2026-11-01): each card leads with
 * Arya's guess, the printed text and a section; "Use the N sure guesses"
 * (confidence >= 0.85) sets them all in one call with one Undo. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: { code: "USD", symbol: "$" } }), clearOnSignOut: () => {} }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const ln = (rid: string, raw: string, extra: Partial<Line> = {}): Line => ({ receipt_id: rid, idx: 0, raw, decoded_name: raw, merchant: "Costco",
  date: "2026-10-28", line_total: 4, qty: 1, ...extra } as Line);
const guess = (name: string, confidence: number, section = "dairy & eggs") => ({ suggested: { name, section, confidence, by: "arya" } });

let review: { lines: Line[]; unresolved: unknown[] };
let posts: [string, any][];
const serve = (onPost?: (u: string, b: any) => unknown) => vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
  const s = String(u);
  if (init?.method === "POST") {
    const b = JSON.parse(String(init.body || "{}"));
    posts.push([s, b]);
    return json(onPost?.(s, b) ?? { ok: true });
  }
  if (s.includes("/api/review")) return json(review);
  if (s.includes("/api/quest/receipts")) return json({ receipts: [] });
  return json({});
}));
const show = () => render(<ToastProvider><NavProvider initial="tocheck"><ToCheck /></NavProvider></ToastProvider>);

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("CSS", { escape: (s: string) => s });
  posts = [];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("cards come sure guesses first, then unsure, then no guess; bigger groups first", () => {
  const out = orderCards([
    ln("a", "NOPE", { suggest_tried: true }),
    ln("b", "MAYBE", guess("Maybe item", 0.6)),
    ln("c", "SURE1", guess("Sure one", SURE)),
    ln("d", "SURE2", { ...guess("Sure two", 0.95), sku: "9" }),
    ln("e", "SURE2", { ...guess("Sure two", 0.95), sku: "9" }),
  ]);
  expect(out.map(g => g[0].raw)).toEqual(["SURE2", "SURE1", "MAYBE", "NOPE"]);
});

test("a guess card shows the guess, what was printed and the section; Use this name saves both", async () => {
  review = { lines: [ln("r1", "KS ORG EGGS", { ...guess("Organic eggs - 24 ct", 0.92), sku: "11" })], unresolved: [] };
  serve();
  show();
  await waitFor(() => expect($("[data-card]")).not.toBeNull());
  const card = $("[data-card]")!.textContent!;
  expect(card).toContain("Arya's guess");
  expect(card).toContain("Organic eggs - 24 ct");
  expect(card).toContain('Printed "KS ORG EGGS"');
  expect($(".tc-sect")!.textContent).toBe("Dairy & eggs");
  expect($$(".actions button").map(b => b.textContent)).toEqual(["Use this name", "Fix", "Keep printed", "Details"]);
  await act(async () => { fireEvent.click($("[data-use]")!); });
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/line"))).toBe(true));
  expect(posts.find(p => p[0].includes("/api/review/line"))![1]).toEqual({ receipt_id: "r1", idx: 0, action: "rename", name: "Organic eggs - 24 ct", section: "dairy & eggs" });
});

test("Fix opens with the guess and its section filled in", async () => {
  review = { lines: [ln("r1", "KS ORG EGGS", guess("Organic eggs", 0.7))], unresolved: [] };
  serve();
  show();
  await waitFor(() => expect($("[data-card]")).not.toBeNull());
  expect($(".tc-kick")!.textContent).toBe("Arya's guess · not sure");
  expect($("#tc-bulk")).toBeNull(); // an unsure guess is never in the bulk button
  fireEvent.click($("[data-group-fix]")!);
  expect(($("[data-editor] input") as HTMLInputElement).value).toBe("Organic eggs");
  expect(($("[data-editor] select") as HTMLSelectElement).value).toBe("dairy & eggs");
});

test("Use the sure guesses sets them in one call, and one Undo puts them all back", async () => {
  review = { lines: [
    ln("a", "MLK", guess("Milk", 0.9)), ln("b", "BRD", guess("Bread", 0.88, "bakery")),
    ln("c", "XYZ", guess("Maybe", 0.5)), ln("d", "QQ", { suggest_tried: true }),
  ], unresolved: [] };
  const undo = [{ receipt_id: "a", idx: 0, decoded_name: "MLK", status: "unverified" }];
  serve(u => u.includes("/api/review/accept") ? { ok: true, done: 2, undo } : undefined);
  show();
  await waitFor(() => expect($("#tc-bulk")).not.toBeNull());
  expect($("#tc-bulk")!.textContent).toContain("Arya has a guess for 3 of them");
  expect($("#tc-use-sure")!.textContent).toBe("Use the 2 sure guesses");
  await act(async () => { fireEvent.click($("#tc-use-sure")!); });
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/accept"))).toBe(true));
  expect(posts.find(p => p[0].includes("/api/review/accept"))![1].items).toEqual([
    { receipt_id: "a", idx: 0, name: "Milk", section: "dairy & eggs" },
    { receipt_id: "b", idx: 0, name: "Bread", section: "bakery" },
  ]);
  expect($("#toast")!.textContent).toContain("2 names set: Milk, Bread.");
  await act(async () => { fireEvent.click($("#toast .toastact")!); });
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/undo"))).toBe(true));
  expect(posts.find(p => p[0].includes("/api/review/undo"))![1]).toEqual({ changes: undo });
});

test("lines Arya has not guessed yet are read on open; ones it cannot read say so", async () => {
  review = { lines: [ln("a", "ZZ TOP", {}), ln("b", "QQ", { suggest_tried: true })], unresolved: [] };
  serve(u => {
    if (u.includes("/api/review/smart-pass")) review = { lines: [ln("a", "ZZ TOP", guess("Zucchini", 0.9, "produce")), review.lines[1]], unresolved: [] };
    return { suggested: 1 };
  });
  show();
  await waitFor(() => expect(posts.some(p => p[0].includes("/api/review/smart-pass"))).toBe(true));
  await waitFor(() => expect(document.body.textContent).toContain("Zucchini"));
  expect(document.body.textContent).toContain("Arya could not read this one");
  const noGuess = $$("[data-card]").find(c => c.textContent!.includes("QQ"))!;
  expect(Array.from(noGuess.querySelectorAll(".actions button")).map(b => b.textContent)).toEqual(["Type the name", "Keep printed", "Details"]);
});

test("no smart pass when every line already has a guess or was tried", async () => {
  review = { lines: [ln("a", "MLK", guess("Milk", 0.9)), ln("b", "QQ", { suggest_tried: true })], unresolved: [] };
  serve();
  show();
  await waitFor(() => expect($("[data-card]")).not.toBeNull());
  await new Promise(r => setTimeout(r, 30));
  expect(posts.some(p => p[0].includes("/api/review/smart-pass"))).toBe(false);
});
