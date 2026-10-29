import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNav } from "../app/nav";
import { get, post } from "../lib/api";
import { InfoBtn, INFO, InfoSheetFrame, WhyRows } from "../ui/Info";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-powers and pwa/powers.js (POWERS, powRow,
 * group, paintPowers, the (i) sheets and the Share anonymous prices
 * opt-in). LOCK_SVG is from pwa/app.js. The Today tip and Analysis
 * cards of powers.js live in their own screens. */

type Facts = { receipts: number; stores: number; share_prices: boolean };
type Power = {
  id: string; group: "next" | "new" | "on"; name: string; sub: string; need?: string; what: string;
  unlock?: string; when?: string; share?: boolean; soon?: boolean; on?: (f: Facts) => boolean; tip?: string;
};

const POWERS: Power[] = [
  { id: "community", group: "next", name: "Community prices", sub: "See what other Arya shoppers paid at other stores.", need: "Turn on", what: "See what other Arya households paid for the same item at other stores.",
    unlock: "Turn on Share anonymous prices. You give item, store and price by the week, never your name, list or receipt photo.",
    when: "You need to opt in first. A price then shows only when 5 or more opted-in households agree on it in the last 30 days. Older prices are left out because shelf prices move, and 5 households keeps any one of them from being identified.", share: true },
  { id: "deals", group: "next", name: "Deals for you", sub: "Hear when something you buy is cheaper nearby.", need: "Needs Community prices", what: "A heads-up when an item you buy is cheaper than usual somewhere near you.",
    unlock: "Needs Community prices. Only items you already buy.", when: "Built from shared prices, never from store sites or flyers.", share: true },
  { id: "shoppers", group: "next", name: "Arya Shoppers", sub: "See how busy a store is right now.", need: "Coming soon", soon: true, what: "How busy a store is right now: Quiet, Busy or Packed, from people shopping there with Arya.",
    unlock: "Opt in to be counted while you shop. Nobody is shown by name or on a map.", when: "Under 3 Arya Shoppers there, it only says Quiet.", share: true },
  { id: "compare", group: "new", name: "Compare your stores", sub: "See which of your stores is cheaper for an item.", need: "After receipts from 2 stores", what: "Ask \"how much was milk at Costco?\" in the aisle, and see the cheaper store on any item.",
    unlock: "Add receipts from 2 different stores.", on: f => f.stores >= 2, tip: "Arya can tell you which of your stores is cheaper for an item." },
  { id: "trends", group: "new", name: "Price trends", sub: "See which items you buy are getting dearer or cheaper.", need: "After 3 receipts", what: "See when an item you buy gets dearer or cheaper, and your own inflation in Analysis.",
    unlock: "Add 3 receipts.", on: f => f.receipts >= 3, tip: "Arya can tell you which of your usual items are getting pricier." },
  { id: "similar", group: "new", name: "Similar items", sub: "Compare what you paid for similar items, per ounce.", need: "After 1 receipt", what: "Other items of the same kind you bought, with what you paid, per ounce when sizes are known.",
    unlock: "Add 1 receipt.", on: f => f.receipts >= 1, tip: "Arya can compare similar items you have bought, per ounce." },
  { id: "split", group: "new", name: "Split smarter", sub: "Know which store to buy each item at, and what it saves a month.", need: "After receipts from 2 stores", what: "Which store to buy what at, and what that saves you a month.",
    unlock: "Add receipts from 2 different stores.", on: f => f.stores >= 2, tip: "Arya can show which store to buy what at, and what it saves." },
  { id: "waste", group: "new", name: "Food waste", sub: "See what expired food cost you this month.", what: "What expired this month, in dollars, from the items you mark \"It expired\".",
    unlock: "Tap It expired when food goes off.", on: () => true, tip: "Tap It expired on Today and Arya counts what food waste costs you." },
  { id: "low", group: "on", name: "Running low", sub: "Tells you what is about to run out, from how often you buy it.", what: "What is about to run out, from how often you buy it." },
  { id: "lists", group: "on", name: "A list for each store", sub: "One list per store. Add items by typing, talking or a photo.", what: "One list per store. Add by typing, voice or photo." },
  { id: "usesoon", group: "on", name: "Use soon", sub: "Snap a date and Arya reminds you before food goes off.", what: "Snap an expiry date and Arya reminds you before it goes off." },
  { id: "plan", group: "on", name: "Plan a shop", sub: "Sorts your list by the store you usually buy each item at.", what: "Your list sorted by where you usually buy each item." },
  { id: "receipts", group: "on", name: "Receipt check", sub: "Snap a receipt. Arya files it and checks the total.", what: "One photo files a receipt. Arya checks the total and nets returns." },
  { id: "patterns", group: "on", name: "Your spending", sub: "What you spend each month, by store and by item.", what: "What you spend, by month, store and item." },
  { id: "ask", group: "on", name: "Ask Arya", sub: "Ask about your food or spending, by typing or talking.", what: "Ask about your food and spending, by text or voice." },
  { id: "find", group: "on", name: "Find it for me", sub: "Point your camera and Arya spots the next item on your list.", what: "The camera looks for the next item on your list." },
  { id: "alerts", group: "on", name: "Store alerts", sub: "See when other shoppers could not find an item at a store.", what: "\"Not here?\" reports from other shoppers, before you walk the aisle." },
  { id: "haul", group: "on", name: "Share a haul", sub: "Share a photo of what you bought.", what: "A photo of what you bought, through your phone's share sheet." },
];

