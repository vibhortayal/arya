import { askChips } from "./Chat";
import { profileLine, receiptsSub } from "./Profile";

/* Relevant cards (owner 2026-10-30): Ask's starter chips come from the
 * household's data; Settings shows no zero scores. */

vi.mock("../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

describe("ask chips", () => {
  const today = new Date("2026-10-30T12:00:00");
  test("from the data, four at most", () => {
    const h = {
      as_of: "2026-10-27", running_low: [{ name: "Whole Milk" }], use_soon: [{}],
      list: { items: [{ item_id: "b", name: "Sourdough", on_list: true }] },
      price_by_store: { b: { A: { median: 5.2 }, B: { median: 5.6 } } },
    };
    expect(askChips(h, today)).toEqual(["Do I need Whole Milk?", "What should I use first?", "Where is Sourdough cheaper?", "What did I spend in October?"]);
  });
  test("a new account gets list-building chips", () => {
    expect(askChips({ lists: [{ name: "Costco" }] }, today)).toEqual(["Add milk and eggs to Costco", "How does Arya know what I need?"]);
    expect(askChips({}, today)[0]).toBe("Add eggs to my list");
    // No spend chip for last month's receipts.
    expect(askChips({ as_of: "2026-09-20" }, today)).not.toContain("What did I spend in October?");
  });
});

describe("settings", () => {
  const p = (points: number, streak?: number) => ({ handle: "x", level: 2, points, stats: { hunts: 1, streak_weeks: streak } });
  test("no zero scores", () => {
    expect(profileLine(p(0))).toBe("Your first quest earns Level 1");
    expect(profileLine(p(0, 26))).toBe("26 weeks of shopping with Arya");
    expect(profileLine(p(120, 3))).toBe("Level 2 · 120 points · 3-week streak");
  });
  test("receipts say who sees them", () => {
    expect(receiptsSub(0, null)).toBe("Only you see them");
    expect(receiptsSub(39, null)).toBe("39 receipts · only you see them");
    expect(receiptsSub(1, "Tayals")).toBe("1 receipt · only you and Tayals see them");
  });
});
