import type { ReactNode } from "react";
import { Sheet } from "./Sheet";

/* The (i) button and its how-it-works sheet (pwa/powers.js INFO,
 * infoBtn, openInfo; INFO_SVG from pwa/app.js). */

export type InfoEntry = { t: string; s: string; rows: [string, string][] };

/* What each (i) says: how the number is worked out, and its limits. */
export const INFO: Record<string, InfoEntry> = {
  trend: { t: "Price trend", s: "How Arya works out a price move.", rows: [
    ["From your receipts", "Arya compares the first and the latest price you paid at the store you use most for this item."],
    ["What counts", "Sale prices count as what you paid. A trend needs 3 or more buys over 4 weeks or more. Moves under 2% are not shown."],
    ["What it is not", "This is your price, not an official inflation number."]] },
  cheaper: { t: "Cheaper store", s: "How Arya picks the cheaper store.", rows: [
    ["From your receipts", "The last price you paid at each store for this same item."],
    ["What counts", "A store counts as cheaper only when it saves at least 25 cents and 5%."],
    ["What it is not", "Prices change. This is what you paid, not today's shelf price."]] },
  similar: { t: "Similar items", s: "Where these come from.", rows: [
    ["From your receipts", "Other items you bought with the same kind of name, such as other milks."],
    ["Per ounce", "When both names give a size, Arya shows the price per ounce so they compare fairly."],
    ["No outside prices", "Arya never looks up prices on store sites, flyers or the web."]] },
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

export function InfoBtn({ k, onOpen }: { k: string; onOpen: (k: string) => void }) {
  return (
    <button className="infobtn" type="button" data-info={k} aria-label="How this works" onClick={() => onOpen(k)}>
      <svg className="infoic" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="8.25" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="10" cy="6.2" r="1.15" fill="currentColor" /><path d="M10 9v5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
    </button>
  );
}

export function WhyRows({ rows }: { rows: [string, string][] }) {
  return <>{rows.map(([b, s]) => <div className="whyrow" key={b}><div><b>{b}</b><span className="sub">{s}</span></div></div>)}</>;
}

/* The sheet wrapper: grip, large title, then whatever the caller draws. */
export function InfoSheetFrame({ open, onClose, title, sub, children }:
  { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} id="info-sheet">
      <span className="sheetgrip" />
      <h3 className="largetitle" style={{ fontSize: 22, margin: "0 0 2px" }}>{title}</h3>
      {sub !== undefined && <span className="sub">{sub}</span>}
      {children}
    </Sheet>
  );
}

/* The plain how-it-works sheet for an INFO key. */
export function InfoSheet({ k, onClose }: { k: string | null; onClose: () => void }) {
  const i = k ? INFO[k] : null;
  return (
    <InfoSheetFrame open={!!i} onClose={onClose} title={i?.t ?? ""} sub={i?.s}>
      {i && <WhyRows rows={i.rows} />}
      <div className="sheetacts"><button className="btn secondary" type="button" data-pw="close" onClick={onClose}>Close</button></div>
    </InfoSheetFrame>
  );
}
