import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "../i18n";

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
 *   more       optional link under the line, { labelKey, onClick }: it
 *              ends the tour as Done does, then runs onClick (the
 *              first-run tour's "Want the full guide?")
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
  const end = (how: "done" | "skip") => {
    const o = run?.opts;
    setRun(null);
    (how === "done" ? o?.onDone : o?.onSkip)?.();
  };
  return (
    <Ctx.Provider value={v}>
      {children}
      {run && <TourOverlay key={run.n} steps={run.steps} onDone={() => end("done")} onSkip={() => end("skip")} />}
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
export function tourLayout(r: Box, vw: number, vh: number, placement: TourStep["placement"] = "auto") {
  const tipWidth = vw - 2 * EDGE;
  const arrowX = Math.max(18, Math.min(tipWidth - 18 - 2 * HALF, r.left + r.width / 2 - EDGE - HALF));
  const above = placement === "above" || (placement !== "below" && r.top >= vh - (r.top + r.height));
  return {
    hole: { left: r.left + 4, top: r.top + 2, width: Math.max(0, r.width - 8), height: Math.max(0, r.height - 8) },
    above,
    tip: above ? { bottom: vh - r.top + GAP } : { top: r.top + r.height + GAP },
    arrowX,
  };
}

const resolve = (t: TourStep["target"]) => (typeof t === "function" ? t() : document.querySelector(t));
const FOCUSABLE = "button:not([disabled])";
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

function TourOverlay({ steps, onDone, onSkip }: { steps: TourStep[]; onDone: () => void; onSkip: () => void }) {
  const { t } = useTranslation();
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: innerWidth, h: innerHeight });
  const next = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  // Enter the step, wait for its target, bring it into view, then
  // follow resize and scroll.
  useLayoutEffect(() => {
    let alive = true, tries = 0, raf = 0;
    let el: Element | null = null;
    const measure = () => {
      const r = el?.getBoundingClientRect();
      setBox(r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null);
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
    addEventListener("resize", measure);
    addEventListener("scroll", measure, true);
    return () => { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", measure); removeEventListener("scroll", measure, true); };
  }, [step]);

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

  const lay = box ? tourLayout(box, vp.w, vp.h, step.placement) : null;
  const tipStyle: CSSProperties = { ...(lay ? lay.tip : { bottom: 96 }) };
  (tipStyle as Record<string, string | number>)["--ax"] = (lay ? lay.arrowX : -999) + "px";
  return createPortal(
    <div className={"fr-tour" + (lay ? "" : " nohole")} ref={wrap} role="dialog" aria-modal="true" data-tour-step={step.id}
      aria-labelledby="fr-tip-title" aria-describedby="fr-tip-line" onKeyDown={onKeyDown}>
      {lay && <div className="fr-hole" style={lay.hole} />}
      <div className={"fr-tip" + (lay && !lay.above ? " below" : "")} style={tipStyle}>
        <h4 id="fr-tip-title">{t(step.titleKey)}</h4>
        <p id="fr-tip-line">{t(step.bodyKey)}</p>
        {step.more && (
          <button className="linkbtn fr-more" id="fr-tour-more" type="button"
            onClick={() => { const go = step.more!.onClick; onDone(); go(); }}>{t(step.more.labelKey)}</button>
        )}
        <div className="fr-row">
          <span className="fr-pips" role="img" aria-label={t("tour.stepOf", { n: i + 1, total: steps.length })}>
            {steps.map((s, k) => <i key={s.id} className={k === i ? "on" : undefined} />)}
          </span>
          <button className="fr-skipbtn" id="fr-tour-skip" type="button" onClick={onSkip}>{t("tour.skip")}</button>
          <button className="btn primary" id="fr-tour-next" type="button" ref={next}
            onClick={() => (last ? onDone() : setI(i + 1))}>{last ? t("common.done") : t("tour.next")}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
