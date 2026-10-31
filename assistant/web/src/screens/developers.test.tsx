import { render, fireEvent, cleanup } from "@testing-library/react";
import "../i18n";
import en from "../i18n/en.json";
import { ToastProvider } from "../ui/Toast";
import { Developers, GROUPS, SECTIONS, REF_PATH, curlLine, samples, isDevelopersPath } from "./Developers";

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

test("the language tabs change the example and what Copy puts on the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const { getByText, getByRole, container } = page();
  fireEvent.click(getByRole("tab", { name: "Python" }));
  expect(container.querySelector(".devcode")?.textContent).toBe(samples(location.origin).python);
  fireEvent.click(getByText("Copy"));
  expect(writeText).toHaveBeenCalledWith(samples(location.origin).python);
  fireEvent.click(getByRole("tab", { name: "JavaScript" }));
  expect(container.querySelector(".devcode")?.textContent).toBe(samples(location.origin).js);
});

test("every section on the side list is on the page", () => {
  const { container } = page();
  for (const id of SECTIONS) expect(container.querySelector("#" + id), id).toBeTruthy();
  expect(container.querySelectorAll(".devnav a").length).toBe(SECTIONS.length);
});

test("search narrows the endpoint list and says when nothing matches", () => {
  const { container, getByLabelText } = page();
  const box = getByLabelText("Search endpoints");
  fireEvent.change(box, { target: { value: "receipts" } });
  const paths = [...container.querySelectorAll(".devpath")].map(e => e.textContent);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.every(p => /receipts/.test(p || ""))).toBe(true);
  fireEvent.change(box, { target: { value: "zzzz" } });
  expect(container.querySelectorAll(".devrow").length).toBe(0);
  expect(container.textContent).toContain("No endpoint matches that.");
});

test("the interactive reference is linked", () => {
  const { container } = page();
  expect(container.querySelector(`a[href="${REF_PATH}"]`)).toBeTruthy();
});

test("using a link on the side list marks that section", () => {
  const { container } = page();
  const link = container.querySelector('.devnav a[href="#n"]') as HTMLElement;
  fireEvent.click(link);
  expect(link.getAttribute("aria-current")).toBe("true");
});
