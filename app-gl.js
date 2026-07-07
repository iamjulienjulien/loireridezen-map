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
import { loadPoisForViewportGL, bindViewportListenersGL } from "./app/poi-gl.js";
import { initEuroVelosGL } from "./app/eurovelo-gl.js";
import { buildTraceMarkersGL } from "./app/trace-markers-gl.js";
import { initActionsPanelGL } from "./app/actions-panel-gl.js";
import { applyCarnetGL, getCurrentCarnetGL } from "./app/carnets/apply-gl.js";
import { initExportButton } from "./app/map-export.js";

const map = initMapGL();

map.on("load", async () => {
  // Retirer le skeleton de chargement dès que le fond est prêt (parité avec app.js).
  const skeleton = document.getElementById("lrz-loading");
  if (skeleton) skeleton.style.display = "none";

  // Commit [4] — EuroVelo d'abord (sous les traces, ordre des layers GL).
  await initEuroVelosGL();

  // Commit [2] — traces (lignes colorées + popups + fitBounds).
  await loadAllRoutesGL();

  // Commit [4] — markers Départ/Étape/Arrivée (après les traces : openStepPopupGL prêt).
  buildTraceMarkersGL();

  // Commit [5] — sélecteur de carnets + zoom/recentrer/localiser.
  bindViewportListenersGL();
  initActionsPanelGL();

  // Commit [6] — bouton d'export image (?admin) : map-export.js est agnostique du moteur.
  initExportButton();

  // Commit [5] — applique le carnet courant (fond + couleurs + filtre POI + catégories).
  // setEnabledPoiTypesGL (dans applyCarnetGL) déclenche le chargement initial des POI.
  const carnet = getCurrentCarnetGL();
  if (carnet) applyCarnetGL(carnet);
  else loadPoisForViewportGL();
});
