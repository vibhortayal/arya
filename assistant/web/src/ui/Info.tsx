import type { ReactNode } from "react";
import { Sheet } from "./Sheet";
import { t as tr, useTranslation } from "../i18n";

/* The (i) button and its how-it-works sheet (pwa/powers.js INFO,
 * infoBtn, openInfo; INFO_SVG from pwa/app.js). */

export type InfoEntry = { t: string; s: string; rows: [string, string][] };

/* What each (i) says: how the number is worked out, and its limits.
 * The texts are en.json keys; infoEntry() returns them translated. */
export const INFO: Record<string, InfoEntry> = {
  /* Spending card (owner, 2026-11-01): one sheet for every heading, so
   * Groceries, Other purchases and All-time read side by side. */
  spend: { t: "info.spend.title", s: "info.spend.sub", rows: [
    ["info.spend.month", "info.spend.monthText"],
    ["info.spend.all", "info.spend.allText"],
    ["info.spend.groceries", "info.spend.groceriesText"],
    ["info.spend.other", "info.spend.otherText"],
    ["info.spend.returns", "info.spend.returnsText"],
    ["info.spend.saved", "info.spend.savedText"],
    ["info.spend.others", "info.spend.othersText"]] },
  trend: { t: "info.trend.title", s: "info.trend.sub", rows: [
    ["info.trend.row1", "info.trend.row1Text"],
    ["info.trend.row2", "info.trend.row2Text"],
    ["info.trend.row3", "info.trend.row3Text"]] },
  cheaper: { t: "info.cheaper.title", s: "info.cheaper.sub", rows: [
    ["info.cheaper.row1", "info.cheaper.row1Text"],
    ["info.cheaper.row2", "info.cheaper.row2Text"],
    ["info.cheaper.row3", "info.cheaper.row3Text"]] },
  similar: { t: "info.similar.title", s: "info.similar.sub", rows: [
    ["info.similar.row1", "info.similar.row1Text"],
    ["info.similar.row2", "info.similar.row2Text"],
    ["info.similar.row3", "info.similar.row3Text"]] },
  basket: { t: "info.basket.title", s: "info.basket.sub", rows: [
    ["info.basket.row1", "info.basket.row1Text"],
    ["info.basket.row2", "info.basket.row2Text"],
    ["info.basket.row3", "info.basket.row3Text"]] },
  split: { t: "info.split.title", s: "info.split.sub", rows: [
    ["info.split.row1", "info.split.row1Text"],
    ["info.split.row2", "info.split.row2Text"],
    ["info.split.row3", "info.split.row3Text"]] },
  waste: { t: "info.waste.title", s: "info.waste.sub", rows: [
    ["info.waste.row1", "info.waste.row1Text"],
    ["info.waste.row2", "info.waste.row2Text"]] },
};

export function InfoBtn({ k, onOpen }: { k: string; onOpen: (k: string) => void }) {
  const { t } = useTranslation();
  return (
    <button className="infobtn" type="button" data-info={k} aria-label={t("common.howThisWorks")} onClick={() => onOpen(k)}>
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

/* An INFO entry with its texts translated, or null for an unknown key. */
export function infoEntry(k: string | null | undefined): InfoEntry | null {
  const e = k ? INFO[k] : null;
  return e ? { t: tr(e.t), s: tr(e.s), rows: e.rows.map(([a, b]) => [tr(a), tr(b)] as [string, string]) } : null;
}

/* The plain how-it-works sheet for an INFO key. */
export function InfoSheet({ k, onClose }: { k: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const i = infoEntry(k);
  return (
    <InfoSheetFrame open={!!i} onClose={onClose} title={i?.t ?? ""} sub={i?.s}>
      {i && <WhyRows rows={i.rows} />}
      <div className="sheetacts"><button className="btn secondary" type="button" data-pw="close" onClick={onClose}>{t("common.close")}</button></div>
    </InfoSheetFrame>
  );
}
