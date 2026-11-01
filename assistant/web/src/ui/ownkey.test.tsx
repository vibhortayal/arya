import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider, useNav } from "../app/nav";
import { ToastProvider, useToast } from "./Toast";
import { OwnKeyRoute, OwnKeyRow } from "./OwnKey";
import { ApiError, get } from "../lib/api";

/* Your own Meta key (owner-approved mockup 2026-11-01): a Settings row,
 * hidden unless the server offers it; the key is never shown back; a
 * daily-limit answer (X-Arya-Offer) offers the setting. */
let demo = false;
vi.mock("../app/session", () => ({ useIsDemo: () => demo, useSession: () => ({ demo, user: "t@x.y" }), clearOnSignOut: () => {} }));

const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const res = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", ...headers } });
let state: any;
let calls: [string, string, any][];
let putAnswer: () => Response;
const serve = () => vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
  const m = init?.method || "GET";
  calls.push([m, String(u), init?.body ? JSON.parse(String(init.body)) : undefined]);
  if (m === "PUT") return putAnswer();
  if (m === "DELETE") return res({ removed: true });
  return state instanceof Response ? state : res(state);
}));
const show = () => render(<ToastProvider><NavProvider initial="profile"><OwnKeyRow /></NavProvider></ToastProvider>);

beforeEach(() => { demo = false; calls = []; vi.stubGlobal("scrollTo", () => {}); putAnswer = () => res({ saved: true, ends: "1234" }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("hidden when the server says it is not available, when it fails, and in the demo", async () => {
  state = { available: false, set: false, ends: null, status: null };
  serve(); show();
  await waitFor(() => expect(calls.length).toBe(1));
  expect($("#own-key-row")).toBeNull();
  cleanup(); calls = [];
  state = res({ detail: "nope" }, 500);
  serve(); show();
  await waitFor(() => expect(calls.length).toBe(1));
  await new Promise(r => setTimeout(r, 10));
  expect($("#own-key-row")).toBeNull();
  cleanup(); calls = [];
  demo = true; state = { available: true, set: false };
  serve(); show();
  await new Promise(r => setTimeout(r, 10));
  expect(calls.length).toBe(0);
  expect($("#own-key-row")).toBeNull();
});

test("add a key: a non-Meta key is stopped before sending; a good one is saved and only its last 4 show", async () => {
  state = { available: true, set: false, ends: null, status: null };
  serve(); show();
  await waitFor(() => expect($("#own-key-row")).not.toBeNull());
  expect($("#own-key-row")!.textContent).toContain("Optional. For when you reach Arya's daily limit.");
  fireEvent.click($("#own-key-row")!);
  const input = $("#own-key-input") as HTMLInputElement;
  expect(input.type).toBe("password");
  expect(input.autocomplete).toBe("off");
  fireEvent.change(input, { target: { value: "sk-proj-abcdefghij" } });
  fireEvent.click($("#own-key-save")!);
  expect($(".ok-err")!.textContent).toBe("That isn't a Meta Model API key. It starts with LLM_.");
  expect(calls.some(c => c[0] === "PUT")).toBe(false);
  fireEvent.change(input, { target: { value: "  LLM_abcdefghij1234 " } });
  await act(async () => { fireEvent.click($("#own-key-save")!); });
  await waitFor(() => expect($(".ok-card")).not.toBeNull());
  expect(calls.find(c => c[0] === "PUT")![2]).toEqual({ key: "LLM_abcdefghij1234" });
  expect($(".ok-card")!.textContent).toContain("…1234");
  expect(document.body.textContent).not.toContain("LLM_abcdefghij1234");
  expect($("#own-key-row")!.textContent).toContain("On");
});

test("Meta's refusal shows the server's sentence in the sheet", async () => {
  state = { available: true, set: false };
  putAnswer = () => res({ detail: "Meta didn't accept this key. Check it at dev.meta.ai and try again." }, 422);
  serve(); show();
  await waitFor(() => expect($("#own-key-row")).not.toBeNull());
  fireEvent.click($("#own-key-row")!);
  fireEvent.change($("#own-key-input")!, { target: { value: "LLM_abcdefghij1234" } });
  await act(async () => { fireEvent.click($("#own-key-save")!); });
  await waitFor(() => expect($(".ok-err")).not.toBeNull());
  expect($(".ok-err")!.textContent).toBe("Meta didn't accept this key. Check it at dev.meta.ai and try again.");
});

test("a key that needs attention says so, and Remove asks first", async () => {
  state = { available: true, set: true, ends: "9876", status: "needs_attention" };
  serve(); show();
  await waitFor(() => expect($("#own-key-row")).not.toBeNull());
  expect($("#own-key-row")!.textContent).toContain("Needs attention");
  fireEvent.click($("#own-key-row")!);
  expect($(".ok-alert")!.textContent).toContain("Meta rejected key …9876");
  fireEvent.click($("#own-key-remove")!);
  expect(calls.some(c => c[0] === "DELETE")).toBe(false);
  await act(async () => { fireEvent.click($("#own-key-remove-yes")!); });
  await waitFor(() => expect(calls.some(c => c[0] === "DELETE")).toBe(true));
  await waitFor(() => expect($("#own-key-row")!.textContent).not.toContain("Needs attention"));
});

test("an offer header rides on ApiError, and the limit toast opens Settings with the sheet", async () => {
  state = { available: true, set: false };
  const capped = res({ detail: "Arya's daily limit is reached." }, 503, { "X-Arya-Offer": "own-key" });
  let view = "";
  function Probe() {
    const { showErr } = useToast(); const nav = useNav(); view = nav.view;
    return <button id="probe" onClick={async () => { try { await get("/api/x"); } catch (e) { showErr(e); } }} />;
  }
  vi.stubGlobal("fetch", vi.fn(async (u: string) => String(u).includes("/api/x") ? capped : res(state)));
  render(<ToastProvider><NavProvider initial="home"><OwnKeyRoute /><Probe /><Shown /></NavProvider></ToastProvider>);
  await act(async () => { fireEvent.click($("#probe")!); });
  await waitFor(() => expect($("#toast")!.textContent).toContain("Use my own Meta key"));
  await act(async () => { fireEvent.click($("#toast .toastact")!); });
  await waitFor(() => expect(view).toBe("profile"));
  await waitFor(() => expect($("#own-key-input")).not.toBeNull());
  try { await get("/api/x"); } catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).offer).toBe("own-key"); }
});
function Shown() { const nav = useNav(); return nav.view === "profile" ? <OwnKeyRow /> : null; }
