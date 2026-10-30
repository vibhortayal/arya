import { render, cleanup, waitFor } from "@testing-library/react";
import "../i18n";
import { ToastProvider } from "../ui/Toast";
import { Usage } from "./Usage";

/* Keeping Arya running (owner approved the mock 2026-10-30): lifetime
 * first, no limit bar, the heads-up and pause notes only when the server
 * says so, and the whole-Arya totals only when the server sends them. */

const kinds = (reads = 0, ask = 0) => ({
  reads: { n: reads, usd: reads * 0.1 }, ask: { n: ask, usd: ask * 0.01 },
  maps: { n: 0, usd: 0 }, helps: { n: 0, usd: 0 },
});
let data: any;
vi.mock("../lib/api", async () => ({ ...(await vi.importActual<object>("../lib/api")), get: async () => data }));
vi.mock("../app/nav", () => ({ useNav: () => ({ key: 1, back: () => {} }) }));

afterEach(cleanup);
const page = () => render(<ToastProvider><Usage /></ToastProvider>);

test("shows lifetime as the headline, this month under it, and where it went", async () => {
  data = { lifetime_usd: 2.4, month_usd: 0.62, since: "2026-09-25", kinds: kinds(19, 52), heavy: false, paused: false, whole: null };
  const { container } = page();
  await waitFor(() => expect(container.querySelector("#us-lifetime")?.textContent).toBe("$2.40"));
  expect(container.querySelector("#us-month")?.textContent).toBe("$0.62");
  expect(container.textContent).toContain("Receipts and photos");
  expect(container.textContent).toContain("19 times");
  expect(container.textContent).not.toContain("Store maps and Quest");   // nothing used, no row
  expect(container.querySelector("#us-heavy")).toBeNull();
  expect(container.querySelector("#us-paused")).toBeNull();
  expect(container.textContent).not.toContain("Arya as a whole");
});

test("a new account sees a calm empty state", async () => {
  data = { lifetime_usd: 0, month_usd: 0, since: "", kinds: kinds(), heavy: false, paused: false, whole: null };
  const { container } = page();
  await waitFor(() => expect(container.textContent).toContain("Nothing yet"));
  expect(container.querySelector("#us-month")).toBeNull();
});

test("the heads-up and the pause notice show only when the server says so", async () => {
  data = { lifetime_usd: 4, month_usd: 3.2, since: "2026-10-01", kinds: kinds(5), heavy: true, paused: false, whole: null };
  const a = page();
  await waitFor(() => expect(a.container.querySelector("#us-heavy")).toBeTruthy());
  cleanup();
  data = { ...data, paused: true };
  const b = page();
  await waitFor(() => expect(b.container.querySelector("#us-paused")).toBeTruthy());
  expect(b.container.querySelector("#us-heavy")).toBeNull();
});

test("the whole-Arya totals appear when sent", async () => {
  data = { lifetime_usd: 1, month_usd: 1, since: "2026-10-01", kinds: kinds(2), heavy: false, paused: false,
    whole: { usd: 142, people: 318, average_usd: 0.45, paid_by: "Hackathon credits" } };
  const { container } = page();
  await waitFor(() => expect(container.textContent).toContain("Arya as a whole, so far"));
  expect(container.textContent).toContain("Paid by Hackathon credits");
  expect(container.textContent).toContain("$142.00");
  expect(container.textContent).toContain("318");
});
