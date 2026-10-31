import { asset } from "../lib/format";
import { Sheet } from "./Sheet";
import { useTranslation } from "../i18n";

/* First run (#153, owner-approved mockup 2026-10-29): the welcome
 * sheet a new account sees once. "Show me around" starts the
 * first-run tour (onboarding/firstRunTour.ts, drawn by ui/Tour.tsx). */

/* The welcome shows to a signed-in account (never the demo) that the
 * server says has not answered it and holds no data. null = settings
 * not loaded yet, so nothing flashes. */
export function showWelcome(user: string | null, demo: boolean, onboarded: boolean | null, demoPending = false): boolean {
  if (demo) return !!user && demoPending; // the demo: every time "Try it now" is tapped
  return !!user && onboarded === false;
}

/* "Try it now" marks the start of a demo visit (owner, 2026-10-31: show
 * the welcome and the tour every time). The mark lasts for this tab until
 * the welcome is answered, so a reload mid-demo does not ask again. */
const DEMO_KEY = "arya-demo-welcome";
export const markDemoStart = () => { try { sessionStorage.setItem(DEMO_KEY, "1"); } catch { /* private window */ } };
export const demoWelcomePending = () => { try { return sessionStorage.getItem(DEMO_KEY) === "1"; } catch { return false; } };
export const clearDemoWelcome = () => { try { sessionStorage.removeItem(DEMO_KEY); } catch { /* ignore */ } };

export function WelcomeSheet({ onTour, onSkip, demo = false }: { onTour: () => void; onSkip: () => void; demo?: boolean }) {
  const { t } = useTranslation();
  return (
    <Sheet open onClose={onSkip} id="fr-welcome" className="fr-welcome" labelledBy="fr-welcome-title">
      <span className="sheetgrip" />
      <img className="fr-face" src={asset("assets/characters/basket.webp")} alt="" />
      <h3 id="fr-welcome-title">{t("firstRun.welcome.title")}</h3>
      <p className="fr-line">{t("firstRun.welcome.line")}</p>
      <div className="fr-three">
        <div><b>{t("firstRun.welcome.lists")}</b>{t("firstRun.welcome.listsSub")}</div>
        <div><b>{t("firstRun.welcome.reminders")}</b>{t("firstRun.welcome.remindersSub")}</div>
        <div><b>{t("firstRun.welcome.spending")}</b>{t("firstRun.welcome.spendingSub")}</div>
      </div>
      <button className="btn primary wide fr-go" id="fr-tour-start" type="button" data-first onClick={onTour}>{t(demo ? "firstRun.welcome.showMeDemo" : "firstRun.welcome.showMe")}</button>
      <button className="linkbtn fr-skip" id="fr-skip" type="button" onClick={onSkip}>{t("firstRun.welcome.skip")}</button>
    </Sheet>
  );
}
