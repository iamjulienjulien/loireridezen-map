/**
 * app/actions-panel.js — Panel flottant d'actions (top-right)
 *
 * Groupe 1 : zoom+ / zoom−
 * Groupe 2 : Plan / Satellite / CyclOSM (boutons fond avec état actif)
 * Groupe 3 : Thèmes (5 thèmes — fond + couleur + police)
 * Groupe 4 : Recentrer / Ma position
 */

import { FeatureGroup } from "leaflet";
import { map, baseOSM, baseEsriSat, esriLabels, baseCyclOSM, baseIgnPlan, baseOpenTopo } from "./map.js";
import { traceGroups } from "./routes.js";
import { FIT_OPTIONS } from "./config.js";
import { triggerLocate } from "./locate.js";
import { loadPreferences, updatePreference } from "./preferences.js";
import { track } from "./analytics.js";
import { THEME_MAP, DEFAULT_THEME } from "./themes.js";
import { hiddenModes } from "./url-mode.js";

let _currentBase = "sat";
let _currentTheme = DEFAULT_THEME;

function _setBase(base, { skipTrack = false } = {}) {
  if (!skipTrack) track('Map Style Changed', { style: base });
  _currentBase = base;
  map.removeLayer(baseOSM);
  map.removeLayer(baseEsriSat);
  map.removeLayer(esriLabels);
  map.removeLayer(baseCyclOSM);
  map.removeLayer(baseIgnPlan);
  map.removeLayer(baseOpenTopo);
  if (base === "sat") {
    baseEsriSat.addTo(map);
    esriLabels.addTo(map);
  } else if (base === "cyclosm") {
    baseCyclOSM.addTo(map);
  } else if (base === "ign") {
    baseIgnPlan.addTo(map);
  } else if (base === "topo") {
    baseOpenTopo.addTo(map);
  } else {
    baseOSM.addTo(map);
  }
  updatePreference("baseLayer", base);
  _syncBaseActive();
}

function _syncBaseActive() {
  document.querySelectorAll("[data-basemap]").forEach((btn) => {
    btn.classList.toggle("lrz-apanel-btn--active", btn.dataset.basemap === _currentBase);
  });
}

function _syncThemeActive(key) {
  document.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.classList.toggle("lrz-apanel-btn--active", btn.dataset.theme === key);
  });
}

function _applyColorToTraces(color) {
  traceGroups.forEach(({ group, layers }) => {
    layers.forEach((layer) => layer.setStyle({ color }));
    // Update the legend swatch for this group in the panel
    const cb = document.querySelector(`[data-group-id="${group.id}"]`);
    const visual = cb?.closest('.lrz-row')?.querySelector('.lrz-row__visual');
    if (visual) {
      visual.style.background = group.dashed
        ? `repeating-linear-gradient(to right,${color} 0 5px,transparent 5px 9px)`
        : color;
    }
  });
}

/** Applique un thème complet (fond + couleur traces + police UI). */
export function applyTheme(key, { changeBasemap = true, persist = true } = {}) {
  const theme = THEME_MAP.get(key);
  if (!theme) return;

  const prev = _currentTheme;
  _currentTheme = key;

  if (changeBasemap) {
    _setBase(theme.basemap, { skipTrack: true });
  }

  document.documentElement.style.setProperty('--lrz-font-theme', theme.fontStack);
  document.documentElement.style.setProperty('--lrz-or', theme.color);
  _applyColorToTraces(theme.color);
  _syncThemeActive(key);

  if (persist) localStorage.setItem('lrz_theme', key);
  if (changeBasemap) track('Theme Changed', { theme: key, from: prev });
}

/** Recolorise les traces avec le thème courant (à appeler après wireTraceCheckboxes). */
export function applyThemeColors() {
  const theme = THEME_MAP.get(_currentTheme);
  if (theme) _applyColorToTraces(theme.color);
}

export function initActionsPanel() {
  const prefs = loadPreferences();
  _currentBase = prefs.baseLayer || "sat";
  _syncBaseActive();

  // Restaurer l'état visuel du thème (police + bouton actif) — les traces
  // seront recolorisées après wireTraceCheckboxes via applyThemeColors()
  // Le mode for=elle conserve son ambiance propre, sans thème
  if (!hiddenModes.rabbit) {
    const storedTheme = localStorage.getItem('lrz_theme') || DEFAULT_THEME;
    _currentTheme = storedTheme;
    const theme = THEME_MAP.get(storedTheme);
    if (theme) {
      document.documentElement.style.setProperty('--lrz-font-theme', theme.fontStack);
      document.documentElement.style.setProperty('--lrz-or', theme.color);
      _syncThemeActive(storedTheme);
    }
  }

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
          _setBase("cyclosm");
          break;
        case "set-basemap":
          _setBase(btn.dataset.basemap);
          break;
        case "theme":
          applyTheme(btn.dataset.theme);
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
