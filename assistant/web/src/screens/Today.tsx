import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAvatar } from "../app/avatar";
import { useNav } from "../app/nav";
import { clearOnSignOut, useSession } from "../app/session";
import { questOpened } from "../lib/questSeen";
import { get, post, friendlyError } from "../lib/api";
import { MONTHS, asset, fmtDate, fmtShort, money } from "../lib/format";
import { charFor, useCharacters } from "../lib/characters";
import { A2hsCard } from "../ui/A2hs";
import { InfoSheetFrame, WhyRows } from "../ui/Info";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";
import { TownFeed } from "../ui/Town";
import { useTown } from "../lib/town";
import { t, useTranslation } from "../i18n";

/* Port of pwa/index.html #view-home and app.js renderHome and its
 * paintToday* functions, plus the Today parts of expiry.js (Use soon
 * and its sheets), a2hs.js (the Add to Home Screen card) and powers.js
 * (the Did you know? line and its share sheet). Every section stays
 * hidden when it has nothing to say (owner, 2026-10-29).
 *
 * Shared: lib/characters.ts (faces), ui/A2hs.tsx (the card). Local
 * helpers (not in ui/): the Expiry sheets and TipLine. The level chip (#today-level) lives on the Quest tab, not here; Today
 * only fills the avatar ring. */

const Face = ({ name }: { name: unknown }) => {
  const c = charFor(name);
  return c ? <img className="rowface" src={asset(`assets/characters/${c}`)} alt="" /> : null;
};

/* The Still good? fold keeps its state across visits (app.js todayChecksOpen). */
let checksOpenMem = false;
clearOnSignOut(() => { checksOpenMem = false; });

type Home = any;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isoToday = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
};
/* Where a pantry photo was taken (api/routes/eyes.py kinds). */
const PLACES = ["fridge", "pantry", "freezer", "fruit"];
const cap = (t: unknown) => String(t || "").replace(/^./, c => c.toUpperCase());

/* app.js storeAlertRows: up to three "not there" reports, then price
 * gaps worth a detour (two stores or more, 25 cents apart or more),
 * four rows at most. */
export type AlertRow = { key: string; kind: "report" | "price"; name: string; sub: string };
export function storeAlerts(h: Home, news: any[], currency?: Parameters<typeof money>[1]): AlertRow[] {
  const items: any[] = h?.list?.items || [];
  const rows: AlertRow[] = [];
  const mineNames = new Set(items.filter(i => !i.checked && i.on_list).map(i => String(i.name || "").toLowerCase()));
  news.slice(0, 3).forEach((n, k) => {
    const mine = mineNames.has(String(n.item || "").toLowerCase());
    rows.push({ key: "n" + k, kind: "report", name: t("today.alertNotThere", { store: n.store, item: n.item }),
      sub: t("today.alertReports", { count: n.count, date: fmtShort(String(n.reported_at || "").slice(0, 10)) }) + (mine ? t("today.alertOnYourList") : "") });
  });
  // Only what is on a list now: a price gap helps the next trip, not
  // the history (relevant cards, owner 2026-10-30).
  const names: Record<string, string> = Object.fromEntries(items.filter(i => !i.checked && i.on_list).map(i => [i.item_id, i.name]));
  for (const [id, by] of Object.entries<any>(h?.price_by_store || {})) {
    if (rows.length >= 4) break;
    const stores = Object.entries<any>(by).filter(([, p]) => p && p.median > 0);
    if (stores.length < 2 || !names[id]) continue;
    stores.sort((a, b) => a[1].median - b[1].median);
    const [lo, hi] = [stores[0], stores[stores.length - 1]];
    if (hi[1].median - lo[1].median < 0.25) continue; // not worth a detour
    rows.push({ key: "p" + id, kind: "price", name: t("today.alertPrice", { name: names[id], store: lo[0] }),
      sub: t("today.alertUsuallyPay", { price: money(lo[1].median, currency), usual: money(hi[1].median, currency), store: hi[0] }) });
  }
  return rows;
}

/* Adaptive Today (#156): a row section shows three rows at most, then
 * a "See N more" row that opens the rest in place; Your lists shows
 * four tiles at most when there are more than four lists, then
 * "See all N lists". Three rows or fewer, four lists or fewer: as
 * before. */
export const ROW_CAP = 3;
export const LIST_CAP = 4;
export function capRows<T>(rows: T[], open: boolean): { shown: T[]; more: number } {
  if (open || rows.length <= ROW_CAP) return { shown: rows, more: 0 };
  return { shown: rows.slice(0, ROW_CAP), more: rows.length - ROW_CAP };
}
export function capLists<T>(cards: T[], nLists: number): { shown: T[]; seeAll: boolean } {
  if (nLists <= LIST_CAP) return { shown: cards, seeAll: false };
  return { shown: cards.slice(0, LIST_CAP), seeAll: true };
}

/* Relevant cards (owner, 2026-10-30): a card shows only when it says
 * something true for you now. Empty lists fold into one row. */
