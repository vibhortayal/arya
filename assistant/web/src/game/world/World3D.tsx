/* The living store: one continuous 3D world (three.js through React
 * Three Fiber). Your shopper pushes a cart along the shortest walk to
 * each item, other shoppers stroll, grabbed items fly into the cart and
 * the camera follows. The world only shows and moves; the trip reducer
 * owns the rules, and the screen around it (Play) decides what a tap means.
 *
 * Honesty rules carry over from the map: a simulated store is drawn as
 * a blueprint, an unmapped section sits under fog with a "?" sign, and
 * nothing here claims a shelf Arya has not seen. */
import { Canvas, invalidate, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { charArt } from "../assets";
import { reducedMotion } from "../fx/feel";
import { currentStop, isHandled, itemsIn, liveStops, sectionView, type Trip } from "../core/trip";
import type { Section } from "../core/types";
import { checkoutOf, entryOf, findPath, fixtures, floorOf, grid, nearestOpen, spots, toWorld, U, type Fixture, type Floor, type Spot, type V2 } from "./layout3d";
import { advance, pathLen, zoomSpeed, type Walker } from "./motion";

const UP = new THREE.Vector3(0, 1, 0);

export type Goal = { kind: "item"; key: string } | { kind: "checkout" } | { kind: "point"; p: V2 };
export type WorldApi = {
  walkTo(g: Goal): void;
  /* Client coordinates of an item's marker, or of the shopper. */
  screenOf(what: string): { x: number; y: number } | null;
  pickup(key: string): void;
  setOverview(on: boolean): void;
  /* Undo the player's zoom and turn; true when there was any. */
  resetView(): boolean;
  busy(): boolean;
};
type Props = {
  trip: Trip;
  /* The player's own avatar picture: worn as the shopper's face. */
  avatar?: string | null;
  focus: string | null;
  onReady: (api: WorldApi) => void;
  onArrive: (g: Goal) => void;
  onWalking: (g: Goal | null) => void;
  onTapItem: (key: string) => void;
  /* The phone cannot draw the store (no WebGL, or the renderer failed):
   * the screen around the world carries on without it. */
  onFail?: () => void;
};

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

/* ---------------------------------------------------------------- palette */
type Pal = ReturnType<typeof palette>;
function palette(bp: boolean, look?: Trip["layout"]["look"]) {
  if (bp) return {
    bp, floorA: "#EAF1FB", floorB: "#E1EAF7", grout: "#C8D8EE", wall: "#E6EEF9", trim: "#9DB8E0", wood: "#DCE7F7", metal: "#D3E1F4",
    glass: "#BFD6F2", product: ["#CFDDF2", "#DCE7F7", "#C3D5EF", "#E6EEF9"], fruit: ["#C9DAF1", "#D9E5F6"], ink: "#3E6FB8", sky: "#F3F7FD",
  };
  const base = {
    bp, floorA: "#F4EBD6", floorB: "#EEE3CB", grout: "#E2D6BC", wall: "#F1E7D3", trim: "#C9B48C", wood: "#C99A62", metal: "#A9B8B2",
    glass: "#CFEAF2", product: ["#E4572E", "#F2C14E", "#3FA66B", "#4A8FE0", "#F28AB2", "#FFF4D6", "#8E6CCF", "#F08A3C"],
    fruit: ["#E9443A", "#F5B800", "#4FB23B", "#FF9A1F", "#7CC23B", "#C2185B"], ink: "#2E3B33", sky: "#FBF4E6",
  };
  // Build's looks (map/answers.ts): the same store, another mood.
  if (look === "modern") return { ...base, floorA: "#FAFAFA", floorB: "#EFF1F3", grout: "#E1E4E8", wall: "#FFFFFF", trim: "#B8C2CC", wood: "#E8EBEE", metal: "#CBD3DA", sky: "#F4F7FA", ink: "#1F2933" };
  if (look === "farm") return { ...base, floorA: "#E9DCC2", floorB: "#DCCAA8", grout: "#C9B38A", wall: "#B5452F", trim: "#7A2E1F", wood: "#9C6B3E", metal: "#8A9A7B", sky: "#F3EBDA", ink: "#3B2A1A" };
  if (look === "neon") return { ...base, floorA: "#2A2340", floorB: "#231C38", grout: "#3B3160", wall: "#3A2F63", trim: "#FF4FD8", wood: "#5B3FA8", metal: "#47D7FF", glass: "#7DF9FF", sky: "#1A1530", ink: "#FFFFFF",
    product: ["#FF4FD8", "#47D7FF", "#B8FF3C", "#FFE14F", "#FF8A3C", "#9B7CFF"], fruit: ["#FF4FD8", "#B8FF3C", "#FFE14F", "#47D7FF"] };
  return base;
}

/* ----------------------------------------------------------- textures */
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  draw(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const imgCache = new Map<string, HTMLImageElement>();
function loadImg(src: string, then: (im: HTMLImageElement) => void) {
  let im = imgCache.get(src);
  if (im?.complete && im.naturalWidth) { then(im); return; }
  if (!im) { im = new Image(); im.src = src; imgCache.set(src, im); }
  // The world draws on demand: a picture that arrives late asks for a frame.
  im.addEventListener("load", () => { then(im!); invalidate(); }, { once: true });
}

/* An item's sticker card, floating over its shelf. */
type CardMode = "n" | "on" | "gold" | "fog" | "dim";
const cardCache = new Map<string, THREE.CanvasTexture>();
function cardTex(art: string, mode: CardMode, bp: boolean) {
  const key = art + mode + bp;
  const hit = cardCache.get(key); if (hit) return hit;
  const W = 256, H = 300;
  const paint = (c: CanvasRenderingContext2D, im?: HTMLImageElement) => {
    c.clearRect(0, 0, W, H);
    const border = mode === "gold" ? "#F2B705" : mode === "on" ? "#2E8B57" : mode === "fog" ? "#8C96A3" : bp ? "#5B8BD0" : "#FFFFFF";
    c.fillStyle = "rgba(0,0,0,.18)"; c.beginPath(); c.roundRect(14, 18, W - 24, W - 24, 46); c.fill();
    c.fillStyle = mode === "gold" ? "#FFF3C4" : "#FFFDF7"; c.strokeStyle = border; c.lineWidth = mode === "n" || mode === "dim" ? 8 : 16;
    c.beginPath(); c.roundRect(10, 10, W - 24, W - 24, 44); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(W / 2 - 22, W - 16); c.lineTo(W / 2 - 7, H - 8); c.lineTo(W / 2 + 8, W - 16); c.fillStyle = border === "#FFFFFF" ? "#FFFDF7" : border; c.fill();
    if (im) { c.save(); c.beginPath(); c.roundRect(30, 30, W - 64, W - 64, 30); c.clip(); c.drawImage(im, 30, 30, W - 64, W - 64); c.restore(); }
    if (mode === "fog") { c.fillStyle = "#5E6B7A"; c.beginPath(); c.arc(W - 40, 38, 30, 0, 7); c.fill(); c.fillStyle = "#fff"; c.font = "800 40px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("?", W - 40, 40); }
    if (mode === "gold") { c.fillStyle = "#F2B705"; c.beginPath(); c.arc(W - 40, 38, 30, 0, 7); c.fill(); c.fillStyle = "#fff"; c.font = "800 38px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("★", W - 40, 40); }
    if (mode === "dim") { c.fillStyle = "rgba(255,253,247,.55)"; c.fillRect(0, 0, W, H); }
  };
  const t = canvasTex(W, H, c => paint(c));
  loadImg(charArt(art), im => { paint((t.image as HTMLCanvasElement).getContext("2d")!, im); t.needsUpdate = true; });
  cardCache.set(key, t);
  return t;
}

/* The player's avatar, cut round with a white rim (avatars are square pictures). */
const faceCache = new Map<string, THREE.CanvasTexture>();
function faceTex(src: string) {
  const hit = faceCache.get(src); if (hit) return hit;
  const W = 256;
  const paint = (c: CanvasRenderingContext2D, im?: HTMLImageElement) => {
    c.clearRect(0, 0, W, W);
    c.fillStyle = "rgba(0,0,0,.2)"; c.beginPath(); c.arc(W / 2, W / 2 + 6, W / 2 - 8, 0, 7); c.fill();
    c.fillStyle = "#FFFDF7"; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 8, 0, 7); c.fill();
    if (im) { c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 22, 0, 7); c.clip(); c.drawImage(im, 14, 14, W - 28, W - 28); c.restore(); }
    c.strokeStyle = "#F2C14E"; c.lineWidth = 10; c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 12, 0, 7); c.stroke();
  };
  const t = canvasTex(W, W, c => paint(c));
  loadImg(src, im => { paint((t.image as HTMLCanvasElement).getContext("2d")!, im); t.needsUpdate = true; });
  faceCache.set(src, t);
  return t;
}

function signTex(text: string, bg: string, fg: string, dashed: boolean) {
  return canvasTex(512, 128, c => {
    c.fillStyle = bg; c.strokeStyle = dashed ? fg : "rgba(0,0,0,.25)"; c.lineWidth = 8;
    if (dashed) c.setLineDash([22, 14]);
    c.beginPath(); c.roundRect(8, 8, 496, 112, 30); c.fill(); c.stroke();
    c.fillStyle = fg; c.font = "800 60px system-ui, -apple-system, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text.toUpperCase(), 256, 68, 460);
  });
}

const softTex = () => canvasTex(128, 128, c => {
  const g = c.createRadialGradient(64, 64, 4, 64, 64, 62); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,.55)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
});

