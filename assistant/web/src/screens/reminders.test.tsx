import { act, render } from "@testing-library/react";
import { Reminders } from "./Profile";

/* Reminders switched off on the server: the row stays in Settings,
 * greyed, with a plain line (owner, 2026-11-01), so people can find it. */
let cfg: unknown = { enabled: false, notice_days: 2, subscribed: false };
vi.mock("../lib/api", async orig => ({
  ...(await orig<typeof import("../lib/api")>()),
  get: async () => cfg,
}));

beforeAll(() => { window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia; });

const mount = async () => {
  render(<Reminders />);
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
};

test("off on the server: a greyed Remind me row with a disabled switch", async () => {
  await mount();
  const box = document.getElementById("pf-reminders")!;
  expect(box.hidden).toBe(false);
  expect(box.className).toContain("rem-off");
  expect(box.textContent).toContain("Reminders aren't switched on yet");
  expect((document.getElementById("rem-switch") as HTMLButtonElement).disabled).toBe(true);
  expect(document.getElementById("rem-test")).toBeNull();
});

test("on: the live switch, no greyed line", async () => {
  cfg = { enabled: true, notice_days: 2, subscribed: false, public_key: "x" };
  await mount();
  const box = document.getElementById("pf-reminders")!;
  expect(box.className).not.toContain("rem-off");
  expect(box.textContent).not.toContain("switched on yet");
});
