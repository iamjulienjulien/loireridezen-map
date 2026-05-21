/**
 * app/ui.js — Rendu et interactions du panel cockpit
 *
 * 4 sections : Traces · POI · Photos · Options
 * Accordion pliable (état persisté via preferences.js), badge "X visibles".
 * Lignes d'actions : zoom, toggle-map, reset-view, goto-julien, locate-me.
 */

import { FeatureGroup } from "leaflet";
import * as leafletExtraMarkers from "leaflet-extra-markers";

import { map, baseOSM, baseEsriSat, esriLabels } from "./map.js";
import { traceGroups, loadAllRoutes } from "./routes.js";
import { POI_TYPES, SHAPES, TRACE_MARKER_TYPES, getGroupColorPreview } from "./types.js";

const { Icon: ExtraIcon, TackCircleBorder } = leafletExtraMarkers;
import { getVisiblePoiCount } from "./poi.js";
import { triggerLocate } from "./locate.js";
import { loadPreferences, updatePreference, resetPreferences } from "./preferences.js";
import { escapeHtml, lightenHex } from "./helpers.js";
import { FIT_OPTIONS } from "./config.js";
import { hiddenModes } from "./url-mode.js";

// Map<groupId, FeatureGroup> peuplée après wireTraceCheckboxes()
const traceFeatureGroups = new Map();

// Coordonnées de Julien (mises à jour via lrz:position-loaded)
let _gotoJulienCoords = null;

// ─────────────────────────────────────── Section 1 : Contrôles

function _updateMapToggleLabel(base) {
  const label = document.getElementById("map-toggle-label");
  if (label) label.textContent = base === "sat" ? "🛰️ Satellite" : "🗺️ Plan";
}

export function updateGotoJulienButton(active) {
  const btn = document.getElementById("btn-goto-julien");
  if (!btn) return;
  btn.disabled = !active;
  btn.classList.toggle("lrz-btn--disabled", !active);
  btn.title = active ? "Aller à la position de Julien" : "Pas de position active";
}

export function initControls(map) {
  const prefs = loadPreferences();
  let currentBase = prefs.baseLayer || "osm";

  // Initialiser le fond de carte depuis les prefs
  if (currentBase === "sat") {
    map.removeLayer(baseOSM);
    baseEsriSat.addTo(map);
    esriLabels.addTo(map);
  }
  _updateMapToggleLabel(currentBase);

  // Boutons data-action
  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switch (btn.dataset.action) {
        case "zoom-in":
          map.zoomIn();
          break;
        case "zoom-out":
          map.zoomOut();
          break;
        case "toggle-map": {
          currentBase = currentBase === "osm" ? "sat" : "osm";
          if (currentBase === "sat") {
            map.removeLayer(baseOSM);
            baseEsriSat.addTo(map);
            esriLabels.addTo(map);
          } else {
            map.removeLayer(baseEsriSat);
            map.removeLayer(esriLabels);
            baseOSM.addTo(map);
          }
          updatePreference("baseLayer", currentBase);
          _updateMapToggleLabel(currentBase);
          break;
        }
        case "reset-view": {
          const layers = [];
          traceGroups.forEach(({ layers: ls }) => layers.push(...ls));
          if (layers.length) {
            map.fitBounds(new FeatureGroup(layers).getBounds(), FIT_OPTIONS);
          }
          break;
        }
        case "goto-julien":
          if (_gotoJulienCoords) {
            map.flyTo(_gotoJulienCoords, 14, { duration: 1.2 });
          }
          break;
        case "locate-me":
          triggerLocate(map);
          break;
      }
    });
  });

  // Activer le bouton goto-julien quand la position est chargée
  document.addEventListener("lrz:position-loaded", ({ detail }) => {
    _gotoJulienCoords = detail.active ? [detail.lat, detail.lon] : null;
    updateGotoJulienButton(detail.active);
  });

  // Backward compat : segmented basemap (si HTML ancien encore présent)
  const opts = document.querySelectorAll(".lrz-segmented__opt");
  opts.forEach((btn) =>
    btn.classList.toggle("is-active", btn.dataset.basemap === currentBase),
  );
  opts.forEach((btn) => {
    btn.addEventListener("click", () => {
      currentBase = btn.dataset.basemap;
      opts.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (currentBase === "sat") {
        map.removeLayer(baseOSM);
        baseEsriSat.addTo(map);
        esriLabels.addTo(map);
      } else {
        map.removeLayer(baseEsriSat);
        map.removeLayer(esriLabels);
        baseOSM.addTo(map);
      }
      updatePreference("baseLayer", currentBase);
      _updateMapToggleLabel(currentBase);
    });
  });
}

