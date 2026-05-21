/**
 * app/actions-panel.js — Panel flottant d'actions (top-right)
 *
 * Groupe 1 : zoom+ / zoom−
 * Groupe 2 : Plan / Satellite (bouton group avec état actif)
 * Groupe 3 : Recentrer / Ma position
 */

import { FeatureGroup } from "leaflet";
import { map, baseOSM, baseEsriSat, esriLabels } from "./map.js";
import { traceGroups } from "./routes.js";
import { FIT_OPTIONS } from "./config.js";
import { triggerLocate } from "./locate.js";
import { loadPreferences, updatePreference } from "./preferences.js";

let _currentBase = "osm";

function _setBase(base) {
  _currentBase = base;
  if (base === "sat") {
    map.removeLayer(baseOSM);
    baseEsriSat.addTo(map);
    esriLabels.addTo(map);
  } else {
    map.removeLayer(baseEsriSat);
    map.removeLayer(esriLabels);
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

  if (_currentBase === "sat") {
    map.removeLayer(baseOSM);
    baseEsriSat.addTo(map);
    esriLabels.addTo(map);
  }
  _syncActive();

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switch (btn.dataset.action) {
        case "zoom-in":
          map.zoomIn();
          break;
        case "zoom-out":
          map.zoomOut();
          break;
        case "set-plan":
          _setBase("osm");
          break;
        case "set-sat":
          _setBase("sat");
          break;
        case "reset-view": {
          const layers = [];
          traceGroups.forEach(({ layers: ls }) => layers.push(...ls));
          if (layers.length) {
            map.fitBounds(new FeatureGroup(layers).getBounds(), FIT_OPTIONS);
          }
          break;
        }
        case "locate-me":
          triggerLocate(map);
          break;
      }
    });
  });
}
