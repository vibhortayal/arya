import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";
import { get, post } from "../lib/api";
import { isOffline, subscribeOffline } from "../lib/offline";
import { setDeleteAsker, setListAsker, type DeleteChoice, type DeleteNeed, type ListRef, type NeedList, type Picked } from "../lib/listPick";

/* The "Which list?" sheet (lib/listPick.ts). Two shapes:
 * - pick: "Add Whole Milk to…", one row per list, the usual store's
 *   list first and ticked; tap a list to add there. "+ New list" makes
 *   one by name.
 * - first: "Make a list first", your stores as choices (or another
 *   store by name); the button makes that list and adds to it.
 * Cancel adds nothing. Mounted once in the app shell. */
type Ask = { need: NeedList; done: (p: Picked) => void };

export function ListPickHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const cur = useRef<Ask | null>(null);
  cur.current = ask;
  useEffect(() => {
    setListAsker(need => new Promise<Picked>(done => {
      cur.current?.done(null);               // a second ask replaces the first
      setAsk({ need, done });
    }));
    return () => setListAsker(null);
  }, []);
  const finish = (p: Picked) => { const a = cur.current; setAsk(null); a?.done(p); };

  const [del, setDel] = useState<DelAsk | null>(null);
  const curDel = useRef<DelAsk | null>(null);
  curDel.current = del;
  useEffect(() => {
    setDeleteAsker((name, need) => new Promise<DeleteChoice>(done => {
      curDel.current?.done(null);
      setDel({ name, need, done });
    }));
    return () => setDeleteAsker(null);
  }, []);
  const finishDel = (c: DeleteChoice) => { const a = curDel.current; setDel(null); a?.done(c); };
  return <><ListPickSheet ask={ask} finish={finish} /><DeleteSheet ask={del} finish={finishDel} /></>;
}

type DelAsk = { name: string; need: DeleteNeed; done: (c: DeleteChoice) => void };

/* "Delete Trader Jill's?" It has 4 items: move them (ticked first) or
 * delete them too, then Delete list. Undo on the toast brings both back. */
function DeleteSheet({ ask, finish }: { ask: DelAsk | null; finish: (c: DeleteChoice) => void }) {
  const { t } = useTranslation();
  const lists = ask?.need.lists || [];
  const [pickTo, setTo] = useState<string>("");
  useEffect(() => { setTo(""); }, [ask]);
  const to = pickTo || lists[0]?.id || "drop";      // moving is the default
  return (
    <Sheet open={!!ask} onClose={() => finish(null)} id="listdelete" title={ask ? t("listPick.deleteTitle", { name: ask.name }) : ""} closeLabel={t("common.cancel")}>
      <p id="listdelete-why">{t("listPick.deleteHas", { count: ask?.need.count || 0 })}</p>
      <div className="group">
        {lists.map(l => (
          <button key={l.id} className="navrow" type="button" data-move={l.id} aria-pressed={to === l.id} onClick={() => setTo(l.id)}>
            <span className="grow">{t("listPick.moveTo", { name: l.name })}</span><span className="tick" aria-hidden="true">✓</span>
          </button>
        ))}
        <button className="navrow" type="button" id="listdelete-drop" aria-pressed={to === "drop"} onClick={() => setTo("drop")}>
          <span className="grow">{t("listPick.deleteToo")}</span><span className="tick" aria-hidden="true">✓</span>
        </button>
      </div>
      <button className="btn wide ok-danger" id="listdelete-go" type="button"
        onClick={() => finish(to === "drop" ? { remove_items: true } : { move_to: to })}>{t("listPick.deleteList")}</button>
    </Sheet>
  );
}

