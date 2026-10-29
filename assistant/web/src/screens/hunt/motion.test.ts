import { Q } from "./model";
import { M, anchorToU, stepAnchorTo } from "./motion";

/* Where am I? and the step anchor, as the plain-JS app's node harness
 * ran quest.js qAnchorToU. */

function hunt() {
  return {
    id: "s1", store: "Trader Joe's", mode: "quest", state: "playing", started_at: Date.now(),
    items: [
      { name: "A", qty: 1, checked: false, shelf_u: 0.0, shelfLabel: "Start Shelf" },
      { name: "B", qty: 1, checked: false, shelf_u: 0.3, shelfLabel: "Mid Shelf" },
      { name: "C", qty: 1, checked: false, shelf_u: 0.6, shelfLabel: "Pasta Shelf" },
      { name: "D", qty: 1, checked: false, shelf_u: 1.0, shelfLabel: "End Shelf" }],
  } as any;
}

describe("Where am I?", () => {
  let progress: number | null;
  let walks: number[];
  beforeEach(() => {
    progress = null; walks = [];
    Q.current = hunt();
    Q.scene = { setProgress(u: number) { progress = u; } } as any;
  });
  afterEach(() => { Q.current = null; Q.scene = null; });

  test("the anchor jumps the view, snaps to the nearest stop and resumes following", () => {
    Q.followHold = true; // the user had grabbed control
    M.stepsHold = true;
    const idx = anchorToU(0.58, i => walks.push(i));
    expect(idx).toBe(2);
    expect(progress).toBe(0.58);
    expect(Q.followHold).toBe(false);
    expect(Q.focusIdx).toBe(2);
    expect(walks).toEqual([2]);
    expect(M.stepU).toBe(0.58);
    expect(M.stepAnchorU).toBe(0.58);
    expect(M.stepsHold).toBe(false);
  });

  test("anchored at a stop already in the basket: the next open stop ahead", () => {
    Q.current!.items[2].checked = true;
    anchorToU(0.58, i => walks.push(i));
    expect(Q.focusIdx).toBe(3);
    expect(walks).toEqual([3]);
  });

  test("a collect re-anchors the step counter at that stop", () => {
    M.stepsHold = true;
    stepAnchorTo("B");
    expect(M.stepAnchorU).toBe(0.3);
    expect(M.stepU).toBe(0.3);
    expect(M.stepsHold).toBe(false);
  });
});
