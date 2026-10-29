import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { t, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-stores-mine and quest.js renderMyStores
 * (+ the data-fav / data-remove handlers). The Shell already renders
 * <section id="view-stores-mine">; no second one. */

export type MyStore = { id: string; name: string; street: string; city: string; state: string; zip: string;
  scene?: string; favorite?: boolean };

/* Scene names are en.json keys. */
const SCENE_LABEL: Record<string, string> = { cloud: "storesMine.scene.cloud", strip: "storesMine.scene.strip" };

export function StarSvg({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  );
}

/* quest.js qStoreMeta */
export const storeMeta = (s: MyStore) =>
  `${s.street}, ${s.city}, ${s.state} ${s.zip} · ${(s.scene && SCENE_LABEL[s.scene] && t(SCENE_LABEL[s.scene])) || ""}`;

export function StoresMine() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [mine, setMine] = useState<MyStore[] | null>(null);

  const load = useCallback(async () => {
    const d = await get("/api/stores/mine").catch(() => ({ stores: [] }));
    setMine(d.stores || []);
  }, []);
  useEffect(() => { load().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (path: string, body: object, msg: string) => {
    try {
      await post(path, body);
      await load().catch(() => {});
      toast(msg);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  const row = (s: MyStore) => (
    <div className="row" key={s.id}>
      <div className="grow"><span className="name">{s.name}</span>
        <span className="sub">{storeMeta(s)}</span></div>
      <button className="chip" data-remove={s.id} type="button"
        onClick={() => act("/api/stores/mine/remove", { store_id: s.id }, t("storesMine.removed"))}>{t("common.remove")}</button>
      <button className={"starbtn " + (s.favorite ? "on" : "")} data-fav={s.id} data-on={String(!!s.favorite)}
        aria-pressed={!!s.favorite} aria-label={s.favorite ? t("common.fav.remove") : t("common.fav.add")} type="button"
        onClick={() => act("/api/stores/favorite", { store_id: s.id, favorite: !s.favorite },
          !s.favorite ? t("common.fav.added") : t("common.fav.removed"))}>
        <StarSvg filled={!!s.favorite} />
      </button>
    </div>
  );

  const favs = (mine || []).filter(s => s.favorite);
  const rest = (mine || []).filter(s => !s.favorite);

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("storesMine.myStores")}</h2>
      <div id="sm-list">
        {mine && !mine.length && <div className="group"><Empty>{t("storesMine.noStoresYetFindOne")}</Empty></div>}
        {favs.length > 0 && <><h3 className="sect">{t("common.favorites")}</h3><div className="group">{favs.map(row)}</div></>}
        {rest.length > 0 && <><h3 className="sect">{t("storesMine.allMyStores")}</h3><div className="group">{rest.map(row)}</div></>}
      </div>
      <div className="group">
        <button className="navrow" type="button" onClick={() => nav.show("stores-find")}><span className="grow">{t("common.findStores")}<span className="sub">{t("storesMine.searchTheDirectoryByZip")}</span></span><span className="chev">›</span></button>
        <button className="navrow" type="button" onClick={() => nav.show("stores-add")}><span className="grow">{t("common.addAStore")}<span className="sub">{t("storesMine.aStoreThatIsNot")}</span></span><span className="chev">›</span></button>
      </div>
    </>
  );
}
