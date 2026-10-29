/* The section as a place: a view down the aisle in one-point
 * perspective, drawn on a canvas ($0, no image files). Each kind of
 * section has its own look (produce crates, dairy coolers, frosted
 * freezer doors, a warm bakery, packed centre aisles), and a quiet
 * ambient layer keeps it alive: light shimmer, glass reflections,
 * frost sparkle, a shopper passing at the far end.
 * A simulated store is drawn as a blueprint, never as a real place. */
import { useEffect, useRef } from "react";
import type { SectionKind } from "../core/types";
import { reducedMotion } from "../fx/feel";

type Look = "real" | "fog" | "guess";
type Props = { kind: SectionKind; seed: string; name: string; tint: number; look: Look; art?: string };

type Pal = { wall: string; plank: string; plankEdge: string; floorA: string; floorB: string; ceil: string; goods: string[]; glow?: string };
const PAL: Record<SectionKind, Pal> = {
  produce: { wall: "#E9E2CF", plank: "#B98A57", plankEdge: "#8C6236", floorA: "#EFE8DA", floorB: "#E4DCCB", ceil: "#F6F1E6", goods: ["#5DAA3E", "#8CC63F", "#E9443A", "#F5B800", "#FF9A1F", "#3E8E2F", "#B23A48"] },
  bakery: { wall: "#F1E2CB", plank: "#A8743F", plankEdge: "#7C5228", floorA: "#F2E9DA", floorB: "#E8DCC8", ceil: "#FAF3E6", goods: ["#C9893F", "#E2B06E", "#9C6A2E", "#F1CE97", "#B5722F"] },
  deli: { wall: "#F3E1DA", plank: "#C9B8B0", plankEdge: "#9B8A82", floorA: "#F1ECE8", floorB: "#E6DFDA", ceil: "#FBF6F3", goods: ["#E7C98F", "#8FA34A", "#D9534F", "#F2D6A2", "#6E7F22"], glow: "#FFF4E8" },
  meat: { wall: "#F2DDE1", plank: "#C7B5B9", plankEdge: "#9A878C", floorA: "#F1ECEC", floorB: "#E6DEDF", ceil: "#FBF5F6", goods: ["#C0392B", "#E06666", "#F4A6A6", "#E8C3A0", "#A93226"], glow: "#FFF0F2" },
  dairy: { wall: "#DCE7F2", plank: "#AFC3D8", plankEdge: "#7F98B3", floorA: "#EEF2F6", floorB: "#E2E8EF", ceil: "#F7FAFD", goods: ["#FFFFFF", "#CFE3FF", "#FFE7B3", "#4A8FE0", "#F4C04E", "#E9F2FF"], glow: "#EAF4FF" },
  frozen: { wall: "#D6ECF2", plank: "#A7CFDB", plankEdge: "#78AEBE", floorA: "#EDF4F6", floorB: "#E0EAEE", ceil: "#F5FAFC", goods: ["#7FD6F5", "#E9443A", "#FFD23F", "#FFFFFF", "#4A8FE0", "#BFEFFF"], glow: "#DDF6FF" },
  aisle: { wall: "#ECE6F2", plank: "#B9B2C4", plankEdge: "#8E879B", floorA: "#F1EEF3", floorB: "#E6E2EA", ceil: "#F8F6FA", goods: ["#E4572E", "#FFC83D", "#3FA66B", "#4A8FE0", "#F28AB2", "#8E6CC9", "#F2C14E", "#2F8F4E"] },
};
const BLUE = "#1D5FAF", BLUE2 = "#7FA3D6", PAPER = "#EEF3FA";

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/* Depth: z 0 (near) .. 1 (far) to screen fraction, compressed far away. */
const S = (z: number) => (z * 4) / (1 + z * 3);
const isCooler = (k: SectionKind) => k === "dairy" || k === "frozen" || k === "deli" || k === "meat";