/* ------------------------------------------------------------ the world */
/* A phone with 4 cores or fewer draws without shadows or antialiasing,
 * at 1x pixels (speed audit #12). */
const LOW_END = typeof navigator !== "undefined" && (navigator.hardwareConcurrency || 8) <= 4;

/* WebGL is there at all (retest 2026-10-31 #1: a browser without it
 * blanked the whole app). Asked once; the probe's context is let go. */
let glOk: boolean | null = null;
export function canDraw3D() {
  if (glOk !== null) return glOk;
  try {
    const gl = document.createElement("canvas").getContext("webgl2") || document.createElement("canvas").getContext("webgl");
    glOk = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { glOk = false; }
  return glOk;
}

/* What shows in the world's place when it cannot be drawn. */
function NoWorld({ onFail }: { onFail?: () => void }) {
  useEffect(() => { onFail?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="qg-world qg-noworld" role="note">
      <p><b>This browser can't draw the 3D store.</b><br />Your list still works: open it and tap an item to grab it.</p>
    </div>
  );
}

/* A renderer that throws (lost or refused context) stays inside the world. */
class WorldGuard extends Component<{ children: ReactNode; onFail?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn("Arya 3D:", e); }
  render() { return this.state.failed ? <NoWorld onFail={this.props.onFail} /> : this.props.children; }
}

export function World3D(p: Props) {
  if (!canDraw3D()) return <NoWorld onFail={p.onFail} />;
  // frameloop="demand": a frame is drawn only while something moves
  // (the shopper, a flight, the camera settling, other shoppers in
  // practice). A still store draws nothing, so a sheet over it costs no
  // GPU time and the phone stays cool (speed audit #12).
  return (
    <WorldGuard onFail={p.onFail}>
    <Canvas className="qg-world" frameloop="demand" shadows={!LOW_END} dpr={LOW_END ? 1 : [1, 1.5]}
      gl={{ antialias: !LOW_END, powerPreference: LOW_END ? "default" : "high-performance" }}
      camera={{ fov: 42, near: 0.5, far: 200, position: [10, 30, 40] }} onCreated={({ gl }) => { gl.toneMapping = THREE.NoToneMapping; }}>
      <Store {...p} />
    </Canvas>
    </WorldGuard>
  );
}



function Store({ trip, avatar, focus, onReady, onArrive, onWalking, onTapItem }: Props) {
  const L = trip.layout;
  const bp = L.kind === "simulated";
  const P = useMemo(() => palette(bp, L.look), [bp, L.look]);
  const FL = useMemo(() => floorOf(L), [L]);
  const F = useMemo(() => fixtures(L), [L]);
  const G = useMemo(() => grid(F, FL), [F, FL]);
  const ENTRY_AT = useMemo(() => entryOf(FL), [FL]), CHECKOUT_AT = useMemo(() => checkoutOf(FL), [FL]);
  const S = useMemo(() => spots(L, trip.items, G), [L, trip.items, G]);
  const { camera, gl, scene } = useThree();

  const sim = useRef({
    me: { p: { ...ENTRY_AT }, heading: Math.PI, path: [] as V2[], walk: 0, moving: false, speed: 8, pause: 0, zoom: true } as Walker,
    goal: null as Goal | null,
    // Other shoppers stroll only in practice: in a real store they would be one more thing to watch.
    npcs: !trip.practice ? [] : [
      { p: nearestOpen(G, { x: FL.w * 0.37, z: FL.d * 0.41 }), heading: 0, path: [], walk: 0, moving: false, speed: 1.1, pause: 1 },
      { p: nearestOpen(G, { x: FL.w * 0.8, z: 2.6 }), heading: 0, path: [], walk: 2, moving: false, speed: 0.9, pause: 3 },
      { p: nearestOpen(G, { x: FL.w * 0.67, z: FL.d * 0.76 }), heading: 0, path: [], walk: 1, moving: false, speed: 1.0, pause: 0 },
    ] as Walker[],
    flights: [] as { key: string; t: number; from: THREE.Vector3 }[],
    overview: false,
    zoom: 1, yaw: 0,              // the player's pinch and two-finger turn
    camT: new THREE.Vector3(ENTRY_AT.x, 0, ENTRY_AT.z),
    clock: 0,
    // Keep drawing until this clock time (fades, pulses after a change).
    awake: 1.5,
    npcWake: 0,                   // a timer that wakes the world when a resting shopper sets off
  });
  useEffect(() => () => clearTimeout(sim.current.npcWake), []);
  const wake = (sec = 1.2) => { const s = sim.current; s.awake = Math.max(s.awake, s.clock + sec); invalidate(); };
  // A new trip state (a grab, a pass, fog lifting) or focus animates for a moment.
  useEffect(() => { wake(); }, [trip, focus]); // eslint-disable-line react-hooks/exhaustive-deps
  const cb = useRef({ onArrive, onWalking, onTapItem }); cb.current = { onArrive, onWalking, onTapItem };
  const spotsRef = useRef(S); spotsRef.current = S;

  useEffect(() => { scene.background = new THREE.Color(P.sky); scene.fog = new THREE.Fog(P.sky, 40, 90); }, [scene, P.sky]);

  /* The API the screen drives. */
  useEffect(() => {
    const s = sim.current;
    const api: WorldApi = {
      walkTo(g) {
        const to = g.kind === "item" ? spotsRef.current.find(x => x.key === g.key)?.stand : g.kind === "checkout" ? CHECKOUT_AT : nearestOpen(G, g.p);
        if (!to) return;
        s.goal = g;
        s.me.path = findPath(G, s.me.p, to);
        if (!s.me.path.length) s.me.path = [to];
        s.me.speed = zoomSpeed(pathLen(s.me.p, s.me.path), reducedMotion());
        s.overview = false;
        cb.current.onWalking(g.kind === "point" ? null : g);
        wake();
      },
      screenOf(what) {
        const v = what === "player" ? new THREE.Vector3(s.me.p.x, 1.4, s.me.p.z) : (() => { const sp = spotsRef.current.find(x => x.key === what); return sp ? new THREE.Vector3(sp.at.x, 2.25, sp.at.z) : null; })();
        if (!v) return null;
        v.project(camera);
        const r = gl.domElement.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
      },
      pickup(key) {
        const sp = spotsRef.current.find(x => x.key === key);
        if (sp) s.flights.push({ key, t: 0, from: new THREE.Vector3(sp.at.x, 2.2, sp.at.z) });
        wake();
      },
      setOverview(on) { s.overview = on; wake(); },
      resetView() { const had = Math.abs(s.zoom - 1) > 0.05 || Math.abs(s.yaw) > 0.05; s.zoom = 1; s.yaw = 0; wake(); return had; },
      busy() { return s.me.path.length > 0; },
    };
    onReady(api);
  }, [G, camera, gl, onReady, CHECKOUT_AT]);

  /* Simulation: shopper, other shoppers, flights, camera. */
  useFrame((_, dtRaw) => {
    const dt = Math.min(0.05, dtRaw), s = sim.current, rm = reducedMotion();
    s.clock += dt;
    step(s.me, dt, () => {
      const g = s.goal; s.goal = null;
      if (g?.kind === "item") {
        // Park the cart alongside the shelf (not into it): turn side-on, whichever way is closer.
        const sp = spotsRef.current.find(x => x.key === g.key);
        if (sp) { const a = sp.face + Math.PI / 2, b = sp.face - Math.PI / 2, d = (x: number) => Math.abs(Math.atan2(Math.sin(x - s.me.heading), Math.cos(x - s.me.heading))); s.me.heading = d(a) < d(b) ? a : b; }
      }
      if (g?.kind === "checkout") s.me.heading = Math.PI;
      cb.current.onWalking(null);
      if (g && g.kind !== "point") cb.current.onArrive(g);
    });
    if (!rm) for (const n of s.npcs) {
      if (!n.path.length) {
        n.pause -= dt;
        if (n.pause <= 0) {
          const t = { x: 1 + Math.random() * (FL.w - 2), z: 2 + Math.random() * (FL.d - 6) };
          n.path = findPath(G, n.p, nearestOpen(G, t)); n.pause = 1.5 + Math.random() * 3.5;
        }
      }
      step(n, dt, () => {});
    }
    s.flights.forEach(f => (f.t += dt * 1.6)); s.flights = s.flights.filter(f => f.t < 1);
    // Camera: follow the shopper, framed above the bottom card; or the whole store.
    const asp = Math.max(0.4, size.current.w / Math.max(1, size.current.h));
    const want = (s.overview ? Math.max(FL.w, FL.d) * 1.15 : 11) * s.zoom, fov = (camera as THREE.PerspectiveCamera).fov * Math.PI / 180;
    const dist = Math.min(60, want / (2 * Math.tan(fov / 2) * Math.min(asp, 1.3)));
    const lead = new THREE.Vector3(0, 0, 1.6).applyAxisAngle(UP, s.yaw);
    const tgt = s.overview ? new THREE.Vector3(FL.w / 2, 0, FL.d / 2 + 1.5) : new THREE.Vector3(s.me.p.x, 0, s.me.p.z).add(lead);
    const k = rm ? 20 : s.me.moving ? 9 : 3.2; // keep up with a zoom, settle softly after
    s.camT.lerp(tgt, 1 - Math.exp(-dt * k));
    const dir = new THREE.Vector3(0.28, 1.05, 0.9).normalize().multiplyScalar(dist).applyAxisAngle(UP, s.yaw);
    const camWant = s.camT.clone().add(dir);
    camera.position.lerp(camWant, 1 - Math.exp(-dt * k));
    camera.lookAt(s.camT);
    // Ask for the next frame only while something still moves.
    const moving = s.me.path.length > 0 || s.me.moving || s.flights.length > 0
      || s.clock < s.awake || s.camT.distanceTo(tgt) > 0.01 || camera.position.distanceTo(camWant) > 0.01;
    const npcBusy = !rm && s.npcs.some(n => n.path.length > 0 || n.moving);
    if (moving || npcBusy) invalidate();
    else if (!rm && s.npcs.length && !s.npcWake) {
      // Everyone is resting: no frames until the first stroller sets off.
      const wait = Math.max(0.05, Math.min(...s.npcs.map(n => n.pause))), t0 = performance.now();
      s.npcWake = window.setTimeout(() => {
        s.npcWake = 0;
        const gone = (performance.now() - t0) / 1000;
        s.npcs.forEach(n => { n.pause -= gone; });
        invalidate();
      }, wait * 1000);
    }
  });
  /* Pinch to zoom, two fingers to turn (owner, 2026-10-30); the mouse
   * wheel zooms on a computer. One finger still taps and walks. */
  useEffect(() => {
    const el = gl.domElement, s = sim.current, pts = new Map<number, { x: number; y: number }>();
    let last: { d: number; a: number } | null = null;
    const pair = () => { const [p, q] = [...pts.values()]; return { d: Math.hypot(q.x - p.x, q.y - p.y), a: Math.atan2(q.y - p.y, q.x - p.x) }; };
    const down = (e: PointerEvent) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) last = pair(); };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size !== 2 || !last) return;
      const now = pair();
      s.zoom = Math.min(2.6, Math.max(0.45, s.zoom * last.d / Math.max(1, now.d)));
      let da = now.a - last.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      s.yaw -= da;
      last = now;
      wake(0.3);
    };
    const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) last = null; };
    const wheel = (e: WheelEvent) => { e.preventDefault(); s.zoom = Math.min(2.6, Math.max(0.45, s.zoom * Math.exp(e.deltaY * 0.0015))); wake(0.3); };
    el.addEventListener("pointerdown", down); el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, [gl]);
  const size = useRef({ w: 1, h: 1 });
  const three = useThree(); size.current = { w: three.size.width, h: three.size.height };

  const tapFloor = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const s = sim.current;
    s.goal = { kind: "point", p: { x: e.point.x, z: e.point.z } };
    s.me.path = findPath(G, s.me.p, nearestOpen(G, { x: e.point.x, z: e.point.z }));
    s.me.speed = zoomSpeed(pathLen(s.me.p, s.me.path), reducedMotion());
    s.overview = false;
    cb.current.onWalking(null);
    wake();
  };

  const cur = currentStop(trip), reach = Math.max(FL.w, FL.d) / 2 + 5;
  return (
    <>
      <hemisphereLight args={[P.bp ? "#FFFFFF" : "#FFF6E4", P.bp ? "#DCE7F7" : "#D9C9A8", 1.5]} />
      <directionalLight position={[FL.w / 2 + 1, 18, FL.d / 2 + 1]} intensity={P.bp ? 0.9 : 1.7} castShadow
        shadow-mapSize={[1024, 1024]} shadow-camera-left={-reach} shadow-camera-right={reach} shadow-camera-top={reach} shadow-camera-bottom={-reach} shadow-bias={-0.0006}
        target-position={[FL.w / 2, 0, FL.d / 2]} />
      <Floor P={P} L={L} FL={FL} trip={trip} onTap={tapFloor} />
      <Walls P={P} FL={FL} name={L.name} />
      <Fixtures P={P} F={F} />
      <Signs P={P} trip={trip} FL={FL} />
      <FogBanks trip={trip} />
      <StopDiscs trip={trip} S={S} cur={cur} />
      <PathDots sim={sim} />
      <Markers trip={trip} S={S} focus={focus} bp={bp} onTap={k => cb.current.onTapItem(k)} sim={sim} />
      <Shopper w={() => sim.current.me} cart shirt="#F2C14E" pants="#3E5C76" hair="#5A3B2A" skin="#D9A57B" got={trip.got} items={trip.items} face={avatar} />
      {sim.current.npcs.map((_, i) => (
        <Shopper key={i} w={() => sim.current.npcs[i]} shirt={["#7FA7C9", "#C98FA7", "#9DBF7A"][i]} pants={["#4D5D6B", "#6B5A4D", "#4F5B4A"][i]} hair={["#2F2A26", "#B89B72", "#6B4A2E"][i]} skin={["#C68A64", "#E8C2A0", "#9A6A48"][i]} ghost={bp} />
      ))}
      <Flights sim={sim} trip={trip} bp={bp} />
    </>
  );

  function step(w: Walker, dt: number, arrived: () => void) {
    if (advance(w, dt)) arrived();
  }
}

