import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { InfoBtn, INFO, infoEntry, InfoSheetFrame, WhyRows } from "../ui/Info";
import { useToast } from "../ui/Toast";
import { useGuide } from "../ui/Guide";
import { GUIDE_FOR_POWER } from "../guide/cards";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-powers and pwa/powers.js (POWERS, powRow,
 * group, paintPowers, the (i) sheets and the Share anonymous prices
 * opt-in). LOCK_SVG is from pwa/app.js. The Today tip and Analysis
 * cards of powers.js live in their own screens.
 * The Arya guide (#154) is linked both ways: "See how it works" at
 * the top opens it, and a power with a guide card (GUIDE_FOR_POWER)
 * links to that card from its (i) sheet. Powers stays a status list;
 * the guide stays the story. */

type Facts = { receipts: number; stores: number; share_prices: boolean };
type Power = {
  id: string; group: "next" | "new" | "on"; name: string; sub: string; need?: string; what: string;
  unlock?: string; when?: string; share?: boolean; soon?: boolean; on?: (f: Facts) => boolean; tip?: string;
  /* Not live yet: the row stays out of the list (keys kept) until it ships. */
  hidden?: boolean;
};

/* Text fields are en.json keys; the screen runs them through t(). */
const POWERS: Power[] = [
  { id: "community", group: "next", name: "powers.p.community.name", sub: "powers.p.community.sub", need: "powers.p.community.need", what: "powers.p.community.what",
    unlock: "powers.p.community.unlock",
    when: "powers.p.community.when", share: true },
  { id: "deals", group: "next", name: "powers.p.deals.name", sub: "powers.p.deals.sub", need: "powers.p.deals.need", what: "powers.p.deals.what",
    unlock: "powers.p.deals.unlock", when: "powers.p.deals.when", share: true, hidden: true },
  { id: "shoppers", group: "next", name: "powers.p.shoppers.name", sub: "powers.p.shoppers.sub", need: "powers.p.shoppers.need", soon: true, what: "powers.p.shoppers.what",
    unlock: "powers.p.shoppers.unlock", when: "powers.p.shoppers.when", share: true, hidden: true },
  { id: "compare", group: "new", name: "powers.p.compare.name", sub: "powers.p.compare.sub", need: "powers.p.compare.need", what: "powers.p.compare.what",
    unlock: "powers.p.compare.unlock", on: f => f.stores >= 2, tip: "powers.p.compare.tip" },
  { id: "trends", group: "new", name: "powers.p.trends.name", sub: "powers.p.trends.sub", need: "powers.p.trends.need", what: "powers.p.trends.what",
    unlock: "powers.p.trends.unlock", on: f => f.receipts >= 3, tip: "powers.p.trends.tip" },
  { id: "similar", group: "new", name: "powers.p.similar.name", sub: "powers.p.similar.sub", need: "powers.p.similar.need", what: "powers.p.similar.what",
    unlock: "powers.p.similar.unlock", on: f => f.receipts >= 1, tip: "powers.p.similar.tip" },
  { id: "split", group: "new", name: "powers.p.split.name", sub: "powers.p.split.sub", need: "powers.p.split.need", what: "powers.p.split.what",
    unlock: "powers.p.split.unlock", on: f => f.stores >= 2, tip: "powers.p.split.tip" },
  { id: "waste", group: "new", name: "powers.p.waste.name", sub: "powers.p.waste.sub", what: "powers.p.waste.what",
    unlock: "powers.p.waste.unlock", on: () => true, tip: "powers.p.waste.tip" },
  { id: "low", group: "on", name: "powers.p.low.name", sub: "powers.p.low.sub", what: "powers.p.low.what" },
  { id: "lists", group: "on", name: "powers.p.lists.name", sub: "powers.p.lists.sub", what: "powers.p.lists.what" },
  { id: "usesoon", group: "on", name: "powers.p.usesoon.name", sub: "powers.p.usesoon.sub", what: "powers.p.usesoon.what" },
  { id: "plan", group: "on", name: "powers.p.plan.name", sub: "powers.p.plan.sub", what: "powers.p.plan.what" },
  { id: "receipts", group: "on", name: "powers.p.receipts.name", sub: "powers.p.receipts.sub", what: "powers.p.receipts.what" },
  { id: "patterns", group: "on", name: "powers.p.patterns.name", sub: "powers.p.patterns.sub", what: "powers.p.patterns.what" },
  { id: "ask", group: "on", name: "powers.p.ask.name", sub: "powers.p.ask.sub", what: "powers.p.ask.what" },
  { id: "find", group: "on", name: "powers.p.find.name", sub: "powers.p.find.sub", what: "powers.p.find.what" },
  { id: "alerts", group: "on", name: "powers.p.alerts.name", sub: "powers.p.alerts.sub", what: "powers.p.alerts.what" },
  { id: "haul", group: "on", name: "powers.p.haul.name", sub: "powers.p.haul.sub", what: "powers.p.haul.what" },
];

const LockSvg = () => (
  <svg className="pwlock" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4.25" y="8.75" width="11.5" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);

type SheetState = { kind: "power" | "info"; key: string } | { kind: "share" } | null;

export function Powers() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const guide = useGuide();
  const [facts, setFacts] = useState<Facts>({ receipts: 0, stores: 0, share_prices: false });
  const [sheet, setSheet] = useState<SheetState>(null);

  // paintPowers reloads the facts each time the page opens; keep the last on failure.
  useEffect(() => {
    let live = true;
    get<Facts>("/api/powers").then(f => live && setFacts(f), () => { /* keep the last facts */ });
    return () => { live = false; };
  }, [nav.key]);

  const isOn = (p: Power) => p.group === "on" || (p.on ? p.on(facts) : false);
  const close = useCallback(() => setSheet(null), []);
  const openInfo = (key: string) => setSheet({ kind: POWERS.some(p => p.id === key) ? "power" : "info", key });

  async function setShare(on: boolean) {
    try {
      const r = await post<{ share_prices: boolean }>("/api/powers/share", { on });
      setFacts(f => ({ ...f, share_prices: !!r.share_prices }));
      close();
      toast(on ? t("powers.sharingStarts") : t("powers.sharingOff"));
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }

  const row = (p: Power) => {
    const on = isOn(p);
    const need = on ? "" : (p.share && !p.soon && facts.share_prices ? t("powers.waiting5") : p.need ? t(p.need) : "");
    // A price-sharing power that is still off opens the Share prices sheet.
    const act = p.share && !p.soon && !facts.share_prices;
    return (
      <div className="row powrow" key={p.id}>
        <span className={"pwdot" + (on ? " on" : " off")} aria-hidden="true">{on ? "✓" : <LockSvg />}</span>
        <div className="grow"><span className="name">{t(p.name)}</span><span className="sub">{t(p.sub || p.what)}</span>{need && (act
          ? <button className="pwneed" type="button" data-pw-act="share" onClick={() => setSheet({ kind: "share" })}>{need}</button>
          : <span className="pwneed">{need}</span>)}</div>
        <InfoBtn k={p.id} onOpen={openInfo} />
      </div>
    );
  };
  const group = (title: string, items: Power[], openNow = true): ReactNode => !items.length ? null : (
    <details className="pwgroup" open={openNow}><summary><h3 className="sect">{title}</h3><span className="pwchev" aria-hidden="true">›</span></summary>
      <div className="group">{items.map(row)}</div></details>
  );

  const shown = POWERS.filter(p => !p.hidden);
  const working = [...shown.filter(p => p.group === "on"), ...shown.filter(p => p.group === "new" && isOn(p))];
  const later = shown.filter(p => p.group === "new" && !isOn(p));
  const choose = shown.filter(p => p.share);

  const closeBtn = (label = t("common.close")) => <button className="btn secondary" type="button" data-pw="close" onClick={close}>{label}</button>;
  let sheetBody: ReactNode = null;
  if (sheet?.kind === "power") {
    const p = POWERS.find(x => x.id === sheet.key)!;
    const rows: [string, string][] = [[t("powers.whatItDoes"), t(p.what)]];
    if (!isOn(p) && p.unlock) rows.push([t("powers.toUnlock"), t(p.unlock)]);
    if (p.when) rows.push([p.share ? t("powers.whenYouSee") : t("powers.goodToKnow"), t(p.when)]);
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={t(p.name)}>
        <WhyRows rows={rows} />
        <div className="sheetacts">{closeBtn()}
          {/* Use soon trades its guide button for Add a date (#207): the
            * empty Use soon card on Today is gone, so this is the by-hand way in. */}
          {GUIDE_FOR_POWER[p.id] && p.id !== "usesoon" && <button className="btn primary" type="button" data-pw="guide" onClick={() => { close(); guide.open(GUIDE_FOR_POWER[p.id]); }}>{t("powers.seeItInTheGuide")}</button>}
          {p.id === "usesoon" && <button className="btn primary" type="button" data-pw="snap" onClick={() => { close(); nav.show("home", { snapDate: true }); }}>{t("powers.addADate")}</button>}
          {p.share && <button className="btn primary" type="button" data-pw="share" onClick={() => setSheet({ kind: "share" })}>{facts.share_prices ? t("powers.sharingOn") : t("common.sharing.start")}</button>}
        </div>
      </InfoSheetFrame>);
  } else if (sheet?.kind === "info" && INFO[sheet.key]) {
    const i = infoEntry(sheet.key)!;
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={i.t} sub={i.s}>
        <WhyRows rows={i.rows} />
        <div className="sheetacts">{closeBtn()}</div>
      </InfoSheetFrame>);
  } else if (sheet?.kind === "share") {
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={t("powers.shopSmarterTogether")} sub={t("powers.everyReceiptAndReportMakes")}>
        <WhyRows rows={[
          [t("common.sharing.youGive"), t("common.sharing.youGiveText")],
          [t("common.sharing.youGet"), t("common.sharing.youGetText")],
          [t("common.sharing.reportsMatter"), t("common.sharing.reportsMatterText")]]} />
        <div className="sheetacts">{closeBtn(t("common.notNow"))}
          <button className="btn primary" type="button" data-pw={facts.share_prices ? "unshare" : "doshare"} onClick={() => setShare(!facts.share_prices)}>{facts.share_prices ? t("common.sharing.stop") : t("common.sharing.start")}</button></div>
        <p className="sub nomargin" style={{ textAlign: "center", fontSize: 13 }}>{t("powers.optionalYouCanTurnIt")}</p>
      </InfoSheetFrame>);
  }

  return (
    <>
      <p><a href="#" id="pw-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("common.aryaSPowers")}</h1>
      <p className="subtitle">{t("powers.whatAryaAlreadyDoesFor")}</p>
      <button className="linkbtn" id="pw-guide" type="button" onClick={() => guide.open()}>{t("powers.seeHowItWorks")}<span aria-hidden="true"> ›</span></button>
      <div id="powers-body">
        {group(t("powers.working", { n: working.length }), working, false)}
        {group(t("powers.later"), later)}
        {group(t("powers.choose"), choose)}
      </div>
      {sheetBody}
    </>
  );
}
