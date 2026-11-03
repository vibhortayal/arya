import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ToastProvider, useToast } from "../ui/Toast";
import { AlexaCard, reviewItems, type Review } from "./todayAlexa";
import { withAlexa } from "./todayCards";

/* From Alexa (owner, 2026-11-03): only unclear Alexa adds; Right keeps,
 * Fix moves, renames or removes; the card is gone when nothing is left. */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const guess: Review = { id: "r1", item_id: "manual-paper-towels", name: "Paper Towels", heard: "paper tower", kind: "guess", list_id: "l-c", list_name: "Costcozy", at: "2026-11-03T00:10:00Z" };
const raw: Review = { id: "r2", item_id: null, name: "brocoli crowns", heard: "brocoli crowns", kind: "unchecked", list_id: "l-t", list_name: "Trader Jill's", at: "2026-11-03T00:09:00Z" };
const lists = [{ id: "l-c", name: "Costcozy" }, { id: "l-t", name: "Trader Jill's" }];
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
let posts: { url: string; body: any }[] = [];
let answer: (url: string) => Response;

function Host({ start }: { start: Review[] }) {
  const [rows, setRows] = useState(start);
  const { toast } = useToast();
  return <AlexaCard rows={rows} setRows={setRows} lists={lists} toast={toast} />;
}
const mount = (start: Review[]) => render(<ToastProvider><Host start={start} /></ToastProvider>);

beforeEach(() => {
  posts = [];
  answer = () => json({ items: [raw] });
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    posts.push({ url: String(u), body: JSON.parse(String(init?.body || "{}")) });
    return answer(String(u));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("reviewItems", () => {
  test("keeps well-formed rows, fills heard, drops junk", () => {
    expect(reviewItems(null)).toEqual([]);
    expect(reviewItems({ items: "x" })).toEqual([]);
    const got = reviewItems({ items: [guess, { id: "r9", name: "", list_id: "l" }, { ...raw, heard: undefined }, 5] });
    expect(got.map(r => r.id)).toEqual(["r1", "r2"]);
    expect(got[1].heard).toBe("brocoli crowns");
  });
});

describe("withAlexa", () => {
  test("off: never shown; on: added once, a later remove sticks", () => {
    expect(withAlexa(["alexa", "trip"], false, true)).toEqual(["trip"]);
    expect(withAlexa(["trip", "low"], true, false)).toEqual(["alexa", "trip", "low"]);
    expect(withAlexa(["trip", "low"], true, true)).toEqual(["trip", "low"]);
    expect(withAlexa(["low", "alexa"], true, true)).toEqual(["low", "alexa"]);
  });
});

describe("From Alexa card", () => {
  test("nothing unclear: no card", () => {
    mount([]);
    expect($("#today-alexa")?.textContent).toBe("");
  });

  test("rows show what Alexa heard, the guess and the list", () => {
    mount([guess, raw]);
    const card = $("#today-alexa")!;
    expect(card.textContent).toContain("2 to check");
    expect(card.textContent).toContain("Paper Towels");
    expect(card.textContent).toContain("Arya's guess");
    expect(card.textContent).toContain("paper tower");
    expect(card.textContent).toContain("on Costcozy");
    expect(card.textContent).toContain("Not checked");
    expect(card.textContent).toContain("Arya couldn't check this one");
  });

  test("Right confirms, the row goes, Undo reopens", async () => {
    mount([guess, raw]);
    await act(async () => { fireEvent.click(document.querySelectorAll("[data-alexa-right]")[0]); });
    expect(posts[0].url).toContain("/api/alexa/review/r1/confirm");
    await waitFor(() => expect($("#today-alexa")!.textContent).toContain("1 to check"));
    expect(document.body.textContent).toContain("Kept Paper Towels on Costcozy");
    answer = () => json({ items: [guess, raw] });
    const undo = [...document.querySelectorAll("button")].find(b => b.textContent === "Undo")!;
    await act(async () => { fireEvent.click(undo); });
    expect(posts[1].url).toContain("/api/alexa/review/r1/reopen");
    await waitFor(() => expect($("#today-alexa")!.textContent).toContain("2 to check"));
  });

  test("Fix moves to another list", async () => {
    mount([guess]);
    fireEvent.click($("[data-alexa-fix]")!);
    expect($('[data-alexa-move="l-c"]')!.getAttribute("aria-pressed")).toBe("true");
    answer = () => json({ items: [] });
    await act(async () => { fireEvent.click($('[data-alexa-move="l-t"]')!); });
    expect(posts[0].url).toContain("/r1/move");
    expect(posts[0].body).toEqual({ list_id: "l-t" });
    await waitFor(() => expect($("#today-alexa")!.textContent).toBe(""));
  });

  test("Fix renames and removes", async () => {
    mount([guess]);
    fireEvent.click($("[data-alexa-fix]")!);
    fireEvent.click($("[data-alexa-edit]")!);
    const input = $("#alexa-name") as HTMLInputElement;
    expect(input.value).toBe("Paper Towels");
    fireEvent.change(input, { target: { value: "Paper towel rolls" } });
    await act(async () => { fireEvent.submit(input.form!); });
    expect(posts[0].url).toContain("/r1/rename");
    expect(posts[0].body).toEqual({ name: "Paper towel rolls" });

    cleanup(); posts = [];
    mount([guess]);
    fireEvent.click($("[data-alexa-fix]")!);
    await act(async () => { fireEvent.click($("[data-alexa-remove]")!); });
    expect(posts[0].url).toContain("/r1/remove");
  });

  test("a row closed elsewhere (404) just goes", async () => {
    answer = () => json({ detail: "gone" }, 404);
    mount([guess, raw]);
    await act(async () => { fireEvent.click(document.querySelectorAll("[data-alexa-right]")[0]); });
    await waitFor(() => expect($("#today-alexa")!.textContent).toContain("1 to check"));
  });
});
