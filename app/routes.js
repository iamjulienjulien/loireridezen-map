/**
 * app/routes.js — Chargeur de traces depuis data/catalog/
 *
 * Lit groups.json et traces.json en parallèle, crée un GeoJSON layer par item
 * (ou un seul pour les groupes unified), et expose :
 *   - traceGroups : Map<groupId, {group, layers}> peuplée après loadAllRoutes()
 *   - loadAllRoutes() : singleton async — safe à appeler plusieurs fois
 */

import { GeoJSON, FeatureGroup } from "leaflet";
import { map } from "./map.js";
import { resolveColor } from "./types.js";
import { FIT_OPTIONS } from "./config.js";
import { renderStepPopup } from "./step-popup.js";

/** Map<groupId, {group, layers: GeoJSON[]}> — peuplée par loadAllRoutes() */
export const traceGroups = new Map();

/** Map<stepId, GeoJSON> — pour center-on-step et openStepPopup */
const _stepLayersById = new Map();

let _promise = null;
let _centerListenerAdded = false;

async function _fetchGeoJson(primaryUrl, fallbackUrl = null) {
  try {
    let res = await fetch(primaryUrl);
    if (!res.ok && fallbackUrl) res = await fetch(fallbackUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[loireridezen] trace load failed: ${primaryUrl}`, err);
    return null;
  }
}

function _layerStyle(group, item, featureIndex) {
  const base = {
    weight: 4,
    opacity: 0.9,
    ...(group.dashed ? { dashArray: "6,4" } : {}),
  };
  return (feature) => ({
    ...base,
    color: resolveColor(group.color, { feature, item, group, featureIndex }),
  });
}

async function _safeFetchJSON(url) {
  try {
    const r = await fetch(url);
    return r.ok ? r.json() : null;
  } catch {
    return null;
  }
}

function _photosInBounds(photos, bounds) {
  return photos.filter((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    return lon != null && bounds.contains([lat, lon]);
  }).length;
}

async function _doLoad() {
  let groupsCatalog, tracesCatalog, photosFC;
  try {
    [groupsCatalog, tracesCatalog, photosFC] = await Promise.all([
      fetch("data/catalog/groups.json").then((r) => r.json()),
      fetch("data/catalog/traces.json").then((r) => r.json()),
      _safeFetchJSON("data/pois/pois_photos.geojson"),
    ]);
  } catch (err) {
    console.warn("[loireridezen] catalog load failed", err);
    return;
  }
  const photoFeatures = (photosFC?.features ?? []).filter(
    (f) => !(f.properties?.poi_id),
  );

  const groups = (groupsCatalog.items ?? []).sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const allItems = tracesCatalog.items ?? [];
  const allLayers = [];

  if (!_centerListenerAdded) {
    _centerListenerAdded = true;
    map.getContainer().addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='center-on-step']");
      if (!btn) return;
      const layer = _stepLayersById.get(btn.dataset.stepId);
      if (!layer) return;
      try { map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 14 }); } catch {}
    });
  }

  for (const group of groups) {
    const items = allItems
      .filter((it) => it.group === group.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    if (!items.length) continue;

    const layers = [];

    if (group.unified) {
      const item = items[0];
      const url = item.paths?.full;
      if (!url) continue;
      const data = await _fetchGeoJson(url);
      if (!data) continue;
      const itemsByStage = new Map(items.map((it) => [(it.order ?? 1) - 1, it]));
      layers.push(new GeoJSON(data, {
        style: _layerStyle(group, item, 0),
        onEachFeature(feature, layer) {
          const stage = feature.properties?.stage ?? 0;
          const matched = itemsByStage.get(stage) ?? items[0];
          layer.bindPopup(renderStepPopup(matched), { maxWidth: 280 });
        },
      }));
    } else {
      const loaded = await Promise.all(
        items.map(async (item) => {
          const primary = item.paths?.simplified ?? item.paths?.full;
          const fallback = item.paths?.simplified ? item.paths?.full : null;
          if (!primary) return null;
          const data = await _fetchGeoJson(primary, fallback);
          if (!data) return null;
          const featureIndex = (item.order ?? 1) - 1;
          const geoLayer = new GeoJSON(data, {
            style: _layerStyle(group, item, featureIndex),
          });
          try {
            const bounds = geoLayer.getBounds();
            item._photo_count = _photosInBounds(photoFeatures, bounds);
          } catch { item._photo_count = 0; }
          const popup = renderStepPopup(item);
          geoLayer.eachLayer((l) => l.bindPopup(popup, { maxWidth: 280 }));
          _stepLayersById.set(item.id, geoLayer);
          return geoLayer;
        }),
      );
      layers.push(...loaded.filter(Boolean));
    }

    if (layers.length) {
      traceGroups.set(group.id, { group, layers });
      allLayers.push(...layers);
    }
  }

  if (allLayers.length) {
    try {
      map.fitBounds(new FeatureGroup(allLayers).getBounds(), FIT_OPTIONS);
    } catch (err) {
      console.warn("[loireridezen] fitBounds failed:", err);
    }
  }
}

/** Charge toutes les traces depuis le catalog. Singleton : safe à appeler plusieurs fois. */
export function loadAllRoutes() {
  if (!_promise) _promise = _doLoad();
  return _promise;
}

/** Zoome la carte sur les bounds d'une étape. */
export function centerOnStep(stepId) {
  const layer = _stepLayersById.get(stepId);
  if (!layer) return;
  try { map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 14 }); } catch {}
}

/** Ouvre programmatiquement le popup de la première feature d'une étape. */
export function openStepPopup(stepId) {
  const layer = _stepLayersById.get(stepId);
  if (!layer) return;
  const sub = layer.getLayers();
  if (sub.length) sub[0].openPopup();
}
