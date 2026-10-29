import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { Empty } from "../ui/kit";
import { get, post } from "../lib/api";
import { Q, qLoadSessions, qParseLines, type Session } from "./hunt/model";

/* Port of pwa/index.html #view-race and quest.js renderRace (Shop-Off).
 * nav.params.store prefills the store (old Q.raceStore); nav.params.opponent
 * prefills the handle (old Q.racePrefill). A player's Open button opens its
 * session the way qOpenSession did. */

type Player = { handle: string; placeholder?: boolean; session_id: string; done?: boolean; finish_time?: string | null;
  progress?: { checked: number; total: number } | null };
type RaceData = { store: string; state: string; players: Player[]; winner?: string | null };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Race() {
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [opp, setOpp] = useState("");
  const [store, setStore] = useState("");
  const [items, setItems] = useState("");
  const [busy, setBusy] = useState(false);
  // null until loaded, so "No races yet" does not flash first.
  const [races, setRaces] = useState<RaceData[] | null>(null);

  const load = useCallback(async () => {
    await qLoadSessions().catch(() => {});
    const ids = [...new Set(Q.sessions.filter(s => s.shopoff_id).map(s => String(s.shopoff_id)))];
    if (!ids.length) { setRaces([]); return; }
    const got = await Promise.all(ids.map(id => get<RaceData>(`/api/quest/shopoff/${encodeURIComponent(id)}`).catch(() => null)));
    setRaces(got.filter(Boolean) as RaceData[]);
  }, []);

  useEffect(() => {
    const p = nav.params;
    if (typeof p.store === "string" && p.store) setStore(p.store);
    const o = p.opponent ?? p.handle ?? p.prefill;
    if (typeof o === "string" && o) setOpp(o);
    load().catch(showErr);
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (sid: string) => {
    await qLoadSessions().catch(() => {});
    const s = Q.sessions.find((x: Session) => x.id === sid);
    if (!s) return;
    Q.current = s;
    if (s.state === "done" || s.state === "finished") nav.show("score", { session: s });
    else nav.show(s.mode === "express" ? "express" : "hunt", { session: s });
  };

  const create = async () => {
    const handle = opp.trim().replace(/^@/, "");
    const st = store.trim();
    const list = qParseLines(items);
    if (!handle) { toast("Name your opponent's handle."); return; }
    if (!st) { toast("Name the store."); return; }
    if (!list.length) { toast("The race needs a list."); return; }
    setBusy(true);
    try {
      await post("/api/quest/shopoff", { store: st, items: list, opponent_handle: handle });
      toast("Race on. Both hunts are on Today.");
      load().catch(showErr);
    } catch (e) { toast(errMsg(e)); }
    setBusy(false);
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Shop-Off</h2>
      <div id="race-body">
        {races && !races.length && <div className="group"><Empty>No races yet. Start one below, or challenge a friend.</Empty></div>}
        {(races || []).map((race, ri) => (
          <div className="group pad" key={ri}>
            <p className="nomargin"><strong>{race.store}</strong> · {race.state === "finished" ? "Finished" : "Racing"}</p>
            {race.players.map(p => {
              const pct = p.progress && p.progress.total ? Math.round(p.progress.checked / p.progress.total * 100) : 0;
              return (
                <div className="row" key={p.session_id}>
                  <div className="grow"><span className="name">@{p.handle}{p.placeholder ? " (placeholder)" : ""}</span>
                    <span className="track"><span className="bar" style={{ width: `${pct}%` }} /></span>
                    <span className="sub">{p.progress ? `${p.progress.checked}/${p.progress.total} collected` : ""}{p.done && p.finish_time ? ` · receipt ${String(p.finish_time).replace("T", " ")}` : ""}</span></div>
                  <button className="chip" data-open-sess={p.session_id} type="button" onClick={() => open(p.session_id).catch(showErr)}>Open</button>
                </div>
              );
            })}
            {race.state === "finished"
              ? <p className="nomargin" style={{ marginTop: 8 }}><strong>{race.winner ? `Winner: @${race.winner} — by receipt time.` : "Dead heat — identical receipt times."}</strong></p>
              : <p className="muted nomargin" style={{ marginTop: 8 }}>First verified receipt wins.</p>}
          </div>
        ))}
      </div>
      <h3 className="sect">New race</h3>
      <div className="group pad">
        <label className="field">Opponent handle
          <input type="text" id="race-opp" placeholder="cartqueen" autoComplete="off" value={opp} onChange={e => setOpp(e.target.value)} />
        </label>
        <label className="field">Store
          <input type="text" id="race-store" placeholder="Trader Joe’s" autoComplete="off" value={store} onChange={e => setStore(e.target.value)} />
        </label>
        <label className="field">The list — one item per line
          <textarea id="race-items" rows={5} placeholder={"milk\neggs"} value={items} onChange={e => setItems(e.target.value)} />
        </label>
        <p style={{ marginBottom: 0 }}><button id="race-create" className="btn primary wide" type="button" disabled={busy} onClick={create}>Start the race</button></p>
      </div>
      <p className="muted">Same store, same list. The first verified receipt wins — its timestamp is the photo finish. Until real cross-account races land, your opponent’s hunt is a placeholder in this account; run it from its session card.</p>
    </>
  );
}
