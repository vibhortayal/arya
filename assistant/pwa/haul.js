"use strict";
/* Haul (game slice): after the hunt closes, the shopper checks the
 * receipt, watches the haul appear, makes a haul card, and may post
 * it to the Crew. Loaded after share.js; globals only.
 *
 * Rules this file keeps:
 *  - The hunt is closed before review. A fix here is a note on the
 *    haul record (server: hauls.json). It never changes points,
 *    badges or the hunt itself.
 *  - Matching is a list of suggestions. The shopper decides.
 *  - Nothing here shows a price to anyone but the owner. A post
 *    carries stock character art only, never a product cutout.
 *  - No chat, no comments. A reaction is one of three stickers.
 *  - Motion is opt-out: prefers-reduced-motion shows the end state.
 */

/*HAULCORE-START*/
const HaulCore = (() => {
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  /* The count-up. k runs 0..1; the curve eases out and ends exactly
   * on the target, so the shown number is never off by one. */
  function countStep(from, to, k) {
    if (!(k < 1)) return to;
    if (!(k > 0)) return from;
    const e = 1 - Math.pow(1 - k, 3);
    return Math.round(from + (to - from) * e);
  }
  /* "Tap anywhere" lands here: every tile shown, number at target. */
  function revealFinal(total, tiles) {
    return { shown: tiles, value: total };
  }
  function toggleHidden(set, key) {
    const out = new Set(set || []);
    if (out.has(key)) out.delete(key); else out.add(key);
    return out;
  }
  function statsLabel(stats) {
    const s = stats || {};
    return `${s.items || 0} items · ${s.new || 0} new · level ${s.level || 1}`;
  }
  /* '@priya', '@priya and @dev', '@a, @b and @c', '@a, @b and 3 more'. */
  function sheetAudienceText(handles) {
    const h = (handles || []).map(x => "@" + String(x).replace(/^@/, ""));
    if (h.length === 0) return "";
    if (h.length === 1) return h[0];
    if (h.length === 2) return `${h[0]} and ${h[1]}`;
    if (h.length === 3) return `${h[0]}, ${h[1]} and ${h[2]}`;
    return `${h[0]}, ${h[1]} and ${h.length - 2} more`;
  }
  /* The Same haul sheet: one row per item. What is already on the
   * Arya list, or already queued for the next hunt (from any post),
   * starts unticked and says so. */
  function queuePick(items, onListNames, queuedNames) {
    const has = (names, name) => {
      const have = (names || []).map(norm).filter(Boolean);
      const n = norm(name);
      return !!n && have.some(h => h === n || (" " + h + " ").includes(" " + n + " ") || (" " + n + " ").includes(" " + h + " "));
    };
    return (items || []).map(it => {
      const name = typeof it === "string" ? it : it.name;
      const queued = (queuedNames || []).map(norm).includes(norm(name));
      const dupe = !queued && has(onListNames, name);
      return { name, checked: !(dupe || queued),
               note: queued ? "Already in your next hunt" : dupe ? "Already on your list" : "" };
    });
  }
  /* How many rows of one post the server queue holds. */
  function queuedCount(rows, postId) {
    return (rows || []).filter(r => r && r.post_id === postId).length;
  }
  /* The words after a Same haul tap. Counts come from the server, not
   * from the ticks, because the queue drops names it already holds. */
  function sameToast(added, asked) {
    if (added <= 0) return "Nothing new to add. Your next hunt has these already, or it is full.";
    const one = `${added} ${added === 1 ? "item" : "items"} added to your next hunt.`;
    return added < asked ? one + " The rest were there already." : one;
  }
  /* Chip words per review section. */
  function fixLabel(bucket) {
    return ({
      on_receipt_only: { yes: "Add to album", no: "Leave out", yesKind: "extra_add", noKind: "extra_drop", none: "extra_none" },
      grabbed_only: { yes: "Keep", no: "Remove from haul", yesKind: "grabbed_keep", noKind: "grabbed_drop", none: "grabbed_none" },
      swapped: { yes: "Yes, swapped", no: "No", yesKind: "swap_ok", noKind: "swap_no", none: "swap_none" }
    })[bucket] || null;
  }
  /* The owner's private lines. A pair "About X · Receipt Y" shows only
   * when the estimate prices every grabbed item. With fewer, the
   * estimate says how many it covers and the receipt is its own line,
   * so two different sums never read as one comparison. */
  function privateLines(pv, fmt) {
    if (!pv || (pv.estimate == null && pv.actual == null)) return [];
    const n = pv.estimate_items || 0, m = pv.grabbed_items || 0;
    const full = pv.estimate != null && m > 0 && n >= m;
    if (full || pv.estimate == null) {
      const est = pv.estimate != null ? `About ${fmt(pv.estimate)}` : "";
      const act = pv.actual != null ? `Receipt ${fmt(pv.actual)}` : "";
      return [{ label: "Estimate vs actual (only you)", text: [est, act].filter(Boolean).join(" · ") }];
    }
    const rows = [{ label: "Estimate (only you)", text: `About ${fmt(pv.estimate)} for ${n} of ${m} items` }];
    if (pv.actual != null) rows.push({ label: "Receipt total (only you)", text: fmt(pv.actual) });
    return rows;
  }
  /* What a post may carry from the client: a name and a stock art
   * file per item. Nothing else is copied across. */
  function postPayload(items) {
    return { items: (items || []).map(i => ({ name: String(i.name), art: String(i.art || "basket.webp") })) };
  }
  /* The labelled example card shown while the Crew feed is empty. */
  function sampleHaul() {
    return {
      post_id: "sample", author: "sample-priya", sample: true,
      name: "Sunday Fruit Bowl Run",
      items: [["Mandarins", "mandarin.webp"], ["Bananas", "banana.webp"],
              ["Blueberries", "blueberry.webp"], ["Raspberries", "raspberry.webp"],
              ["Strawberries", "fruit.webp"], ["Apples", "fruit.webp"],
              ["Kiwi", "fruit.webp"], ["Grapes", "fruit.webp"], ["Lemons", "fruit.webp"]]
        .map(([name, art]) => ({ name, art })),
      stats: { items: 9, new_finds: 2, level: 4 },
      my_reaction: null
    };
  }
  return { norm, countStep, revealFinal, toggleHidden, statsLabel,
           sheetAudienceText, queuePick, queuedCount, sameToast, privateLines, fixLabel, postPayload, sampleHaul };
})();
/*HAULCORE-END*/
window.HaulCore = HaulCore;

