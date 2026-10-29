import { storeHasData, storeModel, storePhotos } from "./stores";

test("store data keys on the squashed name, as quest.js qnorm did", () => {
  expect(storePhotos("Trader Joe's")).toBe("models/trader-joes/frames-web");
  expect(storePhotos("TRADER  JOES")).not.toBeNull();
  expect(storeModel("trader-joe's")).toBe("models/trader-joes/manifest.json");
  expect(storeHasData("Trader Joe's Market")).toBe(false);
  expect(storeHasData("")).toBe(false);
  expect(storePhotos(undefined)).toBeNull();
});