/* --------------------------------------------------------------- floor */
function Floor({ P, L, FL, trip, onTap }: { P: Pal; L: Trip["layout"]; FL: Floor; trip: Trip; onTap: (e: ThreeEvent<MouseEvent>) => void }) {
  const tex = useMemo(() => {
    const t = canvasTex(128, 128, c => {
      c.fillStyle = P.floorA; c.fillRect(0, 0, 128, 128); c.fillStyle = P.floorB; c.fillRect(0, 0, 64, 64); c.fillRect(64, 64, 64, 64);
      c.strokeStyle = P.grout; c.lineWidth = 2; c.strokeRect(0, 0, 64, 64); c.strokeRect(64, 64, 64, 64); c.strokeRect(64, 0, 64, 64); c.strokeRect(0, 64, 64, 64);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(FL.w / 2, FL.d / 2);
    return t;
  }, [P, FL]);
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[FL.w / 2, 0, FL.d / 2]} receiveShadow onClick={onTap}>
        <planeGeometry args={[FL.w, FL.d]} />
        <meshLambertMaterial map={tex} />
      </mesh>
      {/* Ground outside the store, so the edges never float in space. */}
      <mesh rotation-x={-Math.PI / 2} position={[FL.w / 2, -0.02, FL.d / 2]}>
        <planeGeometry args={[120, 120]} />
        <meshBasicMaterial color={P.bp ? "#E8EFF9" : P.sky === "#FBF4E6" ? "#E6DCC5" : P.sky} />
      </mesh>
      {L.sections.map(s => {
        const v = sectionView(trip, s.id);
        const r = s.rect;
        return (
          <mesh key={s.id} rotation-x={-Math.PI / 2} position={[(r.x + r.w / 2) / U, 0.006, (r.y + r.h / 2) / U]} receiveShadow>
            <planeGeometry args={[r.w / U, r.h / U]} />
            <meshLambertMaterial color={v === "fog" ? "#C9CED6" : P.bp ? "#D3E2F6" : hex(s.color)} transparent opacity={P.bp ? 0.6 : 0.75} />
          </mesh>
        );
      })}
      {/* Doormat at the entrance. */}
      <mesh rotation-x={-Math.PI / 2} position={[entryOf(FL).x, 0.01, FL.d - 0.6]}>
        <planeGeometry args={[2.6, 0.9]} />
        <meshLambertMaterial color={P.bp ? "#BFD3EE" : "#6E7F5A"} />
      </mesh>
    </group>
  );
}

