import type { ReactNode } from "react";
import { Sheet } from "./Sheet";
import { Button } from "./kit";
import { useToast } from "./Toast";
import { t, useTranslation } from "../i18n";
import { directorOn, townDirector, townReport, type Town, type TownAlt, type TownLine } from "../lib/town";
import "./town.css";

/* Demo Town pieces (api/town.py): the simulated neighbours' reports on
 * Today, on the list rows, in an item's sheet, and when a store is
 * reported closed. Each wears the Simulated pill. The rule behind them
 * is stated in the sheet: 3 households, a day, nobody named. */

export const SimPill = () => <span className="simpill">{t("town.sim")}</span>;

export function agoText(min: number): string {
  if (min < 2) return t("town.agoNow");
  if (min < 90) return t("town.agoMin", { n: min });
  return t("town.agoHour", { n: Math.round(min / 60) });
}

const priceText = (p: number | null | undefined) => (p == null ? "" : "$" + p.toFixed(2));

function altText(alt: TownAlt | null | undefined): string {
  if (!alt) return "";
  return alt.price != null ? t("town.hasItAt", { store: alt.store, price: priceText(alt.price) }) : t("town.hasIt", { store: alt.store });
}

export function lineText(l: TownLine): { title: string; sub: string } {
  const n = l.households || 0, ago = agoText(l.ago_min || 0);
  switch (l.kind) {
    case "out": return { title: t("town.feedOut", { item: l.item, store: l.store }), sub: t("town.feedOutSub", { count: n, ago, alt: altText(l.alt) }).trim() };
    case "closed": return { title: l.why ? t("town.feedClosedWhy", { store: l.store, why: l.why }) : t("town.feedClosed", { store: l.store }), sub: t("town.feedStoreSub", { count: n, ago }) };
    case "incident": return { title: l.why ? t("town.feedIncidentWhy", { store: l.store, why: l.why }) : t("town.feedIncident", { store: l.store }), sub: t("town.feedStoreSub", { count: n, ago }) };
    case "quiet": return { title: t("town.feedQuiet", { store: l.store }), sub: t("town.feedQuietSub") };
    case "rush": return { title: t("town.feedRush", { store: l.store }), sub: t("town.feedRushSub") };
    default: return { title: t("town.feedPrice", { item: l.item, store: l.store, price: priceText(l.price) }), sub: t("town.feedPriceSub", { count: n }) };
  }
}

/* Today: "Near you today". */
export function TownFeed({ town }: { town: Town }) {
  const { t } = useTranslation();
  if (!town.feed.length) return null;
  return (
    <div id="today-town" className="towncard">
      <div className="sectrow townhead"><h3 className="sect">{t("town.nearYou")}</h3><SimPill /></div>
      <div className="group">
        {town.feed.map((l, i) => {
          const x = lineText(l);
          return <div className="hubrow" key={i}><span className="hr-label">{x.title}<span className="sub">{x.sub}</span></span></div>;
        })}
      </div>
    </div>
  );
}

/* The list stores this list is for, matched against the town's store names. */
const named = (town: Town, stores: string[]) =>
  Object.keys(town.stores).filter(n => stores.some(s => sameName(s, n)));
const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, "") === b.toLowerCase().replace(/[^a-z0-9]+/g, "");

/* The first store of this list that has this item reported out. */
export function outAt(town: Town, itemId: string, listStores: string[]) {
  const it = town.items[itemId];
  if (!it) return null;
  for (const s of named(town, listStores)) {
    const v = it.stores[s];
    if (v && v.state === "out") return { store: s, ...v };
  }
  return null;
}

export function TownChip({ town, itemId, listStores, onOpen }: { town: Town; itemId: string; listStores: string[]; onOpen: () => void }) {
  const { t } = useTranslation();
  const o = outAt(town, itemId, listStores);
  if (!o) return null;
  return <button type="button" className="townchip" onClick={e => { e.preventDefault(); e.stopPropagation(); onOpen(); }}>{t("town.chipOut", { count: o.households })}</button>;
}

/* A heads-up card for the open list: items out at the list's store. */
export function HeadsUp({ town, itemIds, listStores }: { town: Town; itemIds: string[]; listStores: string[] }) {
  const { t } = useTranslation();
  const hits = itemIds.map(id => ({ id, o: outAt(town, id, listStores) })).filter(x => x.o);
  if (!hits.length) return null;
  const first = hits[0], it = town.items[first.id], alt = it.alt;
  const sub = t("town.headsUpSub", {
    item: it.name,
    alt: alt ? t("town.headsUpAlt", { store: alt.store, count: it.stores[alt.store]?.households || 0 }) : "",
  }).trim();
  return (
    <div className="group towncard"><div className="hubrow">
      <span className="hr-label">{t("town.headsUp", { count: hits.length, store: first.o!.store })} <SimPill /><span className="sub">{sub}</span></span>
    </div></div>
  );
}

