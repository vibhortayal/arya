import { useNav } from "../app/nav";
import { Group, Row, Section } from "../ui/kit";
import { useTranslation } from "../i18n";

/* How Arya uses AI (owner, 2026-10-31, approved mockup): the one page that
 * explains where AI is used and when to double-check. Other notices (Ask
 * line, date reader, Terms, landing footer) point here. */
export function AiNotice() {
  const { t } = useTranslation();
  const nav = useNav();
  const rows: [string, string][] = [["ask", "askSub"], ["receipts", "receiptsSub"], ["photos", "photosSub"], ["maps", "mapsSub"], ["prices", "pricesSub"]];
  return (
    <>
      <p><a href="#" id="ai-back" onClick={ev => { ev.preventDefault(); nav.back("about"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("ai.title")}</h1>
      <p className="muted" style={{ margin: "0 0 6px" }}>{t("ai.intro")}</p>
      <Section title={t("ai.where")}>
        <Group>{rows.map(([a, b]) => <Row key={a} name={t("ai." + a)} sub={t("ai." + b)} />)}</Group>
      </Section>
      <Section title={t("ai.food")}><Group><div className="pad"><p className="nomargin">{t("ai.foodBody")}</p></div></Group></Section>
      <Section title={t("ai.models")}>
        <p className="muted">{t("ai.modelsBody")} <a href="/privacy/">{t("landing.privacy")}</a> · <a href="/terms/">{t("landing.terms")}</a></p>
      </Section>
    </>
  );
}