const HaulUI = (() => {
  const H = {
    cache: {},        // session id -> last haul view from the server
    profile: null,    // last /api/quest/profile
    raf: null,        // the one count-up frame request
    burst: new Set(), // sessions whose level-up burst already played
    queuedIds: {},    // post id -> queued row ids this phone added
    stk: {},          // session id -> {stickers, fresh} from the album
    celebP: null
  };
  const REACTIONS = [
    ["yum", "Yum", "banana.webp"],
    ["me_too", "Me too", "basket.webp"],
    ["teach_me", "Teach me", "binoculars.webp"]
  ];
  const q = s => document.querySelector(s);
  const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const art = name => (typeof qFaceFor === "function" ? qFaceFor(name) : "basket.webp");
  const artSrc = file => "assets/characters/" + file;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + "s")}`;

  /* qFaceFor needs the character manifest. A hunt loads it; a resumed
   * Score may not have. Load it here once, from the same file. */
  function faceReady() {
    if (H.celebP) return H.celebP;
    H.celebP = (async () => {
      try {
        if (typeof CELEB !== "undefined" && (!CELEB || !CELEB.fallback) && typeof qCelebSetManifest === "function") {
          const m = await fetch("assets/characters/manifest.json").then(r => r.json());
          qCelebSetManifest(m);
        }
      } catch (e) { /* the basket stands in */ }
    })();
    return H.celebP;
  }

  /* ---------- data ---------- */
  async function fetchHaul(sess) {
    const d = await api(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul`);
    H.cache[sess.id] = d;
    return d;
  }
  async function loadProfile() {
    try { H.profile = await api("/api/quest/profile"); } catch (e) { /* the card shows no handle */ }
    return H.profile;
  }
  /* The album's side of the haul (C9): the sticker art and which
   * stickers are new. Any failure gives an empty answer and the
   * screens fall back to the character art with no NEW badge. */
  async function stickersFor(sess) {
    if (H.stk[sess.id]) return H.stk[sess.id];
    let stickers = [], fresh = new Set();
    try { if (window.albumHaul) stickers = (await albumHaul(sess)) || []; } catch (e) { stickers = []; }
    try { if (window.albumNewFor) fresh = (await albumNewFor(sess)) || new Set(); } catch (e) { fresh = new Set(); }
    return (H.stk[sess.id] = { stickers, fresh });
  }
  function stickerFor(stickers, item) {
    const n = String(item.name).toLowerCase();
    return stickers.find(s => String(s.name).toLowerCase() === n) ||
      stickers.find(s => s.key && HaulCore.norm(s.key) === item.key) || null;
  }
  function tileSrc(stickers, item) {
    const st = stickerFor(stickers, item);
    if (st && window.albumStickerSrc) return albumStickerSrc(st);
    return artSrc(art(item.name));
  }
  function enter(id) {
    questShow(id);
    Q.stack = [id];   // a closed hunt has no Back to the hunt
  }

  /* ---------- the views, injected once ---------- */
  function ensureViews() {
    if (q("#view-rreview")) return;
    const anchor = q("#view-score");
    const views = `
  <section id="view-rreview" class="view" hidden>
    <div id="rv-review"></div>
  </section>
  <section id="view-reveal" class="view" hidden>
    <div id="rv-reveal"></div>
  </section>
  <section id="view-haul" class="view" hidden>
    <div id="hl-card-body"></div>
  </section>`;
    if (anchor) anchor.insertAdjacentHTML("beforebegin", views);
    else document.body.insertAdjacentHTML("beforeend", views);
    document.body.insertAdjacentHTML("beforeend", `
  <div id="hl-post-sheet" class="sheetwrap" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="hl-post-title">
      <div class="row"><span class="name" id="hl-post-title">Post to Crew</span><button id="hl-post-x" class="btn" type="button">Cancel</button></div>
      <div id="hl-post-body"></div>
    </div>
  </div>
  <div id="hl-same-sheet" class="sheetwrap" hidden>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="hl-same-title">
      <div class="row"><span class="name" id="hl-same-title">Same haul</span><button id="hl-same-x" class="btn" type="button">Cancel</button></div>
      <div id="hl-same-body"></div>
    </div>
  </div>`);
    q("#hl-post-x").addEventListener("click", closePostSheet);
    q("#hl-same-x").addEventListener("click", closeSameSheet);
    q("#hl-post-sheet").addEventListener("click", ev => { if (ev.target.id === "hl-post-sheet") closePostSheet(); });
    q("#hl-same-sheet").addEventListener("click", ev => { if (ev.target.id === "hl-same-sheet") closeSameSheet(); });
    q("#view-rreview").addEventListener("click", onReviewClick);
    q("#view-reveal").addEventListener("click", onRevealClick);
    q("#view-haul").addEventListener("click", onCardClick);
    q("#hl-post-body").addEventListener("click", onPostSheetClick);
    q("#hl-same-body").addEventListener("click", onSameSheetClick);
    q("#view-rreview").addEventListener("change", onReviewChange);
    q("#hl-same-body").addEventListener("change", onSameChange);
  }

  /* ---------- the receipt step: the e-receipt path ---------- */
  async function decodeAny(file) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (!isPdf) return qDecodeReceipt(file);
    const r = await fetch("/decode/pdf", {
      method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || `HTTP ${r.status}`);
    return (await r.json()).receipt.receipt_id;
  }
  function wireFinish() {
    const inp = q("#fin-ereceipt");
    if (!inp || inp._hl) return;
    inp._hl = true;
    inp.addEventListener("change", async ev => {
      const f = ev.target.files[0];
      const sess = Q.current;
      if (!f || !sess) return;
      const status = q("#fin-status");
      status.textContent = "Reading the receipt. This can take up to a minute.";
      let rid;
      try {
        rid = await decodeAny(f);
      } catch (e) {
        status.textContent = "";
        ev.target.value = "";
        toast("Could not read that file: " + e.message + " You can add the receipt later from Receipts.");
        return;
      }
      status.textContent = "";
      try {
        await closeToScore(sess, () => qAttach(sess.id, rid));
      } catch (e) {
        // The file was read. The receipt itself was refused.
        toast("Arya read the file, but could not attach it: " + e.message);
      }
      ev.target.value = "";
    });
  }

  /* ---------- the way on from a closed hunt ---------- */
  async function afterFinish(sess) {
    ensureViews();
    delete H.stk[sess.id];
    try {
      if (sess.state === "done" && sess.receipt_id) {
        const d = await fetchHaul(sess);
        if (d.review && d.review.read > 0) return openReview(sess, d);
      }
      return next(sess);
    } catch (e) {
      return openScore(sess);
    }
  }
  function next(sess) {
    // Express stays quiet: no reveal, straight to the summary.
    return sess.mode === "express" ? openScore(sess) : openReveal(sess);
  }

  /* ---------- the review ---------- */
  function fixChip(bucket, e, which) {
    const L = HaulCore.fixLabel(bucket);
    const kind = which === "yes" ? L.yesKind : L.noKind;
    const on = e.fix === kind;
    return `<button class="rv-fix" type="button" data-fix="${kind}" data-key="${esc(e.key)}" aria-pressed="${on}">${L[which]}</button>`;
  }
  /* chips: false = none, true = both, "no" = the opt-out chip only. */
  function reviewRow(bucket, e, sub, chips) {
    const qty = e.qty > 1 ? ` ×${e.qty}` : "";
    const cs = chips === "no" ? fixChip(bucket, e, "no")
      : chips ? fixChip(bucket, e, "yes") + fixChip(bucket, e, "no") : "";
    return `<div class="rv-line"><div class="grow"><span class="name">${esc(e.name)}${qty}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>
      ${cs ? `<div class="rv-chips">${cs}</div>` : ""}</div>`;
  }
  function reviewHtml(sess, d) {
    const r = d.review;
    let h = `<h2 class="largetitle" style="font-size:28px">Check your receipt</h2>
      <p class="muted">Arya read ${plural(r.read, "line")}. Fix anything that looks off.</p>
      <p class="muted">Arya matches by name. These are suggestions. You decide.</p>`;
    if (r.matched.length) {
      h += `<h3 class="sect">Matched (${r.matched.length})</h3><div class="group">${r.matched.map(e => reviewRow("matched", e, "", false)).join("")}</div>`;
    }
    if (r.swapped.length) {
      h += `<h3 class="sect">Swapped (${r.swapped.length})</h3><div class="group">${r.swapped.map(e =>
        reviewRow("swapped", e, e.suggested ? `Looks like a swap for ${esc(e.from)}. Is it? It stays in your haul either way.` : `Instead of ${esc(e.from)}`, e.suggested)).join("")}</div>`;
    }
    if (r.on_receipt_only.length) {
      h += `<h3 class="sect">On receipt, not on your list (${r.on_receipt_only.length})</h3><div class="group">${r.on_receipt_only.map(e =>
        reviewRow("on_receipt_only", e, "", true)).join("")}</div>`;
    }
    if (r.grabbed_only.length) {
      // A grab with no receipt line stays in the haul. Leaving it out
      // is the shopper's choice, never the default.
      const n = r.grabbed_only.length;
      h += `<h3 class="sect">Grabbed, not on receipt (${n})</h3>
        <p class="muted">${n === 1 ? "1 grabbed item is" : n + " grabbed items are"} not on the receipt. They stay in your haul.</p>
        <p class="muted">Paid another way? Keep it. Tap Remove from haul to leave one out.</p>
        <div class="group">${r.grabbed_only.map(e => reviewRow("grabbed_only", e,
          e.fix === "grabbed_drop" ? "Left out of your haul" : "In your haul", "no")).join("")}</div>`;
    }
    h += `<p class="rv-more"><label class="rv-addrcpt" for="rv-more">+ Add another receipt</label>
      <input type="file" id="rv-more" accept="application/pdf,image/*" aria-label="Another receipt" hidden></p>
      <p class="muted rv-more-note">Paid in two parts? Add the other receipt.</p>
      <p id="rv-status" class="muted"></p>
      <p><button class="btn primary wide" type="button" data-act="looks-right">Looks right</button></p>`;
    return h;
  }
  async function openReview(sess, data) {
    ensureViews();
    Q.current = sess;
    enter("view-rreview");
    const d = data || await fetchHaul(sess);
    q("#rv-review").innerHTML = reviewHtml(sess, d);
  }
  const FIX_TOAST = {
    extra_add: n => `${n} added to your haul.`, extra_drop: n => `${n} left out.`,
    grabbed_keep: n => `${n} kept.`, grabbed_drop: n => `${n} removed from your haul.`,
    swap_ok: () => "Swap noted.", swap_no: () => "Not a swap."
  };
  function findEntry(d, key) {
    for (const b of ["swapped", "on_receipt_only", "grabbed_only"]) {
      const e = d.review[b].find(x => x.key === key);
      if (e) return { bucket: b, entry: e };
    }
    return null;
  }
  async function applyFix(sess, kind, key, quiet) {
    const d = await post(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/fix`, { kind, key });
    H.cache[sess.id] = d;
    q("#rv-review").innerHTML = reviewHtml(sess, d);
    return d;
  }
  async function onReviewClick(ev) {
    const sess = Q.current;
    if (!sess) return;
    if (ev.target.closest('[data-act="looks-right"]')) { next(sess); return; }
    const chip = ev.target.closest("[data-fix]");
    if (!chip) return;
    const d = H.cache[sess.id];
    const found = d && findEntry(d, chip.dataset.key);
    if (!found) return;
    const L = HaulCore.fixLabel(found.bucket);
    const before = found.entry.fix;
    const kind = chip.dataset.fix;
    // Tapping the chosen chip again takes the choice back.
    const send = before === kind ? L.none : kind;
    try {
      await applyFix(sess, send, chip.dataset.key);
      // A raw receipt line ('KS ORG BNNA 3LB') makes no sticker: it
      // could not be taken back from here. It still joins the haul.
      if (send === "extra_add" && window.albumHaul && found.entry.decoded) {
        post("/api/quest/stickers", { name: found.entry.name, session: sess.id, store: sess.store }).catch(() => {});
        delete H.stk[sess.id];
      }
      const undoKind = before || L.none;
      toast(send === L.none ? "Choice taken back." : FIX_TOAST[send](found.entry.name), {
        action: "Undo",
        onAction: () => applyFix(sess, undoKind, chip.dataset.key).catch(showErr)
      });
    } catch (e) { toast(e.message); }
  }
  async function onReviewChange(ev) {
    if (ev.target.id !== "rv-more") return;
    const f = ev.target.files[0];
    const sess = Q.current;
    if (!f || !sess) return;
    const status = q("#rv-status");
    status.textContent = "Reading the receipt. This can take up to a minute.";
    try {
      const rid = await decodeAny(f);
      const d = await post(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/receipts`, { receipt_id: rid });
      H.cache[sess.id] = d;
      q("#rv-review").innerHTML = reviewHtml(sess, d);
      toast("Second receipt added.");
    } catch (e) {
      status.textContent = "";
      toast("Could not add that receipt: " + e.message);
    }
    ev.target.value = "";
  }

  /* ---------- the reveal ---------- */
  function revealRows(d, status) {
    const p = d.points;
    let rows = `<div class="rv-row"><span>Items</span><b>+${p.items}</b></div>`;
    if (p.full_haul) rows += `<div class="rv-row"><span>Full haul</span><b>+${p.full_haul}</b></div>`;
    if (d.boss) {
      rows += status === "found"
        ? `<div class="rv-row"><span>Boss item</span><b>+${p.boss}</b></div>`
        : `<div class="rv-row rv-grey"><span>Boss item: next time</span><b></b></div>`;
    }
    rows += d.settled
      ? `<div class="rv-row"><span>Receipt</span><b>+${p.receipt}</b></div>`
      : `<div class="rv-row rv-grey"><span>Receipt waiting. Add it any time. It never expires.</span><b>+${p.receipt}</b></div>`;
    rows += privateRows(d.private);
    return rows;
  }
  function privateRows(pv) {
    return HaulCore.privateLines(pv, money).map(r =>
      `<div class="rv-row rv-private"><span>${r.label}</span><span class="rv-priv-n">${r.text}</span></div>`).join("");
  }
  function bossStatus(sess, d) {
    if (typeof qBossStatus === "function") {
      try { return qBossStatus(sess); } catch (e) { /* fall through */ }
    }
    return d.boss ? (d.boss.found ? "found" : "open") : "none";
  }
  async function openReveal(sess) {
    ensureViews();
    Q.current = sess;
    enter("view-reveal");
    const box = q("#rv-reveal");
    box.innerHTML = `<div class="group">${empty("Opening your haul…")}</div>`;
    let d;
    try { d = await fetchHaul(sess); } catch (e) { return openScore(sess); }
    await faceReady();
    const { stickers, fresh } = await stickersFor(sess);
    const items = d.items;
    const isNew = it => fresh.has(String(it.name).toLowerCase());
    const allNew = items.length > 0 && items.every(isNew);
    const status = bossStatus(sess, d);
    const target = d.settled ? d.points.total : d.points.total - d.points.receipt;
    const title = allNew ? `Your first ${items.length === 1 ? "sticker" : items.length + " stickers"}` : "Your haul";
    const tiles = items.map((it, i) => {
      const boss = it.boss && status === "found";
      const badge = !allNew && isNew(it) ? `<span class="rv-new">NEW</span>` : "";
      return `<div class="rv-tile${boss ? " rv-boss" : ""}" style="transition-delay:${i * 160}ms">
        <img src="${esc(tileSrc(stickers, it))}" alt="${esc(it.name)}" data-fallback="${esc(artSrc("basket.webp"))}">${badge}</div>`;
    }).join("");
    box.innerHTML = `<div class="rv-head"><h2 class="largetitle" style="font-size:28px">${esc(title)}</h2>
      <p class="muted nomargin">${plural(items.length, "sticker")} from this trip. Tap anywhere to skip.</p></div>
      <div class="rv-loot" id="rv-loot">${tiles}</div>
      <p class="rv-pts" id="rv-pts" data-target="${target}" aria-hidden="true">0</p>
      <p class="rv-sr" id="rv-pts-sr" role="status" aria-live="polite"></p>
      <p class="muted rv-ptsub">${d.settled ? "Points banked." : "Points. They bank when you add the receipt."}</p>
      <div class="group rv-lines">${revealRows(d, status)}</div>
      <p><button class="btn primary wide" type="button" data-act="card">Make my haul card</button></p>
      ${canReview(sess, d) ? `<p><button class="btn wide" type="button" data-act="review">Check your receipt</button></p>` : ""}
      ${d.settled ? "" : `<p><button class="btn wide" type="button" data-act="addreceipt">Add receipt now</button></p>`}
      <p class="rv-sum"><button class="rv-link" type="button" data-act="summary">Trip summary</button></p>`;
    // A missing sticker falls back to the basket art. A listener, not
    // an inline onerror: the CSP refuses inline script.
    box.querySelectorAll("img[data-fallback]").forEach(img =>
      img.addEventListener("error", () => { img.src = img.dataset.fallback; }, { once: true }));
    play(sess, d, target);
  }
  function setNumber(n) { const el = q("#rv-pts"); if (el) el.textContent = String(n); }
  /* Screen readers hear the total once, when the count ends. */
  function announce(n) { const el = q("#rv-pts-sr"); if (el) el.textContent = `${n} points`; }
  /* A receipt that Arya read at least one line of can be checked
   * again, any time, from the Score screen or the Reveal. */
  function canReview(sess, d) {
    return !!(sess && sess.receipt_id && d && d.review && d.review.read > 0);
  }
  function showAll() {
    document.querySelectorAll("#rv-loot .rv-tile").forEach(t => { t.style.transitionDelay = "0ms"; t.classList.add("in"); });
  }
  function play(sess, d, target) {
    if (H.raf) cancelAnimationFrame(H.raf);
    H.raf = null;
    const n = d.items.length;
    if (reduced()) { showAll(); setNumber(target); announce(target); levelBurst(sess, d); return; }
    requestAnimationFrame(() => document.querySelectorAll("#rv-loot .rv-tile").forEach(t => t.classList.add("in")));
    const dur = Math.max(900, n * 160 + 500), t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      setNumber(HaulCore.countStep(0, target, k));
      if (k < 1) H.raf = requestAnimationFrame(step);
      else { H.raf = null; announce(target); levelBurst(sess, d); }
    };
    H.raf = requestAnimationFrame(step);
  }
  function skipReveal() {
    if (H.raf) { cancelAnimationFrame(H.raf); H.raf = null; }
    const el = q("#rv-pts");
    if (!el) return;
    const fin = HaulCore.revealFinal(Number(el.dataset.target || 0), document.querySelectorAll("#rv-loot .rv-tile").length);
    showAll();
    setNumber(fin.value);
    announce(fin.value);
    const sess = Q.current, d = sess && H.cache[sess.id];
    if (sess && d) levelBurst(sess, d);
  }
  /* A level crossed on this trip gets one burst. Sound and buzz stay
   * opt-in inside qTone and qBuzz; the confetti respects reduced motion. */
  async function levelBurst(sess, d) {
    if (!d.settled || H.burst.has(sess.id)) return;
    H.burst.add(sess.id);
    const p = await loadProfile();
    if (!p || !p.level) return;
    try {
      // The same memory the Score screen uses: a level the phone has
      // not seen yet gets its burst, once. A replay never repeats it.
      const seen = Number(localStorage.getItem("arya-level") || 0);
      localStorage.setItem("arya-level", String(p.level));
      if (!(seen && p.level > seen)) return;
      if (typeof qShowMilestone === "function") qShowMilestone(`Level up! Level ${p.level}`);
      if (typeof qConfetti === "function") qConfetti();
      if (typeof qTone === "function") qTone([523, 784, 1047, 1319], 0.1);
    } catch (e) { /* a missing opt-in effect never blocks the reveal */ }
  }
  function onRevealClick(ev) {
    const sess = Q.current;
    const btn = ev.target.closest("button, a, label, input");
    if (!btn) { skipReveal(); return; }
    const act = btn.dataset && btn.dataset.act;
    if (!sess) return;
    if (act === "card") openCard(sess);
    else if (act === "summary") openScore(sess);
    else if (act === "review") openReview(sess).catch(() => openScore(sess));
    else if (act === "addreceipt") {
      openAddReceipt(sess.id, sess.store, s => { Object.assign(sess, s); afterFinish(sess); }, { goesToHaul: true });
    }
  }

  /* ---------- the haul card ---------- */
  function hiddenKeys(d) { return new Set(d.items.filter(i => i.hidden).map(i => i.key)); }
  async function newCount(sess, d) {
    const { fresh } = await stickersFor(sess);
    return d.items.filter(i => !i.hidden && fresh.has(String(i.name).toLowerCase())).length;
  }
  function flatHtml(d) {
    return d.items.map(i => `<button type="button" class="hl-st${i.hidden ? " hid" : ""}" data-hide="${esc(i.key)}" aria-pressed="${i.hidden}"
      aria-label="${i.hidden ? "Show" : "Hide"} ${esc(i.name)} ${i.hidden ? "in" : "from"} this post"><img src="${artSrc(art(i.name))}" alt=""></button>`).join("");
  }
  async function openCard(sess) {
    ensureViews();
    Q.current = sess;
    enter("view-haul");
    q("#hl-card-body").innerHTML = `<div class="group">${empty("Making your card…")}</div>`;
    try { await fetchHaul(sess); await faceReady(); await loadProfile(); } catch (e) { return openScore(sess); }
    await paintCard(sess);
  }
  async function paintCard(sess) {
    const d = H.cache[sess.id];
    if (!d) return;
    const fresh = await newCount(sess, d);
    d.stats.new = fresh;
    const shown = d.items.filter(i => !i.hidden).length;
    const p = H.profile || {};
    const posted = d.post && d.post.posted;
    const reacts = posted && d.post.reactions ? d.post.reactions : null;
    q("#hl-card-body").innerHTML = `
      <h2 class="largetitle" style="font-size:28px">Your haul card</h2>
      <div class="hl-card">
        <div class="hl-top"><span class="hl-chip">Named by Arya</span>
          ${posted ? `<button type="button" class="rv-link" data-act="delpost">Delete post</button>` : ""}</div>
        <h3 class="hl-name">${esc(d.name)}</h3>
        <div class="hl-flat" id="hl-flat">${flatHtml(d)}</div>
        <p class="hl-hint">Tap a sticker to hide it from the post.</p>
        <div class="hl-stats"><div><b>${shown}</b><span>items</span></div><div><b>${fresh}</b><span>new finds</span></div><div><b>${d.stats.level}</b><span>level</span></div></div>
        ${d.boss && d.boss.found ? `<p class="hl-bosschip"><span class="hl-chip">Boss item</span></p>` : ""}
        <p class="hl-foot">${p.handle ? "@" + esc(p.handle) + " · " : ""}Level ${d.stats.level} · no prices</p>
      </div>
      <div class="hl-actions">
        <button class="btn" type="button" data-act="save">Save as image</button>
        <button class="btn primary" type="button" data-act="post">${posted ? "Update post" : "Post to Crew"}</button>
      </div>
      <p class="muted">${posted
        ? "Posted to your Crew. Hide or show a sticker and the post updates."
        : "Nothing posts until you tap Post to Crew."}${reacts && (reacts.yum + reacts.me_too + reacts.teach_me)
        ? ` Reactions: ${reacts.yum} Yum, ${reacts.me_too} Me too, ${reacts.teach_me} Teach me.` : ""}</p>
      <p><button class="btn secondary wide" type="button" data-act="done">Done</button></p>`;
  }
  async function toggleHide(sess, key, hidden) {
    const d = await post(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/hide`, { key, hidden });
    H.cache[sess.id] = d;
    if (d.post && d.post.taken_down) toast("Post taken down. Nothing is left to show.");
    return d;
  }
  async function onCardClick(ev) {
    const sess = Q.current;
    if (!sess) return;
    const hide = ev.target.closest("[data-hide]");
    if (hide) {
      const d = H.cache[sess.id];
      const keys = HaulCore.toggleHidden(hiddenKeys(d), hide.dataset.hide);
      try {
        await toggleHide(sess, hide.dataset.hide, keys.has(hide.dataset.hide));
        await paintCard(sess);
      } catch (e) { toast(e.message); }
      return;
    }
    const act = ev.target.closest("[data-act]");
    if (!act) return;
    if (act.dataset.act === "save") ShareUI.open("haul", Object.assign(shareCtx(sess), { newBadge: Q.newBadge || null }));
    else if (act.dataset.act === "post") openPostSheet(sess);
    else if (act.dataset.act === "delpost") unpost(sess, false);
    else if (act.dataset.act === "done") openScore(sess);
  }
  async function unpost(sess, quiet) {
    try {
      const d = await api(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/post`, { method: "DELETE" });
      H.cache[sess.id] = d;
      if (!quiet) toast("Post deleted.");
      await paintCard(sess);
    } catch (e) { toast(e.message); }
  }

  /* ---------- the post sheet ---------- */
  function closePostSheet() { const s = q("#hl-post-sheet"); if (s) s.hidden = true; }
  async function openPostSheet(sess) {
    const sheet = q("#hl-post-sheet");
    sheet.hidden = false;
    const body = q("#hl-post-body");
    body.innerHTML = empty("Checking your Crew…");
    let audience = [];
    try { audience = (await api("/api/quest/crew/audience")).audience || []; } catch (e) { audience = []; }
    paintPostSheet(sess, audience);
  }
  function paintPostSheet(sess, audience) {
    const d = H.cache[sess.id];
    const body = q("#hl-post-body");
    if (!audience.length) {
      body.innerHTML = `<p>You have no Crew yet.</p>
        <p class="muted">Add a friend by handle. Then you can post your haul to them.</p>
        <p><button class="btn primary wide" type="button" data-act="addfriend">Add a friend</button></p>`;
      return;
    }
    const left = d.items.filter(i => !i.hidden).length;
    body.dataset.audience = JSON.stringify(audience);
    body.innerHTML = `<p>Shared with Crew: ${esc(HaulCore.sheetAudienceText(audience))}. No prices, no store photos, no people.</p>
      <div class="hl-flat" id="hl-post-flat">${d.items.map(i => `<span class="hl-xwrap"><button type="button" class="hl-st${i.hidden ? " hid" : ""}" data-hide="${esc(i.key)}" aria-pressed="${i.hidden}"
        aria-label="${i.hidden ? "Show" : "Hide"} ${esc(i.name)} ${i.hidden ? "in" : "from"} this post"><img src="${artSrc(art(i.name))}" alt=""><span class="hl-x" aria-hidden="true">${i.hidden ? "+" : "×"}</span></button></span>`).join("")}</div>
      <p class="muted">Tap a sticker to hide it from this post. ${plural(left, "sticker")} will go out.</p>
      <p class="hl-btnrow"><button class="btn primary" type="button" data-act="postgo"${left ? "" : " disabled"}>Post</button>
      <button class="btn" type="button" data-act="postcancel">Cancel</button></p>`;
  }
  async function onPostSheetClick(ev) {
    const sess = Q.current;
    if (!sess) return;
    const hide = ev.target.closest("[data-hide]");
    const act = ev.target.closest("[data-act]");
    if (hide) {
      const d = H.cache[sess.id];
      const keys = HaulCore.toggleHidden(hiddenKeys(d), hide.dataset.hide);
      try {
        await toggleHide(sess, hide.dataset.hide, keys.has(hide.dataset.hide));
        paintPostSheet(sess, JSON.parse(q("#hl-post-body").dataset.audience || "[]"));
        paintCard(sess);
      } catch (e) { toast(e.message); }
      return;
    }
    if (!act) return;
    if (act.dataset.act === "addfriend") { closePostSheet(); questGo("view-friends"); }
    else if (act.dataset.act === "postcancel") closePostSheet();
    else if (act.dataset.act === "postgo") {
      act.disabled = true;
      try {
        const d = H.cache[sess.id];
        const payload = HaulCore.postPayload(d.items.map(i => ({ name: i.name, art: art(i.name) })));
        const res = await post(`/api/quest/sessions/${encodeURIComponent(sess.id)}/haul/post`, payload);
        H.cache[sess.id] = res;
        closePostSheet();
        await paintCard(sess);
        toast("Posted to your Crew", { action: "Undo", onAction: () => unpost(sess, true) });
      } catch (e) { act.disabled = false; toast(e.message); }
    }
  }

  /* ---------- the Score screen's haul row, and the share context ---------- */
  function scoreRow(sess, attached) {
    // The fetch warms the share card's context and, when the receipt
    // has readable lines, shows the Check your receipt button.
    fetchHaul(sess).then(d => {
      const b = q('.hl-score [data-hl="review"]');
      if (b) b.hidden = !canReview(sess, d);
    }).catch(() => {});
    const quest = sess.mode !== "express";
    const cached = H.cache[sess.id];
    const showReview = !!(cached && canReview(sess, cached));
    return `<div class="group pad hl-score">
      ${attached ? "" : `<p class="hl-wait"><b>Receipt bonus waiting.</b> It never expires. Add the receipt any time.</p>`}
      <div class="hl-btns">
        <button class="btn" type="button" data-hl="card">Make my haul card</button>
        ${sess.receipt_id ? `<button class="btn" type="button" data-hl="review"${showReview ? "" : " hidden"}>Check your receipt</button>` : ""}
        ${quest ? `<button class="btn" type="button" data-hl="replay">Replay the reveal</button>` : ""}
        ${window.renderAlbum && quest ? `<button class="btn" type="button" data-hl="album">See my album</button>` : ""}
      </div></div>`;
  }
  document.addEventListener("click", ev => {
    const b = ev.target.closest("[data-hl]");
    if (!b) return;
    const sess = Q.current;
    if (!sess) return;
    ensureViews();
    if (b.dataset.hl === "card") openCard(sess);
    else if (b.dataset.hl === "review") openReview(sess).catch(() => openScore(sess));
    else if (b.dataset.hl === "replay") openReveal(sess);
    else if (b.dataset.hl === "album") questGo("view-album");
  });
  /* The share card's context: hidden stickers, Arya's name for the
   * trip, the reviewed names and the numbers. It reads the last haul
   * view. Share your haul calls shareReady, which waits for that view;
   * the plain hunt (every checked item) is never the fallback for a
   * closed hunt, because it would show hidden and removed stickers. */
  async function shareReady(sess) {
    try {
      if (!H.cache[sess.id]) await fetchHaul(sess);
      await loadProfile();
    } catch (e) {
      toast("Could not load your haul. Check your connection. Then tap Share your haul once more.");
      return null;
    }
    return shareCtx(sess);
  }
  function shareCtx(sess) {
    const d = H.cache[sess.id];
    if (!d) return { sess };
    const hidden = hiddenKeys(d);
    return {
      sess, profile: H.profile || undefined, hidden, title: d.name,
      names: d.items.map(i => i.name),
      stats: { items: d.items.filter(i => !i.hidden).length, new: d.stats.new || 0, level: d.stats.level }
    };
  }

  /* ---------- the Crew feed ---------- */
  function closeSameSheet() { const s = q("#hl-same-sheet"); if (s) s.hidden = true; }
  function feedCard(p) {
    const sample = !!p.sample;
    const avatar = (p.items[0] && p.items[0].art) || "basket.webp";
    const queued = (H.queuedIds[p.post_id] || []).length > 0;
    const sameBtn = sample && !isDemo
      ? `<button class="hl-react hl-same" type="button" disabled>Example only</button>`
      : `<button class="hl-react hl-same" type="button" data-same="${esc(p.post_id)}" aria-pressed="${queued}">${queued ? "In next hunt · Undo" : "Same haul"}</button>`;
    return `<div class="hl-fcard" data-post="${esc(p.post_id)}" data-author="${esc(p.author)}">
      <div class="hl-fhead"><img class="hl-av" src="${artSrc(avatar)}" alt="">
        <div class="grow"><b>@${esc(p.author)}</b>${sample ? `<span class="samplepill">Sample</span>` : ""}
        <span class="sub">${esc(p.name)} · ${plural(p.items.length, "item")}</span></div></div>
      <div class="hl-fflat">${p.items.map(i => `<img src="${artSrc(i.art || "basket.webp")}" alt="${esc(i.name)}">`).join("")}</div>
      <div class="hl-reacts">${REACTIONS.map(([k, label, file]) =>
        `<button class="hl-react" type="button" data-react="${k}" aria-pressed="${p.my_reaction === k}"><img src="${artSrc(file)}" alt=""><span>${label}</span></button>`).join("")}
        ${sameBtn}</div></div>`;
  }
  async function paintFeed() {
    const news = q("#comm-news");
    if (!news) return;
    if (!q("#comm-hauls")) {
      const head = news.previousElementSibling;
      (head && head.classList.contains("sect") ? head : news).insertAdjacentHTML("beforebegin",
        `<h3 class="sect">Crew hauls</h3><div id="comm-hauls" class="group"></div>`);
      q("#comm-hauls").addEventListener("click", onFeedClick);
    }
    ensureViews();
    await faceReady();
    let feed = [], queued = [];
    try { feed = (await api("/api/quest/crew/feed")).feed || []; } catch (e) { feed = []; }
    try { queued = (await api("/api/quest/queued")).queued || []; } catch (e) { queued = []; }
    H.queuedIds = {};
    queued.forEach(r => { (H.queuedIds[r.post_id] = H.queuedIds[r.post_id] || []).push(r.id); });
    const box = q("#comm-hauls");
    H.feed = feed.length ? feed : [HaulCore.sampleHaul()];
    box.innerHTML = H.feed.map(feedCard).join("");
  }
  async function onFeedClick(ev) {
    const card = ev.target.closest(".hl-fcard");
    if (!card) return;
    const post_id = card.dataset.post, author = card.dataset.author;
    const p = (H.feed || []).find(x => x.post_id === post_id);
    if (!p) return;
    const rx = ev.target.closest("[data-react]");
    if (rx) {
      const kind = p.my_reaction === rx.dataset.react ? "none" : rx.dataset.react;
      try {
        if (!p.sample) await post(`/api/quest/crew/posts/${encodeURIComponent(author)}/${encodeURIComponent(post_id)}/react`, { kind });
        p.my_reaction = kind === "none" ? null : kind;
        card.outerHTML = feedCard(p);
      } catch (e) { toast(e.message); }
      return;
    }
    const same = ev.target.closest("[data-same]");
    if (!same) return;
    if ((H.queuedIds[post_id] || []).length) {
      try {
        for (const id of H.queuedIds[post_id]) await api(`/api/quest/queued/${encodeURIComponent(id)}`, { method: "DELETE" });
        H.queuedIds[post_id] = [];
        card.outerHTML = feedCard(p);
        toast("Taken out of your next hunt.");
      } catch (e) { toast(e.message); }
      return;
    }
    openSameSheet(p);
  }
  async function openSameSheet(p) {
    const sheet = q("#hl-same-sheet");
    sheet.hidden = false;
    const body = q("#hl-same-body");
    body.innerHTML = empty("Checking your list…");
    let listNames = [], queuedNames = [];
    try { listNames = ((await api("/api/quest/plan")).list || []).map(i => i.name); } catch (e) { listNames = []; }
    try { queuedNames = ((await api("/api/quest/queued")).queued || []).map(r => r.name); } catch (e) { queuedNames = []; }
    const rows = HaulCore.queuePick(p.items, listNames, queuedNames);
    H.same = { post: p, rows };
    body.innerHTML = `<p class="muted">Pick what you want in your next hunt. Items on your list start unticked.</p>
      <div class="group">${rows.map((r, i) => `<label class="hl-pick"><input type="checkbox" data-row="${i}"${r.checked ? " checked" : ""}>
        <span class="grow"><span class="name">${esc(r.name)}</span>${r.note ? `<span class="sub">${esc(r.note)}</span>` : ""}</span></label>`).join("")}</div>
      <p><button class="btn primary wide" type="button" data-act="samego"></button></p>`;
    syncSameBtn();
  }
  function syncSameBtn() {
    const n = (H.same ? H.same.rows : []).filter(r => r.checked).length;
    const b = q('#hl-same-body [data-act="samego"]');
    if (!b) return;
    b.textContent = `Add ${n} to your next hunt`;
    b.disabled = n === 0;
  }
  function onSameChange(ev) {
    const i = ev.target.dataset && ev.target.dataset.row;
    if (i === undefined || !H.same) return;
    H.same.rows[Number(i)].checked = ev.target.checked;
    syncSameBtn();
  }
  async function onSameSheetClick(ev) {
    const go = ev.target.closest('[data-act="samego"]');
    if (!go || !H.same) return;
    const { post: p, rows } = H.same;
    const names = rows.filter(r => r.checked).map(r => r.name);
    go.disabled = true;
    try {
      const res = await post("/api/quest/queued", { from: p.author, post_id: p.post_id, names });
      const mine = (res.queued || []).filter(r => r.post_id === p.post_id);
      H.queuedIds[p.post_id] = mine.map(r => r.id);
      closeSameSheet();
      const card = q(`.hl-fcard[data-post="${CSS.escape(p.post_id)}"]`);
      if (card) card.outerHTML = feedCard(p);
      toast(HaulCore.sameToast(HaulCore.queuedCount(res.queued, p.post_id), names.length));
    } catch (e) { go.disabled = false; toast(e.message); }
  }

  wireFinish();
  document.addEventListener("DOMContentLoaded", wireFinish);
  return { afterFinish, openReview, openReveal, openCard, scoreRow, shareCtx, shareReady, paintFeed, decodeAny, wireFinish };
})();
window.HaulUI = HaulUI;
