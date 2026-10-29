import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useNav } from "../app/nav";
import { clearOnSignOut } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { storeMeta, type MyStore } from "./StoresMine";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-stores-find and quest.js renderFindStores
 * (+ the Google suggestions drop, qSuggestInto / data-gpick). The Shell
 * already renders <section id="view-stores-find">. */

type Found = MyStore & { in_mine?: boolean };
type Sugg = { place_id: string; name: string; secondary: string };
type Filter = "all" | "quests" | "zip";

/* quest.js qPlacesSession: one billing token per plan, ended by a pick.
 * Shared with StoresAdd (same module-level state as the old Q). */
let placesSession: string | null = null;
export const getPlacesSession = () =>
  (placesSession ||= `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`);
export const endPlacesSession = () => { placesSession = null; };
clearOnSignOut(endPlacesSession);

/* The Google suggestions drop under a text input: debounced fetch
 * (300 ms, 3+ chars, stale answers dropped), Escape or a click outside
 * the .dropanchor hides it, a pick adds the store to My stores. */
export function usePlacesDrop(q: string) {
  const { toast } = useToast();
  const nav = useNav();
  const [rows, setRows] = useState<Sugg[]>([]);
  const latest = useRef(q);
  latest.current = q;

  useEffect(() => {
    const t = q.trim();
    if (t.length < 3) { setRows([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const d = await get(`/api/stores/places?q=${encodeURIComponent(t)}&session=${getPlacesSession()}`);
        if (latest.current.trim() !== t) return; // typed on: stale answer
        setRows(d.suggestions || []);
      } catch { setRows([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [q]);

  const hide = useCallback(() => setRows([]), []);
  useEffect(() => {
    const click = (ev: MouseEvent) => { if (!(ev.target as Element).closest(".dropanchor")) hide(); };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") hide(); };
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key); };
  }, [hide]);

  const pick = async (r: Sugg, btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      const row = await post("/api/stores/places/pick", { place_id: r.place_id, name: r.name });
      endPlacesSession(); // the pick ends the billing session
      hide();
      toast(`${row.name} is in your stores.`);
      nav.show("stores-mine");
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); btn.disabled = false; }
  };

  return { rows, hide, pick };
}

export function PlacesRows({ rows, pick }: { rows: Sugg[]; pick: (r: Sugg, b: HTMLButtonElement) => void }) {
  const { t } = useTranslation();
  return (
    <>
      <div className="ghead">{t("common.fromGoogle")}</div>
      {rows.map(r => (
        <button className="gitem" key={r.place_id} data-gpick={r.place_id} data-gname={r.name} data-gmode="add" type="button"
          onClick={ev => pick(r, ev.currentTarget)}>
          <span className="name">{r.name}</span>
          <span className="sub">{r.secondary}</span>
        </button>
      ))}
    </>
  );
}

export function StoresFind() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Found[] | null>(null);
  const drop = usePlacesDrop(q);

  const load = useCallback(async (query: string, f: Filter) => {
    let found: Found[] = [];
    try {
      const d = await get(`/api/stores/search?q=${encodeURIComponent(query)}${f === "quests" ? "&quests=1" : ""}`);
      found = d.stores || [];
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    if (f === "zip") {
      // "Near" = the same ZIP prefix area (first three digits): the
      // typed ZIP's area, or the first favorite's when nothing typed.
      let digits = query.replace(/\D/g, "");
      if (!digits) {
        const mine: MyStore[] = await get("/api/stores/mine").then(d => d.stores || []).catch(() => []);
        const fav = mine.find(s => s.favorite) || mine[0];
        digits = fav ? fav.zip : "";
      }
      const prefix = digits.slice(0, 3);
      if (prefix) found = found.filter(s => s.zip.startsWith(prefix));
    }
    setRows(found);
  }, [toast]);

  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => { load(qRef.current.trim(), filter).catch(showErr); }, [nav.key, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    drop.hide();
    load(q.trim(), filter).catch(showErr);
  };

  const add = async (id: string, btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      await post("/api/stores/mine", { store_id: id });
      load(q.trim(), filter).catch(showErr);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); btn.disabled = false; }
  };

  const chip = (id: Filter, label: string) => (
    <button className="chip" data-sfchip={id} aria-pressed={filter === id} type="button" onClick={() => setFilter(id)}>{label}</button>
  );

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.findStores")}</h2>
      <form id="sf-form" className="group pad dropanchor" onSubmit={submit}>
        <label className="field">{t("storesFind.zipAddressOrName")}<input type="text" id="sf-q" placeholder="91709" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <div id="sf-goog" className="gdrop" hidden={!drop.rows.length}>
          {drop.rows.length > 0 && <PlacesRows rows={drop.rows} pick={drop.pick} />}
        </div>
        <p style={{ marginBottom: 0 }}><button className="btn primary wide" type="submit">{t("storesFind.search")}</button></p>
      </form>
      <div className="seg" id="sf-chips" style={{ margin: "12px 0" }}>
        {chip("all", "All")}
        {chip("quests", "With quests")}
        {chip("zip", "Near this ZIP")}
      </div>
      <div id="sf-results">
        {rows && !rows.length && <div className="group"><Empty>{t("storesFind.noStoresMatchAddIt")}</Empty></div>}
        {rows && rows.length > 0 && (
          <div className="group">
            {rows.map(s => (
              <div className="row" key={s.id}>
                <div className="grow"><span className="name">{s.name}</span>
                  <span className="sub">{storeMeta(s)}</span></div>
                {s.in_mine ? <span className="sub">{t("storesFind.added")}</span>
                  : <button className="chip" data-addstore={s.id} type="button" onClick={ev => add(s.id, ev.currentTarget)}>{t("common.add")}</button>}
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="muted">{t("storesFind.theDirectoryIsSharedBy")}</p>
    </>
  );
}
