import { useNav } from "../app/nav";
import { useSession } from "../app/session";
import { A2hsRow } from "../ui/A2hs";
import { useTranslation } from "../i18n";

/* About Arya (owner, 2026-10-31): the home of what used to be five
 * Settings rows. Powers, Use Arya in another AI app, Add to Home Screen,
 * Keeping Arya running and the credits. Back lands on Settings.
 * The Shell already renders <section id="view-about">; no second one. */
export function About() {
  const { t } = useTranslation();
  const nav = useNav();
  const { demo } = useSession();
  const row = (id: string, view: Parameters<typeof nav.show>[0], title: string, sub: string) => (
    <button className="navrow" id={id} type="button" onClick={() => nav.show(view)}>
      <span className="grow">{title}<span className="sub">{sub}</span></span><span className="chev">›</span></button>
  );
  return (
    <>
      <p><a href="#" id="pfa-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("settings.aboutArya")}</h1>
      <h3 className="sect">{t("about.whatAryaCanDo")}</h3>
      <div className="group">
        {row("btn-powers", "powers", t("common.aryaSPowers"), t("settings.whatAryaCanDoAnd"))}
        {row("btn-ai", "ai", t("ai.title"), t("ai.rowSub"))}
      </div>
      <h3 className="sect">{t("about.useElsewhere")}</h3>
      <div className="group">
        {row("btn-muse", "muse", t("settings.connectAnAiAgent"), t("settings.useAryaFromYourOwn"))}
        <A2hsRow demo={demo} />
      </div>
      <h3 className="sect">{t("about.behind")}</h3>
      <div className="group">
        {row("btn-usage", "usage", t("usage.title"), t("settings.usageSub"))}
        <div className="pad aboutcredit">
          <p className="nomargin">{t("about.builtBy")}{" "}<a href="https://www.linkedin.com/in/vibhortayal" target="_blank" rel="noopener">Vibhor Tayal</a>.</p>
          <p className="muted" style={{ marginTop: 8 }}>{t("about.builtOnMetaModelsSam")}</p>
        </div>
      </div>
    </>
  );
}
