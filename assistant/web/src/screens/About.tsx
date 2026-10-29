import { useNav } from "../app/nav";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-about. Back lands on Profile.
 * The Shell already renders <section id="view-about">; no second one. */
export function About() {
  const { t } = useTranslation();
  const nav = useNav();
  return (
    <>
      <p><a href="#" id="pfa-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.about")}</h2>
      <div className="group pad">
        <p className="nomargin">{t("about.builtBy")}{" "}<a href="https://www.linkedin.com/in/vibhortayal" target="_blank" rel="noopener">Vibhor Tayal</a>.</p>
        <p className="muted" style={{ marginTop: 8 }}>{t("about.builtOnMetaModelsSam")}</p>
      </div>
    </>
  );
}
