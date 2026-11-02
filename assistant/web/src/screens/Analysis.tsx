import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { get } from "../lib/api";
import { MONTHS, money as fmtMoney } from "../lib/format";
import { Empty, Row, Section } from "../ui/kit";
import { InfoBtn, InfoSheet } from "../ui/Info";
import { useToast } from "../ui/Toast";
import { EditList, EditTitle } from "../ui/EditList";
import { useBar } from "../ui/Bar";
import { t, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-analysis, app.js renderAnalysis and the
 * "Your prices" cards from powers.js paintAnalysis. Spend is live
 * arithmetic over verified receipts. Bars and words only: no line
 * graphs. The (i) buttons open the same how-it-works sheet. */

type Dash = {
  spend_by_month: Record<string, number>;
  spend_by_store: Record<string, number>;
  store_notes?: Record<string, string>;
  top_items: { item_id: string; name: string; spend: number }[];
  returns_total: number; returns_count?: number; savings_total?: number; trip_count: number; spend_total: number;
  spend_other?: number; spend_groceries: number; other_by_kind?: Record<string, number>;
  for_others_total?: number;
};
type Insights = {
  basket?: { pct: number; since_month: string; month_dollars: number; items: number; movers?: { name: string; pct: number }[] } | null;
  split?: { month_dollars: number; moves: { to: string; from: string; to_price: number; from_price: number; month_dollars: number; name: string }[] } | null;
  waste?: { dollars: number; month: string; items: { name: string }[] } | null;
} | null;

/* Spending's sections, in their usual order; the person can reorder
 * and hide them (card library, 2026-10-30). */
const SECTIONS = ["prices", "spend", "months", "stores", "top"];

const pct = (n: number) => `${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0).replace(/\.0$/, "")}%`;
const names = (n: string[]) => (n.length <= 2 ? n.join(t("lists.and")) : t("analysis.namesAnd", { names: n.slice(0, -1).join(", "), last: n[n.length - 1] }));

export function Analysis() {
  const { t } = useTranslation();
  const nav = useNav();
  const onBar = useBar().includes("analysis");
  const { currency, layouts = {}, saveLayout } = useSession();
  const { toast, showErr } = useToast();
  const [editing, setEditing] = useState(false);
  const money = (n: number) => fmtMoney(n, currency);
  const [d, setD] = useState<Dash | null>(null);
  const [receipts, setReceipts] = useState(0);
  const [ins, setIns] = useState<Insights>(null);
  const [info, setInfo] = useState<string | null>(null);
  /* One (i) per Spending heading, each explaining only its own row. */
  const i = (row: string) => <InfoBtn k={"spend." + row} onOpen={setInfo} />;
  /* Who sees the receipts, for the Receipts row: you alone, or you and your group. */
  const [groupName, setGroupName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    get<{ group: { name: string } | null }>("/api/group").then(g => { if (live) setGroupName(g?.group?.name || null); }, () => {});
    return () => { live = false; };
  }, []);

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
    const head = Math.abs(b.pct) < 1 ? t("analysis.basketSame", { month: b.since_month })
      : t(b.pct > 0 ? "analysis.basketMore" : "analysis.basketLess", { pct: pct(b.pct), month: b.since_month });
    const dollars = Math.abs(b.month_dollars) >= 1 ? t(b.month_dollars > 0 ? "analysis.aboutMore" : "analysis.aboutLess", { amount: money(Math.abs(b.month_dollars)) }) : "";
    const movers = b.movers || [];
    cards.push(
      <div key="basket" className="group pad pricecard"><div className="pchead"><span className="name">{head}</span><InfoBtn k="basket" onOpen={setInfo} /></div>
        <span className="sub">{t("analysis.sameItemsYouBuyOften", { items: b.items, dollars })}</span>
        {movers.length > 0 && <div className="pricerows">{movers.map((m, i) =>
          <div className="pricerow" key={i}><span>{m.name}</span><span className={m.pct > 0 ? "up" : "down"}>{m.pct > 0 ? "↑" : "↓"} {pct(m.pct)}</span></div>)}</div>}
      </div>);
  }
  const s = ins && ins.split;
  if (s) {
    cards.push(
      <div key="split" className="group pad pricecard"><div className="pchead"><span className="name">{t("analysis.splitHead", { count: s.moves.length, month_dollars: money(s.month_dollars) })}</span><InfoBtn k="split" onOpen={setInfo} /></div>
        <span className="sub">{t("analysis.splitSub")}</span>
        <div className="pricerows">{s.moves.slice(0, 5).map(m =>
          <div className="pricerow" key={m.name + m.to}><span>{m.name}<br /><span className="sub">{t("analysis.splitMove", { to: m.to, toPrice: money(m.to_price), from: m.from, fromPrice: money(m.from_price) })}</span></span><span className="down">↓ {money(m.month_dollars)}</span></div>)}</div>
        <span className="sub">{t("analysis.splitFoot")}</span></div>);
  }
  const w = ins && ins.waste;
  if (w) {
    const top = w.items.slice(0, 2).map(i => i.name);
    cards.push(
      <div key="waste" className="group pad pricecard"><div className="pchead"><span className="name">{t("analysis.ofFoodExpiredIn", { dollars: money(w.dollars), month: w.month })}</span><InfoBtn k="waste" onOpen={setInfo} /></div>
        <span className="sub">{w.items.length === 1 ? top[0] : t("analysis.mostly", { names: names(top) })}.</span></div>);
  }

  const show = !d || !!latest;
  const saved = layouts.spending?.on;
  const on = saved ? saved.filter(id => SECTIONS.includes(id)) : SECTIONS;
  const offS = SECTIONS.filter(id => !on.includes(id));
  const sections: Record<string, ReactNode> = {
    prices: (
      <div id="an-prices">{cards.length > 0 && <><h3 className="sect">{t("analysis.yourPrices")}</h3>{cards}</>}</div>
    ),
    spend: (
      <>
        <Section title={t("analysis.spendLiveFromYourReceipts")} />
        <div className="group pad" id="an-spend">
          {d && latest && <>
            <p className="an-cap">{t("analysis.monthTotal", { month: monthName(latest) })}{i("month")}</p>
            <p className="bignum">{money(d.spend_by_month[latest])}</p>
            <p className="muted" style={{ textAlign: "center" }}>{t("analysis.acrossReceipt", { count: receipts })}</p>
            <Row name={<>{t("analysis.allTimeSpend")}{i("all")}</>} sub={t("analysis.trips", { count: d.trip_count }) + (d.returns_total ? " · " + t("analysis.afterReturns") : "")} right={money(d.spend_total)} />
            {!!d.spend_other && <Row name={<>{t("analysis.groceries")}{i("groceries")}</>} sub={t("analysis.foodAndHousehold")} right={money(d.spend_groceries)} />}
            {!!d.spend_other && <Row name={<>{t("analysis.otherPurchases")}{i("other")}</>} sub={Object.entries(d.other_by_kind || {}).map(([k, v]) => `${k} ${money(v)}`).join(" · ")} right={money(d.spend_other!)} />}
            {!!d.returns_total && <Row name={<>{t("analysis.returnsRow")}{i("returns")}</>} sub={t("analysis.returnsRowSub", { count: d.returns_count || 1 })} right={<span className="return">{"−" + money(d.returns_total)}</span>} />}
            {!!d.savings_total && <Row name={<>{t("analysis.youSaved")}{i("saved")}</>} sub={t("analysis.youSavedSub")} right={<span className="saved">{money(d.savings_total)}</span>} />}
            {!!d.for_others_total && <Row name={<>{t("analysis.boughtForOthers")}{i("others")}</>} sub={t("analysis.giftsAndItemsForPeople")} right={money(d.for_others_total)} />}
          </>}
        </div>
      </>
    ),
    months: (
      <>
        <Section title={t("analysis.spendByMonth")} />
        <div id="an-months" className="group pad">
          {d && (months.length ? months.map(([m, v]) =>
            <div className="month-row" key={m}><span>{monthName(m)}</span><div className="track"><div className="bar" style={{ width: `${Math.round(v / max * 100)}%` }} /></div><span className="money">{money(v)}</span></div>)
            : <Empty>{t("analysis.noTripsYet")}</Empty>)}
        </div>
      </>
    ),
    stores: (
      <>
        <Section title={t("analysis.spendByStore")} />
        <div id="an-stores" className="group">
          {d && (Object.keys(d.spend_by_store).length
            ? Object.entries(d.spend_by_store).sort((a, c) => c[1] - a[1]).map(([st, v]) => <Row key={st} name={st} sub={d.store_notes?.[st]} right={money(v)} />)
            : <Empty>{t("analysis.noTripsYet")}</Empty>)}
        </div>
      </>
    ),
    top: (
      <>
        <Section title={t("analysis.topGroceryItems")} />
        <div id="an-top" className="group">
          {d && (d.top_items.length ? d.top_items.map(it =>
            <div className="row" key={it.item_id}><div className="grow"><a href="#" className="name item-link" data-id={it.item_id}
              onClick={ev => { ev.preventDefault(); nav.show("item", { id: it.item_id }); }}>{it.name}</a></div><div className="money">{money(it.spend)}</div></div>)
            : <Empty>{t("analysis.noItemsYet")}</Empty>)}
        </div>
      </>
    ),
  };

  return (
    <>
      {/* On the bar, Spending is a tab: no Back at the bottom of the stack. */}
      {!(onBar && nav.depth <= 2) && <p><a href="#" id="an-back" onClick={ev => { ev.preventDefault(); nav.back("home"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>}
      <EditTitle id="an-editbtn" small title={t("common.analysis")} editTitle={t("analysis.editTitle")} editing={editing} onToggle={() => setEditing(e => !e)} />
      {editing ? (
        <EditList id="an-edit" on={on} off={offS} name={id => t(`analysis.sections.${id}`)} sub={() => ""} desc={() => ""}
          hint={t("analysis.editHint")} moreTitle={t("analysis.moreSections")}
          onChange={(next, msg) => {
            const prev = layouts.spending;
            saveLayout("spending", { on: next }).catch(showErr);
            if (msg) toast(msg, { action: t("common.undo"), onAction: () => { saveLayout("spending", prev || {}).catch(showErr); } });
          }}
          onReset={() => { saveLayout("spending", {}).catch(showErr); }} />
      ) : <>
        {/* Receipts lives on Spending (owner, 2026-11-02: Spending took
          * Lists' place on the bar). Stores is in More (owner, 2026-11-02:
          * "We don't need stores in the spending section"). */}
        <div className="group" id="an-places">
          <button className="navrow" id="btn-receipts" type="button" onClick={() => nav.show("receipts", { from: "analysis" })}>
            <span className="grow">{t("common.receipts")}<span className="sub">{t("lists.receiptsRowSub")} · {groupName ? t("lists.seenBy.group", { group: groupName }) : t("lists.seenBy.you")}</span></span><span className="chev">›</span></button>
        </div>
        <div id="an-none" hidden={show}><p className="muted">{t("analysis.fileAReceiptAndYour")}</p>
          <button className="btn primary wide" id="an-add" type="button" onClick={() => nav.show("receipts", { from: "analysis" })}>{t("analysis.addAReceipt")}</button></div>
        <div id="an-data" hidden={!show}>
          {on.map(id => <Fragment key={id}>{sections[id]}</Fragment>)}
        </div>
      </>}
      <InfoSheet k={info} onClose={() => setInfo(null)} />
    </>
  );
}
