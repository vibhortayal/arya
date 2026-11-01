import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { NavProvider } from "../app/nav";
import { ToastProvider } from "../ui/Toast";
import { OpsSettings } from "./OpsSettings";

/* Ops settings (owner, 2026-11-01): a limit saved on blur, Use default hands it back. */

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const data = {
  controls: { photo_reader: "wonder", spark_tier: "contributor", open_model: null, reasoning_effort: null },
  settings: {
    hourly_freeze_usd: { value: 3, default: 1, range: [0.1, 50], kind: "usd", label: "Hourly freeze", group: "account", note: "", set: true },
    monthly_ceiling_usd: { value: 5, default: 5, range: [1, 200], kind: "usd", label: "Monthly ceiling", group: "account", note: "", set: false },
  },
  overrides: {},
};
let calls: { url: string; body: any }[];
beforeEach(() => {
  window.scrollTo = vi.fn();
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string, init?: RequestInit) => {
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return json(init?.method === "POST" ? { ok: true } : data);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

test("the models page saves the photo reader and the Spark plan", async () => {
  render(<NavProvider><ToastProvider><OpsSettings /></ToastProvider></NavProvider>);
  await waitFor(() => expect($("os-reader")).toBeTruthy());
  // Contributor + Wonder: no photo warning yet.
  expect(document.body.textContent).not.toContain("Spark reads send receipt photos");
  fireEvent.change($("os-reader"), { target: { value: "auto" } });
  await waitFor(() => expect(calls.some(c => c.body?.photo_reader === "auto")).toBe(true));
  fireEvent.change($("os-tier"), { target: { value: "standard" } });
  await waitFor(() => expect(calls.some(c => c.body?.spark_tier === "standard")).toBe(true));
});
