/* Juice: short visual rewards layered on the game screen. Every
 * effect is fire-and-forget, lasts under a second, never blocks the
 * next tap and never carries text the player must read. Particles
 * draw on one 2D canvas over the game; DOM effects use the Web
 * Animations API. Reduced motion keeps the meaning (a number, a tick)
 * and drops the motion. Timings follow the research doc (section 2). */
import confetti from "canvas-confetti";
import { reducedMotion } from "./feel";

/* Category colours for the splat: each item bursts in its own colour. */
export const ART_COLOR: Record<string, string[]> = {
  "banana.webp": ["#FFD84A", "#F5B800", "#FFF1A8"], "vegetable.webp": ["#4FB23B", "#2E8B2E", "#A8E07A"],
  "blueberry.webp": ["#3D5BC4", "#6C86E0", "#22357F"], "raspberry.webp": ["#E0315B", "#FF6F8E", "#A3163B"],
  "mandarin.webp": ["#FF9A1F", "#FFC15E", "#E86E00"], "fruit.webp": ["#E9443A", "#FF7A6E", "#7CC23B"],
  "bread.webp": ["#C9893F", "#E8B878", "#8C5A23"], "bakery.webp": ["#D9A35F", "#F1CE97", "#9C6A2E"],
  "hummus.webp": ["#E7C98F", "#C9A061", "#8FA34A"], "milk.webp": ["#FFFFFF", "#CFE3FF", "#7FB0F0"],
  "egg.webp": ["#FFFFFF", "#FFE7B3", "#F4C04E"], "cheese.webp": ["#FFD23F", "#FFE68A", "#E0A800"],
  "dairy.webp": ["#FFFFFF", "#D8ECFF", "#9CC7F5"], "pizza.webp": ["#E9443A", "#FFD23F", "#7CC23B"],
  "frozen.webp": ["#BFEFFF", "#7FD6F5", "#FFFFFF"], "pasta.webp": ["#F2C14E", "#FFE08A", "#C98A1E"],
  "olive-oil.webp": ["#A8B84A", "#E5D25A", "#6E7F22"], "peanut-butter.webp": ["#B5722F", "#D9A066", "#7A4716"],
  "almond.webp": ["#B98552", "#E2BE93", "#7C5530"], "pantry.webp": ["#E4572E", "#FFC83D", "#4A8FE0"],
};
const GOLD = ["#FFC83D", "#FFE08A", "#E0A800", "#FFFFFF"];
const PARTY = ["#E4572E", "#FFC83D", "#3FA66B", "#4A8FE0", "#F28AB2"];

type P = { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number; r: number; vr: number; shape: "drop" | "rect" | "star" | "ring"; g: number };
type Decal = { x: number; y: number; r: number; c: string; life: number; blobs: [number, number, number][] };

export class Juice {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parts: P[] = [];
  private decals: Decal[] = [];
  private raf = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private confettiFire: confetti.CreateTypes | null = null;

  constructor(private root: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "qg-fx";
    this.canvas.setAttribute("aria-hidden", "true");
    root.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
    this.resize();
  }
  destroy() { cancelAnimationFrame(this.raf); this.canvas.remove(); this.confettiFire?.reset(); }
  resize() {
    const r = this.root.getBoundingClientRect();
    this.canvas.width = Math.max(1, r.width * this.dpr); this.canvas.height = Math.max(1, r.height * this.dpr);
  }
  /* A client (viewport) point in the root's coordinates. */
  local(p: { x: number; y: number }) { const R = this.root.getBoundingClientRect(); return { x: p.x - R.left, y: p.y - R.top }; }
  /* A point of an element, in the root's coordinates. */
  at(el: Element | null, fy = 0.5): { x: number; y: number } {
    const R = this.root.getBoundingClientRect();
    if (!el) return { x: R.width / 2, y: R.height / 2 };
    const r = el.getBoundingClientRect();
    return { x: r.left - R.left + r.width / 2, y: r.top - R.top + r.height * fy };
  }