function Walls({ P, FL, name }: { P: Pal; FL: Floor; name: string }) {
  const sign = useMemo(() => signTex(name, P.bp ? "#FFFFFF" : "#2E6B4F", P.bp ? P.ink : "#FFF6DA", P.bp), [name, P]);
  return (
    <group>
      <Block x={-0.25} z={-0.25} w={FL.w + 0.5} d={0.3} h={3} c={P.wall} P={P} cast={false} />
      <Block x={-0.25} z={0} w={0.3} d={FL.d} h={3} c={P.wall} P={P} cast={false} />
      <Block x={-0.25} z={-0.05} w={FL.w + 0.5} d={0.12} h={0.25} c={P.trim} P={P} cast={false} />
      <Block x={FL.w - 0.05} z={0} w={0.3} d={FL.d} h={0.5} c={P.wall} P={P} cast={false} />
      <Block x={4.2} z={FL.d - 0.05} w={FL.w - 4.2} d={0.3} h={0.5} c={P.wall} P={P} cast={false} />
      <sprite position={[FL.w / 2, 3.6, 0.1]} scale={[5, 1.25, 1]}><spriteMaterial map={sign} /></sprite>
    </group>
  );
}

/* A box with its base at y=0 (or y), and blueprint edges when simulated. */
function Block({ x, z, w, d, h, y = 0, c, P, cast = true, opacity }: { x: number; z: number; w: number; d: number; h: number; y?: number; c: string; P: Pal; cast?: boolean; opacity?: number }) {
  const geo = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d]);
  const edges = useMemo(() => (P.bp ? new THREE.EdgesGeometry(geo) : null), [geo, P.bp]);
  return (
    <group position={[x + w / 2, y + h / 2, z + d / 2]}>
      <mesh geometry={geo} castShadow={cast && !P.bp} receiveShadow>
        <meshLambertMaterial color={c} transparent={opacity !== undefined} opacity={opacity ?? 1} />
      </mesh>
      {edges && <lineSegments geometry={edges}><lineBasicMaterial color="#5B8BD0" /></lineSegments>}
    </group>
  );
}

