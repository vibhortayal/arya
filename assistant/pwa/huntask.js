/* Ask Arya during a hunt (owner, 2026-10-29; wireframe v9): a pinned
 * bar at the bottom of the hunt, tap to open a sheet with three quick
 * questions and a field plus mic. Same engine as the List (AryaAsk,
 * surface "hunt"); the context names the store, the stop on screen and
 * what is left, so "this", "here" and "it" resolve. Nothing here tells
 * the crew an item is missing: that stays on "Not here?", which has its
 * own confirm. */

(function () {
  const bar = $("#hunt-askbar"), sheet = $("#ask-sheet"), body = $("#ask-body");
  if (!bar || !sheet) return;

  const QUICK = ["Where's the {item}?", "Is there a cheaper one?", "I can't find it"];

  function context() {
    const sess = typeof Q !== "undefined" ? Q.current : null;
    if (!sess) return {};
    const i = qCurrentIndex(sess), it = i >= 0 ? sess.items[i] : null;
    const left = sess.items.filter(x => !x.checked).map(x => x.name);
    const ctx = { hunt: sess.store, left: left.slice(0, 12) };
    if (it) {
      ctx.next_item = it.name;
      if (it.shelf_label) ctx.aisle = it.shelf_label;
    }
    return ctx;
  }

  function open() {
    const ctx = context();
    const quick = QUICK.map(q => q.replace("{item}", ctx.next_item || "next item"))
      .map(q => `<button class="chip" type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");
    body.innerHTML = `<span class="sheetgrip"></span>
      <h3 id="ask-title" class="largetitle" style="font-size:22px">Ask Arya</h3>
      <div class="chiprow">${quick}</div>
      <div class="addline"><input type="text" id="ask-text" placeholder="Ask anything…" autocomplete="off" enterkeyhint="send">
        <button id="ask-mic" class="iconbtn" type="button" aria-label="Ask by voice"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></svg></button>
        <button id="ask-go" class="btn primary" type="button">Ask</button></div>
      <p id="ask-status" class="muted nomargin"></p>
      <div id="ask-answer"></div>
      <div class="sheetacts"><button class="btn secondary" type="button" data-ask="close">Close</button></div>`;
    sheet.hidden = false;
    wireRecordButton($("#ask-mic"), $("#ask-status"), text => send(text));
    $("#ask-text").focus();
  }
  function close() { sheet.hidden = true; body.innerHTML = ""; }

  function send(text) {
    text = String(text || "").trim();
    if (!text) return;
    const f = $("#ask-text"); if (f) f.value = "";
    return AryaAsk.run(text, { box: $("#ask-answer"), surface: "hunt", context: context(),
      onChange: () => { if (typeof renderHunt === "function") renderHunt(); } });
  }

  bar.addEventListener("click", open);
  sheet.addEventListener("click", ev => {
    if (ev.target === sheet) { close(); return; }
    const q = ev.target.closest("[data-q]");
    if (q) { send(q.dataset.q); return; }
    if (ev.target.closest("[data-ask=close]")) close();
    else if (ev.target.id === "ask-go") send($("#ask-text").value);
  });
  sheet.addEventListener("keydown", ev => {
    if (ev.key === "Escape") close();
    else if (ev.key === "Enter" && ev.target.id === "ask-text") { ev.preventDefault(); send(ev.target.value); }
  });
})();
