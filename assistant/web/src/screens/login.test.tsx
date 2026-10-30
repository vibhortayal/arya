import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { AuthStatus } from "../app/session";
import { Login, SEEN_KEY, loadSeen } from "./Login";

/* Landing B1 (owner, 2026-10-29): a flip card stops wobbling for good
 * once tapped; "Start my own list" shows only while registration is
 * open, and opens the sheet in register mode. */

let status: AuthStatus = { has_users: true, registration_open: true };
vi.mock("../app/session", () => ({ useSession: () => ({ status, enter: () => {} }) }));

beforeEach(() => { localStorage.clear(); status = { has_users: true, registration_open: true }; });
afterEach(cleanup);

describe("flip cards", () => {
  test("the eight guide sections, in the guide's order", () => {
    render(<Login />);
    expect(Array.from(document.querySelectorAll(".ftile")).map(c => c.id)).toEqual(
      ["land-lists", "land-share", "land-maps", "land-news", "land-receipts", "land-prices", "land-usesoon", "land-ask"]);
    expect(document.querySelector("#land-usesoon .back")!.textContent).toContain("expires or goes bad");
    expect(document.body.textContent).not.toMatch(/optional|goes off/i);
  });

  test("a tap flips the card and stops its wobble for good", () => {
    render(<Login />);
    const card = document.getElementById("land-maps")!;
    expect(card.className).not.toContain("seen");
    expect(document.querySelectorAll(".ftile:not(.seen)").length).toBe(8);
    fireEvent.click(card);
    expect(card.className).toContain("seen");
    expect(card.className).toContain(" on");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card);
    expect(card.className).not.toContain(" on");
    expect(card.className).toContain("seen"); // flipped back, still no wobble
    expect(loadSeen()).toEqual(["maps"]);
    cleanup();
    render(<Login />); // a later visit: still seen, not flipped
    const again = document.getElementById("land-maps")!;
    expect(again.className).toContain("seen");
    expect(again.getAttribute("aria-pressed")).toBe("false");
    expect(document.getElementById("land-lists")!.className).not.toContain("seen");
  });

  test("bad or missing storage means every card wobbles", () => {
    localStorage.setItem(SEEN_KEY, "{not json");
    expect(loadSeen()).toEqual([]);
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadSeen()).toEqual([]);
    get.mockRestore();
  });
});

describe("start my own list", () => {
  test("open registration: the button opens the sheet in register mode", () => {
    render(<Login />);
    fireEvent.click(screen.getByText("Start my own list"));
    expect(screen.getByText("Create your account")).toBeTruthy();
    expect(document.getElementById("login-btn")!.textContent).toBe("Create account");
  });

  test("Sign in after it goes back to sign-in mode", () => {
    render(<Login />);
    fireEvent.click(screen.getByText("Start my own list"));
    fireEvent.click(document.getElementById("signin-open")!);
    expect(document.getElementById("login-btn")!.textContent).toBe("Sign in");
  });

  test("closed registration: no button", () => {
    status = { has_users: true, registration_open: false };
    render(<Login />);
    expect(screen.getByText("Try it now")).toBeTruthy();
    expect(screen.queryByText("Start my own list")).toBeNull();
    expect(document.getElementById("register-open")).toBeNull();
  });
});

describe("sign-in sheet", () => {
  test("a typed password does not survive closing the sheet", () => {
    render(<Login />);
    fireEvent.click(document.getElementById("signin-open")!);
    const pass = () => document.getElementById("login-pass") as HTMLInputElement;
    fireEvent.change(pass(), { target: { value: "hunter2" } });
    expect(pass().value).toBe("hunter2");
    fireEvent.keyDown(document.getElementById("signin-sheet")!, { key: "Escape" });
    fireEvent.click(document.getElementById("signin-open")!);
    expect(pass().value).toBe("");
  });
});
