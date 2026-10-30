import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { get } from "../lib/api";
import { fmtShort, money } from "../lib/format";
import { Group, Row, Section } from "../ui/kit";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Keeping Arya running (owner, 2026-10-30, mock KaKqKgw9RG8BJ66cSWpWVC):
 * what the paid AI reading has cost for this account, lifetime first, and
 * for everyone together. Wikipedia-style openness with no money ask and
 * no meter: the heads-up and the pause notice only appear for an account
 * far above a typical one (api/deps.py user_limits). */

const KINDS = ["reads", "ask", "maps", "helps"] as const;
type Kind = (typeof KINDS)[number];
type UsageData = {
  lifetime_usd: number; month_usd: number; since: string;
  kinds: Record<Kind, { n: number; usd: number }>;
  heavy: boolean; paused: boolean;
  whole: { usd: number; people: number; average_usd: number; paid_by: string } | null;
};

export function Usage() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const [d, setD] = useState<UsageData | null>(null);

  useEffect(() => {
    let live = true;
    get<UsageData>("/api/usage").then(r => live && setD(r), () => live && toast(t("usage.couldNotLoad")));
    return () => { live = false; };
  }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p><a href="#" id="us-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("usage.title")}</h1>
      <p className="muted" style={{ margin: "0 0 6px" }}>{t("usage.intro")}</p>
      {d && (
        <>
          <Section title={t("usage.sinceYouJoined")} />
          <div className="group pad" id="us-mine">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span id="us-lifetime" style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-.02em" }}>{money(d.lifetime_usd)}</span>
              {d.since && <span className="muted">{t("usage.ofReadingSince", { since: fmtShort(d.since) })}</span>}
            </div>
            {d.lifetime_usd > 0
              ? <p className="nomargin" style={{ marginTop: 10, display: "flex", justifyContent: "space-between" }}>
                  <b>{t("usage.thisMonth")}</b><b id="us-month" style={{ fontVariantNumeric: "tabular-nums" }}>{money(d.month_usd)}</b></p>
              : <p className="muted nomargin" style={{ marginTop: 8 }}>{t("usage.nothingYet")}</p>}
            {d.paused
              ? <p className="muted small" id="us-paused" style={{ margin: "10px 0 0" }}>{t("usage.paused")}</p>
              : d.heavy && <p className="muted small" id="us-heavy" style={{ margin: "10px 0 0" }}>{t("usage.heavy")}</p>}
          </div>
          {d.lifetime_usd > 0 && (
            <Group>
              {KINDS.filter(k => d.kinds[k].n > 0).map(k => (
                <Row key={k} name={t(`usage.kind.${k}`)} sub={t("usage.calls", { count: d.kinds[k].n })} right={<b>{money(d.kinds[k].usd)}</b>} />
              ))}
            </Group>
          )}
          {d.whole && (
            <>
              <Section title={t("usage.whole")} />
              <Group className="" label={t("usage.whole")}>
                <Row name={t("usage.paidReading")} sub={t("usage.paidBy", { who: d.whole.paid_by })} right={<b>{money(d.whole.usd)}</b>} />
                <Row name={t("usage.people")} sub={t("usage.peopleSub")} right={<b>{d.whole.people}</b>} />
                <Row name={t("usage.average")} sub={t("usage.averageSub")} right={<b>{money(d.whole.average_usd)}</b>} />
              </Group>
            </>
          )}
          <p className="muted small" style={{ margin: "10px 4px" }}>{t("usage.private")}</p>
        </>
      )}
    </>
  );
}