/* ------------------------------------------------------------ fixtures */
function Fixtures({ P, F }: { P: Pal; F: Fixture[] }) {
  return (
    <group>
      {F.map((f, i) => <Fix key={i} f={f} P={P} />)}
      <Goods F={F} P={P} />
    </group>
  );
}

/* The panel against the wall and the glass on the shopper's side, by which way the fixture faces. */
function sides(f: Fixture, t: number) {
  const { x, z, w, d } = f;
  switch (f.face ?? (f.kind === "freezer" ? "-x" : "+z")) {
    case "+x": return { back: { x, z, w: t, d }, front: { x: x + w - t, z, w: t, d } };
    case "-x": return { back: { x: x + w - t, z, w: t, d }, front: { x, z, w: t, d } };
    default: return { back: { x, z, w, d: t }, front: { x, z: z + d - t, w, d: t } };
  }
}

function Fix({ f, P }: { f: Fixture; P: Pal }) {
  const { x, z, w, d, h } = f;
  switch (f.kind) {
    case "rack": return (
      <group>
        <Block x={x} z={z} w={w} d={d} h={0.14} c={P.bp ? P.metal : "#6F7F73"} P={P} />
        <Block x={x + w / 2 - 0.04} z={z} w={0.08} d={d} h={h} c={P.bp ? P.metal : "#B9C1B5"} P={P} />
        {[0.5, 1.0, 1.5].map(y => <Block key={y} x={x} z={z} w={w} d={d} y={y - 0.04} h={0.04} c={P.bp ? P.metal : "#D8D2C0"} P={P} cast={false} />)}
        <Block x={x - 0.02} z={z - 0.05} w={w + 0.04} d={0.1} h={h + 0.1} c={P.bp ? P.metal : "#5E7A69"} P={P} />
        <Block x={x - 0.02} z={z + d - 0.05} w={w + 0.04} d={0.1} h={h + 0.1} c={P.bp ? P.metal : "#5E7A69"} P={P} />
      </group>
    );
    case "bin": return <Block x={x} z={z} w={w} d={d} h={h} c={P.wood} P={P} />;
    case "bread": { const b = sides(f, 0.25).back; return (
      <group>
        <Block x={x} z={z} w={w} d={d} h={h} c={P.wood} P={P} />
        <Block {...b} h={2.1} c={P.bp ? P.wood : "#A9784A"} P={P} />
      </group>
    ); }
    case "counter": { const b = sides(f, 0.2).back; return (
      <group>
        <Block x={x} z={z} w={w} d={d} h={0.8} c={P.bp ? P.metal : "#E9E1D2"} P={P} />
        <Block x={x + 0.05} z={z + 0.05} w={w - 0.1} d={d - 0.1} y={0.8} h={0.5} c={P.glass} P={P} opacity={0.35} cast={false} />
        <Block {...b} h={2.2} c={P.bp ? P.wall : "#D7CDBA"} P={P} />
      </group>
    ); }
    case "fridge": case "freezer": {
      const g = sides(f, 0.06).front;
      return (
        <group>
          <Block x={x} z={z} w={w} d={d} h={h} c={P.bp ? P.metal : f.kind === "fridge" ? "#E4EDF3" : "#D9EEF4"} P={P} />
          <Block {...g} y={0.15} h={h - 0.35} c={P.glass} P={P} opacity={0.4} cast={false} />
        </group>
      );
    }
    case "shelf": { const b = sides(f, 0.12).back; return (
      <group>
        <Block {...b} h={h} c={P.bp ? P.metal : "#B9C1B5"} P={P} />
        {[0.12, 0.5, 1.0, 1.5].map(y => <Block key={y} x={x} z={z} w={w} d={d} y={y - 0.04} h={0.04} c={P.bp ? P.metal : "#D8D2C0"} P={P} cast={false} />)}
      </group>
    ); }
    case "checkout": return (
      <group>
        <Block x={x} z={z} w={w} d={d} h={h} c={P.bp ? P.metal : "#5E8A72"} P={P} />
        <Block x={x + 0.1} z={z + 0.1} w={w - 0.2} d={d - 0.6} y={h} h={0.04} c={P.bp ? P.trim : "#2F3B36"} P={P} cast={false} />
        <Block x={x + 0.2} z={z + d - 0.45} w={0.45} d={0.35} y={h} h={0.35} c={P.bp ? P.metal : "#9FB3AD"} P={P} />
        <Block x={x + w / 2 - 0.03} z={z + d - 0.1} w={0.06} d={0.06} y={h} h={1.2} c={P.bp ? P.trim : "#3A4A43"} P={P} />
      </group>
    );
    case "plant": return (
      <group>
        <Block x={x + 0.15} z={z + 0.15} w={0.5} d={0.5} h={0.45} c={P.bp ? P.wood : "#C38A5E"} P={P} />
        <mesh position={[x + 0.4, 0.95, z + 0.4]} castShadow><icosahedronGeometry args={[0.45, 0]} /><meshLambertMaterial color={P.bp ? P.metal : "#5E9E4A"} flatShading /></mesh>
      </group>
    );
    case "carts": return <Block x={x} z={z} w={w} d={d} h={h} c={P.bp ? P.metal : "#A9B8B2"} P={P} />;
  }
}

/* All the small stock in three instanced meshes: boxes and cartons on
 * racks, fruit in the bins, loaves on the bakery shelf. One draw call each. */
