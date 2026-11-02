import { fireEvent, render } from "@testing-library/react";
import { ListeningCard } from "./Listening";

/* The Listening card (owner, 2026-11-01): one Stop and send plus Cancel,
 * a timer and moving bars; "Got it, reading…" while words come back. */
test("listening: one Stop and send, Cancel, a timer and bars", () => {
  const stop = vi.fn(), cancel = vi.fn();
  render(<ListeningCard capture={{ stop: () => new Blob(), cancel: () => {}, level: () => 0.5 }} onStop={stop} onCancel={cancel} />);
  const card = document.querySelector(".listencard")!;
  expect(card.textContent).toContain("Listening…");
  expect(card.textContent).toContain("0:00");
  expect(card.querySelectorAll(".lc-bars i").length).toBe(18);
  const btns = card.querySelectorAll("button");
  expect(Array.from(btns).map(b => b.textContent)).toEqual(["Cancel", "Stop and send"]);
  fireEvent.click(card.querySelector('[data-listen="stop"]')!);
  fireEvent.click(card.querySelector('[data-listen="cancel"]')!);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledTimes(1);
});

test("reading: no buttons, says Got it, reading…", () => {
  render(<ListeningCard capture={null} reading onStop={() => {}} onCancel={() => {}} />);
  const card = document.querySelector(".listencard.reading")!;
  expect(card.textContent).toContain("Got it, reading…");
  expect(card.querySelectorAll("button").length).toBe(0);
});
