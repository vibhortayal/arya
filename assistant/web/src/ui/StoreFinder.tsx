import { useEffect, useRef, useState } from "react";
import { clearOnSignOut } from "../app/session";
import { get, post } from "../lib/api";
import { askGeo, GeoError, quietGeo } from "../lib/geo";
import { useTranslation } from "../i18n";
import { useToast } from "./Toast";

/* The one store finder (owner, 2026-10-30: find a store should look the
 * same on every screen). A search field with a Near me chip and Google's
 * suggestions under it. Typing ranks by the phone's position when the
 * person has allowed it; Near me asks. A tap on a suggestion files the
 * store in My stores and hands it to the caller.
 *
 *   const search = useStoreSearch(store => { ... });
 *   <StoreSearch search={search} label />
 */

export type Suggestion = { place_id: string; name: string; secondary: string };
export type PickedStore = { id: string; name: string; street?: string; city?: string };
type Places = { suggestions?: Suggestion[]; provisioned?: boolean };
type Drop = { head: string; d: Places };

/* One billing token per search, ended by a pick. */
let token: string | null = null;
clearOnSignOut(() => { token = null; });
const placesSession = () => (token ||= `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useStoreSearch(onPicked: (s: PickedStore) => void) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [drop, setDrop] = useState<Drop | null>(null);
  const [busy, setBusy] = useState("");
  const latest = useRef(q);
  latest.current = q;
  const cb = useRef(onPicked);
  cb.current = onPicked;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 3) { setDrop(null); return; }
    const timer = window.setTimeout(async () => {
      try {
        const g = await quietGeo();
        const at = g ? `&lat=${g.lat}&lng=${g.lng}` : "";
        const d = await get<Places>(`/api/stores/places?q=${encodeURIComponent(s)}&session=${placesSession()}${at}`);
        if (alive.current && latest.current.trim() === s) setDrop({ head: t("common.fromGoogle"), d }); // typed on: stale answers drop
      } catch { if (alive.current) setDrop(null); }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, t]);

  // Escape, or a tap outside the finder, closes the suggestions.
  useEffect(() => {
    const click = (ev: MouseEvent) => { if (!(ev.target as Element).closest(".storefind")) setDrop(null); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") setDrop(null); };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key); };
  }, []);

  const nearMe = async () => {
    try {
      const g = await askGeo();
      const d = await get<Places>(`/api/stores/places?q=&lat=${g.lat}&lng=${g.lng}`);
      if (alive.current) setDrop({ head: t("common.location.nearYou"), d });
    } catch (e) {
      toast(e instanceof GeoError ? t(e.code === "cannot" ? "common.location.cannot" : "common.location.allow") : errMsg(e));
    }
  };

  const pick = async (r: Suggestion) => {
    setBusy(r.place_id);
    try {
      const row = await post<PickedStore>("/api/stores/places/pick", { place_id: r.place_id, name: r.name });
      token = null; // the pick ends Google's billing session
      if (alive.current) { setDrop(null); setQ(""); }
      cb.current(row);
    } catch (e) { toast(errMsg(e)); }
    if (alive.current) setBusy("");
  };

  return { q, setQ, drop, busy, nearMe, pick };
}
export type StoreSearchState = ReturnType<typeof useStoreSearch>;

export function StoreSearch({ search, label, id }: { search: StoreSearchState; label?: boolean; id?: string }) {
  const { t } = useTranslation();
  const { drop } = search;
  const rows = drop?.d.suggestions || [];
  return (
    <div className="storefind dropanchor">
      {label && <div className="field storefind-label">{t("storeFinder.label")}</div>}
      <div className="storefind-row">
        <input type="text" id={id} maxLength={80} placeholder={t("storeFinder.placeholder")} autoComplete="off" aria-label={t("storeFinder.label")}
          value={search.q} onChange={e => search.setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} />
        <button className="chip" type="button" data-near onClick={search.nearMe}><span className="pinic" aria-hidden="true" />{t("storeFinder.nearMe")}</button>
      </div>
      <div className="gdrop" hidden={!drop}>
        {drop && (rows.length
          ? <>
            <div className="ghead">{drop.head}</div>
            {rows.map(r => (
              <button key={r.place_id} className="gitem" type="button" data-pick={r.place_id} disabled={search.busy === r.place_id} onClick={() => search.pick(r)}>
                <span className="name">{r.name}</span><span className="sub">{r.secondary}</span>
              </button>))}
          </>
          : <div className="ghead">{drop.d.provisioned === false ? t("common.googleNotSetUp") : t("common.noStoresFound")}</div>)}
      </div>
    </div>
  );
}
