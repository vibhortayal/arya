import { useEffect, useRef, useState } from "react";
import { Sheet } from "../../ui/Sheet";
import { get } from "../../lib/api";
import { asset } from "../../lib/format";
import { faceFor } from "../../lib/characters";
import type { ShareCtx } from "./state";
import { t, useTranslation } from "../../i18n";

/* Port of pwa/share.js ShareUI and index.html #share-sheet: the haul
 * card, the love note and the Shelf SOS. Every card is built from the
 * real hunt. Nothing posts itself: the player taps Share and their own
 * app does the posting. Spend never appears on a card. The share is a
 * still PNG. The haul card has an optional paint pass (sharelook.py):
 * the phone sends Muse Image only the art layer and draws the words
 * itself afterwards. Open with <ShareSheet req={{ kind, ctx }} />. */
export type ShareKind = "haul" | "love" | "sos";
export type ShareReq = { kind: ShareKind; ctx: ShareCtx };

const CHAINS: [string, string][] = [
  ["trader joe", "@traderjoes"], ["costco", "@costco"],
  ["whole foods", "@wholefoods"], ["safeway", "@safeway"],
  ["target", "@target"], ["walmart", "@walmart"],
  ["kroger", "@kroger"], ["h mart", "@hmartofficial"],
  ["aldi", "@aldiusa"], ["sprouts", "@sproutsfarmersmarket"],
];
const CREAM = "#FBF5E6", INK = "#1B1B1E", ACC = "#E4572E", SOFT = "#FDEEE8", GREY = "#8B8B93";

export function chainTag(store?: string) {
  const n = (store || "").toLowerCase();
  for (const [k, v] of CHAINS) if (n.includes(k)) return v;
  return "";
}

const images: Record<string, HTMLImageElement> = {};
function loadImg(src: string) {
  if (images[src]) return images[src];
  const im = new Image();
  im.src = src;
  images[src] = im;
  return im;
}
const faceSrc = (file: string) => (file === "custom" ? "/api/quest/avatar/image" : asset("assets/characters/" + file));

type Face = { file: string; name: string };
type Card = {
  kind: ShareKind; title: string; store: string; sub?: string; host: string; handle: string;
  faces: Face[]; more?: number; wild?: string[]; stat: string; statBase?: string; level?: number;
  badge?: { id: string; name: string } | null; photo?: string | null; caption: string;
};
type Opts = { size: "story" | "post"; handle: boolean; level: boolean; photo: boolean; look: string;
  painted: ImageBitmap | null; tries: number; busy: boolean };
const freshOpts = (): Opts => ({ size: "story", handle: true, level: true, photo: false, look: "plain", painted: null, tries: 0, busy: false });

/* Card specs. The haul card also reads ctx.hidden (normalised item
 * names the shopper hid), ctx.title (Arya's trip name), ctx.stats and
 * ctx.names (the reviewed haul's item names). It carries no price, no
 * store and no receipt line. */
