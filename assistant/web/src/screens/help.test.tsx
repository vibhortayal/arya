import { act, fireEvent, render, screen } from "@testing-library/react";
import en from "../i18n/en.json";
import { NavProvider, useNav } from "../app/nav";
import { GuideProvider } from "../ui/Guide";
import { TourProvider } from "../ui/Tour";
import { HELP_TOPICS } from "../guide/helpTopics";
import { TABS, VIEWS } from "../app/views";
import { Help } from "./Help";

/* The Help tab (owner pick A, 2026-10-31): six tabs with Help beside
 * Settings; topics are data with real en.json text; a topic opens, goes
 * back with Back, opens its feature, and "Still stuck?" and the ask box
 * send a question to Ask. */

beforeAll(() => { window.scrollTo = (() => {}) as typeof window.scrollTo; });

let nav!: ReturnType<typeof useNav>;
function Probe() { nav = useNav(); return <p data-testid="view">{nav.view}:{String(nav.params.ask ?? "")}</p>; }
const mount = () => render(
  <NavProvider initial="help"><TourProvider><GuideProvider><Probe /><Help /></GuideProvider></TourProvider></NavProvider>);

const get = (path: string): unknown => path.split(".").reduce<unknown>((d, p) => (d && typeof d === "object" ? (d as Record<string, unknown>)[p] : undefined), en);

describe("tab and topics", () => {
  test("Help is a view and a tab, next to Settings", () => {
    expect(VIEWS).toContain("help");
    expect(TABS).toEqual(["home", "list", "chat", "community", "help", "profile"]);
    expect(get("tabs.help")).toBe("Help");
  });
  test("every topic has its text, 2 to 4 steps, and opens a real view", () => {
    for (const tp of HELP_TOPICS) {
      const base = `help.topics.${tp.id}.`;
      for (const k of ["title", "sub", "body", "cta"]) expect(typeof get(base + k)).toBe("string");
      expect(tp.steps).toBeGreaterThanOrEqual(2);
      expect(tp.steps).toBeLessThanOrEqual(4);
      for (let i = 1; i <= tp.steps; i++) expect(typeof get(base + "s" + i)).toBe("string");
      for (let i = 1; i <= tp.notes; i++) expect(typeof get(base + "n" + i)).toBe("string");
      expect(get(base + "s" + (tp.steps + 1))).toBeUndefined();
      expect(VIEWS).toContain(tp.opens);
    }
  });
  test("a step stays a short sentence", () => {
    for (const tp of HELP_TOPICS) for (let i = 1; i <= tp.steps; i++) {
      const s = get(`help.topics.${tp.id}.s${i}`) as string;
      expect(s.split(/\s+/).length).toBeLessThanOrEqual(24);
    }
  });
});

describe("Help screen", () => {
  test("home lists the first steps and every how-to topic", () => {
    mount();
    expect(screen.getByRole("heading", { name: "Help" })).toBeTruthy();
    for (const tp of HELP_TOPICS) expect(document.querySelector(`[data-topic="${tp.id}"]`)).toBeTruthy();
    expect(HELP_TOPICS.filter(x => x.group === "start").map(x => x.id)).toEqual(["receipt", "additem", "ask"]);
  });
  test("a topic shows numbered steps; Back returns to Help", () => {
    mount();
    fireEvent.click(document.querySelector('[data-topic="map"]')!);
    expect(screen.getByRole("heading", { name: "Map my store" })).toBeTruthy();
    expect(document.querySelectorAll("ol.steps li")).toHaveLength(4);
    fireEvent.click(document.getElementById("help-back")!);
    expect(document.querySelector('[data-topic="map"]')).toBeTruthy();
  });
  test("the feature button opens the feature", () => {
    mount();
    fireEvent.click(document.querySelector('[data-topic="map"]')!);
    fireEvent.click(document.getElementById("help-open")!);
    expect(screen.getByTestId("view").textContent).toBe("mapper:");
  });
  test("Still stuck? sends a question to Ask", () => {
    mount();
    fireEvent.click(document.querySelector('[data-topic="map"]')!);
    fireEvent.click(document.getElementById("help-stuck")!);
    expect(screen.getByTestId("view").textContent).toBe("chat:Help me with: Map my store");
  });
  test("the ask box sends what you typed; empty text cannot be sent", () => {
    mount();
    const send = document.querySelector("#help-ask button[type=submit]") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(document.getElementById("help-q")!, { target: { value: "how do I share my list" } });
    expect(send.disabled).toBe(false);
    act(() => { fireEvent.submit(document.getElementById("help-ask")!); });
    expect(screen.getByTestId("view").textContent).toBe("chat:how do I share my list");
  });
  test("a sample question is sent as is", () => {
    mount();
    fireEvent.click(screen.getByText("How do I map my store?"));
    expect(screen.getByTestId("view").textContent).toBe("chat:How do I map my store?");
  });
});
