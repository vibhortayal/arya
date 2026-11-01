import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";
import { motionOff } from "../lib/motion";

/* Coach-mark tours (first run #153; reused by other tours).
 *
 *   const { startTour } = useTour();
 *   startTour(steps, { onDone, onSkip });
 *
 * A step is data:
 *   { id, target, titleKey, bodyKey, onEnter?, placement? }
 *   target     a CSS selector, or a function that returns the element
 *   titleKey   en.json key for the bubble title; bodyKey for its line
 *   onEnter    runs before the target is measured (e.g. nav.show(view));
 *              the tour waits up to a second for the target to appear
 *   placement  "above" | "below" | "auto" (default: the side with room)
 *   screen     optional en.json key for the screen this step belongs to
 *              (the demo's per-screen Tour). Steps with a screen show a
 *              chip ("TODAY · 2 OF 5"), a bar for the whole Tour, and
 *              "Skip Today", which jumps to the next screen's first step
 *   more       optional link under the line, { labelKey, onClick }: it
 *              ends the tour and runs onClick in place of the caller's
 *              onDone (the Tour's "Customize now" opens the bar editor,
 *              not the demo's guide as well)
 *
 * Each step draws a dark scrim with a rounded hole around the target
 * (one element with a huge box-shadow) and a bubble with title, line,
 * progress pips, Skip and Next (Done on the last step). The target is
 * scrolled into view, and the layout follows resize and scroll. Esc
 * and Skip call onSkip, Done calls onDone. role="dialog", focus on
 * Next, focus goes back on close. TourProvider sits inside
 * NavProvider (App.tsx), so a step's onEnter can navigate. A step
 * whose target never appears shows its bubble over a plain scrim. */

export type TourStep = {
  id: string;
  target: string | (() => Element | null);
  titleKey: string;
  bodyKey: string;
  onEnter?: () => void;
  placement?: "above" | "below" | "auto";
  screen?: string;
  more?: { labelKey: string; onClick: () => void };
};
export type TourOptions = { onDone?: () => void; onSkip?: () => void };
type Tour = { active: boolean; startTour: (steps: TourStep[], opts?: TourOptions) => void; stopTour: () => void };

const Ctx = createContext<Tour | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<{ steps: TourStep[]; opts: TourOptions; n: number } | null>(null);
  const seq = useRef(0);
  const startTour = useCallback((steps: TourStep[], opts: TourOptions = {}) => {
    if (steps.length) setRun({ steps, opts, n: ++seq.current });
  }, []);
  const stopTour = useCallback(() => setRun(null), []);
  const v = useMemo(() => ({ active: !!run, startTour, stopTour }), [run, startTour, stopTour]);
  const end = (how: "done" | "skip" | "more") => {
    const o = run?.opts;
    setRun(null);
    if (how !== "more") (how === "done" ? o?.onDone : o?.onSkip)?.();
  };
  return (
    <Ctx.Provider value={v}>
      {children}
      {run && <TourOverlay key={run.n} steps={run.steps} onDone={() => end("done")} onSkip={() => end("skip")} onMore={() => end("more")} />}
    </Ctx.Provider>
  );
}

export function useTour(): Tour {
  const t = useContext(Ctx);
  if (!t) throw new Error("useTour outside TourProvider");
  return t;
}

type Box = { left: number; top: number; width: number; height: number };
const GAP = 16, EDGE = 16, HALF = 9;

/* Where the hole and the bubble go for one target box: the hole hugs
 * the target, the bubble sits 16px above it (or below, when asked or
 * when there is more room below) with its arrow under the target's
 * centre, kept off the bubble's rounded corners. */
export function tourLayout(r: Box, vw: number, vh: number, placement: TourStep["placement"] = "auto", tipH = 0) {
  const tipWidth = vw - 2 * EDGE;
  const arrowX = Math.max(18, Math.min(tipWidth - 18 - 2 * HALF, r.left + r.width / 2 - EDGE - HALF));
  let above = placement === "above" || (placement !== "below" && r.top >= vh - (r.top + r.height));
  // With the bubble's real height known: use the other side when this one is too small, and never
  // let the bubble (and its buttons) cross 12px from the screen edge, even if it must cover the target.
  if (tipH) {
    const roomAbove = r.top - GAP - 12, roomBelow = vh - (r.top + r.height) - GAP - 12;
    if (above && roomAbove < tipH && roomBelow >= tipH) above = false;
    else if (!above && roomBelow < tipH && roomAbove >= tipH) above = true;
  }
  const far = Math.max(12, vh - tipH - 12);
  return {
    hole: { left: r.left + 4, top: r.top + 2, width: Math.max(0, r.width - 8), height: Math.max(0, r.height - 8) },
    above,
    tip: above ? { bottom: Math.min(Math.max(12, vh - r.top + GAP), far) } : { top: Math.min(Math.max(12, r.top + r.height + GAP), far) },
    arrowX,
  };
}

const resolve = (t: TourStep["target"]) => (typeof t === "function" ? t() : document.querySelector(t));
const FOCUSABLE = "button:not([disabled])";
const reduced = motionOff;