function Goods({ F, P }: { F: Fixture[]; P: Pal }) {
  const box = useRef<THREE.InstancedMesh>(null), fruit = useRef<THREE.InstancedMesh>(null);
  const plan = useMemo(() => {
    const boxes: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [];
    const fruits: { p: [number, number, number]; r: number; c: string }[] = [];
    let seed = 7; const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (a: string[]) => a[Math.floor(R() * a.length)];
    for (const f of F) {
      if (f.kind === "rack") {
        for (const y of [0.5, 1.0, 1.5]) for (const side of [-1, 1]) {
          let z = f.z + 0.12;
          while (z < f.z + f.d - 0.3) {
            const len = 0.22 + R() * 0.28, hh = 0.2 + R() * 0.22, c = pick(P.product);
            boxes.push({ p: [f.x + f.w / 2 + side * 0.2, y + hh / 2, z + len / 2], s: [0.3, hh, len - 0.04], c });
            z += len;
          }
        }
      } else if (f.kind === "bin") {
        const c = pick(P.fruit);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++) fruits.push({ p: [f.x + 0.22 + a * 0.36, f.h + 0.08 + R() * 0.05, f.z + 0.22 + b * 0.34], r: 0.15, c });
      } else {
        // Wall runs: stock along the fixture, on the shopper's side.
        const face = f.face ?? (f.kind === "freezer" ? "-x" : "+z"), alongZ = face !== "+z";
        const u0 = alongZ ? f.z : f.x, len = alongZ ? f.d : f.w, deep = alongZ ? f.w : f.d;
        const front = (k: number) => alongZ ? (face === "+x" ? f.x + deep * k : f.x + deep * (1 - k)) : f.z + deep * k;
        const at = (u: number, y: number, k: number): [number, number, number] => alongZ ? [front(k), y, u] : [u, y, front(k)];
        const sz = (a: number, hh: number, b: number): [number, number, number] => alongZ ? [b, hh, a] : [a, hh, b];
        if (f.kind === "bread") {
          for (const y of [f.h, 1.2, 1.75]) for (let u = u0 + 0.3; u < u0 + len - 0.2; u += 0.42) fruits.push({ p: at(u, y + 0.1, 0.47), r: 0.17, c: P.bp ? P.fruit[0] : pick(["#C9893F", "#E0A55A", "#B47332"]) });
        } else if (f.kind === "counter") {
          for (let u = u0 + 0.25; u < u0 + len - 0.2; u += 0.5) boxes.push({ p: at(u, 0.86, 0.58), s: sz(0.4, 0.1, 0.5), c: pick(f.section === "meat" ? ["#E58A8A", "#C95B5B", "#F2B5A7"] : ["#E7C98F", "#8FA34A", "#E9443A", "#F2E6C9"]) });
        } else if (f.kind === "fridge") {
          for (const y of [0.35, 0.85, 1.35]) for (let u = u0 + 0.2; u < u0 + len - 0.15; u += 0.28) boxes.push({ p: at(u, y + 0.15, 0.58), s: sz(0.2, 0.3, 0.2), c: pick(P.bp ? P.product : ["#FFFFFF", "#CFE3FF", "#FFE7B3", "#FFD23F"]) });
        } else if (f.kind === "freezer") {
          for (const y of [0.35, 0.85, 1.35]) for (let u = u0 + 0.2; u < u0 + len - 0.15; u += 0.32) boxes.push({ p: at(u, y + 0.13, 0.42), s: sz(0.26, 0.26, 0.3), c: pick(P.bp ? P.product : ["#BFEFFF", "#E9443A", "#7FD6F5", "#FFFFFF", "#F2C14E"]) });
        } else if (f.kind === "shelf") {
          for (const y of [0.12, 0.5, 1.0, 1.5]) {
            let u = u0 + 0.1;
            while (u < u0 + len - 0.3) { const l = 0.22 + R() * 0.28, hh = 0.2 + R() * 0.22; boxes.push({ p: at(u + l / 2, y + hh / 2, 0.55), s: sz(l - 0.04, hh, 0.3), c: pick(P.product) }); u += l; }
          }
        }
      }
    }
    return { boxes, fruits };
  }, [F, P]);
  useEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    plan.boxes.forEach((b, i) => { m.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(...b.s)); box.current!.setMatrixAt(i, m); box.current!.setColorAt(i, col.set(b.c)); });
    plan.fruits.forEach((b, i) => { m.compose(new THREE.Vector3(...b.p), q, new THREE.Vector3(b.r, b.r * 0.9, b.r)); fruit.current!.setMatrixAt(i, m); fruit.current!.setColorAt(i, col.set(b.c)); });
    for (const r of [box.current!, fruit.current!]) { r.instanceMatrix.needsUpdate = true; if (r.instanceColor) r.instanceColor.needsUpdate = true; }
  }, [plan]);
  return (
    <group>
      <instancedMesh ref={box} args={[undefined, undefined, plan.boxes.length]} castShadow={!P.bp} receiveShadow>
        <boxGeometry args={[1, 1, 1]} /><meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={fruit} args={[undefined, undefined, plan.fruits.length]} castShadow={!P.bp}>
        <icosahedronGeometry args={[1, 1]} /><meshLambertMaterial flatShading />
      </instancedMesh>
    </group>
  );
}

/* ---------------------------------------------------- signs, fog, stops */
function signPos(s: Section, FL: Floor): [number, number, number] {
  const r = s.rect, c = toWorld(s.node);
  if (s.band === "centre") return [(r.x + r.w / 2) / U, 2.75, r.y / U + 0.6];
  if (s.band === "left") return [0.7, 3.2, c.z];
  if (s.band === "right") return [FL.w - 1.0, 3.3, c.z];
  if (s.band === "front") return [c.x, 2.2, c.z];
  return [c.x, 3.25, 0.5];
}

function Signs({ P, trip, FL }: { P: Pal; trip: Trip; FL: Floor }) {
  const L = trip.layout;
  const key = L.sections.map(s => s.id + sectionView(trip, s.id)).join();
  const tex = useMemo(() => L.sections.map(s => {
    const v = sectionView(trip, s.id);
    return v === "fog" ? signTex("?", "#F2F4F7", "#5E6B7A", true)
      : P.bp ? signTex(s.short, "#FFFFFF", P.ink, true)
        : signTex(s.short, hex(s.color), hex(s.ink), false);
  }), [key, P]); // eslint-disable-line react-hooks/exhaustive-deps
  const refs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(({ clock }) => { if (reducedMotion()) return; refs.current.forEach((r, i) => { if (r) r.position.y = signPos(L.sections[i], FL)[1] + Math.sin(clock.elapsedTime * 1.2 + i) * 0.04; }); });
  return (
    <group>
      {L.sections.map((s, i) => (
        <sprite key={s.id} ref={r => { refs.current[i] = r; }} position={signPos(s, FL)} scale={[2.1, 0.53, 1]}>
          <spriteMaterial map={tex[i]} />
        </sprite>
      ))}
    </group>
  );
}

