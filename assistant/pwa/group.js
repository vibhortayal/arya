"use strict";
/* Groups (owner, 2026-10-29; wireframe approved the same day). People
 * who shop for one home share one set of lists and see each other's
 * receipts. Profile holds the Group section (start, invite, members,
 * leave), Join a group is its own screen, and the Lists cards say who
 * changed what. Leaving copies the lists; receipts go with whoever
 * filed them. Off unless the server says enabled (flag ARYA_GROUPS).
 * Wireframe: https://claude.ai/artifact/1A8XKyKMozsUVxLNg88ADc */
(function () {
  let G = { enabled: false, group: null, recent: {} };
  let loadedAt = 0;
  let sheet = null, trigger = null;
  let previewFor = "";

  async function load(force) {
    if (!force && Date.now() - loadedAt < 15000) return G;
    try { G = await api("/api/group"); } catch (e) { G = { enabled: false, group: null, recent: {} }; }
    G.recent = G.recent || {};
    loadedAt = Date.now();
    return G;
  }
  function others() { return G.group ? G.group.members.filter(m => !m.me) : []; }
  function cap(h) { return h ? h.charAt(0).toUpperCase() + h.slice(1) : ""; }
  function initial(h) { return esc((h || "?").charAt(0).toUpperCase()); }
  function myAvatar() {
    const img = $("#avatar-img");
    return img && !img.hidden && img.src ? img.src : "";
  }
  function face(m) {
    const src = m.me ? myAvatar() : "";
    return src ? `<span class="gm"><img src="${esc(src)}" alt=""></span>`
      : `<span class="gm${m.me ? "" : " other"}">${initial(m.handle)}</span>`;
  }
  function ago(sec) {
    const s = Math.max(0, Math.round(Date.now() / 1000 - sec));
    if (s < 90) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return Math.round(s / 86400) === 1 ? "yesterday" : `${Math.round(s / 86400)} days ago`;
  }
  function joinedOn(sec) {
    const d = new Date(sec * 1000);
    return `Joined ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  function fmtCode(c) { return c.length === 6 ? c.slice(0, 3) + " " + c.slice(3) : c; }
  function cleanCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  /* ---------- the one sheet ---------- */
  function ensureSheet() {
    if (sheet) return sheet;
    sheet = document.createElement("div");
    sheet.className = "sheetwrap";
    sheet.id = "group-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "gs-title");
    sheet.hidden = true;
    sheet.innerHTML = `<div class="sheet" id="gs-body"></div>`;
    document.body.appendChild(sheet);
    sheet.addEventListener("click", ev => {
      if (ev.target === sheet || ev.target.closest("[data-gs-close]")) closeSheet();
    });
    sheet.addEventListener("keydown", ev => { ev.stopPropagation(); if (ev.key === "Escape") closeSheet(); });
    return sheet;
  }
  function openSheet(html) {
    ensureSheet();
    if (sheet.hidden) trigger = document.activeElement;
    $("#gs-body").innerHTML = `<span class="sheetgrip"></span>${html}`;
    sheet.hidden = false;
    const first = $("#gs-body").querySelector("[data-first]") || $("#gs-body").querySelector("input, button");
    if (first && first.focus) first.focus();
  }
  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    $("#gs-body").innerHTML = "";
    if (trigger && trigger.isConnected && trigger.focus) trigger.focus();
    trigger = null;
  }
  function head(title, close) {
    return `<div class="sheethead"><h3 class="nomargin" id="gs-title">${esc(title)}</h3><button class="linkbtn" type="button" data-gs-close>${close || "Close"}</button></div>`;
  }

  /* ---------- Profile: the Group section ---------- */
  async function paintProfile() {
    const el = $("#pf-group");
    if (!el) return;
    await load(true);
    el.hidden = !G.enabled;
    if (!G.enabled) { el.innerHTML = ""; return; }
    const g = G.group;
    if (!g) {
      el.innerHTML = `<h3 class="sect">Group</h3><div class="group">
        <div class="row"><span class="grow"><span class="sub">Share lists and receipts with the people you shop for. Everyone sees the same lists; your profile and badges stay yours.</span></span></div>
        <button class="navrow" type="button" data-g="start"><span class="grow accenttext">Start a group<span class="sub">Name it, then invite people with a code</span></span><span class="chev">›</span></button>
        <button class="navrow" type="button" data-g="join"><span class="grow">Join with a code<span class="sub">Someone sent you an invite</span></span><span class="chev">›</span></button></div>`;
      return;
    }
    const n = g.members.length;
    el.innerHTML = `<h3 class="sect">Group</h3><div class="group">
      <button class="navrow" type="button" data-g="rename"><span class="grow"><span class="gname">${esc(g.name)}</span><span class="sub">${n} ${n === 1 ? "person" : "people"} · lists and receipts shared</span></span><span class="chev">${PEN_SVG}</span></button>
      ${g.members.map(m => {
        const role = m.me ? ` <span class="grole">· you${m.owner ? " · owner" : ""}</span>` : ` <span class="grole">· ${m.owner ? "owner" : "member"}</span>`;
        const tap = g.is_owner && !m.me;
        return `<${tap ? `button type="button" class="row gmember" data-g="member" data-handle="${esc(m.handle)}"` : `div class="row gmember"`}>${face(m)}<span class="grow"><span class="name">@${esc(m.handle)}${role}</span>${m.me ? "" : `<span class="sub">${joinedOn(m.joined)}</span>`}</span>${tap ? `<span class="chev">›</span>` : ""}</${tap ? "button" : "div"}>`;
      }).join("")}
      ${n < g.max_members ? `<button class="navrow" type="button" data-g="invite"><span class="grow accenttext">Invite someone<span class="sub">A code that works for 48 hours</span></span><span class="chev">›</span></button>` : ""}
      <button class="navrow" type="button" data-g="leave"><span class="grow dangertext">Leave group<span class="sub">You keep a copy of the lists and your own receipts</span></span><span class="chev">›</span></button></div>`;
  }

  async function act(kind, btn) {
    const g = G.group;
    if (kind === "start") {
      const me = (window.__aryaUser || "").split("@")[0];
      openSheet(`${head("Start a group", "Cancel")}
        <label class="field">Group name<input type="text" id="g-name" maxlength="40" value="${esc(me ? cap(me) + "'s home" : "Our home")}" autocomplete="off" data-first></label>
        <p class="muted small">Your lists become the group's lists. Next you can invite people with a code.</p>
        <div class="sheetacts"><button class="btn primary" type="button" id="g-create">Start group</button></div>`);
      $("#g-create").addEventListener("click", async () => {
        try {
          G = await post("/api/group", { name: $("#g-name").value });
          loadedAt = Date.now();
          closeSheet();
          refresh("view-profile");
          act("invite");
        } catch (e) { toast(e.message); }
      });
    } else if (kind === "join") {
      openJoin("");
    } else if (kind === "rename") {
      openSheet(`${head("Rename group", "Cancel")}
        <label class="field">Group name<input type="text" id="g-name" maxlength="40" value="${esc(g.name)}" autocomplete="off" data-first></label>
        <div class="sheetacts"><button class="btn primary" type="button" id="g-rename">Save</button></div>`);
      $("#g-rename").addEventListener("click", async () => {
        try {
          G = { ...G, ...(await post("/api/group/rename", { name: $("#g-name").value })) };
          closeSheet(); paintProfile();
        } catch (e) { toast(e.message); }
      });
    } else if (kind === "invite") {
      let r;
      try { r = await post("/api/group/invite", {}); } catch (e) { toast(e.message); return; }
      const link = `${location.origin}/?join=${r.code}`;
      openSheet(`${head("Invite to " + G.group.name)}
        <p class="muted nomargin gcenter">Send this code. It works for ${r.hours} hours.</p>
        <div class="gcode" aria-label="Invite code ${esc(r.code.split("").join(" "))}">${esc(fmtCode(r.code))}</div>
        <p class="muted small nomargin gcenter glink">or open ${esc(link.replace(/^https?:\/\//, ""))}</p>
        <div class="sheetacts"><button class="btn" type="button" id="g-copy">Copy code</button><button class="btn primary" type="button" id="g-share" data-first>Share link</button></div>
        <p class="muted small">Anyone with the code can join and see the group's lists and receipts. Make a new code any time and the old one stops working. Up to ${G.group.max_members} people.</p>
        <button class="linkbtn" type="button" id="g-newcode">Make a new code</button>`);
      $("#g-copy").addEventListener("click", () => copy(r.code, "Code copied."));
      $("#g-share").addEventListener("click", async () => {
        const text = `Join ${G.group.name} on Arya: code ${fmtCode(r.code)}`;
        if (navigator.share) {
          try { await navigator.share({ title: "Arya", text, url: link }); return; } catch (e) { if (e && e.name === "AbortError") return; }
        }
        copy(link, "Link copied.");
      });
      $("#g-newcode").addEventListener("click", () => act("invite"));
    } else if (kind === "member") {
      const h = btn.dataset.handle;
      openSheet(`${head("Remove @" + h + "?", "Cancel")}
        <p class="muted">They keep a copy of the lists and take their own receipts with them. The group's lists stay as they are.</p>
        <div class="sheetacts"><button class="btn" type="button" data-gs-close>Keep</button><button class="btn danger" type="button" id="g-remove">Remove</button></div>`);
      $("#g-remove").addEventListener("click", async () => {
        try {
          await post("/api/group/remove", { handle: h });
          toast(`@${h} is out of the group.`);
          closeSheet(); refresh("view-profile");
        } catch (e) { toast(e.message); }
      });
    } else if (kind === "leave") {
      let p;
      try { p = await api("/api/group/leave-preview"); } catch (e) { toast(e.message); return; }
      const nl = p.lists.length;
      const bul = (icon, title, sub) => `<div class="gbul"><span class="gico" aria-hidden="true">${icon}</span><span class="grow"><b>${title}</b>${sub ? `<span class="sub">${sub}</span>` : ""}</span></div>`;
      openSheet(`${head("Leave " + p.name + "?", "Cancel")}
        <div class="gbuls">
        ${bul("📋", nl ? `You keep a copy of ${nl === 1 ? "the list" : `all ${nl} lists`}` : "You keep a copy of everything on the list",
          `${nl ? esc(p.lists.join(", ")) + ". " : ""}The group keeps its own.`)}
        ${bul("🧾", `Your ${p.my_receipts} receipt${p.my_receipts === 1 ? "" : "s"} go${p.my_receipts === 1 ? "es" : ""} with you`,
          p.last_one ? "" : `The ${p.other_receipts} the others added stay with the group.`)}
        ${bul("🔄", "Running low, patterns and spend start over from your receipts", p.last_one ? "" : "Same for the group, from what is left.")}
        ${p.last_one ? bul("👋", "You are the last one", "The group closes. Your lists and receipts stay yours.")
          : p.next_owner ? bul("👑", `@${esc(p.next_owner)} becomes the owner`, "") : ""}
        </div>
        <div class="sheetacts"><button class="btn" type="button" data-gs-close>Stay</button><button class="btn danger" type="button" id="g-leave">Leave group</button></div>`);
      $("#g-leave").addEventListener("click", async () => {
        try {
          await post("/api/group/leave", {});
          closeSheet();
          toast(`You left ${p.name}. Your lists are a copy now.`);
          await load(true);
          if (typeof listData !== "undefined") listData = null;
          refresh("view-profile");
        } catch (e) { toast(e.message); }
      });
    }
  }

  function copy(text, done) {
    const fallback = () => toast(text);
    try {
      navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    } catch (e) { fallback(); }
  }

  /* ---------- Join a group ---------- */
  function openJoin(code) {
    const v = $("#view-group-join");
    if (!v) return;
    previewFor = "";
    $("#gj-code").value = code ? fmtCode(cleanCode(code)) : "";
    $("#gj-preview").innerHTML = "";
    $("#gj-go").disabled = true;
    show("view-group-join");
    if (code) preview(); else $("#gj-code").focus();
  }
  async function preview() {
    const c = cleanCode($("#gj-code").value);
    const out = $("#gj-preview");
    $("#gj-go").disabled = true;
    if (c.length !== 6) { previewFor = ""; out.innerHTML = ""; return; }
    if (c === previewFor) return;
    previewFor = c;
    let p;
    try { p = await api("/api/group/preview?code=" + encodeURIComponent(c)); }
    catch (e) { out.innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
    if (c !== cleanCode($("#gj-code").value)) return;
    const bul = (icon, title, sub) => `<div class="gbul"><span class="gico" aria-hidden="true">${icon}</span><span class="grow"><b>${title}</b>${sub ? `<span class="sub">${sub}</span>` : ""}</span></div>`;
    out.innerHTML = `<div class="group"><div class="row">${`<span class="gm other">${initial(p.name)}</span>`}<span class="grow"><span class="name gname">${esc(p.name)}</span><span class="sub">@${esc(p.invited_by)} invited you · ${p.people} ${p.people === 1 ? "person" : "people"} · ${p.lists} list${p.lists === 1 ? "" : "s"}</span></span></div></div>
      <h3 class="sect">What changes</h3>
      <div class="group pad">
        ${bul("📋", p.my_lists ? (p.my_lists === 1 ? "Your list joins the group" : `Your ${p.my_lists} lists join the group`) : "You share the group's lists", "Lists with the same name merge. Everyone can add and tick.")}
        ${bul("🧾", "Your receipts stay yours", "The group can see them while you are in it.")}
        ${bul("📈", "Running low and patterns use everyone's trips", "")}
        ${bul("🙂", "Profile, avatar, badges and reminders stay yours", "")}
      </div>`;
    $("#gj-go").textContent = `Join ${p.name}`;
    $("#gj-go").disabled = !!p.full;
    if (p.full) toast("That group is full.");
  }
  async function joinNow() {
    const c = cleanCode($("#gj-code").value);
    try {
      G = await post("/api/group/join", { code: c });
      loadedAt = Date.now();
      toast(`You joined ${G.group.name}. Your lists are shared now.`);
      if (typeof listData !== "undefined") listData = null;
      show("view-profile"); refresh("view-profile");
    } catch (e) { toast(e.message); previewFor = ""; }
  }

  /* ---------- Lists: who you share with, who changed what ---------- */
  function decorateLists() {
    const line = $("#list-line");
    if (!line) return;
    let el = $("#list-shared");
    const g = G.group, rest = others();
    if (!G.enabled || !g || !rest.length) {
      if (el) el.remove();
    } else {
      if (!el) {
        el = document.createElement("p");
        el.id = "list-shared";
        el.className = "gstack";
        line.parentNode.insertBefore(el, line);
      }
      const names = rest.map(m => cap(m.handle));
      const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
      el.innerHTML = g.members.slice(0, 4).map(face).join("") + `<span>${esc(g.name)} · shared with ${esc(who)}</span>`;
    }
    document.querySelectorAll("#list-cards .listcard").forEach(card => {
      const old = card.querySelector(".gact");
      if (old) old.remove();
      const id = card.dataset.openList === "else" ? "" : card.dataset.openList;
      const r = g && G.recent[id];
      if (!r) return;
      const span = document.createElement("span");
      span.className = "lc-store gact";
      span.innerHTML = `<b class="byp">${esc(cap(r.by))}</b> ${esc(r.action)} ${esc(r.name)} · ${ago(r.at)}`;
      const top = card.querySelector(".lc-top");
      top.parentNode.insertBefore(span, top.nextSibling);
    });
  }
  async function refreshLists() {
    const before = JSON.stringify([G.group && G.group.members.length, G.recent]);
    await load(false);
    if (JSON.stringify([G.group && G.group.members.length, G.recent]) !== before || $("#list-shared") === null) decorateLists();
  }

  /* ---------- wiring ---------- */
  document.addEventListener("click", ev => {
    const b = ev.target.closest("#pf-group [data-g]");
    if (b) act(b.dataset.g, b);
  });
  const code = $("#gj-code");
  if (code) {
    code.addEventListener("input", () => {
      const c = cleanCode(code.value).slice(0, 6);
      const shown = fmtCode(c);
      if (code.value !== shown && c.length === 6) code.value = shown;
      preview();
    });
    $("#gj-go").addEventListener("click", joinNow);
    $("#gj-back").addEventListener("click", ev => { ev.preventDefault(); show("view-profile"); refresh("view-profile"); });
  }
  /* The other phone sees a change when the list opens or the app comes
   * back to the front; there is no live sync in this version. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !G.group) return;
    const v = document.querySelector(".view:not([hidden])");
    if (v && (v.id === "view-list" || v.id === "view-home")) { loadedAt = 0; refresh(v.id); }
  });

  /* An invite link (/?join=CODE) opens Join a group once the app knows
   * who is signed in. */
  function pendingJoin() {
    try { return new URLSearchParams(location.search).get("join") || ""; } catch (e) { return ""; }
  }
  async function afterSignIn() {
    const c = pendingJoin();
    if (!c) return;
    await load(true);
    try { history.replaceState(null, "", location.pathname); } catch (e) { /* stays in the bar */ }
    if (!G.enabled) return;
    if (G.group) { toast(`You are already in ${G.group.name}. Leave it first to join another group.`); return; }
    openJoin(c);
  }

  window.aryaGroup = { paintProfile, decorateLists, refreshLists, afterSignIn, openJoin,
                       state: () => G };
})();