function ListPickSheet({ ask, finish }: { ask: Ask | null; finish: (p: Picked) => void }) {
  const { t } = useTranslation();
  const offline = useSyncExternalStore(subscribeOffline, isOffline);
  const need = ask?.need;
  const names = need?.names || [];
  const what = names.length === 1 ? names[0] : names.length > 1 ? t("listPick.nItems", { count: names.length }) : t("listPick.this");
  const first = need?.code === "no_lists" || !(need?.lists || []).length;
  const lists = orderLists(need?.lists || [], need?.suggested);
  const [stores, setStores] = useState<string[] | null>(null);
  const [store, setStore] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setTyping(false); setDraft(""); setErr(""); setBusy(false); setStore(null);
    if (!ask || !first) return;
    let alive = true;
    get<{ stores?: { name: string }[] }>("/api/stores/mine")
      .then(r => { if (!alive) return; const s = uniq((r.stores || []).map(x => x.name)); setStores(s); setStore(s[0] || null); if (!s.length) setTyping(true); })
      .catch(() => { if (alive) { setStores([]); setTyping(true); } });
    return () => { alive = false; };
  }, [ask]);

  const make = async (name: string, link: boolean) => {
    const n = name.trim();
    if (!n) { setErr(t("listPick.nameFirst")); return; }
    if (offline) { setErr(t("listPick.offlineMake")); return; }
    setBusy(true); setErr("");
    try {
      const l = await post<ListRef>("/api/lists", link ? { name: n, stores: [n] } : { name: n });
      finish({ id: l.id, name: l.name });
    } catch (e) { setErr(e instanceof Error ? e.message : t("common.couldNotLoad")); setBusy(false); }
  };

  const title = first ? t("listPick.firstTitle") : t("listPick.title", { what });
  const chosen = typing ? draft : store || "";
  return (
    <Sheet open={!!ask} onClose={() => finish(null)} id="listpick" title={title} closeLabel={t("common.cancel")} focusKey={first ? "first" + typing : "pick" + typing}>
      {!first ? <>
        <p className="muted" id="listpick-why">{t("listPick.why")}</p>
        <div className="group">
          {lists.map(l => (
            <button key={l.id} className="navrow" type="button" data-pick={l.id} aria-pressed={l.id === need?.suggested}
              onClick={() => finish(l)}>
              <span className="grow">{l.name}{l.id === need?.suggested && names.length === 1 ? <small>{t("listPick.usual", { what })}</small> : null}</span>
              <span className="tick" aria-hidden="true">✓</span>
            </button>
          ))}
          {!typing && <button className="navrow" type="button" id="listpick-new" onClick={() => setTyping(true)}>
            <span className="grow accent">{t("listPick.newList")}</span></button>}
        </div>
        {typing && <NameRow draft={draft} setDraft={setDraft} label={t("listPick.newListName")} />}
        {typing && <button className="btn primary wide" id="listpick-make" type="button" disabled={busy || !draft.trim()} onClick={() => make(draft, false)}>
          {draft.trim() ? t("listPick.makeAndAdd", { name: draft.trim() }) : t("listPick.makeListAndAdd")}</button>}
      </> : <>
        <p id="listpick-why">{t("listPick.firstWhy", { what })}</p>
        {stores === null ? <p className="muted">{t("common.loading")}</p> : <div className="group">
          {stores.map((s, k) => (
            <button key={s} className="navrow" type="button" data-store={s} aria-pressed={!typing && store === s}
              onClick={() => { setTyping(false); setStore(s); }}>
              <span className="grow">{s}{k === 0 ? <small>{t("listPick.shopMost")}</small> : null}</span>
              <span className="tick" aria-hidden="true">✓</span>
            </button>
          ))}
          <button className="navrow" type="button" id="listpick-other" aria-pressed={typing} onClick={() => setTyping(true)}>
            <span className="grow">{t("listPick.another")}</span><span className="tick" aria-hidden="true">✓</span></button>
        </div>}
        {typing && <NameRow draft={draft} setDraft={setDraft} label={t("listPick.storeName")} />}
        <button className="btn primary wide" id="listpick-make" type="button" disabled={busy || !chosen.trim()} onClick={() => make(chosen, true)}>
          {chosen.trim() ? t("listPick.makeAndAdd", { name: chosen.trim() }) : t("listPick.makeListAndAdd")}</button>
      </>}
      {offline && <p className="sub" id="listpick-offline">{t("listPick.offlineNote")}</p>}
      {err && <p className="sub bad" role="alert">{err}</p>}
    </Sheet>
  );
}

function NameRow({ draft, setDraft, label }: { draft: string; setDraft: (s: string) => void; label: string }) {
  return (
    <label className="listpick-name">
      <span className="sub">{label}</span>
      <input id="listpick-input" data-first type="text" value={draft} maxLength={60} autoComplete="off"
        onChange={e => setDraft(e.target.value)} />
    </label>
  );
}

const uniq = (a: string[]) => a.filter((x, i) => x && a.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i);
export function orderLists(lists: ListRef[], suggested?: string | null) {
  const s = lists.find(l => l.id === suggested);
  return s ? [s, ...lists.filter(l => l !== s)] : lists;
}