const SOFT = { t: null as THREE.CanvasTexture | null };
function FogBanks({ trip }: { trip: Trip }) {
  const fogged = trip.layout.sections.filter(s => sectionView(trip, s.id) === "fog");
  if (!SOFT.t) SOFT.t = softTex();
  return <>{trip.layout.sections.map(s => <FogBank key={s.id} s={s} on={fogged.includes(s)} />)}</>;
}
function FogBank({ s, on }: { s: Section; on: boolean }) {
  const g = useRef<THREE.Group>(null), fade = useRef(on ? 1 : 0);
  const puffs = useMemo(() => {
    const r = s.rect, n = Math.max(6, Math.round((r.w * r.h) / 1800));
    return Array.from({ length: n }, (_, i) => ({ x: (r.x + ((i * 0.618) % 1) * r.w) / U, z: (r.y + ((i * 0.382 + 0.2) % 1) * r.h) / U, y: 0.9 + (i % 3) * 0.45, s: 1.8 + (i % 4) * 0.5, ph: i * 1.7 }));
  }, [s]);
  useFrame(({ clock }, dt) => {
    fade.current += ((on ? 1 : 0) - fade.current) * Math.min(1, dt * 2.2);
    if (!g.current) return;
    g.current.visible = fade.current > 0.02;
    g.current.children.forEach((c, i) => {
      const p = puffs[i], t = clock.elapsedTime;
      c.position.set(p.x + Math.sin(t * 0.3 + p.ph) * 0.3, p.y + (1 - fade.current) * 1.5, p.z + Math.cos(t * 0.25 + p.ph) * 0.3);
      ((c as THREE.Sprite).material as THREE.SpriteMaterial).opacity = 0.8 * fade.current;
    });
  });
  return (
    <group ref={g}>
      {puffs.map((p, i) => <sprite key={i} position={[p.x, p.y, p.z]} scale={[p.s, p.s * 0.75, 1]}><spriteMaterial map={SOFT.t} transparent depthWrite={false} color="#EEF1F5" /></sprite>)}
    </group>
  );
}

/* Numbered discs on the floor at each stop still to visit; the current one pulses. */
function StopDiscs({ trip, S, cur }: { trip: Trip; S: Spot[]; cur: string | null }) {
  const live = liveStops(trip).filter(id => itemsIn(trip, id).some(i => !isHandled(trip, i.key)));
  const texs = useMemo(() => live.map((id, i) => canvasTex(128, 128, c => {
    c.fillStyle = id === cur ? "#F2B705" : "#FFFFFF"; c.strokeStyle = id === cur ? "#B38600" : "#2E8B57"; c.lineWidth = 10;
    c.beginPath(); c.arc(64, 64, 56, 0, 7); c.fill(); c.stroke();
    c.fillStyle = id === cur ? "#3A2A00" : "#2E8B57"; c.font = "900 66px Arial, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(i + 1), 64, 68);
  })), [live.join(), cur]); // eslint-disable-line react-hooks/exhaustive-deps
  const pulse = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (pulse.current) { const k = 1 + (reducedMotion() ? 0 : Math.sin(clock.elapsedTime * 3) * 0.12); pulse.current.scale.set(k, k, 1); } });
  return (
    <group>
      {live.map((id, i) => {
        const first = S.find(s => s.section === id && !isHandled(trip, s.key)); if (!first) return null;
        return (
          <group key={id} position={[first.stand.x, 0.03, first.stand.z]}>
            <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[0.32, 24]} /><meshBasicMaterial map={texs[i]} transparent /></mesh>
            {id === cur && <mesh ref={pulse} rotation-x={-Math.PI / 2} position-y={-0.01}><ringGeometry args={[0.42, 0.55, 32]} /><meshBasicMaterial color="#F2B705" transparent opacity={0.7} /></mesh>}
          </group>
        );
      })}
    </group>
  );
}

/* "Follow the dots": the walk ahead, as dots on the floor. */
function PathDots({ sim }: { sim: RefObject<{ me: Walker }> }) {
  const ref = useRef<THREE.InstancedMesh>(null), MAX = 140;
  useFrame(({ clock }) => {
    const m = ref.current; if (!m) return;
    const me = sim.current!.me, pts = [me.p, ...me.path];
    const o = new THREE.Object3D(); let n = 0, carry = 0.35;
    for (let i = 1; i < pts.length && n < MAX; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.z - a.z);
      let t = carry;
      while (t < d && n < MAX) {
        const k = 0.75 + 0.35 * Math.max(0, Math.sin(clock.elapsedTime * 6 - n * 0.5));
        o.position.set(a.x + (b.x - a.x) * t / d, 0.025, a.z + (b.z - a.z) * t / d); o.rotation.set(-Math.PI / 2, 0, 0); o.scale.set(k, k, k); o.updateMatrix();
        m.setMatrixAt(n++, o.matrix); t += 0.42;
      }
      carry = t - d;
    }
    m.count = n; m.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[undefined, undefined, MAX]}><circleGeometry args={[0.075, 12]} /><meshBasicMaterial color="#1F9E8E" /></instancedMesh>;
}

