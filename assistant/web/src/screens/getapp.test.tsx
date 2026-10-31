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

const FB_IPHONE = IPHONE.replace("Mobile/15E148", "Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]");
const CHROME_IPHONE = IPHONE.replace(/Version\/18.0 /, "").replace("Safari/604.1", "CriOS/130.0 Safari/604.1");

test("iPhone steps name no browser, in Safari or Chrome", () => {
  for (const ua of [IPHONE, CHROME_IPHONE]) {
    env(ua);
    render(<Login />);
    fireEvent.click(pill()!);
    const sheet = document.getElementById("a2hs-sheet")!;
    expect(sheet.textContent).not.toMatch(/Safari|Chrome/);
    expect(sheet.textContent).toContain("Look for it in your browser's menu.");
    expect(document.getElementById("a2hs-copy")).toBeNull();
    cleanup(); vi.restoreAllMocks(); localStorage.clear();
  }
});

test("inside another app: a generic hint and Copy link, no Safari", () => {
  env(FB_IPHONE);
  render(<Login />);
  fireEvent.click(pill()!);
  const sheet = document.getElementById("a2hs-sheet")!;
  expect(sheet.textContent).toContain("Opened from another app? Open this page in your phone's browser first.");
  expect(sheet.textContent).not.toContain("Safari");
  expect(document.getElementById("a2hs-copy")).toBeTruthy();
});

test("desktop: the phone line with Copy link, no install steps", () => {
  env(DESKTOP);
  render(<Login />);
  expect(document.body.textContent).toContain("Arya is made for your phone.");
  expect(document.getElementById("landdesk-copy")).toBeTruthy();
  expect(pill()).toBeNull();
});

test("a phone does not get the desktop line", () => {
  env(IPHONE);
  render(<Login />);
  expect(document.getElementById("landdesk-copy")).toBeNull();
});

test("store badges are shown unlinked, with the coming-soon caption", () => {
  env(DESKTOP);
  const { container } = render(<Login />);
  const apps = container.querySelector(".landapps")!;
  expect(apps.textContent).toMatch(/coming soon/i);
  expect(apps.querySelectorAll("img").length).toBe(2);
  expect(apps.querySelector("a, button")).toBeNull();
});