export function emptyListsLine(names: string[]): string {
  if (names.length === 1) return t("today.emptyLists.one", { name: names[0] });
  if (names.length <= 3) return t("today.emptyLists.some", { names: names.slice(0, -1).join(", "), last: names[names.length - 1] });
  return t("today.emptyLists.many", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
}

/* The Did you know? line turns into what Arya actually found in the
 * receipts (/api/prices/insights): an item that got pricier, with the
 * store that has it for less when Today knows one; else the store
 * where an item is cheaper. Null when there is nothing worth saying. */
export type Insights = {
  basket?: { since_month: string; movers?: { item_id?: string; name: string; pct: number }[] } | null;
  split?: { moves: { item_id?: string; name: string; to: string; month_dollars: number }[] } | null;
} | null;
export const FINDING_MIN_PCT = 5;
export function findingLine(ins: Insights, h: Home, currency?: Parameters<typeof money>[1]): string | null {
  const up = (ins?.basket?.movers || []).find(m => m.pct >= FINDING_MIN_PCT);
  if (up) {
    const pct = `${up.pct.toFixed(up.pct < 10 ? 1 : 0).replace(/\.0$/, "")}%`;
    let line = t("today.finding.up", { name: up.name, pct, month: ins!.basket!.since_month });
    const by = Object.entries<any>((up.item_id && h?.price_by_store?.[up.item_id]) || {}).filter(([, p]) => p && p.median > 0);
    if (by.length >= 2) {
      by.sort((a, b) => a[1].median - b[1].median);
      if (by[by.length - 1][1].median - by[0][1].median >= 0.25) line += " " + t("today.finding.cheaperAt", { store: by[0][0] });
    }
    return line;
  }
  const mv = (ins?.split?.moves || [])[0];
  if (mv && mv.month_dollars >= 1) return t("today.finding.move", { name: mv.name, store: mv.to, money: money(mv.month_dollars, currency) });
  return null;
}

/* "From your receipts up to …" only when the last one is a week old. */
export const STALE_DAYS = 7;
export function staleThrough(asOf: string | undefined, today: string): boolean {
  if (!asOf) return false;
  return (new Date(today + "T12:00:00").getTime() - new Date(asOf.slice(0, 10) + "T12:00:00").getTime()) / 864e5 > STALE_DAYS;
}

function MoreRow({ more, onOpen }: { more: number; onOpen: () => void }) {
  const { t } = useTranslation();
  return more > 0 ? <button className="morerow" type="button" data-see-more onClick={onOpen}>{t("today.seeMore", { count: more })}</button> : null;
}

/* ---------------- Get started (#163, #207) ----------------
 * A new account's Today: one card with the first trip in four steps
 * (owner, 2026-10-30): list, store, shopping, receipt. Only the next
 * step is lit. The server sends get_started only for an account that
 * was empty when it answered the welcome, until all four are done or
 * the card is closed (api/routes/account.py first_run). Use-by dates
 * come after the receipt instead (the Use soon card below). */
export type GetStarted = { list: boolean; store: boolean; shop: boolean; receipt: boolean } | null | undefined;
export const GS_STEPS = ["list", "store", "shop", "receipt"] as const;
export type GsStep = (typeof GS_STEPS)[number];
export function getStartedView(gs: GetStarted): { show: boolean; done: number; steps: { key: GsStep; done: boolean }[] } {
  const steps = GS_STEPS.map(key => ({ key, done: !!gs?.[key] }));
  const done = steps.filter(x => x.done).length;
  return { show: !!gs && done < steps.length, done, steps };
}

export function GetStartedCard({ gs, onStep, onDismiss }: { gs: GetStarted; onStep: (k: GsStep) => void; onDismiss: () => void }) {
  const { t } = useTranslation();
  const v = getStartedView(gs);
  const next = v.steps.findIndex(x => !x.done);
  // List and store are ready but no trip yet: the card just waits.
  const waiting = v.steps[next]?.key === "shop";
  return (
    <article className="fr-card" id="today-getstarted" aria-labelledby="gs-title">
      <button className="tipx fr-x" type="button" id="gs-dismiss" aria-label={t("today.gs.dismiss")} onClick={onDismiss}>×</button>
      <p className="fr-k">{t("today.gs.kicker", { n: v.done, total: v.steps.length })}</p>
      <h3 className="fr-h" id="gs-title">{t("today.gs.title")}</h3>
      <p className="fr-s">{t("today.gs.line")}</p>
      <ul className="fr-steps">
        {v.steps.map((st, k) => (
          <li key={st.key} className={st.done ? "done" : k === next ? "next" : "later"}>
            <button type="button" data-gs={st.key} aria-label={st.done ? t("today.gs.doneAria", { step: t(`today.gs.${st.key}`) }) : undefined}
              onClick={() => onStep(st.key)}>
              <span className="fr-dot" aria-hidden="true">{st.done ? "✓" : k + 1}</span>
              <span className="grow"><b>{t(`today.gs.${st.key}`)}</b><small>{t(`today.gs.${st.key}Sub`)}</small></span>
              <span className="chev" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
      </ul>
      {waiting && <p className="gs-wait">{t("today.gs.wait")}</p>}
    </article>
  );
}

export function Today() {
  const { t } = useTranslation();
  const nav = useNav();
  const { currency, demo, user } = useSession();
  // The Quest nudge retires once this account has opened Quest.
  const [questSeen] = useState(() => questOpened(user));
  const town = useTown();
  const { toast, showErr } = useToast();
  const { setRing } = useAvatar();
  const [h, setH] = useState<Home | null>(null);
  const [news, setNews] = useState<any[] | null>(null);
  const [eyeCount, setEyeCount] = useState(0);
  const [months, setMonths] = useState<{ spend: Record<string, number> } | null>(null);
  const [facts, setFacts] = useState<Facts | null>(null);
  const [ins, setIns] = useState<Insights>(null);
  const [checksOpen, setChecksOpenState] = useState(checksOpenMem);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [ex, setEx] = useState<ExState>(null);
  const [gs, setGs] = useState<GetStarted>(null);
  const [lowOpen, setLowOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const live = useRef(true);

  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useCharacters();

  const load = useCallback(async () => {
    let home: Home, st: { get_started?: GetStarted } | null;
    try {
      [home, st] = await Promise.all([get("/api/home"), demo ? null : get("/api/settings").catch(() => null)]);
    } catch (e) { showErr(e); return; }
    if (!live.current) return;
    setGs(st?.get_started ?? null);
    setH(home);
    setAdded(new Set());
    get("/api/quest/news").then(n => live.current && setNews(n.news || []), () => live.current && setNews([]));
    get("/api/dashboard").then(d => live.current && setMonths({ spend: d.spend_by_month || {} }), () => live.current && setMonths(null));
    // powers.js loadFacts: a failed read keeps the last facts (at first
    // the defaults), so the tip still shows.
    get<Insights>("/api/prices/insights").then(r => live.current && setIns(r), () => live.current && setIns(null));
    get<Facts>("/api/powers").then(f => live.current && setFacts(f),
      () => live.current && setFacts(f => f || { receipts: 0, stores: 0, share_prices: false }));
    Promise.all([
      get("/api/review").catch(() => ({ lines: [], unresolved: [] })),
      get("/api/curator").catch(() => ({ proposals: [] })),
    ]).then(([q, cur]) => {
      if (live.current) setEyeCount((q.lines || []).length + (q.unresolved || []).length + (cur.proposals || []).length);
    });
    // The avatar ring fills toward the next level.
    get("/api/quest/profile").then(p => {
      if (!p || !p.level || !live.current) return;
      const span = (p.next_level_at - p.level_floor) || 1;
      const pct = Math.max(0, Math.min(100, Math.round((p.points - p.level_floor) / span * 100)));
      setRing({ pct, level: p.level });
    }).catch(() => {});
  }, [showErr, setRing, demo]);
  useEffect(() => { load(); }, [load]);
  // What Arya can do › Use soon › Add a date opens the date sheet here.
  useEffect(() => {
    if (nav.params.snapDate) { nav.params.snapDate = undefined; setEx({ k: "capture" }); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Get started ---- */
  const firstRun = !!h && getStartedView(gs).show;
  function gsStep(k: GsStep) {
    const first: string | undefined = (h?.lists || [])[0]?.id;
    if (k === "list" || !first && k !== "receipt") nav.show("list", { newList: true });
    else if (k === "store") nav.show("list", { lens: first, stores: true });
    else if (k === "shop") nav.show("list", { lens: first });
    else nav.show("receipts", { from: "home" });
  }
  function gsDismiss() {
    setGs(null);
    post("/api/settings", { get_started_dismissed: true }).catch(e => toast(e instanceof Error ? e.message : String(e)));
  }

  const now = new Date();
  const items: any[] = h?.list?.items || [];

  /* ---- Running low ---- */
  const onList = new Set(items.filter(i => !i.checked && i.on_list).map(i => i.item_id));
  // Already on a list: handled, so the row goes (one added here stays
  // until you leave, so the tap shows its result).
  const low: any[] = (h?.running_low || []).filter((i: any) => !onList.has(i.item_id) || added.has(i.item_id)).slice(0, 5);
  async function addLow(id: string) {
    setBusy(b => new Set(b).add(id));
    try {
      await post("/api/list/add", { item_id: id });
      setAdded(a => new Set(a).add(id));
      toast(t("common.addedToList"));
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    setBusy(b => { const n = new Set(b); n.delete(id); return n; });
  }

  /* ---- Store alerts ---- */
  const alertRows = h && news ? storeAlerts(h, news, currency) : [];
  const lowCap = capRows(low, lowOpen);

  /* ---- Still good? ---- */
  // The after-receipt card already asks about these; no repeats.
  const asked = new Set<string>((h?.perishables?.items || []).map((i: { item_id: string }) => i.item_id));
  const checks: any[] = (h?.checks || []).filter((c: any) => !asked.has(c.item_id));
  const seen: any[] = (h?.seen || []).filter((c: any) => !asked.has(c.item_id));
  const nChecks = checks.length + seen.length;
  const checkNames = [...checks.map(c => c.name || ""), ...seen.map(s => s.name)].filter(Boolean);
  const checkLabel = checkNames.length ? checkNames.slice(0, 2).join(", ") + (checkNames.length > 2 ? t("today.andMore", { n: checkNames.length - 2 }) : "") : "";
  async function check(kind: "ok" | "expired", id: string) {
    try {
      if (kind === "ok") {
        await post("/api/list/check-ok", { item_id: id });
        toast(t("today.stillGoodToast"));
      } else {
        await post(`/api/items/${encodeURIComponent(id)}/expired`);
        toast(t("today.markedExpiredToast"));
      }
      load();
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }

  /* ---- Your lists ---- */
  const listItems = items.filter(i => !i.checked && i.on_list && !i.not_grocery);
  const lists: any[] = h?.lists || [];
  const allCards = lists.map(l => ({ id: l.id as string, name: l.name as string, items: listItems.filter(i => i.list === l.id) }));
  const cards = allCards.filter(c => c.items.length);
  const emptyNames = allCards.filter(c => !c.items.length).map(c => c.name);
  const rest = listItems.filter(i => !i.list || !lists.some(l => l.id === i.list));
  if (rest.length || (!cards.length && !emptyNames.length)) cards.push({ id: "else", name: lists.length ? t("common.everythingElse") : t("today.yourList"), items: rest });
  const noLists = !listItems.length && !lists.length;
  const listCap = capLists(cards, cards.length);

  /* ---- Your patterns ---- */
  const monthKeys = months ? Object.keys(months.spend).sort() : [];
  const lastMonth = monthKeys[monthKeys.length - 1];

  /* ---- Use soon ---- */
  const soon: Soon[] = h?.use_soon || [];
  const perish: Perish | null = h?.perishables || null;
  const [perishOpen, setPerishOpen] = useState(false);
  async function perishNotNow() {
    if (!perish) return;
    setH((x: Home) => ({ ...x, perishables: null }));
    try { await post("/api/expiry/nudge", { action: "not_now", date: perish.date }); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <>
      <p id="today-dow" className="dow">{h ? `${DAYS[now.getDay()]} · ${fmtDate(isoToday())}` : ""}</p>
      <div className="titlerow"><h1 className="largetitle">{t("today.today")}</h1></div>
      {firstRun && <GetStartedCard gs={gs} onStep={gsStep} onDismiss={gsDismiss} />}
      <div id="today-a2hs">{h && <A2hsCard hasList={items.some(i => i.on_list)} demo={demo} />}</div>
      {town ? <TownFeed town={town} /> : null}
      <div id="today-low">
        {low.length > 0 && (
          <>
            <h3 className="sect">{t("common.runningLow")}</h3>
            <div className="group">
              {lowCap.shown.map(i => (
                <div className="row" key={i.item_id}>
                  <Face name={i.name} />
                  <div className="grow">
                    <a href="#" className="name item-link" data-id={i.item_id}
                      onClick={ev => { ev.preventDefault(); nav.show("item", { id: String(i.item_id) }); }}>{i.name}</a>
                    <span className="sub">{cap(i.reason)}</span></div>
                  {onList.has(i.item_id) || added.has(i.item_id)
                    ? <span className="chip onlist" aria-label={added.has(i.item_id) ? undefined : t("today.onYourList")}>{t("today.onList")}</span>
                    : <button className="chip" data-low-add={i.item_id} type="button" aria-label={t("today.addToYourList", { name: i.name })}
                      disabled={busy.has(i.item_id)} onClick={() => addLow(i.item_id)}>{t("common.add")}</button>}
                </div>
              ))}
              <MoreRow more={lowCap.more} onOpen={() => setLowOpen(true)} />
            </div>
          </>
        )}
      </div>
      <div className="sectrow" id="today-lists-row" hidden={!h || noLists}>
        <h3 className="sect">{t("today.yourLists")}</h3>
      </div>
      <div id="today-lists">
        {h && !noLists && cards.length > 0 && (
          <div className="listcards">
            {listCap.shown.map(c => (
              <button className="listcard" key={c.id} data-open-list={c.id} type="button" onClick={() => nav.show("list", { lens: c.id })}>
                <span className="lc-name">{c.name}</span>
                <span className="lc-count">{t("common.itemCount", { count: c.items.length })}</span>
                <span className="lc-items">{c.items.length ? c.items.slice(0, 3).map(i => i.name).join(", ") + (c.items.length > 3 ? "…" : "") : t("today.nothingToGet")}</span>
              </button>
            ))}
          </div>
        )}
        {h && !noLists && emptyNames.length > 0 && (
          <div className="group"><button className="hubrow" id="today-emptylists" type="button" onClick={() => nav.show("list")}>
            <span className="hr-label">{emptyListsLine(emptyNames)}<span className="sub">{t(facts?.receipts ? "today.emptyLists.sub" : "today.emptyLists.subNew")}</span></span>
            <span className="chev" aria-hidden="true">›</span></button></div>
        )}
        {h && listCap.seeAll && (
          <button id="today-seeall" className="seeall" type="button" onClick={() => nav.show("list")}>
            <span>{t("today.seeAllLists", { count: lists.length })}</span><span aria-hidden="true">›</span></button>
        )}
      </div>
      <div id="today-alerts">
        {/* Out-of-stock reports and price tips are two kinds of row, so
          * each gets its own heading (labels audit, 2026-10-29). */}
        {([["report", "today.storeAlerts"], ["price", "today.cheaperElsewhere"]] as const).map(([kind, head]) => {
          const rows = alertRows.filter(r => r.kind === kind);
          const capped = capRows(rows, alertsOpen);
          return rows.length > 0 && <Fragment key={kind}><h3 className="sect">{t(head)}</h3><div className="group">{capped.shown.map(r => (
            <div className="row" key={r.key}><span className={r.kind === "price" ? "alertic good" : "alertic"} aria-hidden="true">{r.kind === "price" ? "$" : "!"}</span><div className="grow">
              <span className="name">{r.name}</span><span className="sub">{r.sub}</span></div></div>))}<MoreRow more={capped.more} onOpen={() => setAlertsOpen(true)} /></div></Fragment>;
        })}
      </div>
      <div id="today-expiry">
        {h && <UseSoon soon={soon} perish={perish} setEx={setEx} onDone={s => doneWith(s)}
          onPerish={() => setPerishOpen(true)} onNotNow={perishNotNow} />}
      </div>
      <div id="today-checks">
        {nChecks > 0 && (
          <div className={"group checkfold" + (checksOpen ? " open" : "")}>
            <button className="hubrow" type="button" data-checks-fold aria-expanded={String(checksOpen) as "true" | "false"}
              onClick={() => { checksOpenMem = !checksOpen; setChecksOpenState(checksOpenMem); }}>
              <span className="hr-label">{t("today.stillGoodToCheck", { nChecks })}{checkLabel ? <span className="sub">{checkLabel}</span> : null}</span><span className="chev">›</span></button>
            <div className="checkrows" hidden={!checksOpen}>
              {checks.map(c => (
                <div className="row" key={c.item_id}><div className="grow"><span className="checktext">{c.text}</span>
                  <span className="chipset">
                    <button className="chip" data-check-ok={c.item_id} type="button" onClick={() => check("ok", c.item_id)}>{t("today.stillGood")}</button>
                    <button className="chip" data-check-expired={c.item_id} type="button" onClick={() => check("expired", c.item_id)}>{t("today.itExpired")}</button></span></div></div>
              ))}
              {seen.map((s, k) => (
                <div className="row" key={"s" + k}><div className="grow"><span className="checktext">{s.name}</span>
                  <span className="sub">{t("today.seenInTheInStock", { place: t(`today.place.${PLACES.includes(s.kind) ? s.kind : "photo"}`), date: fmtShort(s.date) })}</span></div></div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div id="today-eye">
        {eyeCount > 0 && (
          <button className="hubrow" id="today-eye-btn" type="button" onClick={() => nav.show("receipts", { from: "home" })}>
            <span className="hr-label">{t("today.needsYourEye", { count: eyeCount })}</span><span className="chev">›</span></button>
        )}
      </div>
      <div id="today-patterns">
        {lastMonth && months && (
          <>
            <h3 className="sect">{t("today.yourPatterns")}</h3>
            <button className="hubrow" id="today-patterns-btn" type="button" onClick={() => nav.show("analysis", { from: "home" })}>
              <span className="hr-label">{t("today.spent", { value: MONTHS[Number(lastMonth.slice(5, 7)) - 1], money: money(months.spend[lastMonth], currency) })}</span>
              <span className="hr-action">{t("today.patterns")}</span><span className="chev">›</span></button>
          </>
        )}
      </div>
      <p id="today-through" className="muted small throughline">{h?.as_of && staleThrough(h.as_of, isoToday()) ? t("today.dataThrough", { date: fmtDate(h.as_of) }) : ""}</p>
      <div id="today-tip">{facts && !firstRun && <TipLine facts={facts} setFacts={setFacts} finding={h ? findingLine(ins, h, currency) : null} />}</div>
      {listItems.length > 0 && !questSeen && (
        <button id="today-quest" className="gamerow newrow" type="button" onClick={() => nav.show("community")}>
          <img className="rowimg" src={asset("assets/scenes/storefront.webp")} alt="" />
          <span className="g-main"><span className="g-name">{t("today.makeYourNextRunA")}</span><span className="g-sub">{t("today.turnTheListInto")}</span></span>
          <span className="chev">›</span></button>
      )}
      <ExpirySheets ex={ex} setEx={setEx} soon={soon} demo={demo} reload={load} />
      {perish && <PerishSheet open={perishOpen} perish={perish} demo={demo}
        onClose={() => setPerishOpen(false)} onMore={() => { setPerishOpen(false); setEx({ k: "capture" }); }} reload={load} />}
    </>
  );

  /* Used up: offer, never assume, to put it back on the shopping list
   * (expiry.js done). */
  async function doneWith(s: Soon) {
    try { await post(`/api/expiry/${encodeURIComponent(s.item_id)}/done`); }
    catch (e) { toast(e instanceof Error ? e.message : String(e)); return; }
    load();
    toast(t("today.doneWith", { name: s.name }), {
      action: t("common.add"),
      onAction: async () => {
        try { await post("/api/list/add", { item_id: s.item_id }); toast(t("today.isOnYourList", { name: s.name })); load(); }
        catch (e) { toast(e instanceof Error ? e.message : String(e)); }
      },
    });
  }
}

/* ---------------- Did you know? (powers.js todaysTip) ---------------- */
type Facts = { receipts: number; stores: number; share_prices: boolean };
type Tip = { id: string; titleKey: string; share?: boolean; on?: (f: Facts) => boolean; near?: (f: Facts) => boolean; hidden?: boolean };
/* A tip about a power is news only when that power is one step from
 * turning on (relevant cards, owner 2026-10-30); once it works, the
 * finding line shows what it found instead. */
/* The powers that carry a tip or a share prompt, in powers.js order. */
const TIPS: Tip[] = [
  { id: "community", titleKey: "today.tip.community", share: true, near: f => !f.share_prices && f.receipts >= 3 },
  // Deals and Arya Shoppers are not built yet: their tips stay hidden
  // (keys kept) until they are (labels audit, judgement call 1).
  { id: "deals", titleKey: "today.tip.deals", share: true, hidden: true },
  { id: "shoppers", titleKey: "today.tip.shoppers", share: true, hidden: true },
  { id: "compare", titleKey: "today.tip.compare", near: f => f.stores === 1 && f.receipts >= 1 },
  { id: "trends", titleKey: "today.tip.trends", near: f => f.receipts === 2 },
  { id: "similar", titleKey: "today.tip.similar", near: f => f.receipts === 0 && f.stores > 0 },
  { id: "split", titleKey: "today.tip.split", near: f => f.stores === 1 && f.receipts >= 1 },
  { id: "waste", titleKey: "today.tip.waste" },
];
const TIP_KEY = "arya-tip-hidden";
const hiddenTips = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(TIP_KEY) || "{}"); } catch { return {}; }
};
function hideTip(id: string) {
  const h = hiddenTips();
  h[id] = new Date().toISOString().slice(0, 10);
  try { localStorage.setItem(TIP_KEY, JSON.stringify(h)); } catch { /* private window */ }
}
export function todaysTip(facts?: Facts | null): Tip | null {
  const today = new Date().toISOString().slice(0, 10);
  const hid = hiddenTips();
  if (Object.values(hid).includes(today)) return null; // one a day, and Not now means not today
  const tips = TIPS.filter(p => !p.hidden && (!facts || (p.near ? p.near(facts) : false)));
  if (!tips.length) return null;
  const start = Math.floor(Date.now() / 864e5) % tips.length;
  for (let k = 0; k < tips.length; k++) {
    const p = tips[(start + k) % tips.length];
    if (!hid[p.id]) return p;
  }
  return null;
}

const FINDING: Tip = { id: "finding", titleKey: "" };

function TipLine({ facts, setFacts, finding }: { facts: Facts; setFacts: (f: Facts) => void; finding: string | null }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const [hidden, setHidden] = useState(false);
  // A real finding beats a tip; a tip only for a power that is still off.
  const [tipPick] = useState<Tip | null>(() => todaysTip(facts));
  const findOk = !!finding && !Object.values(hiddenTips()).includes(new Date().toISOString().slice(0, 10));
  const tip = hidden ? null : findOk ? FINDING : tipPick;
  const [share, setShare] = useState(false);

  async function setSharing(on: boolean) {
    try {
      const r = await post<{ share_prices: boolean }>("/api/powers/share", { on });
      setFacts({ ...facts, share_prices: !!r.share_prices });
      setShare(false);
      toast(on ? t("today.sharingThanks") : t("today.sharingOff"));
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }

  const act = tip?.share && !facts.share_prices ? "share" : "all";
  return (
    <>
      {tip && (
        <div className="tipline">
          {tip === FINDING
            ? <button className="hubrow" type="button" data-tip="finding" onClick={() => nav.show("analysis", { from: "home" })}>
              <span className="hr-label"><span className="tipkick">{t("today.finding.kicker")}</span>{finding}</span><span className="chev">›</span></button>
            : <button className="hubrow" type="button" data-tip={act} onClick={() => (act === "share" ? setShare(true) : nav.show("powers"))}>
              <span className="hr-label"><span className="tipkick">{t("today.didYouKnow")}</span>{t(tip.titleKey)}</span><span className="chev">›</span></button>}
          <button className="tipx" type="button" data-tip="hide" data-tip-id={tip.id} aria-label={t("common.notNow")}
            onClick={() => { hideTip(tip.id); setHidden(true); }}>×</button>
        </div>
      )}
      <InfoSheetFrame open={share} onClose={() => setShare(false)} title={t("today.shopSmarterTogether")} sub={t("today.everyReceiptAndReportMakes")}>
        <WhyRows rows={[
          [t("common.sharing.youGive"), t("common.sharing.youGiveText")],
          [t("common.sharing.youGet"), t("common.sharing.youGetText")],
          [t("common.sharing.reportsMatter"), t("common.sharing.reportsMatterText")]]} />
        <div className="sheetacts"><button className="btn secondary" type="button" data-pw="close" onClick={() => setShare(false)}>{t("common.notNow")}</button>
          <button className="btn primary" type="button" data-pw={facts.share_prices ? "unshare" : "doshare"} onClick={() => setSharing(!facts.share_prices)}>{facts.share_prices ? t("common.sharing.stop") : t("common.sharing.start")}</button></div>
        <p className="sub nomargin" style={{ textAlign: "center", fontSize: 13 }}>{t("today.optionalYouCanTurnIt")}</p>
      </InfoSheetFrame>
    </>
  );
}

/* ---------------- Use soon and the expiry sheets (expiry.js) ---------------- */
type Soon = { item_id: string; name: string; date: string; days: number };
type Perish = { receipt_id: string; store: string; date: string; items: { item_id: string; name: string }[] };
type Opt = { id: string; name: string; tag: string };
type Read = { readable?: boolean; date: string; kind?: string; raw?: string; name?: string; match?: { item_id: string; name: string } | null };
type ExState =
  | null
  | { k: "capture" }
  | { k: "reading" }
  | { k: "cant"; why?: string }
  | { k: "confirm"; read: Read; opts: Opt[] }
  | { k: "type"; item?: Soon; opts: Opt[] }
  | { k: "item"; id: string };

const KIND_WORD: Record<string, string> = { use_by: "today.kind.useBy", best_by: "today.kind.bestBy", expires: "today.kind.expires" };
const dateObj = (iso: string) => new Date(iso + "T12:00:00");
const fmtLong = (iso: string) => {
  const d = dateObj(iso);
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
};
const fmtMD = (iso: string) => { const d = dateObj(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
function when(days: number) {
  if (days < 0) return t("today.when.past");
  if (days === 0) return t("today.when.today");
  if (days === 1) return t("today.when.tomorrow");
  return t("today.when.inDays", { count: days });
}

/* Use soon shows only when it has something (owner, 2026-10-30): dated
 * rows, or the card naming what a recent receipt holds that can expire or go bad.
 * With neither, the section is gone; a date can still be added by hand
 * from What Arya can do › Use soon. */
export function perishNames(items: { name: string }[]): string {
  const names = items.map(i => i.name);
  return names.length > 3 ? t("today.perish.andMore", { names: names.slice(0, 3).join(", "), count: names.length - 3 }) : names.join(", ");
}

function UseSoon({ soon, perish, setEx, onDone, onPerish, onNotNow }: { soon: Soon[]; perish: Perish | null; setEx: (s: ExState) => void;
  onDone: (s: Soon) => void; onPerish: () => void; onNotNow: () => void }) {
  const { t } = useTranslation();
  const snap = () => setEx({ k: "capture" });
  const [soonOpen, setSoonOpen] = useState(false);
  if (!soon.length && !perish) return null;
  const open = (id: string) => setEx({ k: "item", id });
  const capped = capRows(soon, soonOpen);
  return (
    <>
      <div className="sectrow"><h3 className="sect">{t("common.useSoon")}</h3>{perish
        ? <button className="linkbtn" type="button" id="perish-notnow" onClick={onNotNow}>{t("common.notNow")}</button>
        : <button className="linkbtn" type="button" data-ex-snap onClick={snap}><span aria-hidden="true">+ </span>{t("today.snapADate")}</button>}</div>
      {perish && (
        <div className="group"><button className="hubrow snaprow" type="button" id="perish-open" onClick={onPerish}>
          <img className="rowface" src={asset("assets/characters/pantry.webp")} alt="" />
          <span className="hr-label">{t("today.perish.title", { count: perish.items.length })}<span className="sub">{t("today.perish.names", { names: perishNames(perish.items) })}</span></span>
          <span className="chev">›</span></button></div>
      )}
      {soon.length > 0 && <><div className="group usesoon">
        {capped.shown.map(s => (
          <div className="row" key={s.item_id} tabIndex={0} role="button" data-ex-item={s.item_id}
            onClick={() => open(s.item_id)}
            onKeyDown={(ev: KeyboardEvent<HTMLDivElement>) => { if (ev.target === ev.currentTarget && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); open(s.item_id); } }}>
            <Face name={s.name} />
            <div className="grow"><span className="name">{s.name}</span><span className="sub"><b>{fmtLong(s.date)}</b> · {when(s.days)}</span></div>
            <button className="chip" data-ex-done={s.item_id} type="button" onClick={ev => { ev.stopPropagation(); onDone(s); }}>{t("today.usedIt")}</button></div>
        ))}
        <MoreRow more={capped.more} onOpen={() => setSoonOpen(true)} />
      </div>
      <p className="muted small listhint">{t("today.tapARowToSnooze")}</p></>}
    </>
  );
}

async function itemOptions(match?: { item_id: string; name: string } | null): Promise<Opt[]> {
  let cands: any[] = [];
  try { cands = (await get("/api/list/candidates")).candidates || []; } catch { cands = []; }
  cands.sort((a, b) => ((b.on_list ? 1 : 0) - (a.on_list ? 1 : 0)) || a.name.localeCompare(b.name));
  const seen = new Set<string>(), opts: Opt[] = [];
  const add = (id: string, name: string, tag: string) => { if (!id || seen.has(id)) return; seen.add(id); opts.push({ id, name, tag }); };
  if (match) add(match.item_id, match.name, "");
  cands.forEach(c => add(c.item_id, c.name, c.on_list ? t("today.onYourListTag") : ""));
  return opts;
}

function ExpirySheets({ ex, setEx, soon, demo, reload }: { ex: ExState; setEx: (s: ExState) => void; soon: Soon[]; demo: boolean; reload: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const close = useCallback(() => setEx(null), [setEx]);
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const handleRead = async (read: Read) => {
    if (!read.readable) { setEx({ k: "cant" }); return; }
    setEx({ k: "confirm", read, opts: await itemOptions(read.match) });
  };
  async function readPhoto(file: File) {
    setEx({ k: "reading" });
    try {
      const r = await fetch("/api/expiry/read", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      if (!r.ok) throw new Error(friendlyError((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`));
      await handleRead(await r.json());
    } catch (e) { setEx({ k: "cant", why: errMsg(e) }); }
  }
  async function readSample() {
    setEx({ k: "reading" });
    try { await handleRead(await post("/api/expiry/read?sample=1")); }
    catch (e) { setEx({ k: "cant", why: errMsg(e) }); }
  }
  const typeSheet = async (item?: Soon) =>
    setEx({ k: "type", item, opts: item ? [{ id: item.item_id, name: item.name, tag: "" }] : await itemOptions(null) });

  const item = ex?.k === "item" ? soon.find(x => x.item_id === ex.id) : undefined;
  const grip = <span className="sheetgrip" />;
  let body = null;

  if (ex?.k === "capture") {
    body = (
      <>
        <h3 className="hm-title" id="ex-title">{t("today.snapTheDate")}</h3>
        <p className="muted">{t("today.pointYourCameraAtThe")}</p>
        <label className="btn primary wide" htmlFor="ex-photo" data-first tabIndex={0} role="button"
          onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); document.getElementById("ex-photo")?.click(); } }}>{t("today.takeAPhoto")}</label>
        <input type="file" id="ex-photo" accept="image/*" capture="environment" hidden
          onChange={ev => { const f = ev.target.files?.[0]; if (f) readPhoto(f); }} />
        {demo && <button className="btn wide" id="ex-sample" type="button" onClick={readSample}>{t("today.tryASampleDate")}</button>}
        <p className="exlinks"><button className="linkbtn" id="ex-type" type="button" onClick={() => typeSheet()}>{t("today.typeTheDateInstead")}</button></p>
      </>
    );
  } else if (ex?.k === "reading") {
    body = (
      <>
        <h3 className="hm-title" id="ex-title">{t("today.readingTheDate")}</h3>
        <p className="muted" role="status">{t("today.sparkIsLookingAtThe")}</p>
      </>
    );
  } else if (ex?.k === "cant") {
    body = (
      <>
        <h3 className="hm-title" id="ex-title">{t("today.aryaCouldnTReadThat")}</h3>
        <p className="muted">{ex.why ? ex.why : t("today.glareHint")}</p>
        <button className="btn primary wide" id="ex-again" type="button" data-first onClick={() => setEx({ k: "capture" })}>{t("common.tryAgain")}</button>
        <button className="btn wide" id="ex-type" type="button" onClick={() => typeSheet()}>{t("today.typeTheDate")}</button>
        <p className="exlinks"><button className="linkbtn" id="ex-skip" type="button" onClick={close}>{t("today.skipForNow")}</button></p>
      </>
    );
  } else if (ex?.k === "confirm" || ex?.k === "type") {
    body = (
      <ConfirmForm key={ex.k + (ex.k === "type" ? ex.item?.item_id || "" : ex.read.date)} ex={ex}
        onSaved={(msg) => { close(); toast(msg); reload(); }} onError={m => toast(m)} />
    );
  } else if (ex?.k === "item" && item) {
    const s = item;
    body = (
      <>
        <div className="exhead"><Face name={s.name} /><div><h3 className="hm-title" id="ex-title">{s.name}</h3><p className="muted nomargin">{fmtLong(s.date)} · {when(s.days)}</p></div></div>
        <button className="btn primary wide" id="ex-done" type="button" data-first onClick={async () => {
          close();
          try { await post(`/api/expiry/${encodeURIComponent(s.item_id)}/done`); } catch (e) { toast(errMsg(e)); return; }
          reload();
          toast(t("today.doneWith", { name: s.name }), {
            action: t("common.add"),
            onAction: async () => {
              try { await post("/api/list/add", { item_id: s.item_id }); toast(t("today.isOnYourList", { name: s.name })); reload(); }
              catch (e) { toast(errMsg(e)); }
            },
          });
        }}>{t("today.usedIt")}</button>
        <button className="btn wide" id="ex-snooze" type="button" onClick={async () => {
          close();
          try { await post(`/api/expiry/${encodeURIComponent(s.item_id)}/snooze`); toast(t("today.snoozedToast", { name: s.name })); reload(); }
          catch (e) { toast(errMsg(e)); }
        }}>{t("today.remindMeIn2Days")}</button>
        <button className="btn wide" id="ex-fix" type="button" onClick={() => typeSheet(s)}>{t("today.fixTheDate")}</button>
        <p className="exlinks"><button className="linkbtn" id="ex-stop" type="button" onClick={async () => {
          close();
          try { await post(`/api/expiry/${encodeURIComponent(s.item_id)}/stop`); toast(t("today.stoppedToast", { name: s.name })); reload(); }
          catch (e) { toast(errMsg(e)); }
        }}>{t("today.stopTrackingThis")}</button></p>
      </>
    );
  }

  return (
    <Sheet open={!!body} onClose={close} id="expiry-sheet" labelledBy="ex-title" focusKey={ex ? ex.k : ""}>
      {grip}
      {body}
    </Sheet>
  );
}

/* The confirm sheet (after a read) and the type sheet (typed or fixed)
 * share the item picker, the date and the save (expiry.js confirmSheet,
 * typeSheet, save). */
function ConfirmForm({ ex, onSaved, onError }: { ex: Extract<ExState, { k: "confirm" | "type" }>; onSaved: (msg: string) => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const read = ex.k === "confirm" ? ex.read : null;
  const fix = ex.k === "type" ? ex.item : undefined;
  const opts = ex.opts;
  const [sel, setSel] = useState(opts.length ? opts[0].id : "");
  const [name, setName] = useState(opts.length ? "" : (read?.name || ""));
  const [date, setDate] = useState(read ? read.date : fix ? fix.date : "");
  const [busy, setBusy] = useState(false);
  const kind = read ? read.kind : "unknown";
  const nameRef = useRef<HTMLInputElement>(null);

  async function save() {
    if (!date) { onError(t("today.pickDateFirst")); return; }
    const nm = name.trim();
    if (!sel && !nm) { onError(t("today.sayWhatItem")); return; }
    setBusy(true);
    try {
      const out = await post("/api/expiry/save", sel ? { item_id: sel, date, kind } : { name: nm, date, kind });
      onSaved(t("today.trackingUntil", { name: out.name, date: fmtMD(out.date) }));
    } catch (e) { setBusy(false); onError(e instanceof Error ? e.message : String(e)); }
  }

  const picker = (
    <>
      <select id="ex-item" aria-label={t("today.itemHeading")} value={sel}
        onChange={ev => { setSel(ev.target.value); if (!ev.target.value) setTimeout(() => nameRef.current?.focus()); }}>
        {opts.map(o => <option key={o.id} value={o.id}>{o.name + o.tag}</option>)}
        <option value="">{opts.length ? t("today.differentItem") : t("today.nameTheItem")}</option>
      </select>
      <input type="text" id="ex-name" ref={nameRef} placeholder={t("today.whatIsIt")} value={name} hidden={sel !== ""} aria-label={t("today.itemName")} autoComplete="off"
        onChange={ev => setName(ev.target.value)} />
    </>
  );
  const dateRow = (
    <div className="exkv"><span className="exk">{t("today.date")}</span><span className="exv"><input type="date" id="ex-date" value={date} aria-label={t("today.date")} onChange={ev => setDate(ev.target.value)} /></span></div>
  );

  if (read) {
    const name0 = read.match ? read.match.name : (read.name || t("today.thisItem"));
    const word = t(KIND_WORD[read.kind || ""] || "today.kind.date");
    return (
      <>
        <p className="dow nomargin">{t("today.aryaRead")}</p>
        {read.raw ? <div className="excrop">{read.raw}</div> : null}
        <h3 className="bigdate" id="ex-title">{t("today.readHeadline", { name: name0, word, date: fmtMD(read.date) })}</h3>
        <p className="muted nomargin">{fmtLong(read.date)} · {when(Math.round((dateObj(read.date).getTime() - dateObj(isoToday()).getTime()) / 864e5))}</p>
        <div className="exkv"><span className="exk">{t("today.itemHeading")}</span><span className="exv">{picker}</span></div>
        {dateRow}
        <button className="btn primary wide" id="ex-save" type="button" data-first disabled={busy} onClick={save}>{t("today.looksRightTrackIt")}</button>
        <p className="muted small excenter">{t("today.nothingIsSavedUntilYou")}</p>
      </>
    );
  }
  return (
    <>
      <h3 className="hm-title" id="ex-title">{fix ? t("today.fixTheDate") : t("today.typeTheDate")}</h3>
      <div className="exkv"><span className="exk">{t("today.itemHeading")}</span><span className="exv">{picker}</span></div>
      {dateRow}
      <button className="btn primary wide" id="ex-save" type="button" data-first disabled={busy} onClick={save}>{t("today.trackIt")}</button>
    </>
  );
}

/* ---------------- After a receipt: dates for what can expire or go bad (#207) ----------------
 * One sheet for the receipt's perishables (owner, 2026-10-30). Per
 * row: snap the date (the same one Spark read as Snap a date), pick it
 * on the phone's calendar, or skip. A read date shows on the row and
 * can be changed with a tap, so nothing is saved unchecked. Done saves
 * what is set and stops asking about this receipt. */
type PRow = { date?: string; kind?: string; skip?: boolean; reading?: boolean };

const CameraSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.3-2h5.4L16 6h1.5A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z" /><circle cx="12" cy="12.5" r="3.2" /></svg>
);

function PerishSheet({ open, perish, demo, onClose, onMore, reload }: { open: boolean; perish: Perish; demo: boolean;
  onClose: () => void; onMore: () => void; reload: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState<Record<string, PRow>>({});
  const [busy, setBusy] = useState(false);
  const set = (id: string, r: PRow) => setRows(x => ({ ...x, [id]: r }));
  const nSet = perish.items.filter(i => rows[i.item_id]?.date && !rows[i.item_id]?.skip).length;
  const minDate = isoToday();

  async function snap(id: string, file?: File) {
    set(id, { reading: true });
    try {
      let read: Read;
      if (demo) read = await post("/api/expiry/read?sample=1");
      else {
        if (!file) throw new Error("no photo");
        const r = await fetch("/api/expiry/read", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
        if (!r.ok) throw new Error(friendlyError((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`));
        read = await r.json();
      }
      if (!read.readable) throw new Error(t("today.perish.cantRead"));
      set(id, { date: read.date, kind: read.kind });
    } catch {
      set(id, {});
      toast(t("today.perish.cantRead"));
    }
  }

  async function done() {
    setBusy(true);
    let saved = 0;
    for (const it of perish.items) {
      const r = rows[it.item_id];
      if (!r?.date || r.skip) continue;
      try { await post("/api/expiry/save", { item_id: it.item_id, date: r.date, kind: r.kind || "unknown" }); saved++; }
      catch (e) { toast(e instanceof Error ? e.message : String(e)); }
    }
    try { await post("/api/expiry/nudge", { action: "done", date: perish.date }); } catch { /* asked again next time */ }
    setBusy(false);
    onClose();
    if (saved) toast(t("today.perish.saved", { count: saved }));
    reload();
  }

  // A native date input laid over the button, so a tap opens the
  // phone's own calendar on every browser.
  const picker = (id: string, name: string, value: string, face: ReactNode) => (
    <span className="pz-pick">{face}
      <input type="date" min={minDate} value={value} aria-label={t("today.perish.pickAria", { name })}
        onChange={ev => ev.target.value && set(id, { date: ev.target.value, kind: "unknown" })} /></span>
  );

  return (
    <Sheet open={open} onClose={onClose} id="perish-sheet" labelledBy="pz-title">
      <span className="sheetgrip" />
      <div className="sheethead"><h3 className="hm-title" id="pz-title">{t("today.perish.sheetTitle")}</h3>
        <button className="linkbtn" type="button" id="pz-done" data-first disabled={busy} onClick={done}>{t("today.perish.done")}</button></div>
      <p className="muted nomargin">{t("today.perish.sheetLine")}</p>
      <p className="muted small nomargin">{t("today.perish.from", { store: perish.store, date: fmtMD(perish.date) })}</p>
      <ul className="pz">
        {perish.items.map(it => {
          const r = rows[it.item_id] || {};
          const fid = "pz-photo-" + it.item_id;
          return (
            <li key={it.item_id} className={r.skip ? "skip" : undefined} data-pz={it.item_id}>
              <Face name={it.name} />
              <span className="grow"><b>{it.name}</b>{r.skip ? <small>{t("today.perish.skipped")}</small> : r.reading ? <small role="status">{t("today.perish.reading")}</small> : null}</span>
              {r.skip
                ? <button className="pz-undo" type="button" onClick={() => set(it.item_id, {})}>{t("today.perish.undo")}</button>
                : r.date
                  ? picker(it.item_id, it.name, r.date, <span className="pz-date">{t("today.perish.useBy", { date: fmtMD(r.date) })}</span>)
                  : <>
                    {demo
                      ? <button className="pz-b" type="button" aria-label={t("today.perish.snapAria", { name: it.name })} disabled={r.reading} onClick={() => snap(it.item_id)}><CameraSvg /></button>
                      : <><label className="pz-b" htmlFor={fid} role="button" tabIndex={0} aria-label={t("today.perish.snapAria", { name: it.name })}
                        onKeyDown={ev => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); document.getElementById(fid)?.click(); } }}><CameraSvg /></label>
                        <input type="file" id={fid} accept="image/*" capture="environment" hidden
                          onChange={ev => { const f = ev.target.files?.[0]; if (f) snap(it.item_id, f); ev.target.value = ""; }} /></>}
                    {picker(it.item_id, it.name, "", <span className="pz-b">{t("today.perish.pick")}</span>)}
                    <button className="pz-x" type="button" aria-label={t("today.perish.skipAria", { name: it.name })} onClick={() => set(it.item_id, { skip: true })}>×</button>
                  </>}
            </li>
          );
        })}
      </ul>
      <p className="muted small pz-foot">{t("today.perish.count", { n: nSet, total: perish.items.length })} {t("today.perish.missing")} <button className="linkbtn" type="button" id="pz-more" onClick={onMore}>{t("today.perish.addAnother")}</button></p>
    </Sheet>
  );
}
