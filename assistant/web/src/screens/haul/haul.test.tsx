import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NavProvider } from "../../app/nav";
import { ToastProvider } from "../../ui/Toast";
import { decode } from "../../ui/AddReceiptSheet";
import { Finish } from "../Finish";
import { Q } from "../hunt/model";
import * as H from "./core";
import { decodeAny } from "./state";

/* The haul slice's pure logic and the e-receipt handler, as the
 * plain-JS app's node harnesses ran them (tests/test_haul_client.py
 * TestHaulCoreUnderNode, TestFinishHandlerUnderNode), against the port. */

vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

beforeEach(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; }); // jsdom has none
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("HaulCore", () => {
  test("count-up is monotonic and lands exactly on the target", () => {
    let prev = -1, mono = true;
    for (let i = 0; i <= 100; i++) { const v = H.countStep(0, 137, i / 100); if (v < prev) mono = false; prev = v; }
    expect(mono).toBe(true);
    expect(H.countStep(0, 137, 0)).toBe(0);
    expect(H.countStep(0, 137, 1)).toBe(137);
    expect(H.countStep(0, 137, 7)).toBe(137);
    expect(H.countStep(0, 0, 0.5)).toBe(0);
    expect(H.revealFinal(137, 9)).toEqual({ shown: 9, value: 137 });
  });

  test("hide toggle round trip does not touch its input", () => {
    const s0 = new Set(["milk"]);
    const s1 = H.toggleHidden(s0, "eggs");
    const s2 = H.toggleHidden(s1, "eggs");
    expect([...s1].sort()).toEqual(["eggs", "milk"]);
    expect(s0.has("eggs")).toBe(false);
    expect([...s2]).toEqual(["milk"]);
  });

  test("audience words", () => {
    expect(H.sheetAudienceText([])).toBe("");
    expect(H.sheetAudienceText(["priya"])).toBe("@priya");
    expect(H.sheetAudienceText(["priya", "dev"])).toBe("@priya and @dev");
    expect(H.sheetAudienceText(["a", "b", "c"])).toBe("@a, @b and @c");
    expect(H.sheetAudienceText(["priya", "dev", "x", "y", "z"])).toBe("@priya, @dev and 3 more");
  });

  test("Same haul: list and queued items start unticked and say why", () => {
    const rows = H.queuePick([{ name: "Whole Milk" }, { name: "Mandarins" }, "Bananas"], ["milk", "Bananas"], []);
    expect(rows[0]).toMatchObject({ checked: false, note: "Already on your list" });
    expect(rows[1]).toMatchObject({ checked: true, note: "" });
    expect(rows[2].checked).toBe(false);
    expect(H.queuePick(["a", "b"], [], []).every(r => r.checked)).toBe(true);
    const rq = H.queuePick(["Kiwi", "Pears", "Whole Milk"], ["milk"], ["kiwi!"]);
    expect(rq[0]).toMatchObject({ checked: false, note: "Already in your next hunt" });
    expect(rq[1]).toMatchObject({ checked: true, note: "" });
    expect(rq[2]).toMatchObject({ checked: false, note: "Already on your list" });
  });

  test("the toast counts what the server queued", () => {
    const q = [{ post_id: "a" }, { post_id: "b" }, { post_id: "a" }];
    expect(H.queuedCount(q, "a")).toBe(2);
    expect(H.queuedCount(q, "z")).toBe(0);
    expect(H.queuedCount(null, "a")).toBe(0);
    expect(H.sameToast(0, 3)).toMatch(/Nothing new/);
    expect(H.sameToast(3, 3)).toBe("3 items added to your next hunt.");
    expect(H.sameToast(1, 1)).toBe("1 item added to your next hunt.");
    expect(H.sameToast(2, 3).startsWith("2 items added to your next hunt.")).toBe(true);
    expect(H.sameToast(2, 3)).toMatch(/rest were there already/);
  });

  test("the private estimate never sets a partial sum against the whole receipt", () => {
    const fmt = (n: number) => "$" + Number(n).toFixed(0);
    const full = H.privateLines({ estimate: 18, estimate_items: 5, grabbed_items: 5, actual: 20 }, fmt);
    expect(full.map(r => r.text)).toEqual(["About $18 · Receipt $20"]);
    const part = H.privateLines({ estimate: 18, estimate_items: 3, grabbed_items: 12, actual: 120 }, fmt);
    expect(part.map(r => r.text)).toEqual(["About $18 for 3 of 12 items", "$120"]);
    expect(H.privateLines(null, fmt)).toEqual([]);
    expect(H.privateLines({ estimate: null, actual: null }, fmt)).toEqual([]);
    const only = H.privateLines({ estimate: null, estimate_items: 0, grabbed_items: 4, actual: 9 }, fmt);
    expect(only.map(r => r.text)).toEqual(["Receipt $9"]);
  });

  test("a post carries a name and a stock art file, nothing else", () => {
    const p = H.postPayload([{ name: "Milk", art: "milk.webp", price: 3.99, store: "X", image_url: "/u" } as any, { name: "Eggs" }]);
    expect(p.items.every(i => Object.keys(i).sort().join() === "art,name")).toBe(true);
    expect(p.items[1].art).toBe("basket.webp");
    expect(JSON.stringify(p)).not.toMatch(/price|store|image_url|3\.99/);
  });

  test("labels and the sample card", () => {
    expect(H.statsLabel({ items: 9, new: 2, level: 4 })).toBe("9 items · 2 new · level 4");
    expect(H.fixLabel("on_receipt_only")).toMatchObject({ yes: "Add to album", no: "Leave out" });
    expect(H.fixLabel("grabbed_only")).toMatchObject({ yes: "Keep", no: "Remove from haul" });
    expect(H.sampleHaul().sample).toBe(true);
    expect(H.sampleHaul().items.length).toBe(9);
  });
});

