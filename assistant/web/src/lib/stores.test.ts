import { itemHasData, setStoreRows, storeAt, storeHasPictures, storeModel, storePhotos } from "./stores";

test("no store ships with pictures", () => {
  setStoreRows([]);
  expect(storePhotos("Trader Joe's")).toBeNull();
  expect(storeModel("Trader Joe's")).toBeNull();
  expect(storeHasPictures("Trader Joe's")).toBe(false);
  expect(storeHasPictures("")).toBe(false);
  expect(storePhotos(undefined)).toBeNull();
});

test("the server's list keys on the squashed name", () => {
  setStoreRows([{ store: "Costco", key: "costco", photos: null, model: null, has_pictures: true }]);
  expect(storeHasPictures("Costco")).toBe(true);
  expect(storeHasPictures("COSTCO ")).toBe(true);
  expect(storePhotos("Costco")).toBeNull();
  setStoreRows([]);
  expect(storeHasPictures("Costco")).toBe(false);
});

test("an item has data only with store pictures and a shelf match", () => {
  setStoreRows([{ store: "Costco", key: "costco", photos: null, model: null, has_pictures: true }]);
  expect(itemHasData("Costco", { shelf_u: 0.4 })).toBe(true);
  expect(itemHasData("Costco", { shelf_u: 0 })).toBe(true);
  expect(itemHasData("Costco", { shelf_u: null })).toBe(false);
  expect(itemHasData("Costco", {})).toBe(false);
  expect(itemHasData("Trader Joe's", { shelf_u: 0.4 })).toBe(false);
});

describe("store pictures per location", () => {
  test("captures show only at the location they were taken", () => {
    setStoreRows([{ store: "Trader Joe's", key: "traderjoes", photos: null, model: null, has_pictures: true,
      location: null, captured_at: ["tj-3"] }]);
    expect(storeHasPictures("Trader Joe's", "tj-3")).toBe(true);
    expect(storeHasPictures("Trader Joe's", "tj-2")).toBe(false);
    expect(storeAt("Trader Joe's", "tj-3")?.model).toBeNull();
    // No store id: the chain's answer.
    expect(storeHasPictures("Trader Joe's")).toBe(true);
  });

  test("a chain-wide map shows at every location", () => {
    setStoreRows([{ store: "Costco", key: "costco", photos: null, model: null, has_pictures: true }]);
    expect(storeHasPictures("Costco", "c-1")).toBe(true);
  });
});