const LockSvg = () => (
  <svg className="pwlock" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="4.25" y="8.75" width="11.5" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
);

type SheetState = { kind: "power" | "info"; key: string } | { kind: "share" } | null;

export function Powers() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
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
      toast(on ? "Thank you. Sharing starts when enough households near you join." : "Sharing is off.");
    } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  }

  const row = (p: Power) => {
    const on = isOn(p);
    const need = on ? "" : (p.share && !p.soon && facts.share_prices ? "Waiting for 5 households" : p.need || "");
    // A price-sharing power that is still off opens the Share prices sheet.
    const act = p.share && !p.soon && !facts.share_prices;
    return (
      <div className="row powrow" key={p.id}>
        <span className={"pwdot" + (on ? " on" : " off")} aria-hidden="true">{on ? "✓" : <LockSvg />}</span>
        <div className="grow"><span className="name">{p.name}</span><span className="sub">{p.sub || p.what}</span>{need && (act
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

  const working = [...POWERS.filter(p => p.group === "on"), ...POWERS.filter(p => p.group === "new" && isOn(p))];
  const later = POWERS.filter(p => p.group === "new" && !isOn(p));
  const choose = POWERS.filter(p => p.share);

  const closeBtn = (label = "Close") => <button className="btn secondary" type="button" data-pw="close" onClick={close}>{label}</button>;
  let sheetBody: ReactNode = null;
  if (sheet?.kind === "power") {
    const p = POWERS.find(x => x.id === sheet.key)!;
    const rows: [string, string][] = [["What it does", p.what]];
    if (!isOn(p) && p.unlock) rows.push(["To unlock", p.unlock]);
    if (p.when) rows.push([p.share ? "When you see it" : "Good to know", p.when]);
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={p.name}>
        <WhyRows rows={rows} />
        <div className="sheetacts">{closeBtn()}
          {p.share && <button className="btn primary" type="button" data-pw="share" onClick={() => setSheet({ kind: "share" })}>{facts.share_prices ? "Sharing is on" : "Share prices"}</button>}
        </div>
      </InfoSheetFrame>);
  } else if (sheet?.kind === "info" && INFO[sheet.key]) {
    const i = INFO[sheet.key];
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={i.t} sub={i.s}>
        <WhyRows rows={i.rows} />
        <div className="sheetacts">{closeBtn()}</div>
      </InfoSheetFrame>);
  } else if (sheet?.kind === "share") {
    sheetBody = (
      <InfoSheetFrame open onClose={close} title={t("powers.shopSmarterTogether")} sub={t("powers.everyReceiptAndReportMakes")}>
        <WhyRows rows={[
          ["You give", "Item, store and price, by the week. Never your name, your list, your receipt photo or what else you bought."],
          ["You get", "Prices at other stores from real shoppers near you, and deals on items you buy."],
          ["Reports matter too", "\"Not here?\" tells the next shopper before they walk the aisle."]]} />
        <div className="sheetacts">{closeBtn("Not now")}
          <button className="btn primary" type="button" data-pw={facts.share_prices ? "unshare" : "doshare"} onClick={() => setShare(!facts.share_prices)}>{facts.share_prices ? "Stop sharing" : "Share prices"}</button></div>
        <p className="sub nomargin" style={{ textAlign: "center", fontSize: 13 }}>{t("powers.optionalYouCanTurnIt")}</p>
      </InfoSheetFrame>);
  }

  return (
    <>
      <p><a href="#" id="pw-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.aryaSPowers")}</h2>
      <p className="subtitle">{t("powers.whatAryaAlreadyDoesFor")}</p>
      <div id="powers-body">
        {group(`Working for you (${working.length})`, working, false)}
        {group("Turns on as you add receipts", later)}
        {group("You choose to turn on", choose)}
      </div>
      {sheetBody}
    </>
  );
}
