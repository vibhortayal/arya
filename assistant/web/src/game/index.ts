/* Public face of the game folder. Load it lazily:
 *   const QuestGame = lazy(() => import("./game"));
 * and give it a QuestSource and a ProfileStore (see README.md). */
export { default } from "./QuestGame";
export type { QuestGameProps } from "./QuestGame";
export type { QuestSource, FieldReport } from "./core/source";
export { SampleSource } from "./core/source";
export { localProfileStore, type ProfileStore } from "./store";
export { setAssetResolver } from "./assets";
