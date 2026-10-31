import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SessionProvider, useSession } from "./session";

/* Audit 2026-10-30. H1: a reload with no signal opens the app as the
 * last account, not the sign-in page. M6: signing in on /team leaves
 * the address at /. */

let me: () => Promise<Response>;
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/");
  me = () => Promise.resolve(json({ user: null, demo: false }));
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    if (u === "/auth/me") return me();
    if (u === "/auth/status") return json({ has_users: true, registration_open: false });
    return json({ currency: "USD", symbol: "$" });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState({}, "", "/"); });

let session: ReturnType<typeof useSession>;
function Probe() {
  session = useSession();
  return <p id="who">{session.ready ? session.user ?? "(signed out)" : "(loading)"}</p>;
}
const who = () => document.getElementById("who")!.textContent;
const boot = async () => { render(<SessionProvider><Probe /></SessionProvider>); await waitFor(() => expect(who()).not.toBe("(loading)")); };

test("signed in: the account is remembered", async () => {
  me = () => Promise.resolve(json({ user: "tester-a@test.arya", demo: false }));
  await boot();
  expect(who()).toBe("tester-a@test.arya");
  expect(JSON.parse(localStorage.getItem("arya.lastUser")!)).toEqual({ user: "tester-a@test.arya", demo: false });
});

test("no signal: the last account opens the app", async () => {
  localStorage.setItem("arya.lastUser", JSON.stringify({ user: "tester-a@test.arya", demo: false }));
  me = offline;
  await boot();
  expect(who()).toBe("tester-a@test.arya");
});

test("no signal and nobody remembered: the sign-in page", async () => {
  me = offline;
  await boot();
  expect(who()).toBe("(signed out)");
});

test("the server says signed out: the remembered account is dropped", async () => {
  localStorage.setItem("arya.lastUser", JSON.stringify({ user: "tester-a@test.arya", demo: false }));
  await boot();
  expect(who()).toBe("(signed out)");
  expect(localStorage.getItem("arya.lastUser")).toBeNull();
});

test("back online with a session that ended: signs out", async () => {
  localStorage.setItem("arya.lastUser", JSON.stringify({ user: "tester-a@test.arya", demo: false }));
  me = offline;
  await boot();
  me = () => Promise.resolve(json({ user: null, demo: false }));
  await act(async () => { dispatchEvent(new Event("online")); });
  await waitFor(() => expect(who()).toBe("(signed out)"));
  expect(localStorage.getItem("arya.lastUser")).toBeNull();
});

test("signing in on /team leaves the address at /, and sign out forgets the account", async () => {
  history.replaceState({}, "", "/team");
  await boot();
  act(() => session.enter("tester-a@test.arya", false));
  expect(location.pathname).toBe("/");
  expect(localStorage.getItem("arya.lastUser")).not.toBeNull();
  await act(async () => { await session.leave(); });
  expect(localStorage.getItem("arya.lastUser")).toBeNull();
});