function TourOverlay({ steps, onDone, onSkip, onMore }: { steps: TourStep[]; onDone: () => void; onSkip: () => void; onMore: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  const next = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  const [tipH, setTipH] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  // Per-screen tour: this step's place among the steps of its screen, and where the next screen starts.
  const scr = step.screen;
  const mates = scr ? steps.filter(x => x.screen === scr) : [];
  const nextScreen = scr ? steps.findIndex((x, k) => k > i && x.screen !== scr) : -1;
  const screenName = scr ? t(scr) : "";

  // Enter the step, wait for its target, bring it into view, then
  // follow resize and scroll.
  useLayoutEffect(() => {
    let alive = true, tries = 0, raf = 0;
    let el: Element | null = null;
    const measure = () => {
      const r = el?.getBoundingClientRect();
      // A hidden or zero-size target (display:none, a hidden input) has no place on screen: show the plain scrim.
      setBox(r && (r.width > 0 || r.height > 0) ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
      setVp({ w: innerWidth, h: innerHeight });
    };
    const find = () => {
      if (!alive) return;
      el = resolve(step.target);
      if (!el && tries++ < 60) { raf = requestAnimationFrame(find); return; }
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight) el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
      }
      measure();
    };
    step.onEnter?.();
    find();
    // Scroll and resize fire many times a frame: measure once per frame (#20).
    let queued = 0;
    const onMove = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; measure(); }); };
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, true);
    return () => { alive = false; cancelAnimationFrame(raf); cancelAnimationFrame(queued); removeEventListener("resize", onMove); removeEventListener("scroll", onMove, true); };
  }, [step]);

  // The bubble's real height decides which side fits and how far it may move (short phones).
  useLayoutEffect(() => { const h = tipEl.current?.offsetHeight ?? 0; if (h !== tipH) setTipH(h); });
  useEffect(() => { next.current?.focus(); }, [i]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => { if (opener && opener !== document.body && opener.isConnected) opener.focus?.(); };
  }, []);

  const onKeyDown = (ev: KeyboardEvent) => {
    ev.stopPropagation();
    if (ev.key === "Escape") { onSkip(); return; }
    if (ev.key !== "Tab" || !wrap.current) return;
    const f = Array.from(wrap.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const [a, z] = [f[0], f[f.length - 1]];
    if (ev.shiftKey && document.activeElement === a) { ev.preventDefault(); z.focus(); }
    else if (!ev.shiftKey && document.activeElement === z) { ev.preventDefault(); a.focus(); }
  };

  const lay = box ? tourLayout(box, vp.w, vp.h, step.placement, tipH) : null;
  const tipStyle: CSSProperties = { ...(lay ? lay.tip : { bottom: 96 }) };
  (tipStyle as Record<string, string | number>)["--ax"] = (lay ? lay.arrowX : -999) + "px";
  return createPortal(
    <div className={"fr-tour" + (lay ? "" : " nohole")} ref={wrap} role="dialog" aria-modal="true" data-tour-step={step.id}
      aria-labelledby="fr-tip-title" aria-describedby="fr-tip-line" onKeyDown={onKeyDown}>
      {lay && <div className="fr-hole" style={lay.hole} />}
      <div className={"fr-tip" + (lay && !lay.above ? " below" : "")} style={tipStyle} ref={tipEl}>
        {scr && (
          <div className="fr-chiprow">
            <span className="fr-chip">{t("tour.chip", { screen: screenName, n: mates.indexOf(step) + 1, of: mates.length })}</span>
            <span className="fr-total">{t("tour.stepOf", { n: i + 1, total: steps.length })}</span>
            <div className="fr-bar" aria-hidden="true"><i style={{ width: Math.round(((i + 1) / steps.length) * 100) + "%" }} /></div>
          </div>
        )}
        <h4 id="fr-tip-title">{t(step.titleKey)}</h4>
        <p id="fr-tip-line">{t(step.bodyKey)}</p>
        {step.more && (
          <button className="linkbtn fr-more" id="fr-tour-more" type="button"
            onClick={() => { const go = step.more!.onClick; onMore(); go(); }}>{t(step.more.labelKey)}</button>
        )}
        <div className="fr-row">
          {scr
            ? <span className="fr-pips" />
            : <span className="fr-pips" role="img" aria-label={t("tour.stepOf", { n: i + 1, total: steps.length })}>
                {steps.map((s, k) => <i key={s.id} className={k === i ? "on" : undefined} />)}
              </span>}
          <button className="fr-skipbtn" id="fr-tour-skip" type="button" onClick={onSkip}>{scr ? t("tour.skipTour") : t("tour.skip")}</button>
          {nextScreen > 0 && (
            <button className="fr-skipbtn" id="fr-tour-skipscreen" type="button" onClick={() => setI(nextScreen)}>{t("tour.skipScreen", { screen: screenName })}</button>
          )}
          <button className="btn primary" id="fr-tour-next" type="button" ref={next}
            onClick={() => (last ? onDone() : setI(i + 1))}>{last ? t("common.done") : t("tour.next")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
