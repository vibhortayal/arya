import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { Lists } from "./Lists";
import { cache, lensState } from "./lists/model";

/* The add box on a list (owner, 2026-10-30): one wide box that says
 * "Add item here…", a round + that shows only once something is typed,
 * and voice and photo as 44px icon buttons inside it (option A, owner 2026-10-30). */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y" }), clearOnSignOut: () => {} }));
vi.mock("../app/avatar", () => ({ useAvatar: () => ({ src: "" }) }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const home = { list: { items: [] }, lists: [{ id: "l-costco", name: "Costco", stores: [] }] };
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;

beforeEach(() => {
  cache.data = null;
  lensState.lens = "l-costco";
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn(async (u: string) => json(String(u).includes("/api/home") ? home : {})));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  render(<ToastProvider><NavProvider initial="list"><section id="view-list"><Lists /></section></NavProvider></ToastProvider>);
  await waitFor(() => expect($("#add-text")).not.toBeNull());
}

test("the + shows only after typing, and says how many when there are several", async () => {
  await mount();
  const box = $("#add-text") as HTMLInputElement;
  expect(box.placeholder).toBe("Add item here…");
  expect($("#add-submit")).toBeNull();
  act(() => { fireEvent.change(box, { target: { value: "   " } }); });
  expect($("#add-submit")).toBeNull();
  act(() => { fireEvent.change(box, { target: { value: "eggs, bread and bananas" } }); });
  const plus = $("#add-submit")!;
  expect(plus.textContent).toBe("+");
  expect(plus.getAttribute("aria-label")).toBe("Add 3 items");
  // The + sits inside the box, so typing never squeezes the text.
  expect(plus.parentElement).toBe(box.parentElement);
  act(() => { fireEvent.change(box, { target: { value: "" } }); });
  expect($("#add-submit")).toBeNull();
});

test("voice and photo are icon buttons inside the box, with names for screen readers", async () => {
  await mount();
  const mic = $("#add-mic")!;
  const photo = $("label[for=add-photo]")!;
  expect(mic.getAttribute("aria-label")).toBe("Talk to add");
  expect(photo.getAttribute("aria-label")).toBe("Photo to add");
  expect(mic.closest(".addline")).not.toBeNull();
  expect(photo.closest(".addline")).not.toBeNull();
  expect($(".caprow")).toBeNull();
  // Typing swaps them for the +, so the text is never squeezed.
  act(() => { fireEvent.change($("#add-text")!, { target: { value: "milk" } }); });
  expect($("#add-mic")).toBeNull();
  expect($("#add-submit")).not.toBeNull();
  act(() => { fireEvent.change($("#add-text")!, { target: { value: "" } }); });
  expect($("#add-mic")).not.toBeNull();
});
