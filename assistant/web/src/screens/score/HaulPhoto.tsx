import { useState, type ChangeEvent } from "react";
import { useToast } from "../../ui/Toast";
import { post } from "../../lib/api";
import { asset } from "../../lib/format";
import { faceFor, useCharacters } from "../../lib/characters";
import type { Session } from "../hunt/model";
import { H } from "../haul/state";
import type { ShareKind } from "../haul/Share";
import { useTranslation } from "../../i18n";

/* The Score's "Snap your haul" (quest.js openScore, haul-photo): Arya
 * spots the products in a photo, extras included. The photo itself is
 * not kept; its object URL (quest.js Q.haulPhotoURL) can front the
 * haul share card. The Share your haul / Loved something? / Shelf SOS
 * buttons open the share cards (share.js) through onShare. */
type Seen = { item: string };
type Result = { seen: Seen[]; extras: string[]; not_seen: string[] };

export function HaulPhoto({ sess, plain, attached, onShare }:
  { sess: Session; plain: boolean; attached: boolean; onShare: (kind: ShareKind) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  useCharacters();
  const [status, setStatus] = useState("A photo of the haul: Arya spots the products in it — extras included — and the photo can front your haul card. The photo itself is not kept.");
  const [res, setRes] = useState<Result | null>(null);
  const [added, setAdded] = useState(false);

  const onPhoto = async (ev: ChangeEvent<HTMLInputElement>) => {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    setStatus("Reading your haul with Spark…");
    try {
      if (H.haulPhotoURL) URL.revokeObjectURL(H.haulPhotoURL);
      H.haulPhotoURL = URL.createObjectURL(f);
      const r = await fetch(`/api/quest/haul-photo?session=${encodeURIComponent(sess.id)}`, {
        method: "POST", headers: { "Content-Type": f.type || "image/jpeg" }, body: f });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail || `HTTP ${r.status}`);
      setRes(await r.json());
      setAdded(false);
      setStatus("");
    } catch (e) {
      setStatus("");
      toast("Could not read that photo: " + (e instanceof Error ? e.message : String(e)));
    }
  };
  const addExtras = async () => {
    await post("/api/list/from-text", { text: (res?.extras || []).join("\n") }).catch(() => {});
    setAdded(true);
    toast("Added to your list.");
  };
  const face = (n: string) => plain ? null : <img key={n} className="rowface" src={asset("assets/characters/" + faceFor(n))} alt="" />;

  return (
    <>
      <h3 className="sect">{t("score.shareThisRun")}</h3>
      <div className="group pad">
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: 0 }}>
          {attached && <>
            <button className="btn primary grow" id="share-haul" type="button" onClick={() => onShare("haul")}>{t("score.shareYourHaul")}</button>
            <button className="btn grow" id="share-love" type="button" onClick={() => onShare("love")}>{t("score.lovedSomething")}</button>
          </>}
          {((sess.my_reports as string[] | undefined) || []).length > 0 &&
            <button className="btn grow" id="share-sos" type="button" onClick={() => onShare("sos")}>{t("score.shelfSos")}</button>}
        </p>
        <p style={{ marginTop: 10 }}><label className="btn wide" htmlFor="haul-photo" style={{ textAlign: "center" }}>{t("score.snapYourHaul")}</label>
          <input type="file" id="haul-photo" accept="image/*" hidden onChange={onPhoto} /></p>
        <p className="muted nomargin" id="haul-status">{status}</p>
        <div id="haul-result">
          {res && (
            <>
              {res.seen.length > 0 && <div className="row">{res.seen.map(s => face(s.item))}<div className="grow">
                <span className="name">{t("score.spottedOfYourItems", { seenCount: res.seen.length })}</span><span className="sub">{res.seen.map(s => s.item).join(", ")}</span></div></div>}
              {res.extras.length > 0 && <div className="row"><div className="grow">
                <span className="name">{t("score.alsoInThePhoto", { join: res.extras.join(", ") })}</span><span className="sub">{t("score.notOnTheListWild")}</span></div>
                {!added && <button className="btn" id="haul-addextra" type="button" onClick={addExtras}>{t("score.addToMyList")}</button>}</div>}
              {res.not_seen.length > 0 && <p className="muted">{t("score.couldNotSpotAPhoto", { join: res.not_seen.join(", ") })}</p>}
              {!res.seen.length && !res.extras.length && <p className="muted">{t("score.noProductsSpottedInThat")}</p>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
