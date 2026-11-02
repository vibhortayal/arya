import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider } from "../ui/Toast";
import { ConfirmForm, PerishSheet } from "./Today";

/* "Pick date" (owner phone test 2026-11-02): the picker stays open while
 * you choose (iPhone fills in today as the wheel opens; the input must
 * not be swapped out under it), and a past date is refused. */
vi.mock("../app/session", () => ({ useSession: () => ({ demo: false, user: "t@x.y", currency: { code: "USD", symbol: "$" } }), clearOnSignOut: () => {} }));

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const perish = { receipt_id: "r1", store: "Costco", date: "2026-10-30", items: [{ item_id: "milk", name: "Milk" }] };
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

beforeEach(() => {
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const sheet = () => render(<ToastProvider><PerishSheet open perish={perish} demo={false} onClose={() => {}} onMore={() => {}} reload={() => {}} /></ToastProvider>);
const dateInput = () => document.querySelector<HTMLInputElement>('[data-pz="milk"] input[type="date"]')!;

test("Use-by sheet: the date input stays the same element once a date is set", () => {
  sheet();
  const before = dateInput();
  expect(before.min).toBe(isoToday());
  fireEvent.change(before, { target: { value: isoToday() } });
  expect(before.isConnected).toBe(true);   // not swapped out, so the phone's picker stays open
  expect(dateInput()).toBe(before);
  fireEvent.change(before, { target: { value: shift(3) } });
  expect(dateInput()).toBe(before);
  expect(document.querySelector('[data-pz="milk"] .pz-date')).not.toBeNull();
});

test("Use-by sheet: a past date is refused with a note", async () => {
  sheet();
  fireEvent.change(dateInput(), { target: { value: shift(-2) } });
  expect(await screen.findByText("That date has passed. Pick today or a later date.")).toBeTruthy();
  expect(document.querySelector('[data-pz="milk"] .pz-date')).toBeNull();
  expect(screen.getByText("Pick date")).toBeTruthy();
});

test("Expiry form: min is today and a past date is refused", () => {
  const onError = vi.fn();
  render(<ConfirmForm ex={{ k: "type", opts: [{ id: "milk", name: "Milk", tag: "" }] } as never} onSaved={() => {}} onError={onError} />);
  const inp = document.querySelector<HTMLInputElement>("#ex-date")!;
  expect(inp.min).toBe(isoToday());
  fireEvent.change(inp, { target: { value: shift(-1) } });
  expect(onError).toHaveBeenCalledWith("That date has passed. Pick today or a later date.");
  fireEvent.change(inp, { target: { value: shift(2) } });
  expect(inp.value).toBe(shift(2));
});
