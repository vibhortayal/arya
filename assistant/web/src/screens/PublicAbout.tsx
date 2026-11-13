import { useEffect } from "react";
import { useTranslation } from "../i18n";
import { AboutCredit, AboutStory } from "../ui/AboutStory";

/* The public About page at /about (owner approved the mockup
 * 2026-11-13). It needs no sign-in, so the app shows it before it asks
 * who you are, like /developers. The note is the same one that sits at
 * the top of About in Settings; the Settings rows are not here because
 * they need an account. */
export { ABOUT_PATH, isAboutPath } from "../lib/paths";

export function PublicAbout() {
  const { t } = useTranslation();
  useEffect(() => { document.title = t("settings.aboutArya"); }, [t]);
  return (
    <main id="public-about" style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 32px" }}>
      <p><a href="/" id="pubabout-back"><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("settings.aboutArya")}</h1>
      <AboutStory />
      <div className="group"><div className="pad aboutcredit"><AboutCredit /></div></div>
      <p style={{ marginTop: 16 }}><a className="btn wide" id="pubabout-try" href="/">{t("about.tryArya")}</a></p>
    </main>
  );
}