/* fetch stub: records calls, answers by path. */
function stubFetch(opts: { pdfFails?: boolean; attachFails?: boolean } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/decode/pdf") return opts.pdfFails ? json({ detail: "this needs a real account" }, 403) : json({ receipt: { receipt_id: "r-pdf" } });
    if (url === "/decode/photo") return json({ receipt: { receipt_id: "r-img" } });
    if (url.endsWith("/receipt")) return opts.attachFails ? json({ detail: "this receipt is from 2020, before the hunt began" }, 422) : json({ id: "s1", state: "done", receipt_id: "r-pdf", mode: "quest", items: [] });
    if (url.endsWith("/state")) return json({ id: "s1", state: "finished", mode: "quest", store: "Trader Joe's", items: [] });
    if (url === "/api/quest/sessions") return json({ sessions: [] });
    return json({});
  }));
  return calls;
}

describe("the receipt decoders", () => {
  const pdf = new File(["%PDF"], "e-receipt.pdf", { type: "application/pdf" });
  const upper = new File(["%PDF"], "RECEIPT.PDF", { type: "" });
  const png = new File(["png"], "screenshot.png", { type: "image/png" });

  test("a PDF, by type or by name, goes to /decode/pdf as a PDF body; a picture to the photo reader", async () => {
    for (const dec of [async (f: File) => (await decode(f)).receipt.receipt_id, decodeAny]) {
      let calls = stubFetch();
      expect(await dec(pdf)).toBe("r-pdf");
      expect(calls[0].url).toBe("/decode/pdf");
      expect(calls[0].init!.method).toBe("POST");
      expect((calls[0].init!.headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
      expect(calls[0].init!.body).toBe(pdf);
      calls = stubFetch();
      await dec(upper);
      expect(calls[0].url).toBe("/decode/pdf");
      calls = stubFetch();
      expect(await dec(png)).toBe("r-img");
      expect(calls.map(c => c.url)).toEqual(["/decode/photo"]);
    }
  });
});

describe("Finish: the e-receipt door", () => {
  const pdf = new File(["%PDF"], "e-receipt.pdf", { type: "application/pdf" });
  const mount = () => {
    (Q as any).current = { id: "s1", store: "Trader Joe's", mode: "quest", state: "playing", items: [{ name: "Milk", qty: 1, checked: true }] };
    render(<ToastProvider><NavProvider initial="finish"><Finish /></NavProvider></ToastProvider>);
  };
  const choose = (f: File) => fireEvent.change(document.getElementById("fin-ereceipt")!, { target: { files: [f] } });

  test("reads the PDF, closes the hunt, then attaches this trip's receipt", async () => {
    const calls = stubFetch();
    mount();
    choose(pdf);
    await waitFor(() => expect(calls.some(c => c.url.endsWith("/receipt"))).toBe(true));
    const urls = calls.map(c => c.url);
    expect(urls[0]).toBe("/decode/pdf");
    expect(urls.indexOf("/api/quest/sessions/s1/state")).toBeLessThan(urls.indexOf("/api/quest/sessions/s1/receipt"));
    expect(JSON.parse(String(calls.find(c => c.url.endsWith("/receipt"))!.init!.body))).toEqual({ receipt_id: "r-pdf" });
    expect(urls).not.toContain("/decode/photo");
  });

  test("a read failure says so, names the cause, and closes nothing", async () => {
    const calls = stubFetch({ pdfFails: true });
    mount();
    choose(pdf);
    await screen.findByText(/^Could not read that file: this needs a real account/);
    expect(calls.map(c => c.url)).toEqual(["/decode/pdf"]);
    expect(document.getElementById("fin-status")!.textContent).toBe("");
  });

  test("an attach refusal is not 'could not read': the file was read", async () => {
    stubFetch({ attachFails: true });
    mount();
    choose(pdf);
    const t = await screen.findByText(/^Arya read the file, but could not attach it: /);
    expect(t.textContent).not.toMatch(/Could not read/);
  });

  test("no file, no work", () => {
    const calls = stubFetch();
    mount();
    fireEvent.change(document.getElementById("fin-ereceipt")!, { target: { files: [] } });
    expect(calls).toEqual([]);
  });
});