/* Tap the chip: who says what, where else has it, one tap to move it. */
export function TownItemSheet({ town, itemId, listStores, onClose, onMove }:
  { town: Town; itemId: string | null; listStores: string[]; onClose: () => void; onMove: (store: string) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const it = itemId ? town.items[itemId] : null;
  const here = it ? named(town, listStores)[0] : "";
  const rows = it ? Object.entries(it.stores).filter(([s, v]) => v.state !== "none" && town.stores[s]?.status !== "shut")
    .sort((a, b) => (a[0] === here ? -1 : b[0] === here ? 1 : b[1].households - a[1].households)).slice(0, 4) : [];
  const say = (kind: "in" | "out") => it && here && townReport(kind, here, it.key).then(() => toast(t("town.thanks"))).catch(() => {});
  return (
    <Sheet open={!!it} onClose={onClose} id="town-sheet" title={it ? it.name : ""}>
      {it && <>
        <p className="muted nomargin">{t("town.sheetSub")} <SimPill /></p>
        <div className="group" style={{ marginTop: 8 }}>
          {rows.map(([s, v]) => {
            const closed = town.stores[s]?.status === "closed" || town.stores[s]?.status === "incident";
            const sub = closed ? t(town.stores[s].status === "closed" ? "town.closedTitle" : "town.incidentTitle")
              : v.state === "out" ? t("town.rowOut", { count: v.households, ago: agoText(v.ago_min) })
                : t("town.rowIn", { count: v.households }) + (v.price != null ? " · " + priceText(v.price) : "")
                  + (v.pending ? " · " + t("town.rowPending", { count: v.pending }) : "");
            return <div className="hubrow" key={s}><span className="hr-label">{s}<span className="sub">{sub}</span></span>
              <span className={"townbadge" + (v.state === "out" || closed ? " bad" : "")}>{closed ? t("town.rClosed") : v.state === "out" ? t("town.badgeOut") : t("town.badgeIn")}</span></div>;
          })}
        </div>
        {it.alt && here && it.stores[here]?.state === "out" && <Button kind="primary" wide style={{ marginTop: 12 }} onClick={() => onMove(it.alt!.store)}>{t("town.moveTo", { store: it.alt.store })}</Button>}
        <div className="townactions">
          <Button onClick={onClose}>{t("town.keep", { store: here })}</Button>
          {it.stores[here]?.state === "out"
            ? <Button onClick={() => say("in")}>{t("town.seeThem")}</Button>
            : <Button onClick={() => say("out")}>{t("town.outHereToo")}</Button>}
        </div>
        <p className="townreport">{t("town.rule")}</p>
      </>}
    </Sheet>
  );
}

/* Start shopping at a store reported closed or in an incident. */
/* Something about this list's store worth a stop before shopping: it is
 * closed or has an incident and the town knows where else to go. */
export function storeTrouble(town: Town, listStores: string[]) {
  const bad = named(town, listStores).map(n => town.stores[n]).find(s => s.status === "closed" || s.status === "incident" || s.status === "shut");
  return !!bad && (bad.status === "closed" || bad.status === "incident" || !!town.alternatives[bad.name]);
}

export function StoreNotice({ town, listStores, onSwitch }: { town: Town; listStores: string[]; onSwitch: (store: string) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const bad = named(town, listStores).map(n => town.stores[n]).find(s => s.status === "closed" || s.status === "incident" || s.status === "shut");
  const store = named(town, listStores)[0];
  const report = (kind: "closed" | "out" | "incident") => store && townReport(kind === "out" ? "out" : kind, store).then(() => toast(t("town.thanks"))).catch(() => {});
  const alt = bad ? town.alternatives[bad.name] : "";
  const altSt = alt ? town.stores[alt] : null;
  const time = altSt ? (altSt.closes >= 12 ? (altSt.closes > 12 ? altSt.closes - 12 : 12) : altSt.closes) + (altSt.closes % 1 ? ":30" : "") + " " + (altSt.closes >= 12 ? "pm" : "am") : "";
  return (
    <>
      {bad && (bad.status === "closed" || bad.status === "incident") && <div className="townalert">
        <b>{t(bad.status === "closed" ? "town.closedTitle" : "town.incidentTitle")}</b> <SimPill />
        <p>{[bad.why, t("town.alertWho", { count: bad.households, ago: agoText(bad.ago_min) })].filter(Boolean).join(". ")}. {t("town.closedNote")}</p>
      </div>}
      {alt && altSt && <>
        <Button kind="primary" wide onClick={() => onSwitch(alt)}>{t("town.shopInstead", { store: alt })}</Button>
        <p className="muted" style={{ margin: "6px 0 10px" }}>{t("town.closedOpen", { store: alt, time, busy: t("town.busy" + altSt.busy[0].toUpperCase() + altSt.busy.slice(1)) })}</p>
      </>}
      {store && <p className="townreport">{t("town.reportYourself")}{" "}
        <button className="linkbtn" type="button" onClick={() => report("closed")}>{t("town.rClosed")}</button> ·{" "}
        <button className="linkbtn" type="button" onClick={() => report("out")}>{t("town.rOut")}</button> ·{" "}
        <button className="linkbtn" type="button" onClick={() => report("incident")}>{t("town.rIncident")}</button></p>}
    </>
  );
}

/* For whoever stages the demo (?director=1): add a moment, or clear them. */
export function DirectorPanel(): ReactNode {
  const { t } = useTranslation();
  const { toast } = useToast();
  if (!directorOn()) return null;
  const go = (s: string) => townDirector(s).then(() => toast(t("town.directorTitle") + ": " + s)).catch(() => {});
  return (
    <div className="group director" id="director">
      <div className="hubrow" style={{ borderBottom: 0, flexDirection: "column", alignItems: "stretch" }}>
        <span className="hr-label">{t("town.directorTitle")} <SimPill /><span className="sub">{t("town.directorSub")}</span></span>
        <div className="chips">
          <button className="chip" type="button" onClick={() => go("eggs_out")}>{t("town.dEggs")}</button>
          <button className="chip" type="button" onClick={() => go("closes")}>{t("town.dCloses")}</button>
          <button className="chip" type="button" onClick={() => go("rush")}>{t("town.dRush")}</button>
          <button className="chip" type="button" onClick={() => go("incident")}>{t("town.dIncident")}</button>
          <button className="chip" type="button" onClick={() => go("reset")}>{t("town.dReset")}</button>
        </div>
      </div>
    </div>
  );
}