type Geo = { W: number; H: number; bl: number; br: number; bt: number; bb: number; nb: number };
function geo(W: number, H: number): Geo {
  const vx = W / 2, vy = H * 0.4, bw = W * 0.3, bh = H * 0.34;
  return { W, H, bl: vx - bw / 2, br: vx + bw / 2, bt: vy - bh * 0.55, bb: vy + bh * 0.45, nb: H * 0.9 };
}
/* A point on a side wall: side -1 left, 1 right; h 0 floor .. 1 top. */
function wall(g: Geo, side: -1 | 1, z: number, h: number): [number, number] {
  const s = S(z);
  const xNear = side < 0 ? -g.W * 0.02 : g.W * 1.02, xBack = side < 0 ? g.bl : g.br;
  const yTop = lerp(0, g.bt, s), yBot = lerp(g.nb, g.bb, s);
  return [lerp(xNear, xBack, s), lerp(yBot, yTop, h)];
}
function quad(c: CanvasRenderingContext2D, p: [number, number][]) { c.beginPath(); p.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); }

/* The still scene, drawn once per size into an offscreen canvas. */
function paint(c: CanvasRenderingContext2D, g: Geo, kind: SectionKind, seed: string, look: Look) {
  const P = PAL[kind], R = rng(seed + kind), bp = look === "guess";
  const fillOr = (col: string) => (bp ? PAPER : col);
  const line = (w = 1) => { if (bp) { c.strokeStyle = BLUE2; c.lineWidth = w; c.stroke(); } };
  const { W, H } = g;
  c.clearRect(0, 0, W, H);
  // Ceiling, floor, back wall.
  c.fillStyle = fillOr(P.ceil); c.fillRect(0, 0, W, H);
  quad(c, [[0, g.nb], [W, g.nb], [g.br, g.bb], [g.bl, g.bb]]); c.fillStyle = fillOr(P.floorA); c.fill(); line();
  quad(c, [[-W, H], [2 * W, H], [W, g.nb], [0, g.nb]]); c.fill();
  // Floor tiles in perspective.
  for (let i = 0; i < 9; i++) {
    const z0 = i / 9, z1 = (i + 1) / 9;
    for (let j = -4; j < 4; j++) {
      if ((i + j) % 2 === 0) continue;
      const u0 = j / 4, u1 = (j + 1) / 4;
      const pt = (z: number, u: number): [number, number] => { const s = S(z); const cx = lerp(W / 2, (g.bl + g.br) / 2, s), half = lerp(W * 0.52, (g.br - g.bl) / 2, s); return [cx + u * half, lerp(g.nb + (H - g.nb), g.bb, s)]; };
      quad(c, [pt(z0, u0), pt(z0, u1), pt(z1, u1), pt(z1, u0)]);
      c.fillStyle = bp ? "rgba(127,163,214,.12)" : P.floorB; c.fill();
    }
  }
  // Ceiling light panels down the middle.
  for (let i = 0; i < 5; i++) {
    const z0 = 0.08 + i * 0.19, z1 = z0 + 0.08, s0 = S(z0), s1 = S(z1);
    const yy = (s: number) => lerp(0, g.bt, s) + 6 * (1 - s), half = (s: number) => lerp(W * 0.16, (g.br - g.bl) * 0.18, s);
    quad(c, [[W / 2 - half(s0), yy(s0)], [W / 2 + half(s0), yy(s0)], [W / 2 + half(s1), yy(s1)], [W / 2 - half(s1), yy(s1)]]);
    c.fillStyle = bp ? "rgba(127,163,214,.25)" : "#FFFFFF"; c.fill(); line();
  }
  // Back wall: an end cap of shelves.
  c.fillStyle = fillOr(P.wall); c.fillRect(g.bl, g.bt, g.br - g.bl, g.bb - g.bt);
  if (bp) { c.strokeStyle = BLUE2; c.strokeRect(g.bl, g.bt, g.br - g.bl, g.bb - g.bt); }
  for (let r = 0; r < 4; r++) {
    const y = lerp(g.bb, g.bt, 0.08 + r * 0.24), hgt = (g.bb - g.bt) * 0.17;
    let x = g.bl + 3;
    while (x < g.br - 6) {
      const w = 3 + R() * 6, hh = hgt * (0.55 + R() * 0.45);
      c.fillStyle = bp ? "transparent" : P.goods[Math.floor(R() * P.goods.length)];
      c.beginPath(); c.rect(x, y - hh, w, hh); c.fill(); line(0.6);
      x += w + 1;
    }
    c.fillStyle = bp ? BLUE2 : P.plankEdge; c.fillRect(g.bl, y, g.br - g.bl, 2);
  }
  // Side walls.
  for (const side of [-1, 1] as const) {
    quad(c, [wall(g, side, 0, 0), wall(g, side, 1, 0), wall(g, side, 1, 1), wall(g, side, 0, 1)]);
    c.fillStyle = fillOr(P.wall); c.fill(); line();
    const levels = kind === "produce" ? [0.06, 0.36, 0.64] : [0.04, 0.27, 0.5, 0.73];
    for (const h0 of levels) {
      // Goods along the shelf, front to back.
      let z = 0.0;
      while (z < 0.98) {
        const dz = (kind === "produce" ? 0.05 : 0.025 + R() * 0.035) * (1 + z * 1.5);
        const col = P.goods[Math.floor(R() * P.goods.length)];
        const ph = kind === "produce" ? 0.1 : 0.1 + R() * 0.1;
        if (kind === "produce") {
          // A heap of round fruit in a slanted bin.
          for (let k = 0; k < 4; k++) {
            const [x, y] = wall(g, side, z + (dz * (k + 0.5)) / 4, h0 + 0.05 + (k % 2) * 0.035);
            const r = Math.max(1.5, 9 * (1 - S(z)) + 1.5);
            c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
            c.fillStyle = bp ? "transparent" : col; c.fill(); line(0.6);
          }
        } else if (kind === "bakery") {
          const a = wall(g, side, z + dz * 0.1, h0 + 0.02), b = wall(g, side, z + dz * 0.9, h0 + 0.02 + ph * 0.7);
          c.beginPath(); c.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 1, Math.abs(b[1] - a[1]) / 2 + 1, 0, 0, Math.PI * 2);
          c.fillStyle = bp ? "transparent" : col; c.fill(); line(0.6);
        } else {
          const bottle = R() < 0.3;
          const w = bottle ? dz * 0.55 : dz * 0.9;
          quad(c, [wall(g, side, z, h0 + 0.015), wall(g, side, z + w, h0 + 0.015), wall(g, side, z + w, h0 + 0.015 + ph), wall(g, side, z, h0 + 0.015 + ph)]);
          c.fillStyle = bp ? "transparent" : col; c.fill(); line(0.6);
          if (!bp && !bottle && R() < 0.5) { quad(c, [wall(g, side, z, h0 + 0.015 + ph * 0.45), wall(g, side, z + w, h0 + 0.015 + ph * 0.45), wall(g, side, z + w, h0 + 0.015 + ph * 0.6), wall(g, side, z, h0 + 0.015 + ph * 0.6)]); c.fillStyle = "rgba(255,255,255,.55)"; c.fill(); }
          if (bottle && !bp) { quad(c, [wall(g, side, z + w * 0.3, h0 + 0.015 + ph), wall(g, side, z + w * 0.7, h0 + 0.015 + ph), wall(g, side, z + w * 0.7, h0 + 0.04 + ph), wall(g, side, z + w * 0.3, h0 + 0.04 + ph)]); c.fillStyle = "#3b3b40"; c.fill(); }
        }
        z += dz + 0.004;
      }
      // The shelf plank, with a price-tag rail.
      quad(c, [wall(g, side, 0, h0), wall(g, side, 1, h0), wall(g, side, 1, h0 - 0.02), wall(g, side, 0, h0 - 0.02)]);
      c.fillStyle = bp ? PAPER : P.plank; c.fill(); line(1);
      if (!bp) for (let k = 0; k < 10; k++) { const zz = k / 10 + 0.03; quad(c, [wall(g, side, zz, h0 - 0.003), wall(g, side, zz + 0.025, h0 - 0.003), wall(g, side, zz + 0.025, h0 - 0.017), wall(g, side, zz, h0 - 0.017)]); c.fillStyle = k % 3 ? "#FFFFFF" : "#FFE27A"; c.fill(); }
    }
    // Coolers: glass doors with frames over the goods.
    if (isCooler(kind)) {
      for (let k = 0; k < 6; k++) {
        const z0 = k / 6, z1 = (k + 1) / 6;
        quad(c, [wall(g, side, z0, 0.02), wall(g, side, z1, 0.02), wall(g, side, z1, 0.95), wall(g, side, z0, 0.95)]);
        c.fillStyle = bp ? "transparent" : kind === "frozen" ? "rgba(200,240,255,.28)" : "rgba(235,245,255,.2)"; c.fill();
        c.strokeStyle = bp ? BLUE2 : "#9AA6B2"; c.lineWidth = Math.max(1, 4 * (1 - S(z0))); c.stroke();
      }
      if (kind === "frozen" && !bp) {
        quad(c, [wall(g, side, 0, 0.02), wall(g, side, 1, 0.02), wall(g, side, 1, 0.2), wall(g, side, 0, 0.2)]);
        const gr = c.createLinearGradient(0, g.nb, 0, g.nb - H * 0.25); gr.addColorStop(0, "rgba(255,255,255,.75)"); gr.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = gr; c.fill();
      }
    }
    // Base kick plate.
    quad(c, [wall(g, side, 0, 0), wall(g, side, 1, 0), wall(g, side, 1, 0.025), wall(g, side, 0, 0.025)]);
    c.fillStyle = bp ? PAPER : P.plankEdge; c.fill(); line(1);
  }
  // Soft light falloff toward the back (depth), and a vignette.
  if (!bp) {
    const v = c.createRadialGradient(W / 2, H * 0.42, W * 0.1, W / 2, H * 0.5, W * 0.85);
    v.addColorStop(0, "rgba(255,255,255,0)"); v.addColorStop(1, "rgba(40,30,20,.16)");
    c.fillStyle = v; c.fillRect(0, 0, W, H);
  }
}

