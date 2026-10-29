import { useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { get } from "../lib/api";
import { MONTHS, money as fmtMoney } from "../lib/format";
import { Empty, Row, Section } from "../ui/kit";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";

/* Port of pwa/index.html #view-analysis, app.js renderAnalysis and the
 * "Your prices" cards from powers.js paintAnalysis. Spend is live
 * arithmetic over verified receipts. Bars and words only: no line
 * graphs. The (i) buttons open the same how-it-works sheet. */

type Dash = {
  spend_by_month: Record<string, number>;
  spend_by_store: Record<string, number>;
  top_items: { item_id: string; name: string; spend: number }[];
  returns_total: number; trip_count: number; spend_total: number;
  spend_other?: number; spend_groceries: number; other_by_kind?: Record<string, number>;
  for_others_total?: number;
};
type Insights = {
  basket?: { pct: number; since_month: string; month_dollars: number; items: number; movers?: { name: string; pct: number }[] } | null;
  split?: { month_dollars: number; moves: { to: string; name: string }[] } | null;
  waste?: { dollars: number; month: string; items: { name: string }[] } | null;
} | null;

/* Local copy of the price (i) sheets in pwa/powers.js (INFO). */
const INFO: Record<string, { t: string; s: string; rows: [string, string][] }> = {
  basket: { t: "Your prices", s: "How Arya works out your own inflation.", rows: [
    ["Same items", "Items you bought both then (60 to 120 days ago) and now (the last 30 days). Each item counts once."],
    ["Dollars a month", "Each item is weighed by how often you bought it in the last 3 months."],
    ["What it is not", "Your own prices at your own stores, not an official inflation number."]] },
  split: { t: "Split smarter", s: "How Arya finds the saving.", rows: [
    ["From your receipts", "Your last 6 months. An item counts when you bought it at 2 or more stores."],
    ["What counts", "The other store must save at least 25 cents and 5% on that item."],
    ["What it leaves out", "Travel time and gas are not counted."]] },
  waste: { t: "Food that expired", s: "How Arya counts it.", rows: [
    ["What counts", "Items you marked \"It expired\" this month."],
    ["Dollars", "Each item at the price you last paid. An item with no price counts as $0."]] },
};

const pct = (n: number) => `${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0).replace(/\.0$/, "")}%`;
const names = (n: string[]) => (n.length <= 2 ? n.join(" and ") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

function InfoBtn({ k, onOpen }: { k: string; onOpen: (k: string) => void }) {
  return (
    <button className="infobtn" type="button" data-info={k} aria-label="How this works" onClick={() => onOpen(k)}>
      <svg className="infoic" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="6.2" r="1.15" fill="currentColor" /><path d="M10 9v5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
    </button>
  );
}

export function Analysis() {
  const nav = useNav();
  const { currency } = useSession();
  const { showErr } = useToast();
  const money = (n: number) => fmtMoney(n, currency);
  const [d, setD] = useState<Dash | null>(null);
  const [receipts, setReceipts] = useState(0);
  const [ins, setIns] = useState<Insights>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const dash = await get<Dash>("/api/dashboard");
      const keys = Object.keys(dash.spend_by_month).sort();
      const latest = keys[keys.length - 1];
      const archive = await get<{ receipts: { purchased_at: unknown }[] }>("/api/quest/receipts").catch(() => ({ receipts: [] }));
      if (!live) return;
      setReceipts(latest ? archive.receipts.filter(r => String(r.purchased_at).startsWith(latest)).length : 0);
      setD(dash);
    })().catch(e => live && showErr(e));
    // A failed read clears the cards, as powers.js paintAnalysis did.
    get<Insights>("/api/prices/insights").then(r => live && setIns(r), () => live && setIns(null));
    return () => { live = false; };
  }, [nav.key, showErr]);

  const monthName = (k: string) => `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  const keys = d ? Object.keys(d.spend_by_month).sort() : [];
  const latest = keys[keys.length - 1];

  // Months with no receipts still get a row, so the bars do not jump a gap.
  const months: [string, number][] = [];
  if (d && keys.length) {
    let [y, m] = keys[0].split("-").map(Number);
    const [ly, lm] = keys[keys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      months.push([k, d.spend_by_month[k] || 0]);
      if (++m > 12) { m = 1; y++; }
    }
  }
  const max = Math.max(...months.map(([, v]) => v), 1);

  const cards: ReactNode[] = [];
  const b = ins && ins.basket;
  if (b) {
    const head = Math.abs(b.pct) < 1 ? `Your basket costs about the same as in ${b.since_month}`
      : `Your basket costs ${pct(b.pct)} ${b.pct > 0 ? "more" : "less"} than in ${b.since_month}`;
    const dollars = Math.abs(b.month_dollars) >= 1 ? ` About ${money(Math.abs(b.month_dollars))} ${b.month_dollars > 0 ? "more" : "less"} a month.` : "";
    const movers = b.movers || [];
    cards.push(
      <div key="basket" className="group pad pricecard"><div className="pchead"><span className="name">{head}</span><InfoBtn k="basket" onOpen={setInfo} /></div>
        <span className="sub">Same {b.items} items you buy often.{dollars}</span>
        {movers.length > 0 && <div className="pricerows">{movers.map((m, i) =>
          <div className="pricerow" key={i}><span>{m.name}</span><span className={m.pct > 0 ? "up" : "down"}>{m.pct > 0 ? "↑" : "↓"} {pct(m.pct)}</span></div>)}</div>}
      </div>);
  }
  const s = ins && ins.split;
  if (s) {
    const byTo: Record<string, string[]> = {};
    for (const m of s.moves) (byTo[m.to] = byTo[m.to] || []).push(m.name);
    const lines = Object.entries(byTo).map(([st, ns]) => `Buy ${names(ns)} at ${st}.`).join(" ");
    cards.push(
      <div key="split" className="group pad pricecard"><div className="pchead"><span className="name">Split smarter, save about {money(s.month_dollars)} a month</span><InfoBtn k="split" onOpen={setInfo} /></div>
        <span className="sub">{lines}</span></div>);
  }
  const w = ins && ins.waste;
  if (w) {
    const top = w.items.slice(0, 2).map(i => i.name);
    cards.push(
      <div key="waste" className="group pad pricecard"><div className="pchead"><span className="name">{money(w.dollars)} of food expired in {w.month}</span><InfoBtn k="waste" onOpen={setInfo} /></div>
        <span className="sub">{w.items.length === 1 ? top[0] : `Mostly ${names(top)}`}.</span></div>);
  }

  const i = info ? INFO[info] : null;
  const show = !d || !!latest;

  return (
    <>
      <p><a href="#" id="an-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Analysis</h2>
      <div id="an-prices">{cards.length > 0 && <><h3 className="sect">Your prices</h3>{cards}</>}</div>
      <p id="an-none" className="muted" hidden={show}>File a receipt and your spending shows up here.</p>
      <div id="an-data" hidden={!show}>
        <Section title="Spend — live, from your receipts" />
        <div className="group pad" id="an-spend">
          {d && latest && <>
            <p className="an-cap">{monthName(latest)} total</p>
            <p className="bignum">{money(d.spend_by_month[latest])}</p>
            <p className="muted" style={{ textAlign: "center" }}>Across {receipts} receipt{receipts === 1 ? "" : "s"} filed this month</p>
            <Row name="Returns netted, all time" sub="All receipts — refunds reconcile into the ledger; returned items never count in patterns" right={"−" + money(d.returns_total)} />
            <Row name="All-time spend" sub={`${d.trip_count} trips`} right={money(d.spend_total)} />
            {!!d.spend_other && <Row name="Groceries" sub="food and household" right={money(d.spend_groceries)} />}
            {!!d.spend_other && <Row name="Other purchases" sub={Object.entries(d.other_by_kind || {}).map(([k, v]) => `${k} ${money(v)}`).join(" · ")} right={money(d.spend_other!)} />}
            {!!d.for_others_total && <Row name="Bought for others" sub="gifts and items for people outside the household" right={money(d.for_others_total)} />}
          </>}
        </div>
        <Section title="Spend by month" />
        <div id="an-months" className="group pad">
          {d && (months.length ? months.map(([m, v]) =>
            <div className="month-row" key={m}><span>{monthName(m)}</span><div className="track"><div className="bar" style={{ width: `${Math.round(v / max * 100)}%` }} /></div><span className="money">{money(v)}</span></div>)
            : <Empty>No trips yet.</Empty>)}
        </div>
        <Section title="Spend by store" />
        <div id="an-stores" className="group">
          {d && (Object.keys(d.spend_by_store).length
            ? Object.entries(d.spend_by_store).sort((a, c) => c[1] - a[1]).map(([st, v]) => <Row key={st} name={st} right={money(v)} />)
            : <Empty>No trips yet.</Empty>)}
        </div>
        <Section title="Top grocery items" />
        <div id="an-top" className="group">
          {d && (d.top_items.length ? d.top_items.map(it =>
            <div className="row" key={it.item_id}><div className="grow"><a href="#" className="name item-link" data-id={it.item_id}
              onClick={ev => { ev.preventDefault(); nav.show("item", { id: it.item_id }); }}>{it.name}</a></div><div className="money">{money(it.spend)}</div></div>)
            : <Empty>No items yet.</Empty>)}
        </div>
      </div>

      <Sheet open={!!i} onClose={() => setInfo(null)} id="info-sheet">
        {i && <>
          <span className="sheetgrip" />
          <h3 className="largetitle" style={{ fontSize: 22, margin: "0 0 2px" }}>{i.t}</h3><span className="sub">{i.s}</span>
          {i.rows.map(([bt, st]) => <div className="whyrow" key={bt}><div><b>{bt}</b><span className="sub">{st}</span></div></div>)}
          <div className="sheetacts"><button className="btn secondary" type="button" data-pw="close" onClick={() => setInfo(null)}>Close</button></div>
        </>}
      </Sheet>
    </>
  );
}
