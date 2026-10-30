import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { StoreSearch, useStoreSearch } from "../ui/StoreFinder";
import { get, post } from "../lib/api";
import { storeMeta, type MyStore } from "./StoresMine";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-stores-find and quest.js renderFindStores.
 * The Shell already renders <section id="view-stores-find">. */

type Found = MyStore & { in_mine?: boolean };
type Filter = "all" | "quests";

/* The store search and add: the directory (Add) and Google's
 * suggestions. One flow, used by Find stores and wherever a screen
 * needs a store the shopper does not have yet (Teach Arya your store,
 * Quest's Build a store). onAdded: a store just joined My stores. */
export function FindStorePanel({ onAdded }: { onAdded?: (name: string) => void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Found[] | null>(null);
  const search = useStoreSearch(row => {
    toast(t("storesFind.inYourStores", { name: row.name }));
    if (onAdded) onAdded(row.name); else nav.show("stores-mine");
  });
  const q = search.q.trim();

  const load = useCallback(async (query: string, f: Filter) => {
    try {
      const d = await get(`/api/stores/search?q=${encodeURIComponent(query)}${f === "quests" ? "&quests=1" : ""}`);
      setRows(d.stores || []);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); setRows([]); }
  }, [toast]);

  // The directory list follows the field as you type.
  useEffect(() => {
    const timer = window.setTimeout(() => { load(q, filter).catch(showErr); }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [q, filter, nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (s: Found, btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      await post("/api/stores/mine", { store_id: s.id });
      load(q, filter).catch(showErr);
      onAdded?.(s.name);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); btn.disabled = false; }
  };

  const chip = (id: Filter, label: string) => (
    <button className="chip" data-sfchip={id} aria-pressed={filter === id} type="button" onClick={() => setFilter(id)}>{label}</button>
  );

  return (
    <div className="findstore">
      <div className="group pad"><StoreSearch search={search} label id="sf-q" /></div>
      <div className="seg" id="sf-chips" style={{ margin: "12px 0" }}>
        {chip("all", t("storesFind.all"))}
        {chip("quests", t("storesFind.withQuests"))}
      </div>
      <div id="sf-results">
        {rows && !rows.length && <div className="group"><Empty>{t("storesFind.noStoresMatchAddIt")}</Empty></div>}
        {rows && rows.length > 0 && (
          <div className="group">
            {rows.map(s => (
              <div className="row" key={s.id}>
                <div className="grow"><span className="name">{s.name}</span>
                  <span className="sub">{storeMeta(s)}</span></div>
                {s.in_mine ? <span className="sub">{t("storesFind.added")}<span aria-hidden="true"> ✓</span></span>
                  : <button className="chip" data-addstore={s.id} type="button" onClick={ev => add(s, ev.currentTarget)}>{t("common.add")}</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StoresFind() {
  const { t } = useTranslation();
  const nav = useNav();
  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("common.findStores")}</h1>
      <FindStorePanel />
      <p className="muted">{t("storesFind.theDirectoryIsSharedBy")}</p>
    </>
  );
}
