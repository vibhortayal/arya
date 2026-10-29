import { useState } from "react";
import { useNav } from "../app/nav";
import { PlacesRows, usePlacesDrop } from "./StoresFind";

/* Port of pwa/index.html #view-stores-add: a Google pick is the only
 * way a store enters the directory. The Shell renders the section. */
export function StoresAdd() {
  const nav = useNav();
  const [q, setQ] = useState("");
  const drop = usePlacesDrop(q);

  return (
    <>
      <p><a href="#" className="qback" onClick={ev => { ev.preventDefault(); nav.back(); }}>‹ Back</a></p>
      <h2 className="largetitle" style={{ fontSize: 28 }}>Add a store</h2>
      <div className="group pad dropanchor">
        <label className="field">Search Google for the store
          <input type="text" id="sa-q" placeholder="Costco" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} />
        </label>
        <p className="muted nomargin" style={{ fontSize: 13 }}>Every store carries its real name and address from Google. Tap yours to add it.</p>
        <div id="sa-results" className="gdrop" hidden={!drop.rows.length}>
          {drop.rows.length > 0 && <PlacesRows rows={drop.rows} pick={drop.pick} />}
        </div>
      </div>
      <p className="muted">The store joins the shared directory, so other players can find it too. New stores play in the walk-through view — map one to unlock the 3D view.</p>
    </>
  );
}
