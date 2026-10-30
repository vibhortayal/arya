import { motionOff } from "../../lib/motion";
/* Sound, buzz and voice: the parts of the feel you get without looking.
 * All three are opt-in (a phone in a store should not beep unasked),
 * remembered per device, and safe to call when unsupported. Sounds are
 * synthesised with Web Audio (no files). */

export type FeelPrefs = { sound: boolean; buzz: boolean; voice: boolean };
const KEY = "arya-quest-feel";

export function loadPrefs(): FeelPrefs {
  try { return { sound: false, buzz: true, voice: false, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { sound: false, buzz: true, voice: false }; }
}
export function savePrefs(p: FeelPrefs) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked */ } }

let prefs = loadPrefs();
export const feel = {
  get prefs() { return prefs; },
  set(p: Partial<FeelPrefs>) { prefs = { ...prefs, ...p }; savePrefs(prefs); if (p.sound) chime(0); },
};

export const reducedMotion = motionOff;

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (!prefs.sound) return null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch { return null; }
}
function tone(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = "triangle", vol = 0.08) {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at); o.stop(at + dur + 0.02);
}
const NOTE = (semi: number) => 523.25 * Math.pow(2, semi / 12); // C5 + semitones

/* The coin: two rising notes. Each grab in a row in one section steps
 * the pitch up (Mario's stomp chain), so a sweep sounds like a climb. */
export function chime(chain: number) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + 0.005, s = Math.min(chain, 7) * 2;
  tone(c, NOTE(7 + s), t, 0.09, "square", 0.045);
  tone(c, NOTE(12 + s), t + 0.07, 0.16, "square", 0.045);
}
export function goldChime() {
  const c = ac(); if (!c) return;
  const t = c.currentTime + 0.005;
  [0, 4, 7, 12, 16].forEach((s, i) => tone(c, NOTE(12 + s), t + i * 0.05, 0.14, "triangle", 0.06));
}
/* Fog lifting: a soft rising whoosh made of a filtered noise burst. */
export function whoosh() {
  const c = ac(); if (!c) return;
  const len = 0.6, buf = c.createBuffer(1, c.sampleRate * len, c.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = buf; f.type = "bandpass"; f.frequency.setValueAtTime(400, c.currentTime); f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + len);
  g.gain.value = 0.12; src.connect(f).connect(g).connect(c.destination); src.start();
}
/* The stinger: section clear (short) and trip clear (long). */
export function stinger(big = false) {
  const c = ac(); if (!c) return;
  const t = c.currentTime + 0.01;
  const seq = big ? [0, 4, 7, 12, 7, 12, 16, 19] : [0, 4, 7, 12];
  seq.forEach((s, i) => tone(c, NOTE(s), t + i * (big ? 0.11 : 0.08), big ? 0.22 : 0.16, "square", 0.05));
  if (big) tone(c, NOTE(-12), t, 0.9, "triangle", 0.06);
}
export function tick(step: number) {
  const c = ac(); if (!c) return;
  tone(c, NOTE(step % 12), c.currentTime + 0.005, 0.06, "square", 0.035);
}
export function soft() {
  const c = ac(); if (!c) return;
  tone(c, NOTE(-5), c.currentTime + 0.005, 0.12, "sine", 0.06);
}

/* Haptics: Android only (iOS Safari has no Vibration API). */
export function buzz(pattern: number | number[]) {
  if (!prefs.buzz || reducedMotion()) return;
  try { navigator.vibrate?.(pattern); } catch { /* no buzz */ }
}

/* Voice guide (pocket mode, after Zombies, Run!): the phone can stay
 * in the cart; Arya says the next stop out loud. */
export function say(text: string) {
  if (!prefs.voice || typeof speechSynthesis === "undefined") return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 1.05; speechSynthesis.speak(u); } catch { /* no voice */ }
}
