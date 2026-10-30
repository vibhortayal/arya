import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Chat } from "./Chat";

/* Ask Arya with photos (owner 2026-10-30): Talk and Photo are labelled
 * chips under the field, a picked photo gets a chooser over the readers
 * that already exist, Ask about this photo sends it once with the next
 * question, and there is no voice out. */
const resets = vi.hoisted(() => [] as (() => void)[]);
vi.mock("../app/session", () => ({ useSession: () => ({ language: "en", languages: [], setLanguage: () => {} }), clearOnSignOut: (f: () => void) => { resets.push(f); } }));
vi.mock("../lib/recorder", () => ({ startCapture: vi.fn(), transcribeBlob: vi.fn(), voiceSupported: () => true }));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const calls: { url: string; init?: RequestInit }[] = [];
let routes: Record<string, () => Response> = {};

beforeEach(() => {
  resets.forEach(f => f());
  calls.length = 0;
  routes = {};
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo" }));
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: String(u), init });
    const hit = Object.keys(routes).find(k => String(u).includes(k));
    return hit ? routes[hit]() : json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  render(<ToastProvider><NavProvider initial="chat"><section id="view-chat"><Chat /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#chat-input")).not.toBeNull());
}
const pick = async () => {
  const f = new File(["x"], "p.jpg", { type: "image/jpeg" });
  act(() => { fireEvent.change($("#ask-photo")!, { target: { files: [f] } }); });
  await waitFor(() => expect($("#photo-choose")).not.toBeNull());
};

test("Talk and Photo are labelled chips under the field, and there is no speaker", async () => {
  await mount();
  expect($("#btn-mic")!.textContent).toBe("Talk");
  expect($("label[for=ask-photo]")!.textContent).toBe("Photo");
  expect($("#btn-speak")).toBeNull();
  const form = $("#chat-form")!;
  expect(form.querySelector(".caprow")!.compareDocumentPosition($("#chat-input")!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

test("a picked photo offers the four readers, the question, and a way out", async () => {
  await mount();
  await pick();
  const opts = [...document.querySelectorAll("[data-photo-do]")].map(b => b.getAttribute("data-photo-do"));
  expect(opts).toEqual(["list", "receipt", "fridge", "date", "ask"]);
  expect($("#photo-choose")!.textContent).toContain("Photo is kept so you can compare");
  act(() => { fireEvent.click($("[data-photo-never]")!); });
  expect($("#photo-choose")).toBeNull();
});

test("Add to my list reads the photo and says what was added", async () => {
  routes["/api/list/from-photo"] = () => json({ kind: "list", names: ["milk", "eggs"], added: 2 });
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=list]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("Added to your list: milk, eggs."));
  expect(calls.some(c => c.url.includes("/api/list/from-photo"))).toBe(true);
});

test("a list read that is really a receipt offers to file it", async () => {
  routes["/api/list/from-photo"] = () => json({ kind: "receipt", names: [], added: 0 });
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=list]")!); });
  await waitFor(() => expect($("[data-photo-chip]")!.textContent).toBe("File a receipt"));
});

test("Read the date says what it read, and Track it saves", async () => {
  routes["/api/expiry/read"] = () => json({ readable: true, name: "Milk", date: "2026-11-20", kind: "use_by", match: { item_id: "i-milk", name: "Whole Milk" } });
  routes["/api/expiry/save"] = () => json({ item_id: "i-milk", date: "2026-11-20" });
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=date]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("Whole Milk expires"));
  act(() => { fireEvent.click($("[data-photo-chip]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("Tracking Whole Milk until"));
  const save = calls.find(c => c.url.includes("/api/expiry/save"))!;
  expect(JSON.parse(String(save.init!.body))).toMatchObject({ item_id: "i-milk", date: "2026-11-20" });
});

test("a failed read says so in plain words and offers another photo", async () => {
  routes["/api/list/from-photo"] = () => json({ detail: "boom" }, 502);
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=list]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("I could not read that photo."));
  expect(document.body.textContent).toContain("Nothing was changed.");
  expect($("[data-photo-chip]")!.textContent).toBe("Try another photo");
});

test("Cancel while reading drops a late answer", async () => {
  let release: (r: Response) => void = () => {};
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(ok => { release = ok; })));
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=list]")!); });
  await waitFor(() => expect($("[data-photo-cancel]")).not.toBeNull());
  act(() => { fireEvent.click($("[data-photo-cancel]")!); });
  await act(async () => { release(json({ kind: "list", names: ["milk"], added: 1 })); });
  expect(document.body.textContent).not.toContain("Added to your list");
});

