/**
 * app-gl.js — Point d'entrée du moteur MapLibre GL (LRZ-BRA-404 P1, activé par `?engine=gl`).
 *
 * En PARALLÈLE de `app.js` (Leaflet, moteur par défaut). Chargé uniquement quand `?engine=gl` est
 * présent, donc n'importe JAMAIS Leaflet — les deux moteurs ne coexistent pas au runtime.
 *
 * Commit [1] : ossature (fonds raster + Positron vectoriel). Les couches de données (traces, POI,
 * photos), les carnets et l'export arrivent aux commits suivants.
 */

import { initMapGL } from "./app/map-gl.js";
import { loadAllRoutesGL } from "./app/routes-gl.js";

const map = initMapGL();

map.on("load", () => {
  // Retirer le skeleton de chargement dès que le fond est prêt (parité avec app.js).
  const skeleton = document.getElementById("lrz-loading");
  if (skeleton) skeleton.style.display = "none";

  // Commit [2] — traces (lignes colorées + popups + fitBounds).
  loadAllRoutesGL();
});
