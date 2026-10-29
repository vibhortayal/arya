import { itemHasData, setStoreRows, storeAt, storeHasPictures, storeModel, storePhotos } from "./stores";

test("store data keys on the squashed name, as quest.js qnorm did", () => {
  setStoreRows([]);
  expect(storePhotos("Trader Joe's")).toBe("models/trader-joes/frames-web");
  expect(storePhotos("TRADER  JOES")).not.toBeNull();
  expect(storeModel("trader-joe's")).toBe("models/trader-joes/manifest.json");
  expect(storeHasPictures("Trader Joe's Market")).toBe(false);
  expect(storeHasPictures("")).toBe(false);
  expect(storePhotos(undefined)).toBeNull();
});

test("the server's list adds mapped stores and keeps Trader Joe's", () => {
  setStoreRows([{ store: "Costco", key: "costco", photos: null, model: null, has_pictures: true }]);
  expect(storeHasPictures("Costco")).toBe(true);
  expect(storePhotos("Costco")).toBeNull();
  expect(storeHasPictures("Trader Joe's")).toBe(true);
  setStoreRows([]);
  expect(storeHasPictures("Costco")).toBe(false);
});

test("an item has data only with store pictures and a shelf match", () => {
  setStoreRows([]);
  expect(itemHasData("Trader Joe's", { shelf_u: 0.4 })).toBe(true);
  expect(itemHasData("Trader Joe's", { shelf_u: 0 })).toBe(true);
  expect(itemHasData("Trader Joe's", { shelf_u: null })).toBe(false);
  expect(itemHasData("Trader Joe's", {})).toBe(false);
  expect(itemHasData("Costco", { shelf_u: 0.4 })).toBe(false);
});

describe("store pictures per location", () => {
  test("a walk's photos show only at the store it was filmed in", () => {
    setStoreRows([{ store: "Trader Joe's", key: "traderjoes", location: "tj-1", captured_at: ["tj-3"] }]);
    expect(storePhotos("Trader Joe's", "tj-1")).toBe("models/trader-joes/frames-web");
    expect(storePhotos("Trader Joe's", "tj-2")).toBeNull();
    expect(storeHasPictures("Trader Joe's", "tj-2")).toBe(false);
    // Another location with its own captures has pictures, but not the walk.
    expect(storeHasPictures("Trader Joe's", "tj-3")).toBe(true);
    expect(storeAt("Trader Joe's", "tj-3")?.model).toBeNull();
    // No store id: the chain's answer.
    expect(storePhotos("Trader Joe's")).toBe("models/trader-joes/frames-web");
  });

  test("a walk filmed nowhere known shows at no location", () => {
    setStoreRows([{ store: "Trader Joe's", key: "traderjoes", location: null, captured_at: [] }]);
    expect(storePhotos("Trader Joe's", "tj-1")).toBeNull();
  });

  test("a store without a walk is unchanged", () => {
    setStoreRows([{ store: "Costco", key: "costco", photos: null, model: null, has_pictures: true }]);
    expect(storeHasPictures("Costco", "c-1")).toBe(true);
  });
});