/* Item markers: sticker cards over their shelves. Tap one to walk there. */
function Markers({ trip, S, focus, bp, onTap, sim }: { trip: Trip; S: Spot[]; focus: string | null; bp: boolean; onTap: (k: string) => void; sim: RefObject<{ clock: number }> }) {
  const refs = useRef<Record<string, THREE.Sprite | null>>({});
  useFrame(() => {
    const t = sim.current!.clock;
    for (const sp of S) { const r = refs.current[sp.key]; if (!r) continue; const on = sp.key === focus; r.position.y = 2.25 + (reducedMotion() ? 0 : Math.sin(t * 2.4 + sp.at.x) * 0.07); const k = on ? 1.05 : 0.8; r.scale.set(k, k * 300 / 256, 1); }
  });
  return (
    <group>
      {S.map(sp => {
        const it = trip.items.find(i => i.key === sp.key); if (!it || trip.got.includes(it.key) || trip.reports.some(r => r.key === it.key)) return null;
        const v = sectionView(trip, sp.section);
        const mode: CardMode = trip.passed.includes(it.key) ? "dim" : v === "fog" ? "fog" : trip.golden === it.key ? "gold" : focus === it.key ? "on" : "n";
        return (
          <sprite key={sp.key} ref={r => { refs.current[sp.key] = r; }} position={[sp.at.x, 2.25, sp.at.z]} scale={[0.8, 0.94, 1]}
            onClick={e => { e.stopPropagation(); onTap(sp.key); }}>
            <spriteMaterial map={cardTex(it.art, mode, bp)} transparent depthWrite={false} />
          </sprite>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------ shoppers */
type ShopperProps = { w: () => Walker; cart?: boolean; shirt: string; pants: string; hair: string; skin: string; ghost?: boolean; got?: string[]; items?: Trip["items"]; face?: string | null };
function Shopper({ w, cart, shirt, pants, hair, skin, ghost, got = [], items = [], face }: ShopperProps) {
  const root = useRef<THREE.Group>(null), legL = useRef<THREE.Group>(null), legR = useRef<THREE.Group>(null), body = useRef<THREE.Group>(null), armL = useRef<THREE.Group>(null), armR = useRef<THREE.Group>(null);
  useFrame(() => {
    const s = w(); if (!root.current) return;
    root.current.position.set(s.p.x, 0, s.p.z); root.current.rotation.y = s.heading;
    // A zoomer glides on the cart, leaning in; only strollers swing their legs.
    const sw = s.moving && !s.zoom && !reducedMotion() ? Math.sin(s.walk * 2.2) * 0.6 : 0;
    legL.current!.rotation.x = sw; legR.current!.rotation.x = -sw;
    body.current!.position.y = s.moving && !s.zoom ? Math.abs(Math.sin(s.walk * 2.2)) * 0.04 : 0;
    const lean = s.moving && s.zoom && !reducedMotion() ? 0.22 : 0;
    body.current!.rotation.x += (lean - body.current!.rotation.x) * 0.25;
    if (!cart) { armL.current!.rotation.x = -sw * 0.7; armR.current!.rotation.x = sw * 0.7; }
  });
  const m = (c: string) => <meshLambertMaterial color={c} transparent={ghost} opacity={ghost ? 0.55 : 1} />;
  const inCart = got.map(k => items.find(i => i.key === k)).filter(Boolean).slice(-8);
  return (
    <group ref={root}>
      <group ref={body}>
        {[-1, 1].map(sd => (
          <group key={sd} ref={sd < 0 ? legL : legR} position={[sd * 0.1, 0.5, 0]}>
            <mesh position={[0, -0.24, 0]} castShadow><boxGeometry args={[0.13, 0.48, 0.15]} />{m(pants)}</mesh>
          </group>
        ))}
        <mesh position={[0, 0.82, 0]} castShadow><capsuleGeometry args={[0.2, 0.3, 4, 10]} />{m(shirt)}</mesh>
        {face ? (
          // The player's avatar as a round face that always looks at the camera.
          <sprite position={[0, 1.55, 0]} scale={[0.9, 0.9, 1]}><spriteMaterial map={faceTex(face)} transparent depthWrite={false} /></sprite>
        ) : (
          <>
            <mesh position={[0, 1.32, 0]} castShadow><sphereGeometry args={[0.17, 16, 12]} />{m(skin)}</mesh>
            <mesh position={[0, 1.39, -0.03]} scale={[1.05, 0.75, 1.08]}><sphereGeometry args={[0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />{m(hair)}</mesh>
          </>
        )}
        {[-1, 1].map(sd => (
          <group key={sd} ref={sd < 0 ? armL : armR} position={[sd * 0.25, 1.02, 0]} rotation-x={cart ? -1.15 : 0}>
            <mesh position={[0, -0.2, 0]} castShadow><boxGeometry args={[0.09, 0.4, 0.1]} />{m(shirt)}</mesh>
          </group>
        ))}
      </group>
      {cart && <Cart inCart={inCart as Trip["items"]} />}
    </group>
  );
}

function Cart({ inCart }: { inCart: Trip["items"] }) {
  const metal = <meshLambertMaterial color="#A7B6BE" />;
  const W = 0.62, D = 0.78, H = 0.42, y0 = 0.42, z0 = 0.62;
  return (
    <group position={[0, 0, z0 + D / 2]}>
      <mesh position={[0, y0, 0]} castShadow><boxGeometry args={[W, 0.03, D]} />{metal}</mesh>
      {[[-W / 2, 0, 0.03, D], [W / 2, 0, 0.03, D], [0, -D / 2, W, 0.03], [0, D / 2, W, 0.03]].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, y0 + H / 2, z]} castShadow><boxGeometry args={[w || 0.03, H, d]} /><meshLambertMaterial color="#B8C6CC" transparent opacity={0.85} /></mesh>
      ))}
      <mesh position={[0, y0 + H + 0.08, -D / 2 - 0.12]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.035, 0.035, W + 0.1, 8]} /><meshLambertMaterial color="#2E8B57" /></mesh>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b], i) => (
        <group key={i}>
          <mesh position={[a * (W / 2 - 0.04), y0 / 2, b * (D / 2 - 0.06)]}><boxGeometry args={[0.03, y0, 0.03]} />{metal}</mesh>
          <mesh position={[a * (W / 2 - 0.04), 0.07, b * (D / 2 - 0.06)]} rotation-z={Math.PI / 2}><cylinderGeometry args={[0.07, 0.07, 0.05, 10]} /><meshLambertMaterial color="#38433F" /></mesh>
        </group>
      ))}
      {inCart.map((it, i) => (
        <sprite key={it.key} position={[((i % 2) - 0.5) * 0.28, y0 + 0.28 + Math.floor(i / 2) * 0.07, ((Math.floor(i / 2) % 4) - 1.5) * 0.17]} scale={[0.34, 0.4, 1]}>
          <spriteMaterial map={cardTex(it.art, "n", false)} />
        </sprite>
      ))}
    </group>
  );
}

/* Items flying from the shelf into the cart. */
function Flights({ sim, trip, bp }: { sim: RefObject<{ flights: { key: string; t: number; from: THREE.Vector3 }[]; me: Walker }>; trip: Trip; bp: boolean }) {
  const pool = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(() => {
    const s = sim.current!;
    pool.current.forEach((sp, i) => {
      if (!sp) return;
      const f = s.flights[i]; sp.visible = !!f; if (!f) return;
      const it = trip.items.find(x => x.key === f.key); if (!it) return;
      (sp.material as THREE.SpriteMaterial).map = cardTex(it.art, "n", bp);
      const to = new THREE.Vector3(s.me.p.x + Math.sin(s.me.heading) * 1.0, 0.9, s.me.p.z + Math.cos(s.me.heading) * 1.0);
      const e = 1 - (1 - f.t) ** 2;
      sp.position.lerpVectors(f.from, to, e); sp.position.y += Math.sin(f.t * Math.PI) * 1.2;
      const k = 0.9 - 0.45 * f.t; sp.scale.set(k, k * 1.17, 1);
    });
  });
  return <group>{[0, 1, 2, 3].map(i => <sprite key={i} ref={r => { pool.current[i] = r; }} visible={false}><spriteMaterial transparent depthTest={false} /></sprite>)}</group>;
}