const normKey = (s: unknown) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function specHaul(ctx: ShareCtx): Card {
  const sess = ctx.sess;
  const hidden = ctx.hidden instanceof Set ? ctx.hidden : new Set<string>((ctx.hidden as unknown as string[]) || []);
  const pool = Array.isArray(ctx.names) ? ctx.names.map(n => ({ name: n })) : sess.items.filter(i => i.checked);
  const got = pool.filter(i => !hidden.has(normKey(i.name)));
  const wild = Array.isArray(ctx.names) ? [] :
    [...new Set([...((sess.wild_finds as string[] | undefined) || []), ...sess.items.filter(i => i.wild).map(i => i.name)])]
      .filter(n => !hidden.has(normKey(n)));
  const st = ctx.stats || ({} as { items?: number; new?: number; level?: number });
  const level = st.level || (ctx.profile && (ctx.profile.level as number)) || 1;
  return {
    kind: "haul", title: ctx.title || t("haul.card.myHaul"), store: "",
    sub: t("haul.card.level", { level }),
    host: (ctx.profile && ctx.profile.avatar) || "basket.webp",
    handle: ctx.profile ? "@" + ctx.profile.handle : "",
    faces: got.slice(0, 8).map(i => ({ file: faceFor(i.name), name: i.name })),
    more: Math.max(0, got.length - 8),
    wild: wild.slice(0, 3),
    stat: t("haul.statsLabel", { items: got.length, fresh: st.new || 0, level }),
    statBase: t("haul.card.statBase", { items: got.length, fresh: st.new || 0 }), level,
    badge: ctx.newBadge || null,
    photo: ctx.haulPhotoURL || null,
    caption: t("haul.card.haulCaption"),
  };
}
function specLove(ctx: ShareCtx, item: string): Card {
  const tag = chainTag(ctx.sess.store);
  return {
    kind: "love", title: t("haul.card.foundLoved"), store: ctx.sess.store,
    host: (ctx.profile && ctx.profile.avatar) || "basket.webp",
    handle: ctx.profile ? "@" + ctx.profile.handle : "",
    faces: [{ file: faceFor(item), name: item }],
    stat: t("haul.card.atStore", { store: ctx.sess.store }),
    caption: t("haul.card.loveCaption", { store: ctx.sess.store, item, tag: tag ? " " + tag : "" }),
  };
}
function specSos(ctx: ShareCtx, item: string, trips: number): Card {
  const tag = chainTag(ctx.sess.store);
  const again = trips >= 2 ? t("haul.card.again", { n: trips }) : "";
  return {
    kind: "sos", title: t("haul.card.shelfSos"), store: ctx.sess.store,
    host: "compass.webp",
    handle: ctx.profile ? "@" + ctx.profile.handle : "",
    faces: [{ file: faceFor(item), name: item }],
    stat: trips >= 2 ? t("haul.card.missingTrips", { n: trips }) : t("haul.card.notOnShelf"),
    caption: t("haul.card.sosCaption", { to: tag || ctx.sess.store, item, store: ctx.sess.store, again }),
  };
}

