import { render, fireEvent, cleanup } from "@testing-library/react";
import "../i18n";
import en from "../i18n/en.json";
import { ToastProvider } from "../ui/Toast";
import { Developers, GROUPS, curlLine, isDevelopersPath } from "./Developers";

/* The public developer page (owner approved the mockup 2026-10-30). */

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const page = () => render(<ToastProvider><Developers /></ToastProvider>);

test("only /developers is the developer page", () => {
  expect(isDevelopersPath("/developers")).toBe(true);
  expect(isDevelopersPath("/developers/")).toBe(true);
  expect(isDevelopersPath("/")).toBe(false);
  expect(isDevelopersPath("/developers/x")).toBe(false);
});

test("the try-it command uses the address the page is on", () => {
  expect(curlLine("https://arya.example")).toBe(
    'curl -H "Authorization: Bearer $TOKEN" \\\n  https://arya.example/api/v1/lists');
});

test("every endpoint row and group has its words in en.json", () => {
  const dev = en.developers as Record<string, string>;
  for (const g of GROUPS) {
    expect(dev[g.title], g.title).toBeTruthy();
    for (const [, , what] of g.rows) expect(dev[what], what).toBeTruthy();
  }
});

test("lists every endpoint and the page needs no sign-in", () => {
  const { container } = page();
  const rows = [...container.querySelectorAll(".devrow")];
  expect(rows.length).toBe(GROUPS.reduce((n, g) => n + g.rows.length, 0));
  expect(container.textContent).toContain("/lists/{id}/items");
  expect(container.textContent).toContain("/analysis/spending");
  expect(document.body.classList.contains("dev")).toBe(true);
});

test("the page never says PWA and names no open-platform claim", () => {
  const { container } = page();
  expect(container.textContent).not.toMatch(/pwa|open platform/i);
  expect(container.textContent).toContain("Export anytime");
});

test("Copy puts the command on the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const { getByText } = page();
  fireEvent.click(getByText("Copy"));
  expect(writeText).toHaveBeenCalledWith(curlLine(location.origin));
});