// ─────────────────────────────────────── Section 2 : Traces

function colorPreviewStyle(preview) {
  if (preview.type === "solid") return `background:${preview.colors[0]}`;
  if (preview.type === "dashed") {
    return `background:repeating-linear-gradient(to right,${preview.colors[0]} 0 5px,transparent 5px 9px)`;
  }
  return `background:linear-gradient(to right,${preview.colors.join(",")})`;
}

export function renderTracesSection(groups, prefs) {
  const list = document.getElementById("traces-list");
  if (!list) return;

  const items = [...(groups.items ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const countEl = document.getElementById("traces-count");
  if (countEl) countEl.textContent = `(${items.length})`;

  const rows = items.map((group) => {
    const preview = getGroupColorPreview(group);
    const style = colorPreviewStyle(preview);
    const isChecked =
      prefs.traces?.[group.id] ?? (group.visible_by_default ?? true);
    return `
      <div class="lrz-row">
        <div class="lrz-row__visual" style="${style}"></div>
        <label class="lrz-row__label">${escapeHtml(group.label)}</label>
        <input type="checkbox" class="lrz-checkbox" data-group-id="${escapeHtml(group.id)}" ${isChecked ? "checked" : ""} />
      </div>`;
  });

  for (const [type, cfg] of Object.entries(TRACE_MARKER_TYPES)) {
    const isChecked = prefs.traceMarkers?.[type] ?? true;
    rows.push(`
      <div class="lrz-row">
        <div class="lrz-row__visual lrz-row__visual--emoji">${cfg.emoji}</div>
        <label class="lrz-row__label">${escapeHtml(cfg.labelPlural)}</label>
        <input type="checkbox" class="lrz-checkbox" data-trace-marker="${escapeHtml(type)}" ${isChecked ? "checked" : ""} />
      </div>`);
  }

  list.innerHTML = rows.join("");
}

export async function wireTraceCheckboxes() {
  await loadAllRoutes();

  for (const [groupId, { group, layers }] of traceGroups) {
    const fg = new FeatureGroup(layers);
    const cb = document.querySelector(`[data-group-id="${groupId}"]`);
    const visible = cb ? cb.checked : (group.visible_by_default ?? groupId !== "acte-1");
    if (visible) fg.addTo(map);
    traceFeatureGroups.set(groupId, fg);
  }

  document.querySelectorAll("[data-group-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const fg = traceFeatureGroups.get(cb.dataset.groupId);
      if (!fg) return;
      if (cb.checked) map.addLayer(fg);
      else map.removeLayer(fg);
      updatePreference(`traces.${cb.dataset.groupId}`, cb.checked);
    });
  });
}

export function wireTraceMarkerCheckboxes(traceMarkersObj, prefs) {
  document.querySelectorAll("[data-trace-marker]").forEach((cb) => {
    const type = cb.dataset.traceMarker;
    const fg = traceMarkersObj[type];
    if (!fg) return;
    if (cb.checked) fg.addTo(map);
    cb.addEventListener("change", () => {
      if (cb.checked) map.addLayer(fg);
      else map.removeLayer(fg);
      updatePreference(`traceMarkers.${type}`, cb.checked);
    });
  });
}

// ─────────────────────────────────────── Section 3 : POI

function renderMiniMarker(type) {
  const t = POI_TYPES[type];
  if (!t) return `<span style="font-size:1.1rem">📍</span>`;
  const icon = new ExtraIcon({
    content: t.emoji,
    color: lightenHex(t.color, 0.8),
    accentColor: t.color,
    svgStyle: { stroke: t.color, "stroke-width": "2" },
    svg: SHAPES[t.shape] || TackCircleBorder,
    scale: 0.75,
    shadow: "none",
  });
  const el = icon.createIcon();
  el.style.position = "static";
  el.style.margin = "0";
  return el.outerHTML;
}

