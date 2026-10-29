import { useEffect, useRef, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { post } from "../lib/api";
import { loadStoreData, storeHasPictures, storePhotos, useStoreData } from "../lib/stores";
import { packFinish, type NewListDraft } from "./NewList";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-mode and quest.js qCreateSession / the
 * .modecard handler / qFastStart's session half. One tap makes one
 * session (draft.creating). With draft.fastMode set the session is
 * created at once and started (state "playing"); the picker never
 * needs a tap. Exit: nav.reset("hunt" | "express", { session }): the
 * set-up screens (store, newlist, optimize, mode) are done with, so
 * Back from the new hunt lands on the Quest tab (quest.js
 * Q.stack = ["view-community"]), never in this picker again. */

const LABEL: Record<string, string> = { quest: "Quest", express: "Express" };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Mode() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast } = useToast();
  const D = nav.params.draft as NewListDraft | undefined;
  const [busy, setBusy] = useState(false);
  const fast = useRef(false);
  useStoreData();
  // A store with no aisle pictures shows Express only (quest.js qShowModes).
  const noQuest = !!(D && D.store) && !storeHasPictures(D.store);

  const create = async (mode: string) => {
    if (!D || D.creating) return;
    D.creating = true;
    setBusy(true);
    try {
      // Quest needs aisle photos (owner, 2026-10-29): a store Arya has
      // no pictures of runs as Express, from every way in.
      await loadStoreData();
      if (mode === "quest" && !storeHasPictures(D.store)) mode = "express";
      const sess = await post("/api/quest/sessions", {
        store: D.store, mode, items: D.finalItems,
        store_id: D.storeId || undefined,
        driver: storePhotos(D.store) ? "photo" : mode === "quest" ? "art" : "strip",
      });
      packFinish(D);
      if (D.fastMode && sess.mode === "quest" && sess.state === "not_started") {
        // The session exists now: a failed start still opens it (ready,
        // not playing) rather than leave the picker up for a second tap
        // that would make a second session.
        try { Object.assign(sess, await post(`/api/quest/sessions/${sess.id}/state`, { state: "playing" })); }
        catch (e) { toast(errMsg(e)); }
      } else {
        toast(`${LABEL[mode]} at ${sess.store} — ready when you are.`);
      }
      nav.reset(sess.mode === "express" ? "express" : "hunt", { session: sess }, "community");
    } catch (e) {
      toast(errMsg(e));
    } finally {
      D.creating = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (D && D.fastMode && !fast.current) {
      fast.current = true;
      create(D.fastMode);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("mode.howAreYouShopping")}</h2>
      <div>
        <button className="modecard" data-mode="quest" type="button" hidden={noQuest} disabled={busy} onClick={() => create("quest")}><span className="name">{t("common.quest")}</span><span className="sub">{t("mode.playTheHuntCharactersPoints")}</span></button>
        <button className="modecard" data-mode="express" type="button" disabled={busy} onClick={() => create("express")}><span className="name">{t("common.express")}</span><span className="sub">{t("mode.sameHelpFromAryaNo")}</span></button>
      </div>
      <p className="muted">{t("mode.bothEndTheSameWay")}</p>
    </>
  );
}
