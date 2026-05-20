/**
 * app.js — Entry point de la carte Loire Ride Zen
 *
 * Orchestre l'initialisation des sous-modules dans le bon ordre.
 * Toute la logique vit dans ./app/*.js, ce fichier ne fait que coordonner.
 *
 * Ordre d'init :
 *   1. UI statique (filtres, légende, drawer)
 *   2. Layer control Leaflet
 *   3. Chargement des traces GPX en parallèle (avec fitBounds final)
 *   4. Premier chargement des POI + branchement des listeners viewport
 */

import { map } from "./app/map.js";
import { loadAllRoutes } from "./app/routes.js";
import { loadPoisForViewport, bindViewportListeners } from "./app/poi.js";
import {
  renderFilters,
  renderLegend,
  initMobileDrawer,
  initLayerControl,
} from "./app/ui.js";
import { initLocateControl } from "./app/locate.js";

function init() {
  renderFilters();
  renderLegend();
  initMobileDrawer();
  initLayerControl();
  initLocateControl(map);

  // Traces GPX : fire-and-forget (fitBounds géré en interne)
  loadAllRoutes();

  // POI : premier chargement + listeners "moveend" / filtres
  bindViewportListeners();
  loadPoisForViewport();

  // Retirer le skeleton dès que la carte est prête
  const loadingEl = document.getElementById("lrz-loading");
  if (loadingEl) {
    loadingEl.classList.add("lrz-loading--hidden");
    setTimeout(() => loadingEl.remove(), 400);
  }
}

init();
