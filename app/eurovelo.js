/**
 * app/eurovelo.js — Trace EuroVelo 6 en référence contextuelle discrète (LRZ-EVO-48)
 *
 * Charge data/eurovelo/eurovelo-6.geojson dans un pane dédié (z-index 350,
 * sous overlayPane à 400). Non-interactive, toggle show/hide piloté depuis
 * le panneau. Non initialisé en mode for=elle.
 */

import { Polyline } from "leaflet";
import { isForElle } from "./url-mode.js";

const GEOJSON_URL = "data/eurovelo/eurovelo-6.geojson";

export async function initEuroVelo(map) {
  if (isForElle()) return null;

  if (!map.getPane("eurovelo")) {
    map.createPane("eurovelo");
    map.getPane("eurovelo").style.zIndex = "350";
    map.getPane("eurovelo").style.pointerEvents = "none";
  }

  try {
    const geojson = await fetch(GEOJSON_URL).then((r) =>
      r.ok ? r.json() : null,
    );
    if (!geojson) return null;

    const coords = geojson.features?.[0]?.geometry?.coordinates;
    if (!coords || coords.length < 2) return null;

    const latlngs = coords.map(([lng, lat]) => [lat, lng]);
    new Polyline(latlngs, {
      color: "#6b7280",
      weight: 1.5,
      opacity: 0.5,
      interactive: false,
      pane: "eurovelo",
    }).addTo(map);
  } catch (err) {
    console.warn("[eurovelo] init failed", err);
    return null;
  }

  return {};
}
