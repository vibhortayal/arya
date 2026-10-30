import { addToast } from "./Lists";

/* Lists usability test 2026-10-30: an add that changed nothing on
 * screen still says why, by name (back from Checked off, moved here,
 * already on a list). */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

describe("add toast", () => {
  test("names what was added", () => {
    expect(addToast({ added: 3, names: ["eggs", "bread", "bananas"] }, "Costco")).toBe("Added eggs, bread, bananas to Costco.");
    expect(addToast({ added: 5, names: ["a", "b", "c", "d", "e"] }, "Costco")).toBe("Added a, b and 3 more to Costco.");
  });
  test("back from Checked off, moved here, already on a list", () => {
    expect(addToast({ added: 1, names: ["basil"], back: ["basil"] }, "your list")).toBe("basil is back on the list.");
    expect(addToast({ added: 1, names: ["eggs"], moved: [{ name: "eggs", from: "Costco" }] }, "Trader Joe's"))
      .toBe("eggs moved here from Costco.");
    expect(addToast({ added: 0, already: 1, names: ["milk"], already_names: [{ name: "milk", list: "Trader Joe's" }] }, "your list"))
      .toBe("milk is already on Trader Joe's.");
    expect(addToast({ added: 0, already: 1, names: ["milk"], already_names: [{ name: "milk", list: "" }] }, "your list"))
      .toBe("milk is already on Everything else.");
  });
  test("mixed, with what was left out", () => {
    expect(addToast({ added: 2, names: ["figs", "milk", "kale"], already_names: [{ name: "milk", list: "Costco" }], back: ["kale"], skipped: ["42"] }, "Costco"))
      .toBe("Added figs to Costco. kale is back on the list. milk is already on Costco. Left out (not items): 42.");
  });
  test("an older server without names keeps the count", () => {
    expect(addToast({ added: 2 }, "Costco")).toBe("Added 2 items to Costco.");
  });
});

test("nothing added with pieces left out says why, not 'Added 0 items'", () => {
  expect(addToast({ added: 0, skipped: ["organic organic organic orga"] }, "Costco")).toMatch(/^Nothing added\./);
  expect(addToast({ added: 0 }, "Costco")).toBe("Added 0 items to Costco.");
});
