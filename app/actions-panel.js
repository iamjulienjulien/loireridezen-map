/**
 * app/actions-panel.js — Panel flottant d'actions (top-right)
 *
 * Groupe 1 : zoom+ / zoom−
 * Groupe 2 : Sélecteur de carnets (7 boutons emoji)
 * Groupe 3 : Recentrer / Ma position
 */

import { FeatureGroup } from "leaflet";
import { map } from "./map.js";
import { traceGroups } from "./routes.js";
import { FIT_OPTIONS } from "./config.js";
import { triggerLocate } from "./locate.js";
import { track } from "./analytics.js";
import { hiddenModes } from "./url-mode.js";
import { migrateLocalStorage, getCurrentCarnetKey, setCarnet, getCurrentCarnet } from "./carnets/state.js";
import { applyCarnet, applyCarnetColors } from "./carnets/apply.js";

export function applyTheme() {} // compat shim — ne rien faire
export function applyThemeColors() {
  const carnet = getCurrentCarnet();
  if (carnet) applyCarnetColors(carnet);
}

export function initActionsPanel() {
  migrateLocalStorage();

  if (!hiddenModes.rabbit) {
    const key = getCurrentCarnetKey();
    const carnet = getCurrentCarnet();
    if (carnet) {
      // Applique CSS vars + ui-mode + font au boot (sans basemap ni POI — déjà gérés)
      const root = document.documentElement;
      root.style.setProperty("--lrz-or", carnet.visual.primaryColor);
      root.style.setProperty("--lrz-color-primary", carnet.visual.primaryColor);
      root.style.setProperty("--lrz-font-theme", carnet.visual.fontTheme);
      const hue = (_hexToHue(carnet.visual.primaryColor) - 38 + 360) % 360;
      root.style.setProperty("--lrz-trace-hue", `${hue}deg`);
      document.body.dataset.uiMode = carnet.uiMode;

      // Sync sélecteur
      document.querySelectorAll("[data-carnet]").forEach((btn) => {
        const isActive = btn.dataset.carnet === key;
        btn.classList.toggle("lrz-carnet-btn--active", isActive);
        btn.setAttribute("aria-pressed", String(isActive));
      });
    }
  }

  // Sélecteur de carnets
  document.querySelectorAll("[data-carnet]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.carnet;
      track("Carnet Changed", { carnet: key });
      setCarnet(key, { withAccroche: true });
    });
  });

  // Actions standard
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switch (btn.dataset.action) {
        case "zoom-in":
          track("Zoom In", { from_zoom: map.getZoom() });
          map.zoomIn();
          break;
        case "zoom-out":
          track("Zoom Out", { from_zoom: map.getZoom() });
          map.zoomOut();
          break;
        case "reset-view": {
          track("Reset View");
          const layers = [];
          traceGroups.forEach(({ layers: ls }) => layers.push(...ls));
          if (layers.length) {
            map.fitBounds(new FeatureGroup(layers).getBounds(), FIT_OPTIONS);
          }
          break;
        }
        case "locate-me":
          track("Locate Me");
          triggerLocate(map);
          break;
      }
    });
  });
}

function _hexToHue(hex) {
  if (!hex || hex[0] !== "#") return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(h * 60 + (h < 0 ? 360 : 0));
}