  private spawn(x: number, y: number, n: number, o: { colors: string[]; speed?: number; up?: number; shape?: P["shape"]; g?: number; life?: number; size?: number }) {
    if (reducedMotion()) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (o.speed ?? 4) * (0.45 + Math.random() * 0.75);
      const life = (o.life ?? 34) * (0.7 + Math.random() * 0.6);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ?? 2.2), life, max: life, c: o.colors[i % o.colors.length], s: (o.size ?? 4) * (0.6 + Math.random() * 0.8), r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, shape: o.shape ?? "drop", g: o.g ?? 0.22 });
    }
    this.run();
  }
  private run() { if (!this.raf) this.raf = requestAnimationFrame(this.frame); }
  private frame = () => {
    const c = this.ctx, d = this.dpr;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const k of this.decals) {
      k.life -= 1; const a = Math.max(0, Math.min(0.55, k.life / 90));
      c.globalAlpha = a; c.fillStyle = k.c;
      for (const [dx, dy, rr] of k.blobs) { c.beginPath(); c.arc((k.x + dx) * d, (k.y + dy) * d, rr * d, 0, Math.PI * 2); c.fill(); }
    }
    this.decals = this.decals.filter(k => k.life > 0);
    for (const p of this.parts) {
      p.x += p.vx; p.y += p.vy; p.vy += p.g; p.vx *= 0.985; p.r += p.vr; p.life -= 1;
      const a = Math.max(0, Math.min(1, p.life / (p.max * 0.5)));
      c.globalAlpha = a; c.fillStyle = p.c; c.strokeStyle = p.c;
      c.save(); c.translate(p.x * d, p.y * d); c.rotate(p.r);
      const s = p.s * d;
      if (p.shape === "drop") { c.beginPath(); c.ellipse(0, 0, s * 0.7, s * 1.15, 0, 0, Math.PI * 2); c.fill(); }
      else if (p.shape === "rect") c.fillRect(-s, -s / 2, s * 2, s);
      else if (p.shape === "star") { c.beginPath(); for (let i = 0; i < 10; i++) { const rr = i % 2 ? s * 0.45 : s * 1.2, an = (i * Math.PI) / 5; c.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } c.closePath(); c.fill(); }
      else { const grow = (1 - p.life / p.max) * 60 * d; c.lineWidth = 3 * d; c.beginPath(); c.arc(0, 0, s + grow, 0, Math.PI * 2); c.stroke(); }
      c.restore();
    }
    c.globalAlpha = 1;
    this.parts = this.parts.filter(p => p.life > 0);
    this.raf = this.parts.length || this.decals.length ? requestAnimationFrame(this.frame) : 0;
    if (!this.raf) c.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  /* Fruit Ninja: juice drops in the item's colours, a ring, and a
   * splat stain that fades behind (the trace of what you collected). */
  splat(x: number, y: number, art: string, golden = false) {
    const cols = golden ? GOLD : ART_COLOR[art] || PARTY;
    this.spawn(x, y, golden ? 26 : 14, { colors: cols, speed: golden ? 6 : 4.6, shape: "drop", life: 30, size: 4.2 });
    this.spawn(x, y, 1, { colors: [cols[0]], speed: 0, up: 0, shape: "ring", g: 0, life: 22, size: 10 });
    if (golden) this.spawn(x, y, 10, { colors: GOLD, speed: 5, shape: "star", life: 40, size: 5, g: 0.08 });
    if (!reducedMotion()) {
      const blobs: [number, number, number][] = Array.from({ length: 7 }, () => [(Math.random() - 0.5) * 46, (Math.random() - 0.5) * 30, 4 + Math.random() * 9]);
      this.decals.push({ x, y, r: 20, c: cols[0], life: 110, blobs });
      this.run();
    }
  }
  sparkle(x: number, y: number, n = 12) { this.spawn(x, y, n, { colors: GOLD, speed: 3.4, shape: "star", g: 0.03, life: 42, size: 4.5 }); }
  burst(x: number, y: number, n = 40, colors = PARTY) { this.spawn(x, y, n, { colors, speed: 7, shape: "rect", life: 60, size: 4, g: 0.18 }); }
  dust(x: number, y: number) { this.spawn(x, y, 6, { colors: ["#D9D4CA", "#E9E5DD"], speed: 1.2, up: 0.6, shape: "drop", g: -0.02, life: 26, size: 3.5 }); }

  /* A number that rises from a point and fades (the Mario coin). */
  float(x: number, y: number, text: string, kind: "pts" | "gold" | "scout" | "chain" = "pts") {
    const el = document.createElement("div");
    el.className = `qg-float ${kind}`; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    this.root.appendChild(el);
    const rm = reducedMotion();
    el.animate(rm ? [{ opacity: 1 }, { opacity: 0 }] : [
      { transform: "translate(-50%,-50%) scale(.6)", opacity: 0 },
      { transform: "translate(-50%,-90%) scale(1.25)", opacity: 1, offset: 0.25 },
      { transform: "translate(-50%,-170%) scale(1)", opacity: 0 },
    ], { duration: rm ? 700 : 650, easing: "cubic-bezier(.22,1,.36,1)" }).onfinish = () => el.remove();
  }

  /* The item flies into the basket in the HUD, with a short hit-stop
   * (it holds big for 70 ms first, which gives the grab its weight). */
  fly(from: { x: number; y: number }, to: Element | null, src: string, then?: () => void) {
    if (!to || reducedMotion()) { then?.(); return; }
    const b = this.at(to);
    const im = document.createElement("img");
    im.src = src; im.alt = ""; im.className = "qg-flyer";
    im.style.left = `${from.x}px`; im.style.top = `${from.y}px`;
    this.root.appendChild(im);
    const dx = b.x - from.x, dy = b.y - from.y;
    im.animate([
      { transform: "translate(-50%,-50%) scale(1)", offset: 0 },
      { transform: "translate(-50%,-50%) scale(1.35) rotate(-8deg)", offset: 0.14 },
      { transform: "translate(-50%,-50%) scale(1.35) rotate(-8deg)", offset: 0.27 },
      { transform: `translate(calc(-50% + ${dx * 0.45}px), calc(-50% + ${dy * 0.45 - 70}px)) scale(1) rotate(8deg)`, offset: 0.6 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3) rotate(18deg)`, opacity: 0.7 },
    ], { duration: 560, easing: "cubic-bezier(.45,0,.25,1)" }).onfinish = () => {
      im.remove();
      (to as HTMLElement).animate?.([{ transform: "scale(1)" }, { transform: "scale(1.28)" }, { transform: "scale(1)" }], { duration: 260, easing: "ease-out" });
      then?.();
    };
  }

  /* Squash and stretch on a pressed control or a sticker. */
  pop(el: Element | null, big = false) {
    if (!el || reducedMotion()) return;
    (el as HTMLElement).animate([{ transform: "scale(1)" }, { transform: `scale(${big ? 0.86 : 0.92}, ${big ? 1.1 : 1.05})`, offset: 0.25 }, { transform: `scale(${big ? 1.12 : 1.05})`, offset: 0.6 }, { transform: "scale(1)" }], { duration: 300, easing: "ease-out" });
  }
  /* Screen shake: finale only, 4 px, 120 ms (research: shake while
   * walking reads as a glitch). */
  shake() {
    if (reducedMotion()) return;
    this.root.animate([{ transform: "translate(0,0)" }, { transform: "translate(-4px,2px)" }, { transform: "translate(3px,-3px)" }, { transform: "translate(-2px,1px)" }, { transform: "translate(0,0)" }], { duration: 120 });
  }
  /* Confetti cannons for the finale (canvas-confetti; it skips itself
   * under reduced motion). */
  confetti() {
    if (!this.confettiFire) {
      const cv = document.createElement("canvas"); cv.className = "qg-fx qg-confetti"; this.root.appendChild(cv);
      this.confettiFire = confetti.create(cv, { resize: true, useWorker: true, disableForReducedMotion: true });
    }
    const f = this.confettiFire;
    void f({ particleCount: 90, spread: 70, origin: { x: 0.5, y: 0.35 }, colors: PARTY, scalar: 0.9 });
    setTimeout(() => void f({ particleCount: 50, angle: 60, spread: 55, origin: { x: 0, y: 0.6 }, colors: PARTY }), 220);
    setTimeout(() => void f({ particleCount: 50, angle: 120, spread: 55, origin: { x: 1, y: 0.6 }, colors: PARTY }), 380);
  }
}
