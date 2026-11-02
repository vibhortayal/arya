import { useEffect, useSyncExternalStore } from "react";
import { syncLists } from "../lib/api";
import { CHANGE, SYNCED, pendingCount, type Synced } from "../lib/listQueue";
import { useSession } from "./session";
import { useToast } from "../ui/Toast";
import { t } from "../i18n";

/* List changes made offline (lib/listQueue.ts): send them when the
 * app opens and when the signal comes back, say once per offline spell
 * that changes are being kept on the phone, and say what happened when
 * they go out. Screens reload on "arya-listq-synced". */
export function useListSync(): void {
  const { toast } = useToast();
  const s = useSession();
  useEffect(() => {
    if (!s.user || s.demo) return;
    let told = false;
    const send = () => { told = false; void syncLists(); };
    const onChange = () => {
      if (told || !pendingCount() || navigator.onLine !== false) return;
      told = true;
      toast(t("lists.queue.saved"));
    };
    const onSynced = (e: Event) => {
      const r = (e as CustomEvent<Synced>).detail;
      if (r.skipped) toast(t("lists.queue.skipped", { count: r.skipped, names: r.skipped_names.filter(Boolean).join(", ") || t("lists.it") }));
      else if (r.failed) toast(t("lists.queue.failed", { count: r.failed, names: r.failed_names.filter(Boolean).join(", ") || t("lists.it") }));
      else if (r.done) toast(t("lists.queue.synced", { count: r.done }));
    };
    send();
    addEventListener("online", send);
    addEventListener(CHANGE, onChange);
    addEventListener(SYNCED, onSynced);
    return () => {
      removeEventListener("online", send);
      removeEventListener(CHANGE, onChange);
      removeEventListener(SYNCED, onSynced);
    };
  }, [s.user, s.demo, toast]);
}

/* For a pending mark or banner: how many list changes wait on this
 * phone, and whether they are going out now (there is signal). */
const sub = (fn: () => void) => {
  for (const e of [CHANGE, "online", "offline"]) addEventListener(e, fn);
  return () => { for (const e of [CHANGE, "online", "offline"]) removeEventListener(e, fn); };
};
export function useListQueue(): { pending: number; syncing: boolean } {
  const pending = useSyncExternalStore(sub, pendingCount);
  const online = useSyncExternalStore(sub, () => navigator.onLine !== false);
  return { pending, syncing: pending > 0 && online };
}
