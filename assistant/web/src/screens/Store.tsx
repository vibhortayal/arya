import { useCallback, useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { StarSvg, storeMeta, type MyStore } from "./StoresMine";

/* Port of pwa/index.html #view-store and quest.js: qStartNewHunt (store
 * half), renderStorePick, qPickStore, the Google Places picker and the
 * favorite star. The Shell already renders <section id="view-store">.
 *
 * Hand-off: the old code kept the hunt plan in the Q.draft global and
 * showed "view-newlist". Here picking a store calls
 *   nav.show("newlist", { store, storeId, fromList, fastMode })
 * and the New list screen builds its own draft from that. This screen
 * accepts the same params in: { fromList: {id,name,stores}, fastMode }. */

const norm = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const sameStore = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.startsWith(y + " ") || y.startsWith(x + " "));
};
// Stores with a photo walk / 3D model (quest.js STORE_PHOTOS, STORE_MODELS).
const hasData = (store: string) => norm(store).replace(/ /g, "") === "traderjoes";

/* One-shot location for biasing Google suggestions (quest.js Q.geo,
 * Q.geoAsked): asked once per app run, not on every open. */
let geo: { lat: number; lng: number } | null = null;
let geoAsked = false;
/* The one-linked-store shortcut fires on the first open only, not
 * again when Back returns here from Find / Add (keyed by the nav
 * entry's params object, which Back keeps). */
const shortcutTried = new WeakSet<object>();

type PlanItem = { item_id?: string; name: string; stores?: Record<string, number>; [k: string]: any };
type PlanRow = { name: string; list?: string; on_list?: boolean; history_id?: string; item_id?: string; [k: string]: any };
type Plan = { list: PlanRow[]; items: PlanItem[] };
type FromList = { id: string; name: string; stores: string[] };
type Sugg = { place_id: string; name: string; secondary: string };

const storeCount = (rec: PlanItem | null, store: string) =>
  rec ? Object.entries(rec.stores || {}).reduce((n, [s, c]) => n + (sameStore(s, store) ? c : 0), 0) : 0;
function planItem(plan: Plan, name: string, itemId?: string) {
  return plan.items.find(i => (itemId && i.item_id === itemId) || norm(i.name) === norm(name)) || null;
}
function isHere(plan: Plan, li: PlanRow, store: string) {
  const rec = planItem(plan, li.name, li.history_id || li.item_id);
  const total = rec ? Object.values(rec.stores || {}).reduce((a, b) => a + b, 0) : 0;
  if (!rec || !total) return false;
  const here = storeCount(rec, store);
  let bestN = 0;
  for (const [s, n] of Object.entries(rec.stores || {})) if (!sameStore(s, store) && n > bestN) bestN = n;
  return !!here && here >= bestN;
}
/* quest.js qStoreFit */
function storeFit(plan: Plan, store: string) {
  const here = plan.list.filter(li => isHere(plan, li, store));
  const usual = plan.items.filter(i => storeCount(i, store) >= 2)
    .sort((a, b) => storeCount(b, store) - storeCount(a, store)).slice(0, 3).map(i => i.name);
  if (!usual.length) return "";
  const lead = here.length ? `${here.length} of your ${plan.list.length} list items usually here · ` : "";
  return `${lead}Usually: ${usual.join(", ")}`;
}
function historyStores(plan: Plan) {
  const seen: Record<string, number> = {};
  for (const i of plan.items) for (const [s, n] of Object.entries(i.stores || {})) seen[s] = (seen[s] || 0) + n;
  return Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([s]) => s);
}

