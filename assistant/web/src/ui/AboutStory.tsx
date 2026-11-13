import { useTranslation } from "../i18n";

/* The About note (owner, 2026-11-12): who built Arya and why, that it
 * is free and a work in progress, and how it is built. One copy, shown
 * in the app (screens/About.tsx) and on the public /about page
 * (screens/PublicAbout.tsx). */
export function AboutStory() {
  const { t } = useTranslation();
  return (
    <div className="group pad aboutstory" id="about-story">
      <p className="nomargin">{t("about.intro")}</p>
      <p><strong>{t("about.freeTitle")}</strong> {t("about.freeBody")}</p>
      <p><strong>{t("about.wipTitle")}</strong> {t("about.wipBody")}</p>
      <p><strong>{t("about.whyTitle")}</strong> {t("about.whyBody")}</p>
      <p className="nomargin"><strong>{t("about.teamTitle")}</strong> {t("about.teamBody")}{" "}<a href="https://agents.teamnightshift.org/" target="_blank" rel="noopener">Agentic Team</a>.</p>
    </div>
  );
}

/* Who built it, the code and where to find the builder. */
export function AboutCredit() {
  const { t } = useTranslation();
  return (
    <>
      <p className="nomargin">{t("about.builtBy")}{" "}<a href="https://www.linkedin.com/in/vibhortayal" target="_blank" rel="noopener">Vibhor Tayal</a>. {t("about.sourceLead")}{" "}<a href="https://github.com/vibhortayal/arya" target="_blank" rel="noopener">GitHub</a>.</p>
      <p className="nomargin" style={{ marginTop: 8 }}>{t("about.findMe")}{" "}<a href="https://x.com/VibTayal" target="_blank" rel="noopener">X</a>{" · "}<a href="https://www.instagram.com/v_do_stuff" target="_blank" rel="noopener">Instagram</a></p>
    </>
  );
}
