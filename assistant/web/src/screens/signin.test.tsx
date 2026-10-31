import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { AuthStatus } from "../app/session";
import { Login } from "./Login";

/* Invite-only sign-in (owner, 2026-10-30): email code first, Google second,
 * the waitlist in reach; the password form only on /team. */

let status: AuthStatus;
let entered: string[] = [];
vi.mock("../app/session", () => ({ useSession: () => ({ status, enter: (u: string) => { entered.push(u); } }) }));

const json = (b: unknown, code = 200) => new Response(JSON.stringify(b), { status: code, headers: { "Content-Type": "application/json" } });
let calls: { url: string; body: any }[];
let replies: Record<string, () => Response>;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); entered = []; calls = [];
  history.replaceState({}, "", "/");
  status = { has_users: true, registration_open: false, email_signin: true };
  replies = {};
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return (replies[u] || (() => json({ ok: true })))();
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); history.replaceState({}, "", "/"); });

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const open = () => act(() => { fireEvent.click($("signin-open")); });
const type = (id: string, v: string) => act(() => { fireEvent.change($(id), { target: { value: v } }); });
const submit = async () => { await act(async () => { fireEvent.submit($("code-form")); }); };

test("the public sheet has email, Google and the waitlist, and no password form", () => {
  render(<Login />); open();
  expect($("code-email")).toBeTruthy();
  expect($("google-btn")).toBeTruthy();
  expect($("code-have").textContent).toBe("I already have a code");
  expect($("code-waitlist")).toBeTruthy();
  expect($("login-form")).toBeNull();
  expect(document.querySelectorAll("#signin-sheet .btn.primary")).toHaveLength(1);
});

test("/team shows the password form and not the email block", () => {
  history.replaceState({}, "", "/team");
  render(<Login />);
  expect($("login-form")).toBeTruthy();
  expect($("code-email")).toBeNull();
  expect(document.querySelector("#signin-sheet h3")!.textContent).toBe("Team sign-in");
});

test("the password form posts (never GET) and names its fields for password managers", () => {
  history.replaceState({}, "", "/team");
  render(<Login />);
  expect($("login-form").getAttribute("method")).toBe("post");
  expect($("login-user").getAttribute("name")).toBe("username");
  expect($("login-pass").getAttribute("name")).toBe("password");
});

test("?team=1 works too", () => {
  history.replaceState({}, "", "/?team=1");
  render(<Login />);
  expect($("login-form")).toBeTruthy();
});

test("where email sign-in is not set up, the password form stays", () => {
  status = { has_users: true, registration_open: false, email_signin: false };
  render(<Login />); open();
  expect($("login-form")).toBeTruthy();
});

test("sending a code moves to Check your email with the code box and the waitlist button", async () => {
  render(<Login />); open();
  type("code-email", "sam@example.com");
  await submit();
  await waitFor(() => expect($("code-input")).toBeTruthy());
  expect(calls[0]).toEqual({ url: "/auth/email/start", body: { email: "sam@example.com" } });
  expect(document.querySelector("#signin-sheet h3")!.textContent).toBe("Check your email");
  expect($("email-signin").textContent).toContain("sam@example.com");
  expect($("code-waitlist").className).toContain("btn");
  expect($("code-resend")).toBeTruthy();
});

test("a right code signs in; a wrong one says what to do", async () => {
  render(<Login />); open();
  type("code-email", "sam@example.com"); await submit();
  await waitFor(() => expect($("code-input")).toBeTruthy());
  type("code-input", "111111");
  replies["/auth/email/verify"] = () => json({ detail: "Token has expired or is invalid" }, 401);
  await submit();
  await waitFor(() => expect($("code-msg").textContent).toBe("That code did not work. Check it, or send a new one."));
  replies["/auth/email/verify"] = () => json({ user: "sam@example.com" });
  await submit();
  await waitFor(() => expect(entered).toEqual(["sam@example.com"]));
});

test("I already have a code goes straight to the code box with an email field, and sends nothing", async () => {
  render(<Login />); open();
  act(() => { fireEvent.click($("code-have")); });
  expect($("code-input")).toBeTruthy();
  expect($("code-email")).toBeTruthy();
  expect(calls).toHaveLength(0);
  type("code-email", "sam@example.com"); type("code-input", "482913");
  replies["/auth/email/verify"] = () => json({ user: "sam@example.com" });
  await submit();
  await waitFor(() => expect(entered).toEqual(["sam@example.com"]));
  expect(calls[0].body).toEqual({ email: "sam@example.com", code: "482913" });
});

test("the waitlist button opens the waitlist with the typed email filled in", async () => {
  render(<Login />); open();
  type("code-email", "sam@example.com"); await submit();
  await waitFor(() => expect($("code-input")).toBeTruthy());
  act(() => { fireEvent.click($("code-waitlist")); });
  expect(($("waitlist-email") as HTMLInputElement).value).toBe("sam@example.com");
});

test("Google, not invited: the sheet says so and one tap joins the waitlist", async () => {
  history.replaceState({}, "", "/?signin=notinvited");
  sessionStorage.setItem("arya.notinvited", "sam@gmail.com");
  replies["/auth/waitlist"] = () => json({ status: "added" });
  render(<Login />);
  expect(document.querySelector("#signin-sheet h3")!.textContent).toBe("Not on the list yet");
  expect($("not-invited").textContent).toContain("sam@gmail.com");
  expect($("login-form")).toBeNull();
  await act(async () => { fireEvent.click($("ni-join")); });
  await waitFor(() => expect($("waitlist-done")).toBeTruthy());
  expect(calls[0]).toEqual({ url: "/auth/waitlist", body: { email: "sam@gmail.com" } });
  expect($("waitlist-done").textContent).toContain("sam@gmail.com");
});

test("open registration keeps the password form and hides the waitlist", () => {
  status = { has_users: true, registration_open: true, email_signin: true };
  render(<Login />); open();
  expect($("login-form")).toBeTruthy();
  expect($("code-waitlist")).toBeNull();
});
