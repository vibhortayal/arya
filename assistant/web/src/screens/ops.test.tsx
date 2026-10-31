import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "../i18n";
import { ToastProvider } from "../ui/Toast";
import { Ops } from "./Ops";

/* Ops (owner approved the mock 2026-10-31): "Needs a look" only when
 * something needs it, a confirm before pausing every paid read, and the
 * switches post to the owner routes. */

const base = () => ({
  updated: Math.floor(Date.now() / 1000), needs: [],
  box: { disk_free_gb: 31, disk_total_gb: 45, disk_ok: true, backup: { hours: 6, ok: true } },
  spend: { app: { spent: 0.42, cap: 10 }, demo: { spent: 14.1, cap: 20 }, credit: { left: 109, total: 150 } },
  calls: [{ key: "reads", label: "Photo and receipt reads", calls: 42, failed: 3, usd: 1.2, p95_ms: 6100, bad: true, errs: {} }],
  frozen: [],
  controls: { ai_paused: false, demo_live: true, photo_reader: "spark", registration_open: false },
  people: { accounts: 4, top: [["ann@x", 0.18]], waitlist: 4, feedback_new: 2 },
});
let data: any;
const posts: [string, unknown][] = [];
vi.mock("../lib/api", async () => ({
  ...(await vi.importActual<object>("../lib/api")),
  get: async () => data,
  post: async (path: string, body: unknown) => { posts.push([path, body]); return {}; },
}));
vi.mock("../app/nav", () => ({ useNav: () => ({ key: 1, back: () => {}, show: () => {} }) }));

afterEach(() => { cleanup(); posts.length = 0; });
const page = () => render(<ToastProvider><Ops /></ToastProvider>);

test("a quiet day has no Needs a look section", async () => {
  data = base();
  const { container } = page();
  await waitFor(() => expect(container.textContent).toContain("Spend today"));
  expect(container.textContent).not.toContain("Needs a look");
  expect(container.textContent).toContain("$0.42 of $10.00");
  expect(container.textContent).toContain("7% failed");
});

test("a frozen account has an Unfreeze button that posts to the owner route", async () => {
  data = { ...base(), needs: [{ title: "priya is frozen", sub: "$1.40 in one hour. Back in 19 h.", freeze: "priya" }] };
  const { container, getByText } = page();
  await waitFor(() => expect(container.textContent).toContain("priya is frozen"));
  fireEvent.click(getByText("Unfreeze"));
  await waitFor(() => expect(posts).toContainEqual(["/api/usage/unfreeze", { user: "priya" }]));
});

test("pausing asks first, and only the confirm posts", async () => {
  data = base();
  const { container, getByText } = page();
  await waitFor(() => expect(container.querySelector("#ops-pause")).toBeTruthy());
  fireEvent.click(container.querySelector("#ops-pause")!);
  expect(posts).toHaveLength(0);
  expect(container.querySelector("#ops-pause-confirm")).toBeTruthy();
  fireEvent.click(getByText("Pause reads"));
  await waitFor(() => expect(posts).toContainEqual(["/api/ops/controls", { ai_paused: true }]));
});

test("the photo reader and demo switches post their own keys", async () => {
  data = base();
  const { container } = page();
  await waitFor(() => expect(container.querySelector("#ops-reader")).toBeTruthy());
  fireEvent.change(container.querySelector("#ops-reader")!, { target: { value: "wonder" } });
  await waitFor(() => expect(posts).toContainEqual(["/api/ops/controls", { photo_reader: "wonder" }]));
  fireEvent.click(container.querySelector("#ops-demo")!);
  await waitFor(() => expect(posts).toContainEqual(["/api/ops/controls", { demo_live: false }]));
  fireEvent.click(container.querySelector("#ops-registration")!);
  await waitFor(() => expect(posts).toContainEqual(["/auth/registration", { open: true }]));
});
