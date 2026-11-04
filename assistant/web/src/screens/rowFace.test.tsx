import { render, fireEvent, cleanup } from "@testing-library/react";
import { Face } from "./rowFace";
import todaySrc from "./Today.tsx?raw";

vi.mock("../lib/characters", () => ({ charFor: (n: unknown) => (n === "Milk" ? "milk.webp" : null) }));

afterEach(cleanup);

/* Owner, 2026-11-04: "clicking the characters on all cards should open
 * the same link as the text". */
test("a picture with onOpen opens the item, outside the tab order", () => {
  const onOpen = vi.fn();
  const { container } = render(<Face name="Milk" onOpen={onOpen} />);
  const a = container.querySelector("a.facelink")!;
  expect(a.getAttribute("tabindex")).toBe("-1");
  expect(a.getAttribute("aria-hidden")).toBe("true");
  fireEvent.click(container.querySelector("img.rowface")!);
  expect(onOpen).toHaveBeenCalledTimes(1);
});

test("without onOpen it is a plain picture; no character, nothing", () => {
  expect(render(<Face name="Milk" />).container.querySelector("a")).toBeNull();
  expect(render(<Face name="Zzz" onOpen={() => {}} />).container.innerHTML).toBe("");
});

test("Today's Running low picture opens the same item page as its name", () => {
  expect(todaySrc).toContain(`<Face name={i.name} onOpen={() => nav.show("item", { id: String(i.item_id) })} />`);
});