export function renderPoiSection(prefs) {
  const list = document.getElementById("poi-list");
  if (!list) return;

  const types = Object.entries(POI_TYPES).filter(
    ([k, cfg]) => k !== "photo" && (!cfg.hidden || (k === "lapin" && hiddenModes.rabbit)),
  );

  const countEl = document.getElementById("poi-count");
  if (countEl) countEl.textContent = `(${types.length})`;

  list.innerHTML = types
    .map(([key, cfg]) => {
      const isChecked = prefs.poi?.[key] ?? (cfg.defaultChecked ?? true);
      return `
        <div class="lrz-row">
          <div class="lrz-row__marker">${renderMiniMarker(key)}</div>
          <label class="lrz-row__label">${escapeHtml(cfg.label)}</label>
          <input type="checkbox" class="lrz-checkbox type-filter" value="${escapeHtml(key)}" ${isChecked ? "checked" : ""} />
        </div>`;
    })
    .join("");
}

// ─────────────────────────────────────── Section 4 : Photos

export function renderPhotosSection(prefs) {
  const list = document.getElementById("photos-list");
  if (!list) return;

  const isChecked = prefs.poi?.photo ?? true;

  list.innerHTML = `
    <div class="lrz-row">
      <div class="lrz-row__marker">${renderMiniMarker("photo")}</div>
      <label class="lrz-row__label" id="photos-count-label">Photos géolocalisées</label>
      <input type="checkbox" class="lrz-checkbox type-filter" value="photo" ${isChecked ? "checked" : ""} />
    </div>`;

  fetch("data/pois/pois_photos.geojson")
    .then((r) => (r.ok ? r.json() : { features: [] }))
    .catch(() => ({ features: [] }))
    .then((fc) => {
      const label = document.getElementById("photos-count-label");
      if (label) label.textContent = `${(fc.features ?? []).length} photos géolocalisées`;
    });
}

// ─────────────────────────────────────── Drawer mobile (legacy guard)

export function initMobileDrawer() {
  const toggleBtn = document.getElementById("toggleFilters");
  if (!toggleBtn) return; // nouveau layout : pas de drawer toggle

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
  map.on("click", () => {
    if (window.matchMedia("(max-width:899px)").matches) setOpen(false);
  });
}

// ─────────────────────────────────────── Accordion + "Tout"

export function initAccordion(prefs) {
  document.querySelectorAll(".lrz-section").forEach((section) => {
    const sectionKey = section.dataset.section;
    const isCollapsed = prefs.sections?.[sectionKey] ?? false;
    if (isCollapsed) section.dataset.collapsed = "true";

    const toggle = section.querySelector(".lrz-section__toggle");

    const toggleSection = () => {
      const wasCollapsed = section.dataset.collapsed === "true";
      section.dataset.collapsed = wasCollapsed ? "false" : "true";
      updatePreference(`sections.${sectionKey}`, !wasCollapsed);
    };

    toggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleSection();
    });
    section.querySelector("h3")?.addEventListener("click", toggleSection);
  });

  document.querySelectorAll(".lrz-section__all").forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.closest(".lrz-section");
      const checkboxes = [...section.querySelectorAll(".lrz-checkbox")];
      const allChecked = checkboxes.every((cb) => cb.checked);
      checkboxes.forEach((cb) => {
        cb.checked = !allChecked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

// ─────────────────────────────────────── Toggle "Où je suis"

export function initCurrentPositionToggle(layer, loadFn, prefs) {
  const cb = document.getElementById("position-toggle");
  if (!cb) return;
  cb.checked = prefs.currentPosition ?? true;
  if (cb.checked) loadFn();
  cb.addEventListener("change", () => {
    if (cb.checked) loadFn();
    else map.removeLayer(layer);
    updatePreference("currentPosition", cb.checked);
  });
}

// ─────────────────────────────────────── Reset preferences

export function initResetButton() {
  document.getElementById("reset-prefs")?.addEventListener("click", () => {
    resetPreferences();
    location.reload();
  });
}

// ─────────────────────────────────────── Badge "X visibles"

export function initPoiBadge() {
  const badge = document.getElementById("poi-visible");
  if (!badge) return;
  const update = () => {
    badge.textContent = `· ${getVisiblePoiCount()} visibles`;
  };
  document.addEventListener("lrz:poi-loaded", update);
}

// ─────────────────────────────────────── Raccourcis clavier

export function initKeyboardShortcuts(map) {
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, [contenteditable]")) return;
    switch (e.key) {
      case "+":
      case "=":
        map.zoomIn();
        break;
      case "-":
        map.zoomOut();
        break;
      case "l":
      case "L":
        triggerLocate(map);
        break;
      case "Escape":
        document.getElementById("filtersPanel")?.classList.remove("open");
        break;
    }
  });
}
