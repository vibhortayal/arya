/* The store map: the game's world map (Super Mario World's overworld).
 * Drawn with PixiJS so the token can walk, the route can march and
 * fog can drift without re-rendering React. It is loaded lazily with
 * the rest of the game. Three looks: a real map (colour), fog over
 * sections nobody has seen, and a blueprint for a simulated store. */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { RACKS, PLAN } from "../core/template";
import { leg, pointAt, routePath } from "../core/route";
import { currentStop, liveStops, itemsIn, leftIn, sectionView, type Trip } from "../core/trip";
import type { Pt } from "../core/types";
import { reducedMotion } from "../fx/feel";

/* Points are in client (viewport) coordinates. */
export type MapHandle = { pointOf(section: string): { x: number; y: number } | null };
type Props = { trip: Trip; active: boolean; tokenSrc: string; onSection: (id: string) => void; onWalkStep?: (p: { x: number; y: number }) => void; onReveal?: (p: { x: number; y: number }) => void };

const ORANGE = 0xe4572e, INK = 0x1b1b1e, GREY = 0x8b8b93, BLUE = 0x1d5faf;

function dashed(g: Graphics, pts: Pt[], dash: number, gap: number, offset: number, width: number, color: number) {
  let carry = -((offset % (dash + gap)) + (dash + gap)) % (dash + gap);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!len) continue;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    let d = carry;
    while (d < len) {
      const s = Math.max(0, d), e = Math.min(len, d + dash);
      if (e > s) g.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * e, a.y + uy * e);
      d += dash + gap;
    }
    carry = d - len;
  }
  g.stroke({ width, color, cap: "round" });
}
function poly(g: Graphics, pts: Pt[]) { pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); }

