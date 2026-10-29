import { splitPreview } from "./Lists";
import { splitInput } from "./NewList";

/* Dictation into a list (phone pass 3, 2026-10-28): the List's add
 * preview and the plan's bag split a spoken sentence the way the
 * server does (api/list/intake.py split_list_text, pinned in
 * tests/test_phone_pass3.py). */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

describe("the List add preview", () => {
  test("a sentence becomes items, once each", () => {
    expect(splitPreview("I need some eggs, eggs, bananas, cookies, oranges.")).toEqual(["eggs", "bananas", "cookies", "oranges"]);
    expect(splitPreview("eggs and bananas and milk")).toEqual(["eggs", "bananas", "milk"]);
  });

  test("one dish name stays whole", () => {
    expect(splitPreview("mac and cheese")).toEqual(["mac and cheese"]);
    expect(splitPreview("salt and pepper")).toEqual(["salt and pepper"]);
  });

  test("a filler word is not an item", () => {
    expect(splitPreview("Oh, I need some eggs, potatoes, tomatoes, tomatoes, onions.")).toEqual(["eggs", "potatoes", "tomatoes", "onions"]);
  });
});

describe("the plan's bag", () => {
  test("a filler word and a lead are not items", () => {
    const got = splitInput("Oh, I need some eggs, potatoes, onions.");
    expect(got.map(s => s.toLowerCase())).toEqual(["eggs", "potatoes", "onions"]);
  });
});