/* ---------- canvas drawing ---------- */
type G = CanvasRenderingContext2D;
const W = 1080, COLS = 4, CELL = (W - 120) / COLS;
const sizeH = (o: Opts) => (o.size === "post" ? 1350 : 1920);
function rr(g: G, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function drawFace(g: G, file: string, cx: number, cy: number, size: number) {
  const im = loadImg(faceSrc(file));
  if (!im.complete || !im.naturalWidth) return;
  g.save();
  g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = "#fff"; g.fill();
  g.drawImage(im, cx - size / 2, cy - size / 2, size, size);
  g.restore();
  g.save();
  g.strokeStyle = SOFT; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.stroke();
  g.restore();
}
const showPhoto = (c: Card, o: Opts) => !!(c.photo && o.photo);
// Where the haul's sticker block starts and ends on this canvas.
const faceTop = (c: Card, H: number, o: Opts) => 250 + (H > 1400 ? 220 : 0) + (showPhoto(c, o) ? 480 : 0);
const faceRows = (c: Card) => Math.ceil(c.faces.length / COLS);
const faceEnd = (c: Card, H: number, o: Opts) => faceTop(c, H, o) + faceRows(c) * 300 + 90;
const BADGE_ART: Record<string, string> = { egg_baron: "egg.webp", banana_republic: "banana.webp" };
function castPair(c: Card, o: Opts) {
  const files = [...new Set(c.faces.map(f => f.file))];
  if (!files.length) return [];
  const n = Math.min(2, files.length), k = o.tries;
  return Array.from({ length: n }, (_, i) => files[(k + i) % files.length]);
}
const shortName = (n: string) => (n.length > 18 ? n.slice(0, 17) + "…" : n);
function wrapText(g: G, text: string, cx: number, y: number, maxW: number, lh: number, maxLines?: number) {
  const words = String(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? line + " " + w : w;
    if (g.measureText(probe).width > maxW && line) { lines.push(line); line = w; }
    else line = probe;
  }
  if (line) lines.push(line);
  const use = lines.slice(0, maxLines || 3);
  use.forEach((ln, i) => g.fillText(ln, cx, y + i * lh));
  return use.length * lh;
}
/* The art layer: cream ground, the cast stickers, and the badge or
 * the joining characters for those two looks. No words, no photo. */
function drawArt(g: G, H: number, c: Card, o: Opts, look: string, names: boolean) {
  g.fillStyle = CREAM; g.fillRect(0, 0, W, H);
  const y = faceTop(c, H, o);
  c.faces.forEach((f, i) => {
    const cx = 60 + CELL * (i % COLS) + CELL / 2;
    const cy = y + Math.floor(i / COLS) * 300 + 110;
    drawFace(g, f.file, cx, cy, 168);
    if (names) {
      g.fillStyle = INK; g.textAlign = "center";
      g.font = "600 30px system-ui, sans-serif";
      wrapText(g, shortName(f.name), cx, cy + 122, CELL - 14, 34, 2);
    }
  });
  if (look === "badge" && c.badge) {
    const cx = W - 130, cy = 190;
    g.fillStyle = ACC; g.fillRect(cx - 46, cy + 60, 30, 70); g.fillRect(cx + 16, cy + 60, 30, 70);
    g.beginPath(); g.arc(cx, cy, 92, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
    g.lineWidth = 12; g.strokeStyle = ACC; g.stroke();
    drawFace(g, BADGE_ART[c.badge.id] || "basket.webp", cx, cy, 130);
  }
  if (look === "friends") {
    const pair = castPair(c, o), cy = faceEnd(c, H, o) + 100;
    pair.forEach((file, i) => drawFace(g, file, W - 190 - i * 150, cy + (i ? 30 : 0), 190));
  }
}
// The Meta credit is claimed only when Muse painted the card.
const creditLine = (o: Opts) => t("haul.card.madeWith") + (o.painted ? t("haul.card.poweredBy") : "");
function draw(g: G, H: number, c: Card, o: Opts) {
  const painted = o.painted;
  if (painted) g.drawImage(painted, 0, 0, W, H);
  else if (c.kind === "haul") drawArt(g, H, c, o, "plain", true);
  else { g.fillStyle = CREAM; g.fillRect(0, 0, W, H); }
  if (painted) {   // keep the words readable on any painting
    const top = g.createLinearGradient(0, 0, 0, 250), bot = g.createLinearGradient(0, H - 300, 0, H);
    top.addColorStop(0, "rgba(251,245,230,.82)"); top.addColorStop(1, "rgba(251,245,230,0)");
    bot.addColorStop(0, "rgba(251,245,230,0)"); bot.addColorStop(1, "rgba(251,245,230,.9)");
    g.fillStyle = top; g.fillRect(0, 0, W - 300, 250);
    g.fillStyle = bot; g.fillRect(0, H - 300, W, 300);
  }
  // header: host avatar + handle + title
  drawFace(g, c.host, 110, 104, 128);
  g.fillStyle = INK; g.textAlign = "left";
  g.font = "800 64px system-ui, sans-serif";
  g.fillText(c.title, 216, 100);
  const sub = c.kind === "haul"
    ? [o.handle ? c.handle : "", o.level ? c.sub : ""].filter(Boolean).join(" · ")
    : `${c.handle ? c.handle + " · " : ""}${c.sub !== undefined ? c.sub : c.store}`;
  g.font = "600 40px system-ui, sans-serif"; g.fillStyle = GREY;
  g.fillText(sub, 218, 158);
  let y = 250 + (c.kind === "haul" && H > 1400 ? 220 : 0);
  if (showPhoto(c, o)) {
    const im = loadImg(c.photo!);
    if (im.complete && im.naturalWidth) {
      g.save(); rr(g, 60, y, W - 120, 430, 28); g.clip();
      const sc = Math.max((W - 120) / im.naturalWidth, 430 / im.naturalHeight);
      g.drawImage(im, 60 - (im.naturalWidth * sc - (W - 120)) / 2,
        y - (im.naturalHeight * sc - 430) / 2,
        im.naturalWidth * sc, im.naturalHeight * sc);
      g.restore();
    }
    y += 480;
  }
  if (c.kind === "love" || c.kind === "sos") {
    const f = c.faces[0];
    drawFace(g, f.file, W / 2, y + 260, 470);
    g.fillStyle = INK; g.textAlign = "center";
    g.font = "800 58px system-ui, sans-serif";
    wrapText(g, f.name, W / 2, y + 580, W - 160, 66);
    y += 700;
  } else {
    if (c.more) {
      g.fillStyle = GREY; g.textAlign = "center";
      g.font = "700 34px system-ui, sans-serif";
      g.fillText(t("haul.card.more", { n: c.more }), W / 2, y + faceRows(c) * 300 + 40);
    }
    y += faceRows(c) * 300 + 90;
    if (c.wild && c.wild.length) {
      g.fillStyle = ACC; g.textAlign = "center";
      g.font = "800 38px system-ui, sans-serif";
      g.fillText(t("haul.card.wild", { names: c.wild.join(" · ") }), W / 2, y);
      y += 60;
    }
  }
  g.fillStyle = ACC; g.textAlign = "center";
  g.font = "800 56px system-ui, sans-serif";
  const stat = c.kind === "haul" && !o.level ? c.statBase! : c.stat;
  g.fillText(stat, W / 2, H - 150);
  g.fillStyle = GREY; g.font = "600 32px system-ui, sans-serif";
  g.fillText(creditLine(o), W / 2, H - 96);
  g.font = "500 26px system-ui, sans-serif";
  g.fillText("arya-pilot.duckdns.org", W / 2, H - 56);
}
const toBlob = (cv: HTMLCanvasElement, type: string) => new Promise<Blob | null>(r => cv.toBlob(r, type));
async function paintLook(c: Card, o: Opts, look: string) {
  const art = document.createElement("canvas");
  art.width = W; art.height = sizeH(o);
  drawArt(art.getContext("2d")!, art.height, c, o, look, false);
  const png = await toBlob(art, "image/png");
  const r = await fetch(`/api/quest/share-look?look=${look}`, {
    method: "POST", headers: { "Content-Type": "image/png" }, body: png });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
  return createImageBitmap(await r.blob());
}
function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

type Pick = { items: string[]; hint: string; done: (item: string) => void } | { none: true } | null;

export function ShareSheet({ req, onClose }: { req: ShareReq | null; onClose: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(() => t("common.share"));
  const [pick, setPick] = useState<Pick>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [ready, setReady] = useState(false);
  const [o, setO] = useState<Opts>(freshOpts);
  const [status, setStatus] = useState("");
  const cv = useRef<HTMLCanvasElement>(null);
  const gen = useRef(0);

  // open(kind, ctx)
  useEffect(() => {
    if (!req) return;
    const my = ++gen.current;
    setO(freshOpts());
    setReady(false);
    setCard(null);
    setStatus("");
    setPick(null);
    const { kind, ctx } = req;
    const showCard = async (c: Card) => {
      // Preload faces so the first draw is complete.
      const srcs = [faceSrc(c.host), ...c.faces.map(f => faceSrc(f.file))];
      if (c.photo) srcs.push(c.photo);
      if (c.badge) srcs.push(faceSrc(BADGE_ART[c.badge.id] || "basket.webp"));
      // One wait per distinct file: two cards faces can share one image.
      await Promise.all([...new Set(srcs)].map(src => new Promise<void>(res => {
        const im = loadImg(src);
        if (im.complete) return res();
        im.addEventListener("load", () => res());
        im.addEventListener("error", () => res());
      })));
      if (my !== gen.current) return;
      if (c.kind !== "haul") setO(cur => ({ ...cur, size: "post" }));
      setCard(c);
      setReady(true);
    };
    if (kind === "haul") {
      setTitle(t("haul.share.haulTitle"));
      showCard(specHaul(ctx));
    } else if (kind === "love") {
      setTitle(t("haul.share.loveTitle"));
      const items = ctx.sess.items.filter(i => i.checked).map(i => i.name);
      setPick(items.length ? { items, hint: t("haul.share.loveHint"),
        done: item => showCard(specLove(ctx, item)) } : { none: true });
    } else if (kind === "sos") {
      setTitle(t("haul.card.shelfSos"));
      const items = (ctx.sess.my_reports as string[] | undefined) || [];
      setPick(items.length ? { items, hint: t("haul.share.sosHint"),
        done: async item => {
          let trips = 1;
          try {
            const d = await get(`/api/quest/sos-count?store=${encodeURIComponent(ctx.sess.store)}&item=${encodeURIComponent(item)}`);
            trips = d.trips || 1;
          } catch { /* one trip */ }
          showCard(specSos(ctx, item, trips));
        } } : { none: true });
    }
  }, [req]);

  // paint()
  useEffect(() => {
    const el = cv.current;
    if (!ready || !card || !el) return;
    el.width = W; el.height = sizeH(o);
    draw(el.getContext("2d")!, el.height, card, o);
  }, [ready, card, o]);

  const setLook = async (look: string, base: Opts) => {
    if (base.busy || !card) return;
    if (look === "plain") { setO({ ...base, look: "plain", painted: null }); return; }
    setO({ ...base, busy: true, look });
    setStatus(t("haul.share.painting"));
    try {
      const painted = await paintLook(card, { ...base, look }, look);
      setStatus("");
      setO(cur => ({ ...cur, look, painted, busy: false }));
    } catch (e) {
      setStatus(t("haul.share.paintFailed") + ((e instanceof Error && e.message) || ""));
      setO(cur => ({ ...cur, look: "plain", painted: null, busy: false }));
    }
  };

  const stillFile = async () => {
    const blob = cv.current ? await toBlob(cv.current, "image/png") : null;
    return blob ? new File([blob], "arya-haul.png", { type: "image/png" }) : null;
  };
  const doShare = async () => {
    const file = await stillFile();
    if (!file || !card) return;
    const data: ShareData = { title: t("haul.share.shareTitle"), text: card.caption };
    if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
    if (navigator.share) {
      try { await navigator.share(data); return; }
      catch (e) { if (e && (e as Error).name === "AbortError") return; }
    }
    download(file, file.name);
    setStatus(t("haul.share.savedPost"));
  };
  const doSave = async () => {
    const file = await stillFile();
    if (file) { download(file, file.name); setStatus(t("newList.saved")); }
  };
  const doCopy = async () => {
    if (!card) return;
    // Instagram and Facebook drop pre-filled text, so the caption is one tap to copy.
    try { await navigator.clipboard.writeText(card.caption); setStatus(t("haul.share.captionCopied")); }
    catch { setStatus(card.caption); }
  };

  /* The options only exist on the haul card. The badge look needs a
   * badge earned on this haul; any look needs the sticker-only card,
   * so a haul photo (which may show people) switches the looks off. */
  const haul = !!card && card.kind === "haul";
  const lookOff = (l: string) => !!card && (o.busy || (l !== "plain" && (!!o.photo || !card.faces.length || (l === "badge" && !card.badge))));
  const hint = !card ? "" : o.photo ? t("haul.share.hintPhoto")
    : !card.badge ? t("haul.share.hintNoBadge")
    : t("haul.share.hintMuse");

  return (
    <Sheet open={!!req} onClose={onClose} id="share-sheet" labelledBy="share-title">
      <h3 id="share-title" style={{ marginTop: 0 }}>{title}</h3>
      <div id="share-chips">
        {pick && "none" in pick && <p className="muted">{t("haul.nothingToPickFromThis")}</p>}
        {pick && "items" in pick && <>
          <p className="muted">{pick.hint}</p>
          <p style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {pick.items.map(n => <button key={n} className="btn" data-pick={n} type="button"
              onClick={() => { const done = pick.done; setPick(null); done(n); }}>{n}</button>)}
          </p>
        </>}
      </div>
      <canvas id="share-canvas" ref={cv} width={1080} height={1920}
        style={{ display: "block", maxWidth: "100%", maxHeight: "46vh", width: "auto", margin: "0 auto", borderRadius: 16, border: "1px solid var(--line)" }}
        hidden={!ready} />
      <div id="share-opts" hidden={!ready || !haul}>
        <div className="seg" id="share-size" style={{ marginTop: 10 }}>
          {(["story", "post"] as const).map(sz => (
            <button key={sz} className="chip" type="button" data-size={sz} aria-pressed={o.size === sz}
              onClick={() => {
                if (o.busy) return;
                const base = { ...o, size: sz };
                if (base.look !== "plain") setLook(base.look, base); else setO(base);
              }}>{sz === "story" ? t("haul.share.sizeStory") : t("haul.share.sizePost")}</button>
          ))}
        </div>
        <p style={{ margin: "10px 0 2px" }}><label><input type="checkbox" id="opt-handle" checked={o.handle}
          onChange={e => setO({ ...o, handle: e.target.checked })} />{" "}{t("haul.showMyHandle")}</label></p>
        <p style={{ margin: "2px 0" }}><label><input type="checkbox" id="opt-level" checked={o.level}
          onChange={e => setO({ ...o, level: e.target.checked })} />{" "}{t("haul.showMyLevel")}</label></p>
        <p style={{ margin: "2px 0" }} id="opt-photo-row" hidden={!card || !card.photo}><label><input type="checkbox" id="opt-photo" checked={!!o.photo}
          onChange={e => {
            const photo = e.target.checked;
            setO(photo && o.look !== "plain" ? { ...o, photo, look: "plain", painted: null } : { ...o, photo });
          }} />{" "}{t("haul.addMyHaulPhoto")}</label><br /><span className="muted">{t("haul.offByDefaultCheckThat")}</span></p>
        <h4 style={{ margin: "12px 0 6px" }}>{t("haul.makeItSpecialWithArya")}</h4>
        <div className="seg" id="share-looks">
          {([["plain", "haul.share.look.plain"], ["badge", "haul.share.look.badge"], ["friends", "haul.share.look.friends"], ["story", "haul.share.look.story"]] as const).map(([l, label]) => (
            <button key={l} className="chip" type="button" data-look={l} aria-pressed={o.look === l} disabled={lookOff(l)}
              onClick={() => setLook(l, { ...o, tries: 0 })}>{t(label)}</button>
          ))}
        </div>
        <p className="muted" id="share-look-hint" style={{ margin: "6px 0 0" }}>{hint}</p>
        <p style={{ margin: "6px 0 0" }}><button className="btn" id="share-again" type="button" hidden={o.look === "plain"} disabled={o.busy}
          onClick={() => setLook(o.look, { ...o, tries: o.tries + 1 })}>{t("haul.tryAnother")}</button></p>
      </div>
      <p className="muted" id="share-caption" style={{ marginTop: 10 }}>{card ? card.caption : ""}</p>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary grow" id="share-go" type="button" hidden={!ready} onClick={() => { doShare().catch(() => {}); }}>{t("common.share")}</button>
        <button className="btn grow" id="share-png" type="button" hidden={!ready} onClick={() => { doSave().catch(() => {}); }}>{t("haul.saveImage")}</button>
        <button className="btn grow" id="share-copy" type="button" hidden={!ready} onClick={() => { doCopy(); }}>{t("haul.copyCaption")}</button>
        <button className="btn grow" id="share-close" type="button" onClick={onClose}>{t("common.close")}</button>
      </p>
      <p className="muted nomargin" id="share-status">{status}</p>
    </Sheet>
  );
}
