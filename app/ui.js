/**
 * app/ui.js — Interface utilisateur (filtres, légende, drawer, layer control)
 *
 * Responsabilités :
 *   - générer les checkboxes de filtres depuis POI_TYPES
 *   - générer la légende depuis POI_TYPES + les lignes de traces
 *   - drawer mobile (toggle du panneau filtres sur petit écran)
 *   - layer control Leaflet (fonds + overlays) + persistance du fond
 *
 * Tout est lié aux modules de carte/données via imports ; ce module ne
 * connaît pas la logique métier, juste le rendu et les interactions UI.
 */

import { Control } from "leaflet";

import { map, baseOSM, baseEsriSat, esriLabels } from "./map.js";
import { routeLayer, routeLayerActe1, boucleLayer } from "./routes.js";
import { cluster } from "./poi.js";
import { POI_TYPES } from "./types.js";
import { escapeHtml } from "./helpers.js";

// ───────────────────────────────────────────────────── Filtres

export function renderFilters() {
  const grid = document.getElementById("filtersGrid");
  grid.innerHTML = Object.entries(POI_TYPES)
    .map(
      ([key, cfg]) => `
        <label>
          <input
            type="checkbox"
            class="type-filter"
            value="${escapeHtml(key)}"
            ${cfg.defaultChecked ? "checked" : ""}
          />
          ${escapeHtml(cfg.label)}
        </label>
      `,
    )
    .join("");
}

// ────────────────────────────────────────────────────── Légende

export function renderLegend() {
  const grid = document.getElementById("legendGrid");

  const traceRows = `
    <div class="legend-line" style="background:#2E86AB"></div>
    <div>Trace principale</div>
    <div class="legend-line" style="background:#FF7F00; border-top: 2px dashed #FF7F00; height: 0"></div>
    <div>Boucle angevine</div>
  `;

  const poiRows = Object.entries(POI_TYPES)
    .map(
      ([, cfg]) => `
        <div class="legend-marker" style="border-color:${cfg.color}">${cfg.emoji}</div>
        <div>${escapeHtml(cfg.label)}</div>
      `,
    )
    .join("");

  grid.innerHTML = traceRows + poiRows;
}

// ───────────────────────────────────────────────── Drawer mobile

export function initMobileDrawer() {
  const toggleBtn = document.getElementById("toggleFilters");
  const panel = document.getElementById("filtersPanel");

  const setOpen = (open) => {
    panel.classList.toggle("open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
  };

  toggleBtn.addEventListener("click", () =>
    setOpen(!panel.classList.contains("open")),
  );

  // Clic sur la carte → ferme le drawer sur mobile uniquement
  map.on("click", () => {
    if (window.matchMedia("(max-width:899px)").matches) setOpen(false);
  });
}

// ───────────────────────────────────────────────── Layer control

export function initLayerControl() {
  const baseMaps = {
    "Plan (OSM)": baseOSM,
    "Satellite (Esri)": baseEsriSat,
  };
  const overlays = {
    "Trace principale": routeLayer,
    "Acte 1": routeLayerActe1,
    "Boucle Angevine": boucleLayer,
    "Points d'intérêt": cluster,
  };
  new Control.Layers(baseMaps, overlays, { collapsed: false }).addTo(map);

  // Synchroniser les labels Esri avec le fond + persister le choix
  map.on("baselayerchange", (e) => {
    if (e.name.includes("Satellite")) {
      esriLabels.addTo(map);
      localStorage.setItem("baseLayer", "sat");
    } else {
      map.removeLayer(esriLabels);
      localStorage.setItem("baseLayer", "osm");
    }
  });
}
