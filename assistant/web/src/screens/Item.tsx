import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { useToast } from "../ui/Toast";
import { Row } from "../ui/kit";
import { get, post } from "../lib/api";
import { MONTHS, fmtDate, money } from "../lib/format";

/* Port of pwa/index.html #view-item and app.js renderItem. Opened with
 * nav.show("item", { id }). */

type Detail = {
  entry?: { canonical_name: string } | null;
  pattern?: any;
  price_by_store: Record<string, { count: number; min: number; max: number }>;
  history: { date: string; event_type: string; store_id?: string; price: number }[];
};

export function Item() {
  const nav = useNav();
  const { currency } = useSession();
  const { toast, showErr } = useToast();
  const id = String(nav.params.id ?? "");
  const [d, setD] = useState<Detail | null>(null);
  const [result, setResult] = useState("");

  useEffect(() => {
    let live = true;
    setD(null);
    setResult("");
    get<Detail>(`/api/items/${encodeURIComponent(id)}`).then(r => { if (live) setD(r); }).catch(showErr);
    return () => { live = false; };
  }, [id, nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<unknown>, msg: string) => {
    try { await f(); setResult(msg); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const eid = encodeURIComponent(id);

  const e = d?.entry, p = d?.pattern;
  const stores = d ? Object.entries(d.price_by_store || {}) : [];
  const onList = p?.admitted;

  return (
    <>
      <p><a href="#" id="item-back" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back</a></p>
      <div id="item-detail">
        {d && <>
          <h2 className="largetitle" style={{ fontSize: 28 }}>{e ? e.canonical_name : id}</h2>
          {p && p.history_state !== "not-enough-history" ? (
            <div className="group">
              <Row name="Buys" right={String(p.purchase_count)} />
              <Row name="Rhythm" right={`every ~${Math.round(p.median_interval_days)} days`} />
              <Row name="Last bought" right={fmtDate(p.last_bought)} />
              <Row name="Total spend" right={money(p.total_spend, currency)} />
            </div>
          ) : <p className="muted">Not enough history yet for a pattern.</p>}
          {p && p.judge && <>
            <h3 className="sect">Why Arya {onList ? "suggests it" : "leaves it off"}</h3>
            <div className="group">
              <Row name={String(p.judge.class).replace("_", " ")} sub={p.judge.reason} right={onList ? "On the list" : "Off the list"} />
            </div>
          </>}
          {p && p.analysis && p.analysis.verdict && (
            <p className="muted">Pattern check: {p.analysis.verdict}{p.analysis.seasonal_months
              ? ` · bought mostly in ${p.analysis.seasonal_months.map((m: number) => MONTHS[m - 1]).join(", ")}` : ""}.</p>
          )}
          {stores.length > 0 && <>
            <h3 className="sect">Price by store</h3>
            <div className="group">
              {stores.map(([s, v]) => (
                <Row key={s} name={s} sub={`${v.count} buys`}
                  right={v.min === v.max ? money(v.min, currency) : `${money(v.min, currency)} – ${money(v.max, currency)}`} />
              ))}
            </div>
          </>}
          {d.history.length > 0 && <>
            <h3 className="sect">Recent history</h3>
            <div className="group">
              {d.history.slice(0, 10).map((h, i) => {
                const ret = h.event_type === "return";
                return <Row key={i} name={fmtDate(h.date)} sub={ret ? "Returned" : h.store_id || ""}
                  right={<span className={ret ? "return" : ""}>{ret ? "−" : ""}{money(h.price, currency)}</span>} />;
              })}
            </div>
          </>}
          <p style={{ marginTop: 20, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn secondary" id="btn-add" type="button"
              onClick={() => act(() => post("/api/list/add", { item_id: id }), "Added to your list.")}>Add to list</button>
            <button className="btn secondary" id="btn-never" type="button"
              onClick={() => act(() => post(`/api/items/${eid}/flag`, { never: true }), "Arya will not suggest this again.")}>Never suggest</button>
            <button className="btn secondary" id="btn-expired" type="button"
              onClick={() => act(() => post(`/api/items/${eid}/expired`), "Marked expired. It's on your list.")}>This expired</button>
          </p>
          <p id="flag-result" className="muted">{result}</p>
        </>}
      </div>
    </>
  );
}
