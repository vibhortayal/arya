/* Ask Arya from where you already are (owner, 2026-10-29): the List's
 * one field and mic, and the hunt's Ask bar. One engine, the same
 * /api/chat the Ask tab uses, called with a surface so that:
 *  - adds apply at once and the card offers Undo;
 *  - riskier changes (out, expired, never, snooze) come back as a
 *    proposal that waits for a Yes;
 *  - a question just gets its answer.
 * The answer renders as a small card in `box`; nothing leaves the
 * screen you are on. */

const AryaAsk = (function () {
  /* A typed line that reads as a question or a command to Arya, not an
   * item. "add X to <list>" is handled without a model call (see
   * parseAddToList). */
  const ASK_LEAD = /^(i'?m out|i am out|we'?re out|we are out|out of |we finished|we ran out|we need to know|when |what |where |how |is |are |do |does |can |should |which |why |who |tell me|remind me)/i;
  function looksLikeAsk(t) {
    t = String(t || "").trim();
    return !!t && (/\?$/.test(t) || ASK_LEAD.test(t));
  }

  /* "add naan to Indian Store" -> {items: "naan", list} when the last
   * words name one of the household's lists. */
  function parseAddToList(t, lists) {
    const m = String(t || "").trim().match(/^add\s+(.+?)\s+to\s+(?:my\s+|the\s+)?(.+?)\s*$/i);
    if (!m) return null;
    const list = (lists || []).find(l => l.name.toLowerCase() === m[2].toLowerCase());
    return list ? { items: m[1], list } : null;
  }

  function card(box, q, body, buttons) {
    box.innerHTML = `<div class="group pad answercard" role="status">
      <p class="muted nomargin" style="font-size:14px">${esc(q)}</p>
      <p style="margin:4px 0 0">${body}</p>
      ${buttons ? `<div class="sheetacts">${buttons}</div>` : ""}</div>`;
  }
  const clear = box => { box.innerHTML = ""; };

  /* Show an outcome. res = {reply, applied, skipped, added, proposed}. */
  function show(box, q, res, onChange) {
    const added = res.added || [], proposed = res.proposed || [];
    const said = esc(res.reply || (res.applied || []).join(" ") || "Done.");
    const skipped = (res.skipped || []).map(s => `<span class="sub">${esc(s)}</span>`).join("");
    if (proposed.length) {
      const ask = proposed.map(p => esc(p.text)).join(" ");
      // The model's own sentence is left out here: it may read as done
      // when nothing has changed yet.
      card(box, q, `${skipped}<strong>${ask}</strong>`,
        `<button class="btn secondary" type="button" data-aa="no">Not now</button>
         <button class="btn primary" type="button" data-aa="yes">${proposed.length > 1 ? "Yes, do these" : "Yes, do it"}</button>`);
      box.onclick = async ev => {
        const b = ev.target.closest("[data-aa]");
        if (!b) return;
        if (b.dataset.aa === "no") { clear(box); return; }
        b.disabled = true;
        try {
          const r = await post("/api/chat/apply", { actions: proposed.map(p => p.action) });
          clear(box);
          toast((r.applied || []).join(" ") || "Done.");
          if (onChange) onChange();
        } catch (e) { toast(e.message); b.disabled = false; }
      };
    } else if (added.length) {
      card(box, q, `${said}${skipped}`,
        `<button class="btn secondary" type="button" data-aa="undo">Undo</button>
         <button class="btn primary" type="button" data-aa="done">Done</button>`);
      box.onclick = async ev => {
        const b = ev.target.closest("[data-aa]");
        if (!b) return;
        if (b.dataset.aa === "done") { clear(box); return; }
        b.disabled = true;
        try {
          for (const a of added) await post("/api/list/remove", { item_id: a.item_id });
          clear(box);
          toast("Undone.");
          if (onChange) onChange();
        } catch (e) { toast(e.message); b.disabled = false; }
      };
    } else {
      card(box, q, `${said}${skipped}`, `<button class="btn secondary" type="button" data-aa="done">Got it</button>`);
      box.onclick = ev => { if (ev.target.closest("[data-aa]")) clear(box); };
    }
  }

  /* Ask Arya. opts: {box, surface, context, onChange}. Resolves true
   * when an answer was shown, false when it failed (the caller may
   * fall back, e.g. keep dictated text in the field). */
  async function run(text, opts) {
    const box = opts.box;
    card(box, text, "Arya is thinking…", "");
    box.onclick = null;
    try {
      const res = await post("/api/chat", {
        messages: [{ role: "user", content: text }],
        surface: opts.surface || "list", context: opts.context || {} });
      show(box, text, res, opts.onChange);
      if (opts.onChange && ((res.added || []).length || (res.applied || []).length)) opts.onChange(res);
      return true;
    } catch (e) {
      clear(box);
      toast(e.message);
      return false;
    }
  }

  /* The deterministic "add naan to Indian Store": no model call. */
  async function addToList(box, q, parsed, onChange) {
    const r = await post("/api/list/from-text", { text: parsed.items, list_id: parsed.list.id });
    const ids = (r.item_ids || []).map(item_id => ({ item_id }));
    const names = (r.names || []).join(", ");
    show(box, q, {
      reply: r.names && r.names.length ? `Added ${names} to ${parsed.list.name}.` : `That is already on ${parsed.list.name}.`,
      added: ids }, onChange);
    if (onChange) onChange(r);
  }

  return { looksLikeAsk, parseAddToList, run, addToList, show, clear };
})();
