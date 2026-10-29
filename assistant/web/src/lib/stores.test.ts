import { itemHasData, setStoreRows, storeHasPictures, storeModel, storePhotos } from "./stores";

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
