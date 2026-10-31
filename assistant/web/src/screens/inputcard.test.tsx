import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Lists } from "./Lists";
import { cache, lensState } from "./lists/model";

/* A photo or voice input that Arya cannot use never ends silently: a card
 * says what was understood, or why not, with Try again / Type it instead. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));
vi.mock("../app/avatar", () => ({ useAvatar: () => ({ src: "" }) }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const home = { list: { items: [] }, lists: [{ id: "l-costco", name: "Costco", stores: [] }] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
let photoReply: unknown;

beforeEach(() => {
  cache.data = null;
  lensState.lens = "l-costco";
  vi.stubGlobal("scrollTo", () => {});
  (URL as any).createObjectURL = () => "blob:x";
  (URL as any).revokeObjectURL = () => {};
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    const s = String(u);
    if (s.includes("/api/list/from-photo")) return photoReply instanceof Response ? photoReply : json(photoReply);
    return json(s.includes("/api/home") ? home : {});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function pick() {
  render(<ToastProvider><NavProvider initial="list"><section id="view-list"><Lists /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#add-photo")).not.toBeNull());
  const file = new File(["x"], "p.jpg", { type: "image/jpeg" });
  await act(async () => { fireEvent.change($("#add-photo")!, { target: { files: [file] } }); });
}

test("a photo of one item offers Add Peach? instead of doing nothing", async () => {
  photoReply = { kind: "item", item: "peach", confident: true, names: [], added: 0 };
  await pick();
  await waitFor(() => expect($("#add-input-card")).not.toBeNull());
  expect($("#add-input-card")!.textContent).toContain("Add peach?");
  expect($("[data-ic=add]")!.textContent).toBe("Add peach");
  act(() => { fireEvent.click($("[data-ic=edit]")!); });
  expect(($("#add-text") as HTMLInputElement).value).toBe("peach");
  expect($("#add-input-card")).toBeNull();
});

test("a photo with nothing usable says so, with Try again and Type it instead", async () => {
  photoReply = { kind: "unclear", reason: "The photo is too dark.", names: [], added: 0 };
  await pick();
  await waitFor(() => expect($("#add-input-card")).not.toBeNull());
  expect($("#add-input-card")!.textContent).toContain("couldn't tell");
  expect($("#add-input-card")!.textContent).toContain("too dark");
  expect($("[data-ic=retry]")).not.toBeNull();
  act(() => { fireEvent.click($("[data-ic=type]")!); });
  expect($("#add-input-card")).toBeNull();
});

test("a model error also lands on the card, not only a passing toast", async () => {
  photoReply = new Response(JSON.stringify({ detail: "boom" }), { status: 502 });
  await pick();
  await waitFor(() => expect($("#add-input-card")).not.toBeNull());
  expect($("#add-input-card")!.textContent).toContain("couldn't read");
});
