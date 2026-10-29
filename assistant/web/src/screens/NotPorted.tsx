import type { ViewId } from "../app/views";
import { useNav } from "../app/nav";

/* Placeholder until a screen is ported: says so plainly and offers
 * the current app, which stays at / until the switch-over. */
export function NotPorted({ view }: { view: ViewId }) {
  const nav = useNav();
  return (
    <>
      {view !== "home" && <p><a href="#" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back</a></p>}
      <h2 className="largetitle">Not here yet</h2>
      <div className="group pad">
        <p className="nomargin">This screen is still being moved to the new app.</p>
        <p className="muted nomargin"><a href="/">Open it in the current app</a></p>
      </div>
    </>
  );
}