export function AisleScene({ kind, seed, name, tint, look, art }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!, ctx = cv.getContext("2d")!;
    const base = document.createElement("canvas"), bctx = base.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let g = geo(1, 1), raf = 0, t0 = performance.now(), last = 0;
    const R = rng(seed + "amb");
    // Generated art, when there is some, replaces the drawn shelves. A
    // simulated store keeps the blueprint so it never passes for a real place.
    let pic: HTMLImageElement | null = null;
    if (art && look !== "guess") {
      const im = new Image();
      im.onload = () => { pic = im; size(); };
      im.src = art;
    }
    const motes = Array.from({ length: 14 }, () => ({ x: R(), y: R(), s: 0.5 + R() * 1.5, v: 0.2 + R() * 0.5 }));
    const size = () => {
      const r = cv.getBoundingClientRect(); if (!r.width) return;
      for (const k of [cv, base]) { k.width = Math.round(r.width * dpr); k.height = Math.round(r.height * dpr); }
      g = geo(r.width, r.height);
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (pic) {
        const k = Math.max(r.width / pic.width, r.height / pic.height), w = pic.width * k, h = pic.height * k;
        bctx.drawImage(pic, (r.width - w) / 2, (r.height - h) * 0.4, w, h);
      } else paint(bctx, g, kind, seed, look);
      frame(performance.now());
    };
    const frame = (now: number) => {
      const t = (now - t0) / 1000, { W, H } = g, bp = look === "guess";
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
      // A slow, slight sway, as if standing in the aisle.
      const sway = reducedMotion() ? 0 : Math.sin(t * 0.5) * 2;
      // With art, a slow push-in down the aisle, like walking in.
      const zoom = pic && !reducedMotion() ? 1.02 + 0.02 * Math.sin(t * 0.15) : 1;
      const zw = (cv.width + 6 * dpr) * zoom, zh = cv.height * zoom;
      ctx.drawImage(base, sway * dpr - 3 * dpr - (zw - cv.width - 6 * dpr) / 2, -(zh - cv.height) * 0.4, zw, zh);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!bp) {
        // Light shimmer from the ceiling panels.
        const a = (0.05 + 0.03 * Math.sin(t * 1.7)) * (pic ? 0.4 : 1);
        const lg = ctx.createLinearGradient(0, 0, 0, H * 0.7); lg.addColorStop(0, `rgba(255,255,240,${a + 0.08})`); lg.addColorStop(1, "rgba(255,255,240,0)");
        ctx.fillStyle = lg; ctx.fillRect(W * 0.25, 0, W * 0.5, H * 0.7);
        // Glass reflection sweeping across cooler doors.
        if (isCooler(kind) && !pic) {
          const p = ((t * 0.22) % 1.4) - 0.2;
          for (const side of [-1, 1] as const) {
            const z = Math.max(0, Math.min(0.95, p));
            quad(ctx, [wall(g, side, z, 0.05), wall(g, side, z + 0.05, 0.05), wall(g, side, z + 0.09, 0.93), wall(g, side, z + 0.04, 0.93)]);
            ctx.fillStyle = "rgba(255,255,255,.28)"; ctx.fill();
          }
        }
        // A shopper with a cart crosses the far end now and then.
        const cyc = (t % 9) / 9;
        if (cyc < 0.45 && !pic) {
          const k = cyc / 0.45, x = lerp(g.bl - 20, g.br + 20, k), y = g.bb, hgt = (g.bb - g.bt) * 0.62, bob = Math.abs(Math.sin(t * 7)) * 1.2;
          ctx.save(); ctx.beginPath(); ctx.rect(g.bl, g.bt, g.br - g.bl, g.bb - g.bt + 2); ctx.clip();
          ctx.fillStyle = "rgba(60,55,70,.55)";
          ctx.beginPath(); ctx.ellipse(x, y - hgt * 0.62 - bob, hgt * 0.13, hgt * 0.32, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x, y - hgt - bob, hgt * 0.12, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "rgba(60,55,70,.5)"; ctx.lineWidth = 1.2; ctx.strokeRect(x + hgt * 0.16, y - hgt * 0.42, hgt * 0.32, hgt * 0.24);
          ctx.restore();
        }
      }
      // Frost sparkle in the freezer aisle, dust in the light elsewhere.
      if (!reducedMotion()) {
        for (const m of motes) {
          const y = ((m.y - t * m.v * 0.03) % 1 + 1) % 1, x = m.x + Math.sin(t * 0.6 + m.y * 9) * 0.01;
          ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(t * 2 + m.x * 12));
          ctx.fillStyle = bp ? BLUE2 : kind === "frozen" ? "#FFFFFF" : "#FFF6D8";
          ctx.beginPath(); ctx.arc(x * W, y * H * 0.85, m.s * (kind === "frozen" ? 1.3 : 0.9), 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      // The hanging sign, swaying a little.
      const sx = W / 2, sy = lerp(0, g.bt, S(0.22)) + 4, sw = Math.min(W * 0.46, 210), sh = 30;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(reducedMotion() ? 0 : Math.sin(t * 1.1) * 0.025);
      ctx.strokeStyle = bp ? BLUE2 : "#6B6B73"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-sw * 0.35, -sy); ctx.lineTo(-sw * 0.35, 0); ctx.moveTo(sw * 0.35, -sy); ctx.lineTo(sw * 0.35, 0); ctx.stroke();
      ctx.beginPath(); ctx.roundRect(-sw / 2, 0, sw, sh, 8);
      ctx.fillStyle = bp ? PAPER : "#" + tint.toString(16).padStart(6, "0"); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = bp ? BLUE : "rgba(0,0,0,.25)"; if (bp) ctx.setLineDash([5, 4]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = bp ? BLUE : "#1B1B1E"; ctx.font = "800 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(name.toUpperCase(), 0, sh / 2 + 1, sw - 16);
      ctx.restore();
      void last;
    };
    const loop = (now: number) => {
      if (now - last > 33) { last = now; frame(now); }
      raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(size); ro.observe(cv);
    size();
    if (!reducedMotion()) raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [kind, seed, look, name, tint, art]);
  return <canvas ref={ref} className={"qg-aisle" + (look === "fog" ? " fog" : "")} aria-hidden="true" />;
}
