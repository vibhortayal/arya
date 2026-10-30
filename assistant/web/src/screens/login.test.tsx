import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { AuthStatus } from "../app/session";
import { Login, SEEN_KEY, loadSeen } from "./Login";

/* Landing (owner, 2026-10-30): a tapped card zooms up with its text and
 * stops hopping for good; "Start my own list" shows only while registration is
 * open, and opens the sheet in register mode. */

let status: AuthStatus = { has_users: true, registration_open: true };
vi.mock("../app/session", () => ({ useSession: () => ({ status, enter: () => {} }) }));

beforeEach(() => { localStorage.clear(); status = { has_users: true, registration_open: true }; });
afterEach(cleanup);

describe("cards", () => {
  test("the eight guide sections, in the guide's order", () => {
    render(<Login />);
    expect(Array.from(document.querySelectorAll(".ftile")).map(c => c.id)).toEqual(
      ["land-lists", "land-share", "land-maps", "land-news", "land-receipts", "land-prices", "land-usesoon", "land-ask"]);
    expect(document.body.textContent).not.toMatch(/optional|goes off/i);
  });

  test("Try it now and Sign in come before the cards", () => {
    render(<Login />);
    const demo = document.getElementById("demo-btn")!, sign = document.getElementById("signin-open")!;
    const cards = document.querySelector(".landcards")!;
    expect(demo.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sign.compareDocumentPosition(cards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  /* The zoom layer must leave on its own timer: the old code waited for
   * animationend, which never came after Close, so the dimmed layer stayed
   * and no other card could be tapped (owner, 2026-10-30). No animation
   * event is fired here on purpose. */
  test("a tap zooms the card with its text, and Close, the backdrop and Escape go back", () => {
    vi.useFakeTimers();
    try {
      render(<Login />);
      fireEvent.click(document.getElementById("land-usesoon")!);
      const dialog = screen.getByRole("dialog");
      expect(dialog.textContent).toContain("expires or goes bad");
      fireEvent.click(document.getElementById("land-zoom-close")!);
      act(() => { vi.advanceTimersByTime(400); });
      expect(document.getElementById("land-zoom")).toBeNull();
      fireEvent.click(document.getElementById("land-maps")!);
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => { vi.advanceTimersByTime(400); });
      expect(document.getElementById("land-zoom")).toBeNull();
      fireEvent.click(document.getElementById("land-ask")!);
      fireEvent.click(document.getElementById("land-zoom")!);
      act(() => { vi.advanceTimersByTime(400); });
      expect(document.getElementById("land-zoom")).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  test("every card opens and closes, in any order and repeatedly", () => {
    vi.useFakeTimers();
    try {
      render(<Login />);
      const ids = Array.from(document.querySelectorAll(".ftile")).map(c => c.id);
      const order = [...ids, ...ids.slice().reverse(), ids[3], ids[3], ids[0]];
      for (const id of order) {
        fireEvent.click(document.getElementById(id)!);
        expect(document.getElementById("land-zoom")).not.toBeNull();
        fireEvent.click(document.getElementById("land-zoom-close")!);
        act(() => { vi.advanceTimersByTime(400); });
        expect(document.getElementById("land-zoom")).toBeNull();
      }
    } finally { vi.useRealTimers(); }
  });

  test("closing a card puts keyboard focus back on it", () => {
    vi.useFakeTimers();
    try {
      render(<Login />);
      const card = document.getElementById("land-news")!;
      card.focus();
      fireEvent.click(card);
      fireEvent.keyDown(document, { key: "Escape" });
      act(() => { vi.advanceTimersByTime(400); });
      expect(document.activeElement).toBe(card);
    } finally { vi.useRealTimers(); }
  });

  test("the first card beats until any card is tapped; a tapped card stops hopping for good", () => {
    render(<Login />);
    expect(document.querySelectorAll(".ftile.beat").length).toBe(1);
    expect(document.getElementById("land-lists")!.className).toContain("beat");
    expect(document.querySelectorAll(".ftile:not(.seen)").length).toBe(8);
    const card = document.getElementById("land-maps")!;
    fireEvent.click(card);
    expect(card.className).toContain("seen");
    expect(document.querySelectorAll(".ftile.beat").length).toBe(0);
    expect(loadSeen()).toEqual(["maps"]);
    cleanup();
    render(<Login />); // a later visit: still seen, and no card beats
    expect(document.getElementById("land-maps")!.className).toContain("seen");
    expect(document.getElementById("land-lists")!.className).not.toContain("seen");
    expect(document.querySelectorAll(".ftile.beat").length).toBe(0);
  });

  test("bad or missing storage means every card hops", () => {
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
