/**
 * app/eurovelo-gl.js — Traces EuroVelo en MapLibre GL (LRZ-BRA-404 P1, commit [4]).
 *
 * Port de `eurovelo.js` : lignes de référence discrètes (gris, fines), non-interactives, sous les
 * traces. Ajoutées AVANT les traces (ordre des layers GL). Masquées en mode `for=elle`.
 * Re-posées après un changement de fond vectoriel (`lrz:basemap-changed`).
 */

import { isForElle } from "./url-mode.js";
import { map } from "./map-gl.js";

export const EUROVELOS = [
  { id: "eurovelo-6", label: "EuroVelo 6", geojsonPath: "data/eurovelo/eurovelo-6.geojson" },
  { id: "eurovelo-1", label: "EuroVelo 1", geojsonPath: "data/eurovelo/eurovelo-1.geojson" },
];

const EV_PAINT = { "line-color": "#6b7280", "line-width": 1.5, "line-opacity": 0.5 };

const _loaded = [];

function _render() {
  for (const ev of _loaded) {
    const srcId = `ev-src-${ev.id}`;
    const lyrId = `ev-${ev.id}`;
    if (map.getSource(srcId)) continue;
    map.addSource(srcId, { type: "geojson", data: ev.data });
    map.addLayer({
      id: lyrId,
      type: "line",
      source: srcId,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: EV_PAINT,
    });
  }
}

export async function initEuroVelosGL() {
  if (isForElle()) return;
  await Promise.all(
    EUROVELOS.map(async (ev) => {
      try {
        const data = await fetch(ev.geojsonPath).then((r) => (r.ok ? r.json() : null));
        if (data) _loaded.push({ id: ev.id, data });
      } catch (err) {
        console.warn(`[eurovelo] init failed for ${ev.id}`, err);
      }
    }),
  );
  _render();
  document.addEventListener("lrz:basemap-changed", _render);
}
