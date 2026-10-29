import { useCallback, useEffect, useState } from "react";
import { useNav } from "../app/nav";
import { useToast } from "../ui/Toast";
import { get, post } from "../lib/api";
import { Empty } from "../ui/kit";
import { useTranslation } from "../i18n";

/* Port of pwa/index.html #view-friends and quest.js renderFriends.
 * Shell renders <section id="view-friends">; no second one. */
type Friend = { handle: string; status: string; top_badge?: string | null; last_hunt?: string | null };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Friends() {
  const { t } = useTranslation();
  const nav = useNav();
  const { toast, showErr } = useToast();
  const [handle, setHandle] = useState("");
  const [friends, setFriends] = useState<Friend[] | null>(null);

  const load = useCallback(async () => {
    const d = await get<{ friends: Friend[] }>("/api/quest/friends");
    setFriends(d.friends);
  }, []);

  useEffect(() => { load().catch(showErr); }, [nav.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (h: string, confirmFirst: boolean) => {
    if (confirmFirst && !confirm(`Remove @${h} from your friends?`)) return;
    try {
      await post("/api/quest/friends/remove", { handle: h });
      toast(`@${h} removed.`);
      load().catch(showErr);
    } catch (e) { toast(errMsg(e)); }
  };
  const accept = async (h: string) => {
    try {
      await post("/api/quest/friends/accept", { handle: h });
      toast("Friends. Their boards and badges are yours to chase.");
      load().catch(showErr);
    } catch (e) { toast(errMsg(e)); }
  };
  const add = async () => {
    const h = handle.trim();
    if (!h) { toast("Type a handle first."); return; }
    try {
      const f = await post<Friend>("/api/quest/friends", { handle: h });
      toast(f.status === "accepted" ? `@${f.handle} is already your friend.` : `Request sent to @${f.handle}.`);
      setHandle("");
      load().catch(showErr);
    } catch (e) { toast(errMsg(e)); }
  };

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back("community"); }}>{t("common.back")}</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>{t("common.friends")}</h2>
      <div className="group pad">
        <label className="field">{t("friends.addByHandle")}<input type="text" id="fr-handle" placeholder={t("friends.handle")} autoComplete="off" value={handle} onChange={e => setHandle(e.target.value)} />
        </label>
        <p style={{ marginBottom: 0 }}><button id="fr-add" className="btn primary wide" type="button" onClick={add}>{t("friends.sendRequest")}</button></p>
      </div>
      <div id="fr-list" className="group">
        {friends && !friends.length && <Empty>{t("friends.noFriendsYetAddOne")}</Empty>}
        {friends?.map(f => f.status === "pending_in" ? (
          <div className="row" key={f.handle}><div className="grow"><span className="name">@{f.handle}</span>
            <span className="sub">{t("friends.wantsToHuntWithYou")}</span></div>
            <button className="chip" data-accept={f.handle} type="button" onClick={() => accept(f.handle)}>{t("friends.accept")}</button>
            <button className="chip" data-remove={f.handle} type="button" onClick={() => remove(f.handle, false)}>{t("friends.decline")}</button></div>
        ) : f.status === "pending_out" ? (
          <div className="row" key={f.handle}><div className="grow"><span className="name">@{f.handle}</span>
            <span className="sub">{t("friends.requestSent")}</span></div>
            <button className="chip" data-remove={f.handle} type="button" onClick={() => remove(f.handle, false)}>{t("common.cancel")}</button></div>
        ) : (
          <div className="row" key={f.handle}><div className="grow"><span className="name">@{f.handle}</span>
            <span className="sub">{f.top_badge ? `Top badge: ${f.top_badge}` : "No badges yet"}{f.last_hunt ? ` · Last hunt: ${f.last_hunt}` : " · No hunts yet"}</span></div>
            <button className="chip" data-challenge={f.handle} type="button" onClick={() => nav.show("race", { opponent: f.handle })}>{t("friends.challenge")}</button>
            <button className="chip" data-remove={f.handle} data-confirm="1" type="button" onClick={() => remove(f.handle, true)}>{t("common.remove")}</button></div>
        ))}
      </div>
      <p className="muted">{t("friends.friendsSeeYourBoardsAnd")}</p>
    </>
  );
}
