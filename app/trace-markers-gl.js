/**
 * app/trace-markers-gl.js — Markers Départ / Étape / Arrivée en MapLibre GL (LRZ-BRA-404 P1, [4]).
 *
 * Port de `trace-markers.js` : emoji `DivIcon` → élément HTML dans `maplibregl.Marker` (ancré au
 * centre), clic → `openStepPopupGL`. Markers indexés par groupe pour la bascule de visibilité
 * (carnets, commit [5]). Recalcule Départ/Étape/Arrivée depuis les coords des traces.
 */

import maplibregl from "maplibre-gl";
import { TRACE_MARKER_TYPES } from "./types.js";
import { hiddenModes } from "./url-mode.js";
import { farthestPointFromStart } from "./geo-utils.js";
import { map } from "./map-gl.js";
import { openStepPopupGL } from "./routes-gl.js";

/** groupId → Marker[] — pour masquer/afficher les markers avec leur trace (commit [5]). */
export const traceMarkersByGroup = new Map();

function emojiEl(type) {
  const cfg = TRACE_MARKER_TYPES[type];
  const span = document.createElement("span");
  span.className = `lrz-trace-emoji lrz-trace-emoji--${type}`;
  span.textContent = cfg.emoji;
  span.style.cursor = "pointer";
  return span;
}

function firstCoord(geojson) {
  const f = geojson.features?.[0];
  return f ? f.geometry.coordinates[0] : null;
}

function lastCoord(geojson) {
  const features = geojson.features ?? [];
  const f = features[features.length - 1];
  if (!f) return null;
  const c = f.geometry.coordinates;
  return c[c.length - 1];
}

function _flatCoords(geojson) {
  const out = [];
  for (const f of geojson.features ?? [geojson]) {
    for (const c of f.geometry?.coordinates ?? []) out.push(c);
  }
  return out;
}

async function safeFetch(url) {
  try {
    const r = await fetch(url);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

/** Crée un marker emoji GL à [lng, lat] et l'enregistre pour son groupe. */
function _addMarker(groupId, type, lngLat, stepId) {
  const marker = new maplibregl.Marker({ element: emojiEl(type), anchor: "center" })
    .setLngLat(lngLat)
    .addTo(map);
  marker.getElement().addEventListener("click", (e) => {
    e.stopPropagation();
    openStepPopupGL(stepId);
  });
  if (!traceMarkersByGroup.has(groupId)) traceMarkersByGroup.set(groupId, []);
  traceMarkersByGroup.get(groupId).push(marker);
}

/** Construit les markers Départ/Étape/Arrivée pour tous les groupes (port fidèle de la logique Leaflet). */
export async function buildTraceMarkersGL() {
  if (hiddenModes.rabbit) return;

  let groupsCatalog, tracesCatalog;
  try {
    [groupsCatalog, tracesCatalog] = await Promise.all([
      fetch("data/catalog/groups.json").then((r) => r.json()),
      fetch("data/catalog/traces.json").then((r) => r.json()),
    ]);
  } catch {
    return;
  }

  for (const group of groupsCatalog.items ?? []) {
    const items = (tracesCatalog.items ?? [])
      .filter((it) => it.group === group.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (!items.length) continue;

    if (group.unified) {
      const data = await safeFetch(items[0].paths.full);
      if (!data) continue;
      const start = firstCoord(data);
      const end = lastCoord(data);
      if (start) _addMarker(group.id, "départ", start, items[0].id);
      if (end) _addMarker(group.id, "arrivée", end, items[items.length - 1].id);
    } else {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const data = await safeFetch(item.paths.simplified ?? item.paths.full);
        if (!data) continue;

        if (item.is_loop) {
          if (i === 0) {
            const start = firstCoord(data);
            if (start) _addMarker(group.id, "départ", start, item.id);
          }
          const far = farthestPointFromStart(_flatCoords(data));
          if (far) _addMarker(group.id, "étape", [far.lng, far.lat], item.id);
        } else {
          if (i === 1 && items[0].is_loop) continue; // même départ que la boucle
          const start = firstCoord(data);
          if (!start) continue;
          _addMarker(group.id, i === 0 ? "départ" : "étape", start, item.id);
        }
      }
      const lastItem = items[items.length - 1];
      if (!lastItem.is_loop) {
        const data = await safeFetch(lastItem.paths.simplified ?? lastItem.paths.full);
        const end = data && lastCoord(data);
        if (end) _addMarker(group.id, "arrivée", end, lastItem.id);
      }
    }
  }
}
