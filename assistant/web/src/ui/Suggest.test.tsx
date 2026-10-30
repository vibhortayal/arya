import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestDrop, lastSegment, replaceLast } from "./Suggest";

test("only the last item is completed and replaced", () => {
  expect(lastSegment("eggs; ban")).toBe("ban");
  expect(lastSegment("milk")).toBe("milk");
  expect(replaceLast("eggs; ban", "Bananas")).toBe("eggs; Bananas");
  expect(replaceLast("ban", "Bananas")).toBe("Bananas");
});

test("rows are grouped yours, shared, guesses; a tap picks; the typed part is bold", () => {
  const picked: string[] = [];
  const rows = [
    { name: "Jasmine Rice 10 lb", kind: "yours" as const, tag: "On this list" },
    { name: "Jasmine Rice", kind: "shared" as const, tag: "" },
    { name: "Basmati Rice", kind: "guess" as const, tag: "" },
  ];
  render(<SuggestDrop rows={rows} idx={1} q="jasm" onPick={n => picked.push(n)} />);
  const heads = [...document.querySelectorAll(".ghead")].map(h => h.textContent);
  expect(heads).toEqual(["From your lists", "Popular with Arya shoppers", "Arya guesses"]);
  const opts = screen.getAllByRole("option");
  expect(opts.map(o => o.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
  expect(opts[0].className).toContain("dim");
  expect(opts[0].querySelector("b")?.textContent).toBe("Jasm");
  fireEvent.click(opts[2]);
  expect(picked).toEqual(["Basmati Rice"]);
});

test("no rows, no dropdown", () => {
  const { container } = render(<SuggestDrop rows={[]} idx={-1} q="x" onPick={() => {}} />);
  expect(container.innerHTML).toBe("");
});
