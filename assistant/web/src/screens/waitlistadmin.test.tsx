import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { WaitlistAdmin } from "./WaitlistAdmin";

/* Waitlist sections (owner, 2026-10-31): Waiting, Approved, Rejected; ticks stay in one section; buttons follow it. */

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const now = Math.floor(Date.now() / 1000);
const rows = [
  { email: "maya@x.co", at: now, approved: false, rejected: false },
  { email: "vt@x.co", at: now, approved: true, rejected: false },
  { email: "bot@x.co", at: now, approved: false, rejected: true },
];
let calls: { url: string; body: any }[];

beforeEach(() => {
  window.scrollTo = vi.fn();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return u === "/auth/waitlist/list" ? json({ rows }) : json({ rejected: 1, restored: 1, removed: 1 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const show = async () => {
  render(<NavProvider><ToastProvider><WaitlistAdmin /></ToastProvider></NavProvider>);
  await waitFor(() => expect($("wl-sec-rejected")).toBeTruthy());
};
const tick = (sec: string) => act(() => { fireEvent.click($("wl-sec-" + sec).querySelector(".check") as HTMLElement); });

test("three sections in order, each with its person", async () => {
  await show();
  const ids = [...document.querySelectorAll("[id^=wl-sec-]")].map(e => e.id);
  expect(ids).toEqual(["wl-sec-waiting", "wl-sec-approved", "wl-sec-rejected"]);
  expect($("wl-sec-rejected").textContent).toContain("bot@x.co");
});

test("ticking a waiting person offers Approve and Reject; Reject posts to /reject", async () => {
  await show(); tick("waiting");
  expect($("wl-approve").textContent).toBe("Approve 1");
  await act(async () => { fireEvent.click($("wl-reject")); });
  await waitFor(() => expect(calls.find(c => c.url === "/auth/waitlist/reject")?.body).toEqual({ emails: ["maya@x.co"] }));
});

test("a rejected person offers Approve, Back to waiting and Delete", async () => {
  await show(); tick("rejected");
  expect($("wl-restore")).toBeTruthy();
  expect($("wl-remove").textContent).toBe("Delete");
});

test("ticking in another section replaces the first pick", async () => {
  await show(); tick("waiting"); tick("approved");
  expect(document.querySelectorAll('[aria-checked="true"]').length).toBe(1);
  expect($("wl-restore")).toBeTruthy();
});
