/**
 * app/routes.js — Traces GPX (trace principale, Acte 1, boucle angevine)
 *
 * Définit les trois couches de traces avec leur style, et fournit une
 * fonction loadAllRoutes() qui :
 *   - charge les 3 GeoJSON en parallèle (avec fallback simplified → full)
 *   - ajoute à la carte ceux qui ont chargé avec succès
 *   - fitBounds une seule fois sur l'union des layers chargés
 */

import { GeoJSON, FeatureGroup } from "leaflet";
import { map } from "./map.js";
import { STAGE_COLORS } from "./types.js";
import { FIT_OPTIONS } from "./config.js";

/** Style par étape (trace principale et Acte 1). */
const stageStyle = (f) => {
  const s = f.properties?.stage || 0;
  return {
    color: STAGE_COLORS[s % STAGE_COLORS.length],
    weight: 4,
    opacity: 0.9,
  };
};

export const routeLayer = new GeoJSON(null, { style: stageStyle });
export const routeLayerActe1 = new GeoJSON(null, { style: stageStyle });
export const boucleLayer = new GeoJSON(null, {
  style: () => ({
    color: "#FF7F00",
    weight: 4,
    opacity: 0.9,
    dashArray: "6,4",
  }),
});

/**
 * Charge un GeoJSON dans un layer, avec fallback optionnel sur une seconde URL.
 * Retourne le layer rempli, ou null en cas d'échec.
 */
async function loadGeoJsonInto(layer, primaryUrl, fallbackUrl = null) {
  try {
    let res = await fetch(primaryUrl);
    if (!res.ok && fallbackUrl) {
      res = await fetch(fallbackUrl);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    layer.addData(data);
    return layer;
  } catch (err) {
    console.warn(`[loireridezen] route load failed: ${primaryUrl}`, err);
    return null;
  }
}

/**
 * Charge toutes les routes en parallèle, ajoute à la carte celles qui
 * ont chargé avec succès, puis fitBounds une seule fois sur l'union.
 */
export async function loadAllRoutes() {
  const results = await Promise.all([
    loadGeoJsonInto(
      routeLayer,
      "data/route_simplified.geojson",
      "data/route.geojson",
    ),
    loadGeoJsonInto(
      routeLayerActe1,
      "data/route-acte1_simplified.geojson",
      "data/route-acte1.geojson",
    ),
    loadGeoJsonInto(boucleLayer, "data/route_boucle_angevine.geojson"),
  ]);

  // Ajouter à la carte les layers chargés avec succès
  results.forEach((layer) => {
    if (layer) layer.addTo(map);
  });

  // FitBounds unique sur l'union (évite les écrasements en cascade)
  const loaded = results.filter(Boolean);
  if (loaded.length > 0) {
    try {
      const group = new FeatureGroup(loaded);
      map.fitBounds(group.getBounds(), FIT_OPTIONS);
    } catch (err) {
      console.warn("[loireridezen] fitBounds failed:", err);
    }
  }
}
