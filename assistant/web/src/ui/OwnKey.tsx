import { useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useIsDemo } from "../app/session";
import { useTranslation } from "../i18n";
import { ApiError } from "../lib/api";
import { OPEN_OWN_KEY, getOwnKey, looksLikeMetaKey, removeOwnKey, saveOwnKey, takeOwnKeyRequest, type OwnKey } from "../lib/ownKey";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/* Settings › Account: "Your own Meta key" (owner-approved mockup,
 * 2026-11-01). Hidden in the demo and whenever the server says the
 * feature is not available (ARYA_BYOK off) or does not answer. The key
 * is never shown back: only "ends …1234". */
export function OwnKeyRow() {
  const { t } = useTranslation();
  const demo = useIsDemo();
  const { toast } = useToast();
  const [k, setK] = useState<OwnKey | null>(null);
  const [open, setOpen] = useState(false);
  const [safe, setSafe] = useState(false);
  const [mode, setMode] = useState<"add" | "manage">("add");
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = () => getOwnKey().then(setK).catch(() => setK(null));
  useEffect(() => { if (!demo) load(); }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  // Sent here by the daily-limit toast or Ask's card: open the sheet.
  useEffect(() => {
    const go = () => { if (k?.available && !demo && takeOwnKeyRequest()) start(); };
    go();
    window.addEventListener(OPEN_OWN_KEY, go);
    return () => window.removeEventListener(OPEN_OWN_KEY, go);
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  if (demo || !k?.available) return null;

  function start() {
    setErr(""); setDraft(""); setConfirm(false); setSafe(false);
    setMode(k?.set ? "manage" : "add");
    setOpen(true);
    document.getElementById("own-key-row")?.scrollIntoView?.({ block: "center" });
  }
  const close = () => { setOpen(false); setDraft(""); setErr(""); setConfirm(false); };
  const save = async () => {
    const v = draft.trim();
    if (!looksLikeMetaKey(v)) { setErr(t("ownKey.notMeta")); return; }
    setBusy(true); setErr("");
    try {
      const r = await saveOwnKey(v);
      setDraft("");
      setK({ available: true, set: true, ends: r.ends, status: "ok" });
      setMode("manage");
      toast(t("ownKey.saved", { ends: r.ends }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("ownKey.couldNotSave"));
    } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await removeOwnKey(); setK({ available: true, set: false, ends: null, status: null }); close(); toast(t("ownKey.removed")); }
    catch (e) { setErr(e instanceof ApiError ? e.message : t("ownKey.couldNotSave")); }
    finally { setBusy(false); }
  };

  const attention = k.set && k.status === "needs_attention";
  const ends = k.ends || "";
  return (
    <>
      <button className="navrow" id="own-key-row" type="button" onClick={start}>
        <span className="grow">{t("ownKey.title")}
          {k.set && <span className={"ok-badge " + (attention ? "warn" : "on")}>{t(attention ? "ownKey.badgeAttention" : "ownKey.badgeOn")}</span>}
          <span className="sub">{!k.set ? t("ownKey.subOff") : attention ? t("ownKey.subAttention") : t("ownKey.subOn", { ends })}</span></span>
        <span className="chev">›</span></button>
      <Sheet open={open && !safe} onClose={close} id="own-key-sheet" title={t("ownKey.sheetTitle")}>
        {mode === "manage" && k.set ? (
          <>
            {attention ? (
              <div className="ok-alert" role="alert"><b>{t("ownKey.attentionTitle", { ends })}</b>{t("ownKey.attentionBody")}</div>
            ) : (
              <div className="ok-card"><b>{t("ownKey.keyEnding")} <span className="ok-mono">…{ends}</span></b><span className="sub">{t("ownKey.working")}</span></div>
            )}
            {!attention && <p className="muted ok-p">{t("ownKey.onBody")} <a href="https://dev.meta.ai/usage" target="_blank" rel="noopener">{"dev.meta.ai/usage"}</a></p>}
            <button className={"btn wide" + (attention ? " primary" : "")} id="own-key-replace" type="button" onClick={() => { setMode("add"); setErr(""); }}>{t("ownKey.replace")}</button>
            {confirm ? (
              <div className="ok-confirm">
                <p>{t("ownKey.removeConfirm")}</p>
                <button className="btn danger wide" id="own-key-remove-yes" type="button" disabled={busy} onClick={remove}>{t("ownKey.removeYes")}</button>
                <button className="linkbtn" type="button" onClick={() => setConfirm(false)}>{t("common.cancel")}</button>
              </div>
            ) : (
              <button className="btn wide ok-danger" id="own-key-remove" type="button" onClick={() => setConfirm(true)}>{t("ownKey.remove")}</button>
            )}
            {err && <p className="ok-err" role="alert">{err}</p>}
            <p className="ok-small">{t(attention ? "ownKey.attentionHint" : "ownKey.removeHint")}</p>
          </>
        ) : (
          <>
            <p className="muted ok-p">{t("ownKey.intro")}</p>
            <p className="ok-h">{t("ownKey.beforeTitle")}</p>
            <ul className="ok-ul"><li>{t("ownKey.before1")}</li><li>{t("ownKey.before2")}</li><li>{t("ownKey.before3")}</li></ul>
            <label className="ok-h" htmlFor="own-key-input">{k.set ? t("ownKey.newKey") : t("ownKey.yourKey")}</label>
            <input id="own-key-input" className={"ok-input" + (err ? " bad" : "")} type="password" autoComplete="off" autoCapitalize="off"
              spellCheck={false} placeholder="LLM_…" value={draft} aria-invalid={!!err} aria-describedby={err ? "own-key-err" : undefined}
              onChange={e => { setDraft(e.target.value); if (err) setErr(""); }} onKeyDown={e => { if (e.key === "Enter") save(); }} />
            {err && <p className="ok-err" id="own-key-err" role="alert">{err}</p>}
            <button className="btn primary wide" id="own-key-save" type="button" disabled={busy || !draft.trim()} onClick={save}>
              {busy ? t("ownKey.checking") : t("ownKey.save")}</button>
            <p className="ok-small">{t("ownKey.testNote")}</p>
            <button className="linkbtn" id="own-key-safe" type="button" onClick={() => setSafe(true)}>{t("ownKey.safeLink")} ›</button>
            <p className="ok-small">{t("ownKey.terms")}</p>
          </>
        )}
      </Sheet>
      <Sheet open={open && safe} onClose={() => setSafe(false)} id="own-key-safe-sheet" title={t("ownKey.safeTitle")} closeLabel={t("common.back")}>
        <p className="ok-h">{t("ownKey.doesTitle")}</p>
        <ul className="ok-ul"><li>{t("ownKey.does1")}</li><li>{t("ownKey.does2")}</li><li>{t("ownKey.does3")}</li><li>{t("ownKey.does4")}</li><li>{t("ownKey.does5")}</li></ul>
        <p className="ok-h">{t("ownKey.wrongTitle")}</p>
        <ul className="ok-ul"><li>{t("ownKey.wrong1")}</li><li>{t("ownKey.wrong2")}</li><li>{t("ownKey.wrong3")}</li></ul>
      </Sheet>
    </>
  );
}

/* Mounted once inside NavProvider: a daily-limit toast or Ask's card
 * asks for the key sheet, so open Settings, where the row opens it. */
export function OwnKeyRoute() {
  const nav = useNav();
  useEffect(() => {
    const go = () => { if (nav.view !== "profile") nav.tab("profile"); };
    window.addEventListener(OPEN_OWN_KEY, go);
    return () => window.removeEventListener(OPEN_OWN_KEY, go);
  }, [nav]);
  return null;
}
