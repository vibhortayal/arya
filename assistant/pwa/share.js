/* Score shares (owner, 2026-10-28): the haul card, the love note,
 * and the Shelf SOS. Every card is built from the real hunt — the
 * items and their cast faces from the character registry, the
 * player's own character as the host, points the receipt proved.
 * Nothing posts itself: the player taps Share and their own app
 * (WhatsApp, Instagram, X) does the posting. Spend never appears
 * on a card. The card animates on a canvas — faces pop in one by
 * one and the points count up — and the animation is recorded to
 * a short video when the browser allows; otherwise a still. */
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
  function faceSrc(file) { return "assets/characters/" + file; }

  /* Card specs. ctx = { sess, profile, haulPhotoURL } */
  function specHaul(ctx) {
    const sess = ctx.sess;
    const got = sess.items.filter(i => i.checked);
    const wild = [...new Set([...(sess.wild_finds || []),
      ...sess.items.filter(i => i.wild).map(i => i.name)])];
    const pts = window.qHaulPoints ? qHaulPoints(sess, true) : 0;
    const tag = chainTag(sess.store);
    return {
      kind: "haul", title: "My haul", store: sess.store,
      host: ctx.profile && ctx.profile.avatar || "basket.webp",
      handle: ctx.profile ? "@" + ctx.profile.handle : "",
      faces: got.slice(0, 8).map(i => ({ file: faceFor(i.name), name: i.name })),
      more: Math.max(0, got.length - 8),
      wild: wild.slice(0, 3),
      stat: `${got.length} items · ${pts} pts`,
      photo: ctx.haulPhotoURL || null,
      caption: `My ${sess.store} haul: ${got.length} items, ${pts} pts — receipt-verified on Arya.${tag ? " " + tag : ""}${wild.length ? ` Wild finds: ${wild.join(", ")}.` : ""}`
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
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function popScale(t) {  // ease-out-back for one pop window
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }
  function drawFace(g, file, cx, cy, size, scale) {
    const im = loadImg(faceSrc(file));
    if (!im.complete || !im.naturalWidth || scale <= 0) return;
    const s = size * scale;
    g.save();
    g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = "#fff"; g.fill();
    g.drawImage(im, cx - s / 2, cy - s / 2, s, s);
    g.restore();
    g.save();
    g.strokeStyle = SOFT; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
  function draw(g, W, H, t) {
    const c = card;
    g.fillStyle = CREAM; g.fillRect(0, 0, W, H);
    // header: host avatar + handle + title
    const headA = Math.min(1, t / 0.12);
    g.globalAlpha = headA;
    drawFace(g, c.host, 110, 104, 128, 1);
    g.fillStyle = INK; g.textAlign = "left";
    g.font = "800 64px system-ui, sans-serif";
    g.fillText(c.title, 216, 100);
    g.font = "600 40px system-ui, sans-serif"; g.fillStyle = GREY;
    g.fillText(`${c.handle ? c.handle + " · " : ""}${c.store}`, 218, 158);
    g.globalAlpha = 1;
    let y = 250;
    if (c.photo) {
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
      const s = popScale((t - 0.15) / 0.3);
      drawFace(g, f.file, W / 2, y + 260, 470, s);
      g.globalAlpha = Math.min(1, Math.max(0, (t - 0.4) / 0.2));
      g.fillStyle = INK; g.textAlign = "center";
      g.font = "800 58px system-ui, sans-serif";
      wrapText(g, f.name, W / 2, y + 580, W - 160, 66);
      g.globalAlpha = 1;
      y += 700;
    } else {
      const cols = 4, cell = (W - 120) / cols;
      c.faces.forEach((f, i) => {
        const cx = 60 + cell * (i % cols) + cell / 2;
        const cy = y + Math.floor(i / cols) * 300 + 110;
        const s = popScale((t - 0.12 - i * 0.07) / 0.25);
        drawFace(g, f.file, cx, cy, 168, s);
        if (s > 0.6) {
          g.fillStyle = INK; g.textAlign = "center";
          g.font = "600 30px system-ui, sans-serif";
          wrapText(g, shortName(f.name), cx, cy + 122, cell - 14, 34, 2);
        }
      });
      if (c.more) {
        g.fillStyle = GREY; g.textAlign = "center";
        g.font = "700 34px system-ui, sans-serif";
        g.fillText(`+ ${c.more} more`, W / 2, y + Math.ceil(c.faces.length / cols) * 300 + 40);
      }
      y += Math.ceil(c.faces.length / cols) * 300 + 90;
      if (c.wild && c.wild.length) {
        g.globalAlpha = Math.min(1, Math.max(0, (t - 0.62) / 0.2));
        g.fillStyle = ACC; g.textAlign = "center";
        g.font = "800 38px system-ui, sans-serif";
        g.fillText("Wild finds: " + c.wild.join(" · "), W / 2, y);
        g.globalAlpha = 1;
        y += 60;
      }
    }
    // stat line counts in at the end
    const statT = Math.min(1, Math.max(0, (t - 0.72) / 0.25));
    g.globalAlpha = statT;
    g.fillStyle = ACC; g.textAlign = "center";
    g.font = "800 56px system-ui, sans-serif";
    g.fillText(c.stat, W / 2, H - 150);
    g.fillStyle = GREY; g.font = "600 32px system-ui, sans-serif";
    g.fillText("Arya — your grocery list, as a game · arya-pilot.duckdns.org",
               W / 2, H - 84);
    g.globalAlpha = 1;
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

  function animate(canvas, record) {
    return new Promise(resolve => {
      const g = canvas.getContext("2d");
      const dur = 2600;
      let stream = null, rec = null, chunks = [];
      if (record && canvas.captureStream && window.MediaRecorder) {
        try {
          stream = canvas.captureStream(30);
          const mime = ["video/webm;codecs=vp9", "video/webm", "video/mp4"]
            .find(m => MediaRecorder.isTypeSupported(m));
          if (mime) {
            rec = new MediaRecorder(stream, { mimeType: mime });
            rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
            rec.start(200);
          }
        } catch (e) { rec = null; }
      }
      const t0 = performance.now();
      const step = now => {
        const t = Math.min(1, (now - t0) / dur);
        draw(g, canvas.width, canvas.height, t);
        if (t < 1) { raf = requestAnimationFrame(step); return; }
        if (rec) {
          rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
          rec.stop();
        } else resolve(null);
      };
      raf = requestAnimationFrame(step);
    });
  }

  /* ---------- sheet ---------- */
  const $ = s => document.querySelector(s);
  function open(kind, ctx) {
    const sheet = $("#share-sheet");
    sheet.hidden = false;
    $("#share-canvas").hidden = true;
    $("#share-go").hidden = true;
    $("#share-png").hidden = true;
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
  async function showCard(ctx) {
    const cv = $("#share-canvas");
    cv.hidden = false;
    $("#share-caption").textContent = card.caption;
    // Preload faces so the pop-in is not a fax machine.
    const srcs = [faceSrc(card.host), ...card.faces.map(f => faceSrc(f.file))];
    if (card.photo) srcs.push(card.photo);
    await Promise.all(srcs.map(src => new Promise(res => {
      const im = loadImg(src);
      if (im.complete) return res();
      im.onload = im.onerror = () => res();
    })));
    await animate(cv, false);
    $("#share-go").hidden = false;
    $("#share-png").hidden = false;
  }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function doShare() {
    const status = $("#share-status");
    const cv = $("#share-canvas");
    status.textContent = "Making your video…";
    const video = await animate(cv, true);
    const files = [];
    let still = null;
    if (video && video.size > 1000) {
      files.push(new File([video], "arya-haul.webm", { type: video.type }));
    } else {
      still = await new Promise(r => cv.toBlob(r, "image/png"));
      if (still) files.push(new File([still], "arya-haul.png", { type: "image/png" }));
    }
    status.textContent = "";
    const data = { title: "Arya haul", text: card.caption };
    if (files.length && navigator.canShare && navigator.canShare({ files })) {
      data.files = files;
    }
    if (navigator.share) {
      try { await navigator.share(data); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
    if (files.length) { download(files[0], files[0].name); status.textContent = "Saved — post it anywhere."; }
  }
  async function doPng() {
    const cv = $("#share-canvas");
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    if (blob) download(blob, "arya-card.png");
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#share-close").addEventListener("click", () => {
      $("#share-sheet").hidden = true;
      if (raf) cancelAnimationFrame(raf);
    });
    $("#share-go").addEventListener("click", () => doShare().catch(() => {}));
    $("#share-png").addEventListener("click", () => doPng().catch(() => {}));
  });
  return { open, chainTag };
})();

window.ShareUI = ShareUI;