test("Ask about this photo shows a not-saved strip and sends the photo once with the question", async () => {
  routes["/api/chat"] = () => json({ reply: "That is basil pesto.", applied: [], skipped: [] });
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=ask]")!); });
  const strip = $("#ask-photo-strip")!;
  expect(strip.textContent).toContain("not saved");
  expect(($("#chat-input") as HTMLInputElement).placeholder).toBe("Ask about this photo");
  act(() => { fireEvent.change($("#chat-input")!, { target: { value: "what is this?" } }); });
  await act(async () => { fireEvent.submit($("#chat-form")!); });
  await waitFor(() => expect(document.body.textContent).toContain("That is basil pesto."));
  const chat = calls.find(c => c.url.includes("/api/chat"))!;
  const body = JSON.parse(String(chat.init!.body));
  expect(body.image.media_type).toBe("image/jpeg");
  expect(body.image.data.length).toBeGreaterThan(0);
  expect($("#ask-photo-strip")).toBeNull();
  // The next question carries no photo.
  act(() => { fireEvent.change($("#chat-input")!, { target: { value: "thanks" } }); });
  await act(async () => { fireEvent.submit($("#chat-form")!); });
  const second = calls.filter(c => c.url.includes("/api/chat"))[1];
  expect(JSON.parse(String(second.init!.body)).image).toBeUndefined();
});

test("Remove drops the photo strip", async () => {
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=ask]")!); });
  act(() => { fireEvent.click($("[data-photo-remove]")!); });
  expect($("#ask-photo-strip")).toBeNull();
});

test("Track it on a date with no known item asks for a name, then saves it", async () => {
  routes["/api/expiry/read"] = () => json({ readable: true, name: null, date: "2026-12-25", kind: "use_by", match: null });
  routes["/api/expiry/save"] = () => json({ item_id: "manual-oat-milk", date: "2026-12-25" });
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=date]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("This item expires"));
  act(() => { fireEvent.click($("[data-photo-chip]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("What is this item called?"));
  expect(calls.find(c => c.url.includes("/api/expiry/save"))).toBeUndefined();
  act(() => { fireEvent.change($("#chat-input")!, { target: { value: "Oat milk" } }); });
  await act(async () => { fireEvent.submit($("#chat-form")!); });
  await waitFor(() => expect(document.body.textContent).toContain("Tracking Oat milk until"));
  expect(JSON.parse(String(calls.find(c => c.url.includes("/api/expiry/save"))!.init!.body))).toMatchObject({ name: "Oat milk", date: "2026-12-25" });
});

test("a failed Track it says so in plain words, not the API's", async () => {
  routes["/api/expiry/read"] = () => json({ readable: true, name: "Milk", date: "2026-11-20", kind: "use_by", match: null });
  routes["/api/expiry/save"] = () => json({ detail: "item_id or name is required" }, 400);
  await mount();
  await pick();
  act(() => { fireEvent.click($("[data-photo-do=date]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("Milk expires"));
  act(() => { fireEvent.click($("[data-photo-chip]")!); });
  await waitFor(() => expect(document.body.textContent).toContain("I could not save that date"));
  expect(document.body.textContent).not.toContain("item_id");
});
