/* Score shares (owner, 2026-10-28): the haul card, the love note,
 * and the Shelf SOS. Every card is built from the real hunt — the
 * items and their cast faces from the character registry, the
 * player's own character as the host, points the receipt proved.
 * Nothing posts itself: the player taps Share and their own app
 * (WhatsApp, Instagram, Facebook) does the posting. Spend never
 * appears on a card. The share is a still PNG, never a video.
 *
 * The haul card has an optional paint pass (sharelook.py): the badge
 * the player just earned, a cast character joining in, or a
 * hand-painted storybook scene. The phone sends Muse Image only the
 * art layer (cream ground and cast stickers, no words, no photo) and
 * draws the words itself afterwards. The footer says Made with Arya,
 * and adds Powered by Meta Muse only when Muse painted the card. */
"use strict";

const ShareUI = (() => {
  const CHAINS = [
    ["trader joe", "@traderjoes"], ["costco", "@costco"],
    ["whole foods", "@wholefoods"], ["safeway", "@safeway"],
    ["target", "@target"], ["walmart", "@walmart"],
    ["kroger", "@kroger"], ["h mart", "@hmartofficial"],
    ["aldi", "@aldiusa"], ["sprouts", "@sproutsfarmersmarket"]
  ];
  const CREAM = "#FBF5E6", INK = "#1B1B1E", ACC = "#E4572E",
        SOFT = "#FDEEE8", GREY = "#8B8B93";
  let card = null;       // the current card spec
  let images = {};       // src -> HTMLImageElement (loaded)
  let raf = null;

  function chainTag(store) {
    const n = (store || "").toLowerCase();
    for (const [k, v] of CHAINS) if (n.includes(k)) return v;
    return "";
  }
  function faceFor(name) {
    return window.qFaceFor ? qFaceFor(name) : "basket.webp";
  }
  function loadImg(src) {
    if (images[src]) return images[src];
    const im = new Image();
    im.src = src;
    images[src] = im;
    return im;
  }
  function faceSrc(file) { return file === "custom" ? "/api/quest/avatar/image" : "assets/characters/" + file; }

  /* Card specs. ctx = { sess, profile, haulPhotoURL }. The haul card
   * (HAUL slice) also reads ctx.hidden (a Set of normalised item names
   * the shopper hid), ctx.title (Arya's trip name), ctx.stats
   * ({items, new, level}) and ctx.names (the reviewed haul's item
   * names). It carries no price, no store and no receipt line. */
  function normKey(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function specHaul(ctx) {
    const sess = ctx.sess;
    const hidden = ctx.hidden instanceof Set ? ctx.hidden : new Set(ctx.hidden || []);
    const pool = Array.isArray(ctx.names)
      ? ctx.names.map(n => ({ name: n }))
      : sess.items.filter(i => i.checked);
    const got = pool.filter(i => !hidden.has(normKey(i.name)));
    const wild = Array.isArray(ctx.names) ? [] :
      [...new Set([...(sess.wild_finds || []),
        ...sess.items.filter(i => i.wild).map(i => i.name)])]
        .filter(n => !hidden.has(normKey(n)));
    const st = ctx.stats || {};
    const level = st.level || (ctx.profile && ctx.profile.level) || 1;
    return {
      kind: "haul", title: ctx.title || "My haul", store: "",
      sub: `Level ${level}`,
      host: ctx.profile && ctx.profile.avatar || "basket.webp",
      handle: ctx.profile ? "@" + ctx.profile.handle : "",
      faces: got.slice(0, 8).map(i => ({ file: faceFor(i.name), name: i.name })),
      more: Math.max(0, got.length - 8),
      wild: wild.slice(0, 3),
      stat: `${got.length} items · ${st.new || 0} new · level ${level}`,
      statBase: `${got.length} items · ${st.new || 0} new`, level,
      badge: ctx.newBadge || null,
      photo: ctx.haulPhotoURL || null,
      caption: "My haul on Arya."
    };
  }
  function specLove(ctx, item) {
    const tag = chainTag(ctx.sess.store);
    return {
      kind: "love", title: "Found & loved", store: ctx.sess.store,
      host: ctx.profile && ctx.profile.avatar || "basket.webp",
      handle: ctx.profile ? "@" + ctx.profile.handle : "",
      faces: [{ file: faceFor(item), name: item }],
      stat: `at ${ctx.sess.store}`,
      caption: `Found & loved at ${ctx.sess.store}: ${item}.${tag ? " " + tag : ""} — via Arya, the list game.`
    };
  }
  function specSos(ctx, item, trips) {
    const tag = chainTag(ctx.sess.store);
    const again = trips >= 2 ? ` That's ${trips} trips in a row.` : "";
    return {
      kind: "sos", title: "Shelf SOS", store: ctx.sess.store,
      host: "compass.webp",
      handle: ctx.profile ? "@" + ctx.profile.handle : "",
      faces: [{ file: faceFor(item), name: item }],
      stat: trips >= 2 ? `missing ${trips} trips in a row` : "not on the shelf today",
      caption: `Dear ${tag || ctx.sess.store} — ${item} wasn't on the shelf at ${ctx.sess.store} today.${again} Arya keeps count.`
    };
  }

  /* ---------- canvas drawing ---------- */
  const W = 1080, COLS = 4, CELL = (W - 120) / COLS;
  // Share options for the open card. size: story 9:16 or post 4:5.
  let opts = null;
  function freshOpts() {
    return { size: "story", handle: true, level: true, photo: false,
             look: "plain", painted: null, tries: 0, busy: false };
  }
  const sizeH = () => (opts && opts.size === "post" ? 1350 : 1920);
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function drawFace(g, file, cx, cy, size) {
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
  const showPhoto = c => !!(c.photo && opts && opts.photo);
  // Where the haul's sticker block starts and ends on this canvas.
  function faceTop(c, H) { return 250 + (H > 1400 ? 220 : 0) + (showPhoto(c) ? 480 : 0); }
  function faceRows(c) { return Math.ceil(c.faces.length / COLS); }
  function faceEnd(c, H) { return faceTop(c, H) + faceRows(c) * 300 + 90; }
  const BADGE_ART = { egg_baron: "egg.webp", banana_republic: "banana.webp" };
  function castPair(c) {
    const files = [...new Set(c.faces.map(f => f.file))];
    if (!files.length) return [];
    const n = Math.min(2, files.length), k = opts ? opts.tries : 0;
    return Array.from({ length: n }, (_, i) => files[(k + i) % files.length]);
  }
  /* The art layer: cream ground, the cast stickers, and the badge or
   * the joining characters for those two looks. No words, no photo. */
  function drawArt(g, H, c, look, names) {
    g.fillStyle = CREAM; g.fillRect(0, 0, W, H);
    const y = faceTop(c, H);
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
      const pair = castPair(c), cy = faceEnd(c, H) + 100;
      pair.forEach((file, i) => drawFace(g, file, W - 190 - i * 150, cy + (i ? 30 : 0), 190));
    }
  }
  function draw(g, H) {
    const c = card;
    const painted = opts && opts.painted;
    if (painted) g.drawImage(painted, 0, 0, W, H);
    else if (c.kind === "haul") drawArt(g, H, c, "plain", true);
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
      ? [opts.handle ? c.handle : "", opts.level ? c.sub : ""].filter(Boolean).join(" · ")
      : `${c.handle ? c.handle + " · " : ""}${c.sub !== undefined ? c.sub : c.store}`;
    g.font = "600 40px system-ui, sans-serif"; g.fillStyle = GREY;
    g.fillText(sub, 218, 158);
    let y = 250 + (c.kind === "haul" && H > 1400 ? 220 : 0);
    if (showPhoto(c)) {
      const im = loadImg(c.photo);
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
        g.fillText(`+ ${c.more} more`, W / 2, y + faceRows(c) * 300 + 40);
      }
      y += faceRows(c) * 300 + 90;
      if (c.wild && c.wild.length) {
        g.fillStyle = ACC; g.textAlign = "center";
        g.font = "800 38px system-ui, sans-serif";
        g.fillText("Wild finds: " + c.wild.join(" · "), W / 2, y);
        y += 60;
      }
    }
    g.fillStyle = ACC; g.textAlign = "center";
    g.font = "800 56px system-ui, sans-serif";
    const stat = c.kind === "haul" && !opts.level ? c.statBase : c.stat;
    g.fillText(stat, W / 2, H - 150);
    g.fillStyle = GREY; g.font = "600 32px system-ui, sans-serif";
    g.fillText(creditLine(), W / 2, H - 96);
    g.font = "500 26px system-ui, sans-serif";
    g.fillText("arya-pilot.duckdns.org", W / 2, H - 56);
  }
  // The Meta credit is claimed only when Muse painted the card.
  function creditLine() {
    return "Made with Arya" + (opts && opts.painted ? " · Powered by Meta Muse" : "");
  }
  function shortName(n) { return n.length > 18 ? n.slice(0, 17) + "…" : n; }
  function wrapText(g, text, cx, y, maxW, lh, maxLines) {
    const words = String(text).split(/\s+/);
    const lines = [];
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
  function paint() {
    const cv = $("#share-canvas");
    cv.width = W; cv.height = sizeH();
    draw(cv.getContext("2d"), cv.height);
  }
  const toBlob = (cv, type) => new Promise(r => cv.toBlob(r, type));
  async function paintLook(look) {
    const c = card;
    const art = document.createElement("canvas");
    art.width = W; art.height = sizeH();
    drawArt(art.getContext("2d"), art.height, c, look, false);
    const png = await toBlob(art, "image/png");
    const r = await fetch(`/api/quest/share-look?look=${look}`, {
      method: "POST", headers: { "Content-Type": "image/png" }, body: png });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
    return createImageBitmap(await r.blob());
  }

  /* ---------- sheet ---------- */
  const $ = s => document.querySelector(s);
  function open(kind, ctx) {
    const sheet = $("#share-sheet");
    sheet.hidden = false;
    opts = freshOpts();
    $("#share-canvas").hidden = true;
    $("#share-go").hidden = true;
    $("#share-png").hidden = true;
    $("#share-copy").hidden = true;
    $("#share-opts").hidden = true;
    $("#share-status").textContent = "";
    const chips = $("#share-chips");
    chips.innerHTML = "";
    if (kind === "haul") {
      card = specHaul(ctx);
      $("#share-title").textContent = "Share your haul";
      showCard(ctx);
    } else if (kind === "love") {
      $("#share-title").textContent = "Loved something?";
      pickItem(ctx, ctx.sess.items.filter(i => i.checked).map(i => i.name),
        "Pick the thing you loved — its character fronts the card.",
        item => { card = specLove(ctx, item); showCard(ctx); });
    } else if (kind === "sos") {
      $("#share-title").textContent = "Shelf SOS";
      pickItem(ctx, ctx.sess.my_reports || [],
        "Pick the item that wasn't there — Arya counts your trips.",
        async item => {
          let trips = 1;
          try {
            const d = await (window.api
              ? api(`/api/quest/sos-count?store=${encodeURIComponent(ctx.sess.store)}&item=${encodeURIComponent(item)}`)
              : fetch(`/api/quest/sos-count?store=${encodeURIComponent(ctx.sess.store)}&item=${encodeURIComponent(item)}`).then(r => r.json()));
            trips = d.trips || 1;
          } catch (e) {}
          card = specSos(ctx, item, trips);
          showCard(ctx);
        });
    }
  }
  function pickItem(ctx, items, hint, done) {
    const chips = $("#share-chips");
    if (!items.length) {
      chips.innerHTML = `<p class="muted">Nothing to pick from this hunt.</p>`;
      return;
    }
    chips.innerHTML = `<p class="muted">${hint}</p><p style="display:flex; flex-wrap:wrap; gap:8px">` +
      items.map(n => `<button class="btn" data-pick="${n.replace(/"/g, "&quot;")}" type="button">${n}</button>`).join("") + `</p>`;
    chips.querySelectorAll("[data-pick]").forEach(b =>
      b.addEventListener("click", () => { chips.innerHTML = ""; done(b.dataset.pick); }));
  }
  /* The options only exist on the haul card. The badge look needs a
   * badge earned on this haul; any look needs the sticker-only card,
   * so a haul photo (which may show people) switches the looks off. */
  function syncOpts() {
    const c = card, haul = c.kind === "haul";
    $("#share-opts").hidden = !haul;
    if (!haul) return;
    $$("#share-size .chip").forEach(b => b.setAttribute("aria-pressed", b.dataset.size === opts.size));
    $$("#share-looks .chip").forEach(b => {
      const l = b.dataset.look;
      b.setAttribute("aria-pressed", l === opts.look);
      b.disabled = opts.busy || (l !== "plain" && (!!opts.photo || !c.faces.length || (l === "badge" && !c.badge)));
    });
    $("#opt-photo-row").hidden = !c.photo;
    $("#opt-photo").checked = !!opts.photo;
    $("#share-again").hidden = opts.look === "plain";
    $("#share-again").disabled = opts.busy;
    const hint = $("#share-look-hint");
    hint.textContent = opts.photo ? "Looks use the stickers only, so they are off while your photo is on."
      : !c.badge ? "No new badge on this haul, so Add my badge is off."
      : "Muse paints the picture. Arya adds the words after. About 10 seconds.";
  }
  async function setLook(look) {
    if (opts.busy) return;
    if (look === "plain") { opts.look = "plain"; opts.painted = null; syncOpts(); paint(); return; }
    opts.busy = true; opts.look = look; syncOpts();
    $("#share-status").textContent = "Arya is painting your card…";
    try {
      opts.painted = await paintLook(look);
      $("#share-status").textContent = "";
    } catch (e) {
      opts.look = "plain"; opts.painted = null;
      $("#share-status").textContent = "Could not paint that one. Your plain card is untouched. " + (e.message || "");
    }
    opts.busy = false; syncOpts(); paint();
  }
  const $$ = s => [...document.querySelectorAll(s)];
  async function showCard(ctx) {
    const cv = $("#share-canvas");
    cv.hidden = false;
    if (card.kind !== "haul") opts.size = "post";
    $("#share-caption").textContent = card.caption;
    // Preload faces so the first draw is complete.
    const srcs = [faceSrc(card.host), ...card.faces.map(f => faceSrc(f.file))];
    if (card.photo) srcs.push(card.photo);
    if (card.badge) srcs.push(faceSrc(BADGE_ART[card.badge.id] || "basket.webp"));
    // One wait per distinct file: two cards faces can share one image.
    await Promise.all([...new Set(srcs)].map(src => new Promise(res => {
      const im = loadImg(src);
      if (im.complete) return res();
      im.addEventListener("load", () => res());
      im.addEventListener("error", () => res());
    })));
    paint();
    syncOpts();
    $("#share-go").hidden = false;
    $("#share-png").hidden = false;
    $("#share-copy").hidden = false;
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function stillFile() {
    const blob = await toBlob($("#share-canvas"), "image/png");
    return blob ? new File([blob], "arya-haul.png", { type: "image/png" }) : null;
  }
  async function doShare() {
    const status = $("#share-status");
    const file = await stillFile();
    if (!file) return;
    const data = { title: "Arya haul", text: card.caption };
    if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
    if (navigator.share) {
      try { await navigator.share(data); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    download(file, file.name);
    status.textContent = "Saved. Post it anywhere.";
  }
  async function doSave() {
    const file = await stillFile();
    if (file) { download(file, file.name); $("#share-status").textContent = "Saved."; }
  }
  async function doCopy() {
    // Instagram and Facebook drop pre-filled text, so the caption is one tap to copy.
    try { await navigator.clipboard.writeText(card.caption); $("#share-status").textContent = "Caption copied."; }
    catch (e) { $("#share-status").textContent = card.caption; }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#share-close").addEventListener("click", () => { $("#share-sheet").hidden = true; });
    $("#share-go").addEventListener("click", () => doShare().catch(() => {}));
    $("#share-png").addEventListener("click", () => doSave().catch(() => {}));
    $("#share-copy").addEventListener("click", () => doCopy());
    $("#share-size").addEventListener("click", e => {
      const b = e.target.closest("[data-size]");
      if (!b || opts.busy) return;
      opts.size = b.dataset.size;
      const l = opts.look;
      if (l !== "plain") setLook(l); else { syncOpts(); paint(); }
    });
    $("#share-looks").addEventListener("click", e => {
      const b = e.target.closest("[data-look]");
      if (b && !b.disabled) { opts.tries = 0; setLook(b.dataset.look); }
    });
    $("#share-again").addEventListener("click", () => { opts.tries++; setLook(opts.look); });
    $("#opt-handle").addEventListener("change", e => { opts.handle = e.target.checked; paint(); });
    $("#opt-level").addEventListener("change", e => { opts.level = e.target.checked; paint(); });
    $("#opt-photo").addEventListener("change", e => {
      opts.photo = e.target.checked;
      if (opts.photo && opts.look !== "plain") { opts.look = "plain"; opts.painted = null; }
      syncOpts(); paint();
    });
  });
  return { open, chainTag };
})();

window.ShareUI = ShareUI;
