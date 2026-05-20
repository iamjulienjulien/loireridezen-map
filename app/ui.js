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

import { Control, FeatureGroup } from "leaflet";
import * as leafletExtraMarkers from "leaflet-extra-markers";

import { map, baseOSM, baseEsriSat, esriLabels } from "./map.js";
import { traceGroups, loadAllRoutes } from "./routes.js";
import { cluster } from "./poi.js";
import { POI_TYPES, SHAPES } from "./types.js";
import { escapeHtml } from "./helpers.js";

const { Icon: ExtraIcon, TackCircleBorder } = leafletExtraMarkers;

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
  grid.innerHTML = "";

  grid.insertAdjacentHTML("beforeend", `
    <div class="legend-line" style="background:#2E86AB"></div>
    <div>Trace principale</div>
    <div class="legend-line legend-line--dashed"></div>
    <div>Boucle angevine</div>
  `);

  for (const [, cfg] of Object.entries(POI_TYPES)) {
    const icon = new ExtraIcon({
      content: cfg.emoji,
      color: cfg.color,
      accentColor: "rgba(0,0,0,0.18)",
      svg: SHAPES[cfg.shape] || TackCircleBorder,
      scale: 0.7,
      shadow: "none",
    });
    const el = icon.createIcon();
    // Reset Leaflet's absolute positioning for inline legend display
    el.style.position = "static";
    el.style.margin = "0";

    const label = document.createElement("div");
    label.textContent = cfg.label;

    grid.appendChild(el);
    grid.appendChild(label);
  }
}

// ───────────────────────────────────────────────── Drawer mobile

export function initMobileDrawer() {
  const toggleBtn = document.getElementById("toggleFilters");
  const panel = document.getElementById("filtersPanel");

  const backdrop = document.createElement("div");
  backdrop.id = "drawer-backdrop";
  document.body.appendChild(backdrop);

  const setOpen = (open) => {
    panel.classList.toggle("open", open);
    backdrop.classList.toggle("open", open);
    toggleBtn.setAttribute("aria-expanded", String(open));
  };

  toggleBtn.addEventListener("click", () =>
    setOpen(!panel.classList.contains("open")),
  );

  backdrop.addEventListener("click", () => setOpen(false));

  // Clic sur la carte → ferme le drawer sur mobile uniquement
  map.on("click", () => {
    if (window.matchMedia("(max-width:899px)").matches) setOpen(false);
  });
}

// ───────────────────────────────────────────────── Layer control

export async function initLayerControl() {
  const baseMaps = {
    "Plan (OSM)": baseOSM,
    "Satellite (Esri)": baseEsriSat,
  };

  const control = new Control.Layers(baseMaps, {}, { collapsed: false }).addTo(map);

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

  // Attendre que les traces soient chargées (singleton : pas de double fetch)
  await loadAllRoutes();

  for (const [groupId, { group, layers }] of traceGroups) {
    const fg = new FeatureGroup(layers);
    const visible = group.visible_by_default ?? groupId !== "acte-1";
    if (visible) fg.addTo(map);
    control.addOverlay(fg, group.label);
  }

  control.addOverlay(cluster, "Points d'intérêt");
}
