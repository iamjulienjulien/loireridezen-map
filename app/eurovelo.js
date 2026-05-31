/**
 * app/eurovelo.js — Traces EuroVelo en référence contextuelle discrète (LRZ-EVO-48/59)
 *
 * Charge les GeoJSON des EuroVelos dans un pane dédié (z-index 350,
 * sous overlayPane à 400). Non-interactives, toujours affichées sauf mode for=elle.
 */

import { GeoJSON } from "leaflet";
import { isForElle } from "./url-mode.js";

export const EUROVELOS = [
  { id: "eurovelo-6", label: "EuroVelo 6", geojsonPath: "data/eurovelo/eurovelo-6.geojson" },
  { id: "eurovelo-1", label: "EuroVelo 1", geojsonPath: "data/eurovelo/eurovelo-1.geojson" },
];

const EV_STYLE = {
  color: "#6b7280",
  weight: 1.5,
  opacity: 0.5,
};

export async function initEuroVelos(map) {
  if (isForElle()) return null;

  if (!map.getPane("eurovelo")) {
    map.createPane("eurovelo");
    map.getPane("eurovelo").style.zIndex = "350";
    map.getPane("eurovelo").style.pointerEvents = "none";
  }

  const layers = {};
  await Promise.all(
    EUROVELOS.map(async (ev) => {
      try {
        const data = await fetch(ev.geojsonPath).then((r) =>
          r.ok ? r.json() : null,
        );
        if (!data) return;
        layers[ev.id] = new GeoJSON(data, {
          pane: "eurovelo",
          interactive: false,
          style: EV_STYLE,
        }).addTo(map);
      } catch (err) {
        console.warn(`[eurovelo] init failed for ${ev.id}`, err);
      }
    }),
  );

  return layers;
}

// Alias pour compatibilité avec les appelants utilisant l'ancienne signature
export const initEuroVelo = initEuroVelos;
