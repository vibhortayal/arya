import { demoDateNote } from "./AddReceiptSheet";

/* Demo only (owner, 2026-11-04): an earlier-dated receipt the demo accepted says so on screen. */
describe("demo receipt date note", () => {
  test("names the date and says a real account would not allow it", () => {
    const m = demoDateNote({ demo_date_waived: "2026-11-03" }) || "";
    expect(m).toMatch(/^Demo only: this receipt is dated /);
    expect(m).toContain("In a real account, Arya would flag it and not count it.");
  });
  test("nothing for a normal trip", () => {
    expect(demoDateNote({})).toBeNull();
    expect(demoDateNote(null)).toBeNull();
  });
});
