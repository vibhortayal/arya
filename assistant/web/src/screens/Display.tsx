import { useNav } from "../app/nav";
import { DISPLAY_DEFAULT, TEXT_ZOOM, useSession, type Display as DisplayT } from "../app/session";
import { post } from "../lib/api";
import { useToast } from "../ui/Toast";
import { useTranslation } from "../i18n";

/* Settings > Display (card library, owner 2026-10-30: "give control to
 * user to customize their views"): text size, spacing, bold text, item
 * pictures and animations, for every screen, saved per account. Each
 * change shows at once (app/session.tsx applyDisplay). */
export function Display() {
  const { t } = useTranslation();
  const nav = useNav();
  const { display, saveDisplay } = useSession();
  const { toast, showErr } = useToast();
  const save = (d: Partial<DisplayT>) => { saveDisplay(d).catch(showErr); };

  const Switch = ({ k, label, sub }: { k: "bold" | "pictures" | "motion"; label: string; sub?: string }) => (
    <div className="hubrow">
      <span className="hr-label">{label}{sub && <span className="sub">{sub}</span>}</span>
      <button type="button" className="sw" id={`display-${k}`} role="switch" aria-checked={display[k]} aria-label={label}
        onClick={() => save({ [k]: !display[k] })}><i></i></button>
    </div>
  );

  async function resetAll() {
    try {
      await saveDisplay(DISPLAY_DEFAULT);
      await post("/api/settings", { today_cards: null, today_sizes: { low: "m", lists: "m", report: "m", price: "m", expiry: "m", checks: "m", patterns: "m", quest: "m" } });
      toast(t("display.resetDone"));
    } catch (e) { showErr(e); }
  }

  return (
    <>
      <p><a href="#" id="display-back" onClick={ev => { ev.preventDefault(); nav.back("profile"); }}><span aria-hidden="true">‹ </span>{t("common.back")}</a></p>
      <h1 className="largetitle" style={{ fontSize: 28 }}>{t("display.title")}</h1>

      <h3 className="sect">{t("display.text")}</h3>
      <div className="group pad">
        <div className="textsize">
          <span aria-hidden="true" className="ts-a small">A</span>
          <input id="display-text" type="range" min={0} max={TEXT_ZOOM.length - 1} step={1} value={display.text}
            aria-label={t("display.text")} aria-valuetext={`${Math.round(TEXT_ZOOM[display.text] * 100)}%`}
            onChange={e => save({ text: Number(e.target.value) })} />
          <span aria-hidden="true" className="ts-a big">A</span>
        </div>
        <p className="muted small nomargin">{t("display.sample")}</p>
      </div>

      <h3 className="sect">{t("display.spacing")}</h3>
      <div className="segs" role="radiogroup" aria-label={t("display.spacing")}>
        {(["compact", "comfortable"] as const).map(v => (
          <button key={v} type="button" role="radio" aria-checked={display.spacing === v} data-spacing={v}
            className={display.spacing === v ? "on" : ""} onClick={() => save({ spacing: v })}>{t(`display.${v}`)}</button>
        ))}
      </div>

      <h3 className="sect">{t("display.look")}</h3>
      <div className="group">
        <Switch k="bold" label={t("display.bold")} />
        <Switch k="pictures" label={t("display.pictures")} sub={t("display.picturesSub")} />
        <Switch k="motion" label={t("display.motion")} sub={t("display.motionSub")} />
      </div>

      <h3 className="sect">{t("display.customize")}</h3>
      <div className="group">
        <button className="navrow" id="display-today" type="button" onClick={() => nav.show("home", { edit: true })}>
          <span className="grow">{t("display.today")}</span><span className="chev">›</span></button>
        <button className="navrow" id="display-reset" type="button" onClick={resetAll}>
          <span className="grow">{t("display.resetAll")}</span></button>
      </div>
    </>
  );
}
