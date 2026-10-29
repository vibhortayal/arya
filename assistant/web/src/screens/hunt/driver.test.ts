import { setStoreRows } from "../../lib/stores";
import { resolveDriver } from "../Hunt";

/* One store view, picked by the store, as the plain-JS app's node
 * harness ran quest.js qResolveDriver (tests/test_photo_driver.py
 * TestPhotoMappingNode.test_driver_resolution_defaults). */

vi.mock("../../app/session", () => ({ useSession: () => ({ demo: false }), clearOnSignOut: () => {} }));

/* No store ships with a photo walk any more (2026-10-29); a row
 * with one stands in for a store that has one. */
const TJ = "Walk Store", CS = "Corner Store";
const WALK = { store: TJ, key: "walkstore", photos: "models/walk/frames", model: "models/walk/manifest.json", has_pictures: true };
const sess = (store: string, mode = "quest") => ({ id: "s", store, mode, state: "playing", items: [] }) as any;

describe("the store view", () => {
  beforeEach(() => setStoreRows([WALK]));

  test("a mapped store opens on its photos; an unmapped one on the drawing, or cards in Express", () => {
    expect(resolveDriver(sess(TJ), false)).toBe("photo");
    expect(resolveDriver(sess(CS), false)).toBe("art");
    expect(resolveDriver(sess(CS, "express"), false)).toBe("strip");
  });

  test("an old stored view choice is ignored", () => {
    try { localStorage.setItem("arya-scene-driver", "aisle"); } catch { /* none */ }
    expect(resolveDriver(sess(TJ), false)).toBe("photo");
    try { localStorage.removeItem("arya-scene-driver"); } catch { /* none */ }
  });

  test("the 3D peek needs a model; without one the view stays", () => {
    expect(resolveDriver(sess(TJ), true)).toBe("cloud");
    expect(resolveDriver(sess(CS), true)).toBe("art");
  });
});
