import { t } from "../i18n";

/* The ✕ that hides one Today row for this account (owner, 2026-11-03:
 * "all card items" get hide). It hides, never deletes, and the toast
 * carries Undo. Its own file so ui/Town.tsx can use it too. */
export function HideX({ what, onHide }: { what: string; onHide: () => void }) {
  return (
    <button type="button" className="rowx" aria-label={t("today.hide.aria", { what })}
      onClick={ev => { ev.stopPropagation(); ev.preventDefault(); onHide(); }}><span aria-hidden="true">✕</span></button>
  );
}
