/**
 * app/ui.js — Rendu et interactions du panel cockpit
 *
 * 4 sections : Contrôles · Traces · Photos · Points d'intérêt
 * Accordion pliable (état persisté via preferences.js), bouton "Tout",
 * raccourcis clavier, badge "X visibles" pour les POI.
 */

import { FeatureGroup } from "leaflet";
import * as leafletExtraMarkers from "leaflet-extra-markers";

import { map, baseOSM, baseEsriSat, esriLabels } from "./map.js";
import { traceGroups, loadAllRoutes } from "./routes.js";
import { POI_TYPES, SHAPES, TRACE_MARKER_TYPES, getGroupColorPreview } from "./types.js";
import { getVisiblePoiCount } from "./poi.js";
import { triggerLocate } from "./locate.js";
import { updatePreference, resetPreferences } from "./preferences.js";
import { escapeHtml } from "./helpers.js";
import { FIT_OPTIONS } from "./config.js";

const { Icon: ExtraIcon, TackCircleBorder } = leafletExtraMarkers;

// Map<groupId, FeatureGroup> peuplée après wireTraceCheckboxes()
const traceFeatureGroups = new Map();

// ─────────────────────────────────────── Section 1 : Contrôles

export function initControls(map) {
  document.getElementById("ctrl-zoom-in")?.addEventListener("click", () => map.zoomIn());
  document.getElementById("ctrl-zoom-out")?.addEventListener("click", () => map.zoomOut());
  document.getElementById("ctrl-locate")?.addEventListener("click", () => triggerLocate(map));

  document.getElementById("ctrl-fit")?.addEventListener("click", () => {
    const layers = [];
    traceGroups.forEach(({ layers: ls }) => layers.push(...ls));
    if (layers.length) {
      map.fitBounds(new FeatureGroup(layers).getBounds(), FIT_OPTIONS);
    }
  });

  const opts = document.querySelectorAll(".lrz-segmented__opt");
  const savedBase = localStorage.getItem("baseLayer") || "osm";

  opts.forEach((btn) =>
    btn.classList.toggle("is-active", btn.dataset.basemap === savedBase),
  );

  opts.forEach((btn) => {
    btn.addEventListener("click", () => {
      const bm = btn.dataset.basemap;
      opts.forEach((b) => b.classList.toggle("is-active", b === btn));
      if (bm === "sat") {
        map.removeLayer(baseOSM);
        baseEsriSat.addTo(map);
        esriLabels.addTo(map);
        localStorage.setItem("baseLayer", "sat");
        updatePreference("baseLayer", "sat");
      } else {
        map.removeLayer(baseEsriSat);
        map.removeLayer(esriLabels);
        baseOSM.addTo(map);
        localStorage.setItem("baseLayer", "osm");
        updatePreference("baseLayer", "osm");
      }
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
      prefs.traces?.[group.id] ?? (group.visible_by_default ?? group.id !== "acte-1");
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
    color: t.color,
    accentColor: "rgba(0,0,0,0.18)",
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

  const types = Object.entries(POI_TYPES).filter(([k]) => k !== "photo");

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

// ─────────────────────────────────────── Drawer mobile

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