export function Store() {
  const nav = useNav();
  const { demo } = useSession();
  const { toast } = useToast();
  const fromList = (nav.params.fromList as FromList | undefined) || null;
  const fastMode = (nav.params.fastMode as string | undefined) || null;

  const [name, setName] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [mine, setMine] = useState<MyStore[]>([]);
  const [plan, setPlan] = useState<Plan>({ list: [], items: [] });
  const [loaded, setLoaded] = useState(false);
  const [histAll, setHistAll] = useState(false);
  const [sugg, setSugg] = useState<Sugg[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const session = useRef<string | null>(null);
  const gbusy = useRef(false);
  const latest = useRef("");
  latest.current = name;

  const loadMine = useCallback(async () => {
    const d = await get("/api/stores/mine");
    setMine(d.stores || []);
    return (d.stores || []) as MyStore[];
  }, []);

  const go = useCallback((store: string, storeId: string | null, replace = false) => {
    const params = { store, storeId, fromList, fastMode };
    (replace ? nav.replace : nav.show)("newlist", params);
  }, [nav, fromList, fastMode]);

  // Open: reload My Stores + the plan (also when Back returns here
  // from Find / Add, so a store added there can be picked).
  useEffect(() => {
    let dead = false;
    if (!geoAsked && navigator.geolocation) {
      geoAsked = true;
      navigator.geolocation.getCurrentPosition(
        p => { geo = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { timeout: 4000, maximumAge: 600000 });
    }
    (async () => {
      const m = await loadMine().catch(() => [] as MyStore[]);
      let p: Plan;
      try { p = await get("/api/quest/plan"); } catch { p = { list: [], items: [] }; }
      p = { list: p.list || [], items: p.items || [] };
      if (fromList) p = { ...p, list: p.list.filter(li => li.list === fromList.id && li.on_list !== false) };
      if (dead) return;
      setPlan(p);
      setLoaded(true);
      // One linked store the household already knows: straight to the plan.
      const one = fromList && (fromList.stores || []).length === 1 ? fromList.stores[0] : "";
      const first = !shortcutTried.has(nav.params);
      shortcutTried.add(nav.params);
      if (one && first) {
        const mn = m.find(s => sameStore(s.name, one));
        const hist = historyStores(p).find(h => sameStore(h, one));
        if (mn || hist) go(mn ? mn.name : hist!, mn ? mn.id : null, true);
      }
    })();
    return () => { dead = true; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const hideDrop = () => setSugg([]);
  useEffect(() => {
    const onClick = (ev: MouseEvent) => { if (!(ev.target as Element).closest(".dropanchor")) hideDrop(); };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") hideDrop(); };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); clearTimeout(timer.current); };
  }, []);

  const suggest = async (q: string) => {
    if (q.length < 3) { setSugg([]); return; }
    if (!session.current) session.current = `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
    const g = geo ? `&lat=${geo.lat}&lng=${geo.lng}` : "";
    try {
      const d = await get(`/api/stores/places?q=${encodeURIComponent(q)}&session=${session.current}${g}`);
      if (latest.current.trim() !== q) return; // typed on: stale answer
      setSugg(d.suggestions || []);
    } catch { setSugg([]); }
  };

  /* qPickStore: a tap on any store row (or Enter) starts the plan. */
  const pickStore = (nm: string, storeId: string | null) => {
    const store = nm.trim();
    if (!store) { toast("Pick or name the store first."); return; }
    if (!storeId) {
      const toks = norm(store).split(" ").filter(Boolean);
      const hits = toks.length < 2 ? [] : mine.filter(s => {
        const hay = norm(`${s.street} ${s.city} ${s.state} ${s.zip}`);
        return toks.every(t => hay.includes(t));
      });
      if (hits.length === 1) { setName(hits[0].name); setSelId(hits[0].id); go(hits[0].name, hits[0].id); return; }
      const known = mine.some(s => sameStore(s.name, store)) || historyStores(plan).some(h => sameStore(h, store));
      if (!known) {
        toast("Pick the store from the list — Arya needs its real address from Google.");
        suggest(store).catch(() => {});
        return;
      }
    }
    go(store, storeId);
  };

  const onType = (v: string) => {
    setName(v);
    const sel = selId && mine.find(x => x.id === selId);
    if (sel && v.trim() !== sel.name) setSelId(null); // typed a different store: free-text trip
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => suggest(v.trim()).catch(() => {}), 300);
  };

  const gpick = async (s: Sugg) => {
    if (gbusy.current) return; // the old button disabled itself while filing
    gbusy.current = true;
    try {
      const row = await post("/api/stores/places/pick", { place_id: s.place_id, name: s.name });
      session.current = null; // the pick ends the billing session
      hideDrop();
      await loadMine().catch(() => {});
      setName(row.name); setSelId(row.id);
      pickStore(row.name, row.id);
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    finally { gbusy.current = false; }
  };

  const toggleFav = async (s: MyStore) => {
    const on = !s.favorite;
    try {
      await post("/api/stores/favorite", { store_id: s.id, favorite: on });
      await loadMine().catch(() => {});
      toast(on ? "Added to favorites." : "Removed from favorites.");
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };

  /* ---- renderStorePick ---- */
  const histPick = (h: string) => { setSelId(null); setName(h); pickStore(h, null); };
  const hist = historyStores(plan)
    .filter(h => !mine.some(s => sameStore(s.name, h)))
    .filter(h => !demo || hasData(h));
  const shown = histAll ? hist : hist.slice(0, 3);
  const mineShown = demo ? mine.filter(s => hasData(s.name)) : mine;
  const favs = mineShown.filter(s => s.favorite);
  const rest = mineShown.filter(s => !s.favorite);

  const rowEl = (s: MyStore) => {
    const fit = storeFit(plan, s.name);
    return (
      <div className="sessrow pickwrap" key={s.id}>
        <button className="pickmain pickrow" data-pick={s.id} aria-pressed={selId === s.id} type="button"
          onClick={() => { setSelId(s.id); setName(s.name); pickStore(s.name, s.id); }}>
          <span className="grow"><span className="name">{s.name}</span>
            <span className="sub">{storeMeta(s)}</span>
            {fit ? <span className="sub fit">{fit}</span> : null}</span>
        </button>
        <button className={"starbtn " + (s.favorite ? "on" : "")} data-fav={s.id} data-on={String(!!s.favorite)}
          aria-pressed={!!s.favorite} aria-label={s.favorite ? "Remove from favorites" : "Add to favorites"} type="button"
          onClick={() => toggleFav(s)}><StarSvg filled={!!s.favorite} /></button>
      </div>
    );
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Where are you shopping?</h2>
      <div className="group pad dropanchor">
        <label className="field">Type a store — or tap one below
          <input type="text" id="st-name" placeholder="Trader Joe’s" autoComplete="off" value={name}
            onChange={ev => onType(ev.target.value)}
            onKeyDown={ev => { if (ev.key === "Enter") { ev.preventDefault(); pickStore(name, selId); } }} />
        </label>
        <p className="muted nomargin" style={{ fontSize: 13 }}>Stores come from Google, with their real addresses — tap yours to start the plan.</p>
        <div id="st-goog" className="gdrop" hidden={!sugg.length}>
          {sugg.length > 0 && <div className="ghead">From Google</div>}
          {sugg.map(r => (
            <button className="gitem" key={r.place_id} data-gpick={r.place_id} data-gname={r.name} data-gmode="hunt" type="button"
              onClick={() => gpick(r)}>
              <span className="name">{r.name}</span>
              <span className="sub">{r.secondary}</span>
            </button>
          ))}
        </div>
      </div>
      <div id="st-fromlist">
        {fromList && (fromList.stores || []).length > 0 && (
          <>
            <h3 className="sect">{fromList.name} stores</h3>
            <div className="group">
              {fromList.stores.map(nm => {
                const mn = mine.find(s2 => sameStore(s2.name, nm));
                return (
                  <button className="sessrow pickrow" type="button" key={nm}
                    {...(mn ? { "data-pick": mn.id } : { "data-histstore": nm })}
                    onClick={() => { if (mn) { setSelId(mn.id); setName(mn.name); pickStore(mn.name, mn.id); } else histPick(nm); }}>
                    <span className="grow"><span className="name">{nm}</span></span></button>
                );
              })}
            </div>
          </>
        )}
      </div>
      <div id="st-mine">
        {loaded && !mine.length
          ? <div className="group"><Empty>No stores in your stores yet. Find one or add one below.</Empty></div>
          : <>
              {favs.length > 0 && <><h3 className="sect">Favorites</h3><div className="group">{favs.map(rowEl)}</div></>}
              {rest.length > 0 && <><h3 className="sect">All my stores</h3><div className="group">{rest.map(rowEl)}</div></>}
            </>}
      </div>
      <div id="st-history">
        {hist.length > 0 && (
          <>
            <h3 className="sect">From your receipts</h3>
            <div className="group">
              {shown.map(s => {
                const fit = storeFit(plan, s);
                return (
                  <button className="sessrow pickrow" key={s} data-histstore={s} aria-pressed={norm(name) === norm(s)} type="button"
                    onClick={() => histPick(s)}>
                    <span className="grow"><span className="name">{s}</span>
                      {fit ? <span className="sub fit">{fit}</span> : null}</span></button>
                );
              })}
              {!histAll && hist.length > 3 && (
                <button className="sessrow pickrow" data-histall="1" type="button" onClick={() => setHistAll(true)}>
                  <span className="grow"><span className="name">Show all {hist.length} stores</span></span><span className="chev">›</span></button>
              )}
            </div>
          </>
        )}
      </div>
      <div className="group">
        <button className="navrow" type="button" onClick={() => nav.show("stores-find")}><span className="grow">Find stores<span className="sub">Search by ZIP, address, or name</span></span><span className="chev">›</span></button>
        <button className="navrow" type="button" onClick={() => nav.show("stores-add")}><span className="grow">Add a store<span className="sub">A store that is not in the directory yet</span></span><span className="chev">›</span></button>
      </div>
    </>
  );
}
