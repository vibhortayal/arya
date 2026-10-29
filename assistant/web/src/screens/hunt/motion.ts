/* Motion navigation (quest.js Discussion 33: qInitMotion .. qAnchorToU).
 * Gyro look turns the store view as the phone turns; step-advance is
 * an EXPERIMENT behind arya-steps (default off, demo only). The
 * controllers come from scene.js (createMotionLook, createStepDetector,
 * MotionMath) through ui/Scene loadScene(). */
import { loadScene } from "../../ui/Scene";
import { Q, qCurrentIndex, qNextIndex, qStopU } from "./model";
import { t } from "../../i18n";

type MotionLook = { on: boolean; onUnavailable: (() => void) | null; start(): Promise<boolean>; stop(): void };
type StepDet = { sample(a: DeviceMotionEventAcceleration | null, now: number): boolean };

let stepsFlag = false;
try { stepsFlag = localStorage.getItem("arya-steps") === "1"; } catch { /* off */ }

export const M = {
  motion: null as MotionLook | null,
  gyroGone: false,
  stepsOn: stepsFlag,
  stepDet: null as StepDet | null,
  stepListening: false,
  stepU: 0,
  stepAnchorU: 0,
  stepsHold: false,
};

const G = () => window as any;

export const gyroAvailable = () => typeof DeviceOrientationEvent !== "undefined";

/* Builds the gyro controller once per hunt mount (it reads Q.scene per
 * event, so a driver switch needs no rewiring). */
let motionGen = 0;
export async function initMotion(mount: HTMLElement | null, onUnavailable: () => void) {
  const gen = ++motionGen;
  M.gyroGone = false;
  try {
    const g = await loadScene();
    // The hunt closed (or re-opened) while scene.js loaded.
    if (gen !== motionGen) return;
    if (!M.motion && g.createMotionLook) {
      M.motion = g.createMotionLook(() => Q.scene, mount) as MotionLook;
      M.motion.onUnavailable = () => { M.gyroGone = true; onUnavailable(); };
    }
  } catch { /* no scene.js: no phone look */ }
  stepReset();
}

/* Leaving the hunt: sensors off, the controller dropped. */
export function stopHuntMotion() {
  motionGen++;
  if (M.motion && M.motion.on) M.motion.stop();
  M.motion = null;
  if (M.stepListening) {
    window.removeEventListener("devicemotion", onMotion);
    M.stepListening = false;
  }
}

export async function toggleGyro(): Promise<boolean> {
  if (!M.motion) return true;
  if (M.motion.on) { M.motion.stop(); return true; }
  return M.motion.start();
}

/* Returns a refusal message, or "" when the flag changed. */
export async function toggleSteps(): Promise<string> {
  if (!M.stepsOn) {
    const DME = typeof DeviceMotionEvent !== "undefined" ? (DeviceMotionEvent as any) : null;
    if (DME && typeof DME.requestPermission === "function") {
      const res = await DME.requestPermission().catch(() => "denied");
      if (res !== "granted") return t("hunt.stepsNeedPermission");
    }
    M.stepsOn = true;
    try { localStorage.setItem("arya-steps", "1"); } catch { /* memory only */ }
    stepReset();
  } else {
    M.stepsOn = false;
    try { localStorage.removeItem("arya-steps"); } catch { /* memory only */ }
  }
  return "";
}

export function stepReset() {
  const sess = Q.current;
  if (!sess) return;
  let anchor = 0;
  sess.items.forEach((it, i) => { if (it.checked) anchor = qStopU(sess, i); });
  M.stepAnchorU = anchor;
  M.stepU = anchor;
  M.stepsHold = false;
}

export function stepAnchorTo(name: string) {
  const sess = Q.current;
  if (!sess) return;
  const i = sess.items.findIndex(it => it.name === name);
  if (i < 0) return;
  M.stepAnchorU = qStopU(sess, i);
  M.stepU = M.stepAnchorU;
  M.stepsHold = false;
  if (M.stepsOn && Q.scene && Q.scene.setProgress) Q.scene.setProgress(M.stepU);
}

export function stepSync(huntOpen: boolean) {
  const want = M.stepsOn && huntOpen && !!Q.current && Q.current.mode === "quest";
  if (want && !M.stepListening) {
    const make = G().createStepDetector;
    if (typeof make !== "function") return;
    M.stepDet = make(() => stepAdvance()) as StepDet;
    window.addEventListener("devicemotion", onMotion);
    M.stepListening = true;
  } else if (!want && M.stepListening) {
    window.removeEventListener("devicemotion", onMotion);
    M.stepListening = false;
  }
}

function onMotion(e: DeviceMotionEvent) {
  if (!M.stepDet || M.stepsHold || !Q.current || Q.current.state !== "playing") return;
  M.stepDet.sample(e.accelerationIncludingGravity, performance.now());
}

function stepAdvance() {
  const sess = Q.current, MM = G().MotionMath;
  if (!sess || !Q.scene || !Q.scene.setProgress || !MM) return;
  const next = qCurrentIndex(sess);
  if (next === -1) return;
  const nextU = qStopU(sess, next);
  const u = MM.advance(M.stepU, nextU, MM.segmentStepU(M.stepAnchorU, nextU));
  if (u !== M.stepU) { M.stepU = u; Q.scene.setProgress(u); }
}

/* Where am I?: snap a path fraction to the nearest stop and present it.
 * walkStart is the hunt's qWalkStart. Returns the nearest stop. */
export function anchorToU(u: number, walkStart: (idx: number) => void): number {
  const sess = Q.current;
  if (!sess || !sess.items.length) return -1;
  let best = 0, bestD = Infinity;
  sess.items.forEach((_it, i) => {
    const d = Math.abs(qStopU(sess, i) - u);
    if (d < bestD) { bestD = d; best = i; }
  });
  Q.followHold = false;
  M.stepAnchorU = u; M.stepU = u; M.stepsHold = false;
  if (Q.scene && Q.scene.setProgress) Q.scene.setProgress(u);
  let target = best;
  if (sess.items[target].checked) {
    target = sess.items.findIndex((it, i) => i > best && !it.checked);
    if (target < 0) target = qNextIndex(sess);
  }
  Q.focusIdx = target;
  walkStart(target);
  return best;
}