export const StoreMap = forwardRef<MapHandle, Props>(function StoreMap({ trip, active, tokenSrc, onSection, onWalkStep, onReveal }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef({
    app: null as Application | null, ready: false, scale: 1, t: 0, ro: null as ResizeObserver | null,
    floor: new Container(), zones: new Container(), labels: new Container(), path: new Graphics(), ahead: new Graphics(), nodes: new Container(), fog: new Container(), token: null as Container | null, pulse: new Graphics(),
    puffs: [] as { g: Graphics; bx: number; by: number; ph: number; sec: string }[],
    aheadPts: [] as Pt[], tokenAt: null as Pt | null, walk: null as null | { pts: Pt[]; t0: number; dur: number; lastDust: number },
    lastStop: null as string | null, lastScouted: [] as string[], cur: null as Pt | null,
    trip, active, onSection, onWalkStep, onReveal,
  });
  S.current.active = active; S.current.trip = trip; S.current.onSection = onSection; S.current.onWalkStep = onWalkStep; S.current.onReveal = onReveal;

  useImperativeHandle(ref, () => ({
    pointOf(section) {
      const s = S.current, sec = s.trip.layout.sections.find(x => x.id === section), el = host.current;
      if (!sec || !el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + sec.node.x * s.scale, y: r.top + sec.node.y * s.scale };
    },
  }));

  // Mount Pixi once.
  useEffect(() => {
    let dead = false;
    const s = S.current, el = host.current!;
    const app = new Application();
    (async () => {
      const w = el.clientWidth || 340;
      await app.init({ width: w, height: (w * PLAN.h) / PLAN.w, backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
      if (dead) { app.destroy(true); return; }
      s.app = app; s.scale = w / PLAN.w;
      el.appendChild(app.canvas);
      app.canvas.setAttribute("aria-hidden", "true");
      const world = new Container();
      world.scale.set(s.scale);
      world.addChild(s.floor, s.zones, s.fog, s.labels, s.path, s.ahead, s.pulse, s.nodes);
      app.stage.addChild(world);
      let tex: Texture | null = null;
      try { tex = await Assets.load(tokenSrc); } catch { /* token falls back to a plain badge */ }
      // The player token: the basket art in a round badge with a ring
      // (the art has a cream background, so it is clipped to a circle).
      const tok = new Container();
      const disc = new Graphics().circle(0, -17, 17).fill({ color: 0xfbf4e6 }).stroke({ width: 3, color: ORANGE });
      tok.addChild(new Graphics().ellipse(0, 2, 12, 4).fill({ color: 0x000000, alpha: 0.18 }), disc);
      if (tex) {
        const sp = new Sprite(tex); sp.anchor.set(0.5); sp.width = 32; sp.height = 32; sp.position.set(0, -17);
        const m = new Graphics().circle(0, -17, 15.5).fill({ color: 0xffffff });
        sp.mask = m; tok.addChild(m, sp);
      }
      world.addChild(tok); s.token = tok;
      s.ready = true;
      draw();
      app.ticker.add(tk => frame(tk.deltaMS));
      const ro = new ResizeObserver(() => {
        const nw = el.clientWidth; if (!nw || !s.app) return;
        s.scale = nw / PLAN.w; world.scale.set(s.scale);
        s.app.renderer.resize(nw, (nw * PLAN.h) / PLAN.w);
      });
      ro.observe(el);
      s.ro = ro;
    })();
    return () => { dead = true; s.ro?.disconnect(); if (s.app) { s.app.destroy(true, { children: true }); s.app = null; } s.ready = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw when the trip changes.
  useEffect(() => { if (S.current.ready) draw(); });

  function draw() {
    const s = S.current, t = s.trip, L = t.layout;
    const guessStore = L.kind === "simulated";
    // Floor
    const f = s.floor; f.removeChildren();
    const g = new Graphics();
    g.roundRect(6, 6, PLAN.w - 12, PLAN.h - 12, 14).fill({ color: guessStore ? 0xf3f7fd : 0xfbf8f2 });
    if (guessStore) {
      for (let x = 18; x < PLAN.w - 6; x += 12) g.moveTo(x, 8).lineTo(x, PLAN.h - 8);
      for (let y = 18; y < PLAN.h - 6; y += 12) g.moveTo(8, y).lineTo(PLAN.w - 8, y);
      g.stroke({ width: 0.6, color: 0xd3e1f4 });
      dashed(g, [{ x: 6, y: 6 }, { x: 354, y: 6 }, { x: 354, y: 434 }, { x: 6, y: 434 }, { x: 6, y: 6 }], 8, 6, 0, 2, 0x7fa3d6);
    } else g.roundRect(6, 6, PLAN.w - 12, PLAN.h - 12, 14).stroke({ width: 4, color: 0x3b3b40 });
    g.rect(22, 428, 56, 10).fill({ color: guessStore ? 0xf3f7fd : 0xfbf8f2 });
    RACKS.forEach(r => g.roundRect(r.x, r.y, r.w, r.h, 4).fill({ color: guessStore ? 0xe3ecf8 : 0xd8d4cc }));
    [125, 175, 225, 275].forEach((x, i) => { g.roundRect(x - 9, 76, 18, 14, 3).fill({ color: guessStore ? 0xc9daf1 : 0x3b3b40 }); label(f, String(i + 1), x, 83, 10, guessStore ? BLUE : 0xffffff, true); });
    for (let i = 0; i < 4; i++) g.roundRect(130 + i * 42, 356, 28, 16, 3).fill({ color: guessStore ? 0xe3ecf8 : 0xcfcbd2 });
    f.addChildAt(g, 0);
    label(f, "DOORS", 50, 414, 9, 0x55555c, true);
    label(f, "CHECKOUT", L.checkout.x, 376, 9, 0x55555c, true);

    // Sections
    const z = s.zones; z.removeChildren(); s.labels.removeChildren();
    s.fog.removeChildren(); s.puffs = [];
    for (const sec of L.sections) {
      const view = sectionView(t, sec.id);
      const onList = itemsIn(t, sec.id).length > 0;
      if (sec.kind === "aisle" && !onList) continue;
      const box = new Graphics();
      const { x, y, w, h } = sec.rect;
      const here = t.here === sec.id;
      if (view === "fog") {
        box.roundRect(x, y, w, h, 8).fill({ color: 0xe6e6eb });
        for (let k = -h; k < w; k += 7) box.moveTo(x + Math.max(0, k), y + Math.max(0, -k)).lineTo(x + Math.min(w, k + h), y + Math.min(h, h - (k + h - Math.min(w, k + h))));
        box.stroke({ width: 1, color: 0xd2d2da });
        // Drifting cloud puffs over the fog.
        const n = Math.max(2, Math.round((w * h) / 1800));
        for (let i = 0; i < n; i++) {
          const pg = new Graphics();
          const r = 7 + Math.random() * 6;
          pg.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.9 }).circle(r * 0.9, 2, r * 0.75).fill({ color: 0xffffff, alpha: 0.9 }).circle(-r * 0.8, 3, r * 0.6).fill({ color: 0xffffff, alpha: 0.9 });
          const bx = x + 10 + Math.random() * Math.max(1, w - 20), by = y + 10 + Math.random() * Math.max(1, h - 20);
          pg.position.set(bx, by);
          s.fog.addChild(pg); s.puffs.push({ g: pg, bx, by, ph: Math.random() * 6, sec: sec.id });
        }
      } else if (view === "guess") {
        box.roundRect(x, y, w, h, 8).fill({ color: sec.kind === "aisle" ? 0xe8f0fb : 0xffffff });
        dashed(box, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }], 5, 4, 0, 1.5, 0x7fa3d6);
      } else {
        box.roundRect(x, y, w, h, 8).fill({ color: sec.kind === "aisle" ? 0xe6dcf5 : sec.color, alpha: sec.kind === "aisle" ? 0.9 : 1 });
      }
      if (here) box.roundRect(x - 1, y - 1, w + 2, h + 2, 9).stroke({ width: 3, color: ORANGE });
      box.eventMode = "static"; box.cursor = "pointer";
      box.on("pointertap", () => S.current.onSection(sec.id));
      z.addChild(box);
      if (sec.kind !== "aisle") {
        const ink = view === "fog" ? 0x55555c : view === "guess" ? BLUE : sec.ink;
        const txt = (view === "fog" ? "? " : "") + sec.short.toUpperCase();
        if (h > w) label(s.labels, txt, x + w / 2, y + h / 2 + 46, 10.5, ink, true, -Math.PI / 2);
        else label(s.labels, txt, x + w / 2, y + 11, 8.5, ink, true);
      }
    }

    // Route
    const stopsLive = liveStops(t), cur = currentStop(t);
    const upTo = cur ? stopsLive.indexOf(cur) : stopsLive.length;
    const { walked, ahead } = routePath(L, stopsLive, upTo);
    s.path.clear(); poly(s.path, walked); s.path.stroke({ width: 4, color: ORANGE, alpha: 0.9, cap: "round", join: "round" });
    s.aheadPts = ahead;

    // Stops
    const nd = s.nodes; nd.removeChildren();
    stopsLive.forEach((id, i) => {
      const sec = L.sections.find(x => x.id === id)!;
      const done = leftIn(t, id).length === 0, fog = sectionView(t, id) === "fog";
      const c = new Graphics();
      c.circle(sec.node.x, sec.node.y, 11).fill({ color: done ? ORANGE : 0xffffff });
      if (fog && !done) dashed(c, Array.from({ length: 25 }, (_, k) => ({ x: sec.node.x + Math.cos((k / 24) * Math.PI * 2) * 11, y: sec.node.y + Math.sin((k / 24) * Math.PI * 2) * 11 })), 3, 2.5, 0, 2.5, GREY);
      else c.circle(sec.node.x, sec.node.y, 11).stroke({ width: 2.5, color: ORANGE });
      if (done) { c.moveTo(sec.node.x - 5, sec.node.y).lineTo(sec.node.x - 1.5, sec.node.y + 3.5).lineTo(sec.node.x + 5, sec.node.y - 3.5).stroke({ width: 2.6, color: 0xffffff, cap: "round", join: "round" }); }
      c.eventMode = "static"; c.cursor = "pointer"; c.on("pointertap", () => S.current.onSection(id));
      nd.addChild(c);
      if (!done) label(nd, fog ? "?" : String(i + 1), sec.node.x, sec.node.y + 0.5, 11.5, fog ? 0x55555c : ORANGE, true);
    });
    const fl = new Graphics();
    fl.circle(L.checkout.x, L.checkout.y, 10).fill({ color: INK }).moveTo(L.checkout.x - 3, L.checkout.y + 5).lineTo(L.checkout.x - 3, L.checkout.y - 5).lineTo(L.checkout.x + 5, L.checkout.y - 2).lineTo(L.checkout.x - 3, L.checkout.y + 1).fill({ color: 0xffffff });
    nd.addChild(fl);

    // Token: walk from the old stop to the new one.
    const target = cur ? L.sections.find(x => x.id === cur)!.node : L.checkout;
    s.cur = target;
    if (!s.active) return; // walk and reveal play when the map is on screen
    const prevStop = s.lastStop;
    if (!s.tokenAt) s.tokenAt = { ...L.entry };
    if (prevStop !== cur && s.tokenAt && (s.tokenAt.x !== target.x || s.tokenAt.y !== target.y)) {
      const from = s.tokenAt;
      const pts = [from, ...leg(from, target)];
      if (reducedMotion()) s.tokenAt = { ...target };
      else s.walk = { pts, t0: performance.now(), dur: 650 + Math.min(900, pts.length * 160), lastDust: 0 };
    }
    s.lastStop = cur;
    // Fog that lifted this trip: a burst at the section.
    const newly = t.scouted.filter(x => !s.lastScouted.includes(x));
    const hr = host.current?.getBoundingClientRect();
    newly.forEach(id => { const sec = L.sections.find(x => x.id === id); if (sec && hr && S.current.onReveal) S.current.onReveal({ x: hr.left + (sec.rect.x + sec.rect.w / 2) * s.scale, y: hr.top + (sec.rect.y + sec.rect.h / 2) * s.scale }); });
    s.lastScouted = t.scouted.slice();
  }

  function frame(dt: number) {
    const s = S.current; if (!s.token) return;
    s.t += dt;
    const rm = reducedMotion();
    // Marching route ahead.
    s.ahead.clear();
    if (s.aheadPts.length > 1) dashed(s.ahead, s.aheadPts, 2, 8, rm ? 0 : -s.t / 60, 3, ORANGE);
    // Pulse on the current stop.
    s.pulse.clear();
    if (s.cur && !rm) { const k = (s.t % 1400) / 1400; s.pulse.circle(s.cur.x, s.cur.y, 12 + k * 14).fill({ color: ORANGE, alpha: 0.55 * (1 - k) }); }
    // Fog drift.
    for (const p of s.puffs) { p.g.position.set(p.bx + Math.sin(s.t / 1300 + p.ph) * 4, p.by + Math.cos(s.t / 1700 + p.ph) * 2); }
    // Walk.
    if (s.walk) {
      const k = Math.min(1, (performance.now() - s.walk.t0) / s.walk.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      s.tokenAt = pointAt(s.walk.pts, e);
      if (s.onWalkStep && performance.now() - s.walk.lastDust > 110 && k < 1) {
        s.walk.lastDust = performance.now();
        const r = host.current?.getBoundingClientRect(); if (r) s.onWalkStep({ x: r.left + s.tokenAt.x * s.scale, y: r.top + s.tokenAt.y * s.scale });
      }
      if (k >= 1) s.walk = null;
    }
    const at = s.tokenAt || s.cur;
    if (at) {
      const hop = s.walk ? Math.abs(Math.sin(s.t / 70)) * 5 : rm ? 0 : Math.sin(s.t / 260) * 2.5;
      s.token.position.set(at.x, at.y + 6 - hop);
      s.token.scale.set(1, s.walk ? 1 - Math.abs(Math.sin(s.t / 70)) * 0.08 : 1);
    }
  }

  return <div ref={host} className="qg-mapcanvas" />;
});

function label(c: Container, text: string, x: number, y: number, size: number, fill: number, bold: boolean, rot = 0) {
  const t = new Text({ text, style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", fontSize: size, fontWeight: bold ? "800" : "500", fill, fontStyle: bold ? "normal" : "italic" }, resolution: 3 });
  t.anchor.set(0.5); t.position.set(x, y); t.rotation = rot;
  c.addChild(t);
  return t;
}
