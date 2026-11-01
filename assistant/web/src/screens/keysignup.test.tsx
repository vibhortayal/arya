import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { AuthStatus } from "../app/session";
import { Login } from "./Login";

/* Sign up with your own Meta key (owner-approved mockup 2026-11-01): one
 * "Get your own account" entry with two ways in; the key is checked,
 * then an emailed code creates the account. Hidden unless the server
 * offers it. */
let status: AuthStatus;
let entered: string[] = [];
vi.mock("../app/session", () => ({ useSession: () => ({ status, enter: (u: string) => { entered.push(u); } }), useIsDemo: () => false }));

const json = (b: unknown, code = 200) => new Response(JSON.stringify(b), { status: code, headers: { "Content-Type": "application/json" } });
let calls: { url: string; body: any }[];
let replies: Record<string, () => Response>;
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); entered = []; calls = [];
  history.replaceState({}, "", "/");
  status = { has_users: true, registration_open: false, email_signin: true, own_key_signup: true };
  replies = {};
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return (replies[u] || (() => json({ ok: true })))();
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const click = (id: string) => act(() => { fireEvent.click($(id)); });
const type = (id: string, v: string) => act(() => { fireEvent.change($(id), { target: { value: v } }); });
const fill = async (email: string, key: string) => {
  await click("ways-open"); await click("ways-key");
  await type("ks-email", email); await type("ks-key", key);
  await act(() => { fireEvent.click($("ks-accept")); });
};
const go = () => act(async () => { fireEvent.submit($("ks-form")); });

test("without the server's say-so the landing keeps Join the waitlist and no key option", () => {
  status = { has_users: true, registration_open: false, email_signin: true };
  render(<Login />);
  expect($("waitlist-open")).toBeTruthy();
  expect($("ways-open")).toBeNull();
  act(() => { fireEvent.click($("signin-open")); });
  expect($("signin-ways")).toBeNull();
});

test("one entry shows both ways; the waitlist way opens the waitlist", async () => {
  render(<Login />);
  expect($("waitlist-open")).toBeNull();
  expect($("ways-open").textContent).toBe("Get your own account ›");
  await click("ways-open");
  expect($("ways-waitlist").textContent).toContain("Join the waitlist");
  expect($("ways-key").textContent).toContain("I have my own Meta key");
  await click("ways-waitlist");
  expect($("waitlist-form")).toBeTruthy();
});

test("the sign-in sheet links to the same two ways", async () => {
  render(<Login />);
  await click("signin-open");
  expect($("signin-ways").textContent).toContain("No account yet?");
  await click("signin-ways-open");
  expect($("ways-key")).toBeTruthy();
});

test("a key that is not Meta's is stopped before sending; the terms tick is needed", async () => {
  render(<Login />);
  await click("ways-open"); await click("ways-key");
  await type("ks-email", "sam@example.com"); await type("ks-key", "sk-proj-abcdefgh");
  expect(($("ks-go") as HTMLButtonElement).disabled).toBe(true);
  await act(() => { fireEvent.click($("ks-accept")); });
  expect(($("ks-key") as HTMLInputElement).type).toBe("password");
  await go();
  expect($("ks-err").textContent).toBe("That isn't a Meta Model API key. It starts with LLM_.");
  expect(calls.some(c => c.url === "/auth/own-key/start")).toBe(false);
});

test("good key: checked, code emailed, then Create my account signs in", async () => {
  replies["/auth/own-key/start"] = () => json({ sent: true, ends: "1234" });
  replies["/auth/own-key/verify"] = () => json({ user: "sam" });
  render(<Login />);
  await fill(" sam@example.com ", "LLM_abcdefghij1234");
  await go();
  expect(calls.find(c => c.url === "/auth/own-key/start")!.body).toEqual({ email: "sam@example.com", key: "LLM_abcdefghij1234", accept: true });
  expect($("ks-checked").textContent).toContain("Meta accepted key …1234");
  expect(document.body.textContent).not.toContain("LLM_abcdefghij1234");
  await type("ks-code", "482913");
  await act(async () => { fireEvent.submit($("ks-code-form")); });
  expect(calls.find(c => c.url === "/auth/own-key/verify")!.body).toEqual({ email: "sam@example.com", code: "482913" });
  expect(entered).toEqual(["sam"]);
});

test("server answers show in place: Meta's refusal, an email with an account offers Sign in, an expired sign-up starts again", async () => {
  replies["/auth/own-key/start"] = () => json({ detail: "Meta didn't accept this key. Check it at dev.meta.ai and try again." }, 422);
  render(<Login />);
  await fill("sam@example.com", "LLM_abcdefghij1234");
  await go();
  expect($("ks-err").textContent).toBe("Meta didn't accept this key. Check it at dev.meta.ai and try again.");
  replies["/auth/own-key/start"] = () => json({ detail: "That email already has an account. Sign in, then add your key in Settings." }, 409);
  await go();
  expect($("ks-err").textContent).toContain("That email already has an account.");
  expect($("ks-signin")).toBeTruthy();
  replies["/auth/own-key/start"] = () => json({ sent: true, ends: "1234" });
  replies["/auth/own-key/verify"] = () => json({ detail: "This sign-up expired. Start again." }, 410);
  await go();
  await type("ks-code", "1");
  await act(async () => { fireEvent.submit($("ks-code-form")); });
  expect($("ks-form")).toBeTruthy();
  expect($("ks-err").textContent).toBe("This sign-up expired. Start again.");
  expect(entered).toEqual([]);
});
