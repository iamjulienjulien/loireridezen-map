/**
 * app/actions-panel.js — Panel flottant d'actions (top-right)
 *
 * Groupe 1 : zoom+ / zoom−
 * Groupe 2 : Plan / Satellite (bouton group avec état actif)
 * Groupe 3 : Recentrer / Ma position
 */

import { FeatureGroup } from "leaflet";
import { map, baseOSM, baseEsriSat, esriLabels, baseCyclOSM } from "./map.js";
import { traceGroups } from "./routes.js";
import { FIT_OPTIONS } from "./config.js";
import { triggerLocate } from "./locate.js";
import { loadPreferences, updatePreference } from "./preferences.js";
import { track } from "./analytics.js";

let _currentBase = "osm";

function _setBase(base) {
  track('Map Style Changed', { style: base });
  _currentBase = base;
  map.removeLayer(baseOSM);
  map.removeLayer(baseEsriSat);
  map.removeLayer(esriLabels);
  map.removeLayer(baseCyclOSM);
  if (base === "sat") {
    baseEsriSat.addTo(map);
    esriLabels.addTo(map);
  } else if (base === "cyclo") {
    baseCyclOSM.addTo(map);
  } else {
    baseOSM.addTo(map);
  }
  updatePreference("baseLayer", base);
  _syncActive();
}

function _syncActive() {
  document.querySelectorAll("[data-basemap]").forEach((btn) => {
    btn.classList.toggle("lrz-apanel-btn--active", btn.dataset.basemap === _currentBase);
  });
}

export function initActionsPanel() {
  const prefs = loadPreferences();
  _currentBase = prefs.baseLayer || "osm";
  _syncActive();

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switch (btn.dataset.action) {
        case "zoom-in":
          track('Zoom In', { from_zoom: map.getZoom() });
          map.zoomIn();
          break;
        case "zoom-out":
          track('Zoom Out', { from_zoom: map.getZoom() });
          map.zoomOut();
          break;
        case "set-plan":
          _setBase("osm");
          break;
        case "set-sat":
          _setBase("sat");
          break;
        case "set-cyclo":
          _setBase("cyclo");
          break;
        case "reset-view": {
          track('Reset View');
          const layers = [];
          traceGroups.forEach(({ layers: ls }) => layers.push(...ls));
          if (layers.length) {
            map.fitBounds(new FeatureGroup(layers).getBounds(), FIT_OPTIONS);
          }
          break;
        }
        case "locate-me":
          track('Locate Me');
          triggerLocate(map);
          break;
      }
    });
  });
}
