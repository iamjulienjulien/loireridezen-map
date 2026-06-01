/**
 * app/carnets/apply.js — Applique un carnet complet sur l'UI
 */

import {
  map,
  baseOSM, baseOSMDark, basePositron, baseOSMFr,
  baseEsriSat, esriLabels,
  baseCyclOSM, baseIgnPlan, baseOpenTopo,
} from "../map.js";
import { traceGroups } from "../routes.js";
import { lightenHex } from "../helpers.js";

const PHOTO_CATEGORIES_ENABLED_IN_DB = false;

// ─── Basemap ────────────────────────────────────────────────────────────────

function _switchBasemap(basemap) {
  const all = [baseOSM, baseOSMDark, basePositron, baseOSMFr, baseEsriSat, esriLabels, baseCyclOSM, baseIgnPlan, baseOpenTopo];
  all.forEach((l) => { try { map.removeLayer(l); } catch {} });

  switch (basemap) {
    case "satellite-esri":
      baseEsriSat.addTo(map);
      esriLabels.addTo(map);
      break;
    case "osm-dark":
      baseOSMDark.addTo(map);
      break;
    case "positron":
      basePositron.addTo(map);
      break;
    case "osm-fr":
      baseOSMFr.addTo(map);
      break;
    case "ign-plan":
      baseIgnPlan.addTo(map);
      break;
    case "cyclosm":
      baseCyclOSM.addTo(map);
      break;
    case "opentopomap":
      baseOpenTopo.addTo(map);
      break;
    default: // osm-plan
      baseOSM.addTo(map);
  }
}

// ─── Trace coloring ─────────────────────────────────────────────────────────

function _hexToHue(hex) {
  if (!hex || hex[0] !== "#") return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = Math.round(h * 60);
  return h < 0 ? h + 360 : h;
}

function _applyColorToTraces(color, velodysseeColor) {
  const actGroups = [...traceGroups.values()]
    .filter(({ group }) => group.id.startsWith("acte-"))
    .sort((a, b) => (a.group.order ?? 0) - (b.group.order ?? 0));

  traceGroups.forEach(({ group, layers }) => {
    let groupColor;
    if (group.id === "micro-aventure") {
      groupColor = "#111111";
    } else if (group.id === "velodyssee") {
      groupColor = velodysseeColor ?? color;
    } else if (group.id.startsWith("acte-")) {
      const idx = actGroups.findIndex((g) => g.group.id === group.id);
      const total = actGroups.length;
      const factor = total > 1 ? ((total - 1 - idx) / (total - 1)) * 0.5 : 0;
      groupColor = factor > 0 ? lightenHex(color, factor) : color;
    } else {
      groupColor = color;
    }

    layers.forEach((layer) => layer.setStyle({ color: groupColor }));

    const cb = document.querySelector(`[data-group-id="${group.id}"]`);
    const visual = cb?.closest(".lrz-row")?.querySelector(".lrz-row__visual");
    if (visual) {
      visual.style.background = group.dashed
        ? `repeating-linear-gradient(to right,${groupColor} 0 5px,transparent 5px 9px)`
        : groupColor;
    }
  });
}

// ─── POI filter ─────────────────────────────────────────────────────────────

const ALL_POI_TYPES = ["chateau", "coupdecoeur", "patrimoine", "guinguette", "hébergement", "vigneron", "nature", "photo"];

export function applyPoiFilter(enabledTypes) {
  ALL_POI_TYPES.forEach((type) => {
    const isEnabled = enabledTypes.includes(type);
    const cb = document.querySelector(`.type-filter[value="${CSS.escape(type)}"]`);
    if (!cb) return;
    if (cb.checked !== isEnabled) {
      cb.checked = isEnabled;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

// ─── Photo filter ────────────────────────────────────────────────────────────

function _applyPhotoFilter(_enabledCategories) {
  if (!PHOTO_CATEGORIES_ENABLED_IN_DB) return; // no-op
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function applyCarnet(carnet) {
  const root = document.documentElement;

  // 1. CSS variables
  root.style.setProperty("--lrz-or", carnet.visual.primaryColor);
  root.style.setProperty("--lrz-color-primary", carnet.visual.primaryColor);
  root.style.setProperty("--lrz-font-theme", carnet.visual.fontTheme);

  const traceHue = (_hexToHue(carnet.visual.primaryColor) - 38 + 360) % 360;
  root.style.setProperty("--lrz-trace-hue", `${traceHue}deg`);

  if (carnet.visual.accentColor) {
    root.style.setProperty("--lrz-color-accent", carnet.visual.accentColor);
  } else {
    root.style.removeProperty("--lrz-color-accent");
  }

  // 2. Mode UI light / dark
  document.body.dataset.uiMode = carnet.uiMode;

  // 3. Basemap
  _switchBasemap(carnet.visual.basemap);

  // 4. Trace colors
  _applyColorToTraces(carnet.visual.primaryColor, null);

  // 5. POI filter
  applyPoiFilter(carnet.pois.defaultEnabled);

  // 6. Photo filter (no-op)
  _applyPhotoFilter(carnet.photoCategories.enabled);
}

/** Recolorise les traces avec le carnet courant (appelé après wireTraceCheckboxes). */
export function applyCarnetColors(carnet) {
  _applyColorToTraces(carnet.visual.primaryColor, null);
}
