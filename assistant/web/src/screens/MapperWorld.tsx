/* Map my store's View map (owner 2026-11-03: the button and the "Map
 * view" tag always agree): the same store world the Quest tab plays,
 * drawn from what Arya has located of this store (your own Build map
 * first), with nothing on the trip. Lazy, so three.js loads only when
 * View map is tapped. Honesty rules are World3D's: unmapped sections
 * sit under fog or show as a labelled guess. */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { newTrip } from "../game/core/trip";
import type { StoreLayout } from "../game/core/types";
import { AppSource } from "./quest/appSource";
import { t } from "../i18n";

const World3D = lazy(() => import("../game/world/World3D").then(m => ({ default: m.World3D })));

export default function MapperWorld({ id, name, where }: { id?: string; name: string; where: string }) {
  const [layout, setLayout] = useState<StoreLayout | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    new AppSource().preview(id, name, where).then(l => { if (live) setLayout(l); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id, name, where]);
  const trip = useMemo(() => (layout ? newTrip(layout, [], { practice: true, golden: null }) : null), [layout]);
  const noop = () => {};
  if (failed) return <p className="mp-scenewait">{t("common.sceneFailed")}</p>;
  if (!trip) return <p className="mp-scenewait">{t("mapper.drawing")}</p>;
  return (
    <Suspense fallback={<p className="mp-scenewait">{t("mapper.drawing")}</p>}>
      <World3D trip={trip} focus={null} onReady={api => api.setOverview(true)} onArrive={noop} onWalking={noop} onTapItem={noop} onFail={() => setFailed(true)} />
    </Suspense>
  );
}
