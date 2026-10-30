import { render, fireEvent, cleanup } from "@testing-library/react";
import type { AuthStatus } from "../app/session";
import { Login, GETAPP_KEY, getAppTapped } from "./Login";

/* "Get the app" pill on the landing (owner, 2026-10-29): shows only
 * while Arya can go on this phone's Home Screen; jiggles (or glows with
 * reduced motion) until first tapped; a tap on iPhone opens the steps. */

const status: AuthStatus = { has_users: true, registration_open: true };
vi.mock("../app/session", () => ({ useSession: () => ({ status, enter: () => {} }) }));

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function env(ua: string, media: Record<string, boolean> = {}) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: !!media[q], media: q, addEventListener() {}, removeEventListener() {} }));
}

const pill = () => document.getElementById("getapp-open");

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("hidden on a desktop with nothing to install", () => {
  env(DESKTOP);
  render(<Login />);
  expect(pill()).toBeNull();
  expect(document.getElementById("signin-open")).toBeTruthy();
});

test("hidden once Arya runs from the Home Screen", () => {
  env(IPHONE, { "(display-mode: standalone)": true });
  render(<Login />);
  expect(pill()).toBeNull();
});

test("shown on an iPhone, in the header, and it jiggles", () => {
  env(IPHONE);
  render(<Login />);
  const p = pill()!;
  expect(p.textContent).toBe("Get the app");
  expect(p.className).toContain("jiggle");
  expect(p.className).not.toContain("glow");
  expect(p.parentElement!.className).toBe("landtop");
});

test("a tap opens the iPhone steps and stops the jiggle for good", () => {
  env(IPHONE);
  render(<Login />);
  fireEvent.click(pill()!);
  expect(pill()!.className).not.toContain("jiggle");
  expect(getAppTapped()).toBe(true);
  expect(localStorage.getItem(GETAPP_KEY)).toBe("1");
  const sheet = document.getElementById("a2hs-sheet")!;
  expect(sheet.textContent).toContain("Get the Arya app");
  expect(sheet.textContent).toContain("Free, no app store.");
  expect(sheet.textContent).toContain("Tip: sign in from the Home Screen app.");
  expect(sheet.querySelectorAll("ol.steps li").length).toBe(4);
  cleanup();
  render(<Login />); // a later visit: still there, but still
  expect(pill()!.className).toBe("gethome");
});

test("reduced motion: a glow, no jiggle", () => {
  env(IPHONE, { "(prefers-reduced-motion: reduce)": true });
  render(<Login />);
  expect(pill()!.className).toContain("glow");
  expect(pill()!.className).not.toContain("jiggle");
  fireEvent.click(pill()!);
  expect(pill()!.className).toBe("gethome");
});

test("blocked storage: the pill still works and jiggles", () => {
  env(IPHONE);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  render(<Login />);
  expect(pill()!.className).toContain("jiggle");
  fireEvent.click(pill()!);
  expect(pill()!.className).not.toContain("jiggle");
});
