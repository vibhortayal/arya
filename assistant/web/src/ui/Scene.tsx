import { useEffect, useRef } from "react";

/* The store view (hunt, Express "Show me") is pwa/scene.js, used as
 * is: 930 lines of three.js drivers (photo walk, point cloud, strip)
 * plus the motion layer, with no DOM of its own beyond the mount
 * element. It loads once as a classic script from the static folder
 * at / (it finds vendor/three.module.js next to itself) and exposes
 * globals: createSceneView, createMotionLook, createStepDetector,
 * MotionMath. The node harnesses in tests/ (test_motion_nav,
 * test_photo_driver) run it as this classic script. */

export type Stop = {
  name: string; qty?: number; checked?: boolean; flagged?: boolean;
  shelfLabel?: string | null; shelfU?: number | null; shelfSide?: string | null; unplaced?: boolean;
};
export type SceneDriver = {
  onTapStop: ((i: number) => void) | null;
  setStops(stops: Stop[]): void;
  setNext(i: number): void;
  glideTo?(i: number): void;
  setLook?(yaw: number, pitch: number): void;
  setProgress?(u: number): void;
  destroy(): void;
};
type SceneGlobals = {
  createSceneView(el: HTMLElement, driver: string): SceneDriver;
  createMotionLook?: (...a: any[]) => any;
  createStepDetector?: (...a: any[]) => any;
  MotionMath?: any;
};

let loading: Promise<SceneGlobals> | null = null;
export function loadScene(): Promise<SceneGlobals> {
  const w = window as any;
  if (w.createSceneView) return Promise.resolve(w);
  if (!loading) {
    // scene.js escapes stop names with app.js's global esc().
    if (typeof w.esc !== "function") {
      w.esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
    }
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "/scene.js";
      s.onload = () => (w.createSceneView ? resolve(w) : reject(new Error("scene.js loaded without createSceneView")));
      s.onerror = () => { loading = null; reject(new Error("The store view did not load.")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

type Props = {
  /* "photo" | "cloud" | "strip" (scene.js SceneDrivers); a driver the
   * store cannot serve falls back inside scene.js. */
  driver: string;
  photos?: string | null;
  model?: string | null;
  stops: Stop[];
  next: number;
  /* Glide the walk to the next stop whenever it changes. */
  glide?: boolean;
  onTapStop?: (i: number) => void;
  /* Gets the live driver (motion look, step advance need it). */
  onDriver?: (d: SceneDriver | null) => void;
  className?: string;
  id?: string;
};

/* Store data paths (lib/stores.ts) are relative to the static folder
 * at /. scene.js resolves them against the page, so a deep link (or a
 * future base path) must not change them: make them absolute. */
const fromRoot = (p?: string | null) => (p && !/^(\/|https?:)/.test(p) ? "/" + p : p || "");

/* One mount per driver/photos/model; stops and next are pushed in
 * without rebuilding, as the old screens moved (never rebuilt) it. */
export function SceneView({ driver, photos, model, stops, next, glide, onTapStop, onDriver, className = "storeview", id }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const drv = useRef<SceneDriver | null>(null);
  const tap = useRef(onTapStop);
  tap.current = onTapStop;
  const latest = useRef({ stops, next, glide });
  latest.current = { stops, next, glide };

  useEffect(() => {
    let dead = false;
    const mount = el.current;
    if (!mount) return;
    mount.dataset.photos = fromRoot(photos);
    mount.dataset.model = fromRoot(model);
    loadScene().then(g => {
      if (dead) return;
      const d = g.createSceneView(mount, driver);
      d.onTapStop = i => tap.current?.(i);
      d.setStops(latest.current.stops);
      d.setNext(latest.current.next);
      if (latest.current.glide && d.glideTo) d.glideTo(latest.current.next);
      drv.current = d;
      onDriver?.(d);
    }).catch(e => { console.error(e); /* the screen keeps its list; no store view */ });
    return () => {
      dead = true;
      drv.current?.destroy();
      drv.current = null;
      onDriver?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driver, photos, model]);

  useEffect(() => { drv.current?.setStops(stops); }, [stops]);
  useEffect(() => {
    const d = drv.current;
    if (!d) return;
    d.setNext(next);
    if (glide && d.glideTo) d.glideTo(next);
  }, [next, glide]);

  return <div ref={el} id={id} className={className} />;
}
