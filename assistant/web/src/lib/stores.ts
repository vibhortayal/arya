/* Stores Arya has real data for (quest.js STORE_PHOTOS, STORE_MODELS):
 * squashed store name -> the photo walk / 3D model inside the PWA.
 * One place, so the store picker and the session's driver agree. */

const squash = (store: unknown) => String(store || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

const STORE_PHOTOS: Record<string, string> = { traderjoes: "models/trader-joes/frames-web" };
const STORE_MODELS: Record<string, string> = { traderjoes: "models/trader-joes/manifest.json" };

/* quest.js qStorePhotos: the store's photo-walk frames, or null. */
export const storePhotos = (store: unknown): string | null => STORE_PHOTOS[squash(store)] || null;
/* quest.js qStoreModel: the store's 3D model manifest, or null. */
export const storeModel = (store: unknown): string | null => STORE_MODELS[squash(store)] || null;
/* A photo walk or a 3D model: what the demo's store lists keep. */
export const storeHasData = (store: unknown): boolean => !!(storePhotos(store) || storeModel(store));
