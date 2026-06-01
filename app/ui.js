/**
 * app/ui.js — Rendu et interactions du panel cockpit
 *
 * 4 sections : Traces · POI · Photos · Options
 * Accordion pliable (état persisté via preferences.js), badge "X visibles".
 */

import { FeatureGroup } from "leaflet";
import * as leafletExtraMarkers from "leaflet-extra-markers";

import { map } from "./map.js";
import { traceGroups, loadAllRoutes } from "./routes.js";
import { POI_TYPES, SHAPES, TRACE_MARKER_TYPES, getGroupColorPreview } from "./types.js";

const { Icon: ExtraIcon, TackCircleBorder } = leafletExtraMarkers;
import { triggerLocate } from "./locate.js";
import { loadPreferences, updatePreference, resetPreferences } from "./preferences.js";
import { escapeHtml, lightenHex } from "./helpers.js";
import { hiddenModes } from "./url-mode.js";
import { track } from "./analytics.js";

// Map<groupId, FeatureGroup> peuplée après wireTraceCheckboxes()
export const traceFeatureGroups = new Map();

// ─────────────────────────────────────── Section 1 : Traces

const LOIRE_GROUPS = ['acte-1', 'acte-2', 'acte-3'];
const OTHER_GROUPS = ['micro-aventure', 'velodyssee'];

function groupSubsection(groupId) {
  if (LOIRE_GROUPS.includes(groupId)) return 'loire';
  if (OTHER_GROUPS.includes(groupId)) return 'other';
  return 'other';
}

function colorPreviewStyle(preview) {
  if (preview.type === "solid") return `background:${preview.colors[0]}`;
  if (preview.type === "dashed") {
    return `background:repeating-linear-gradient(to right,${preview.colors[0]} 0 5px,transparent 5px 9px)`;
  }
  return `background:linear-gradient(to right,${preview.colors.join(",")})`;
}

function buildTraceRow(group, prefs, isEmpty) {
  const preview = getGroupColorPreview(group);
  const displayPreview = preview.type === 'dashed' ? { ...preview, type: 'solid' } : preview;
  const style = colorPreviewStyle(displayPreview);
  const isChecked = prefs.traces?.[group.id] ?? (group.visible_by_default ?? true);
  const emptyClass = isEmpty ? ' lrz-trace-row--empty' : '';
  const suffix = isEmpty
    ? ` <span class="lrz-trace-row__suffix">(à venir)</span>`
    : '';
  return `
    <div class="lrz-row${emptyClass}">
      <div class="lrz-row__visual" style="${style}"></div>
      <label class="lrz-row__label">${escapeHtml(group.label)}${suffix}</label>
      <input type="checkbox" class="lrz-checkbox" data-group-id="${escapeHtml(group.id)}" ${isChecked ? "checked" : ""} />
    </div>`;
}

function buildSubsection(title, groupItems, prefs, tracesItems) {
  if (groupItems.length === 0) return '';
  const groupIds = new Set(tracesItems.map((t) => t.group));
  const rows = groupItems.map((g) => buildTraceRow(g, prefs, !groupIds.has(g.id)));
  return `
    <div class="lrz-trace-subsection">
      <h3 class="lrz-trace-subsection__title">${escapeHtml(title)}</h3>
      <div class="lrz-trace-subsection__list">${rows.join('')}</div>
    </div>`;
}

export function renderTracesSection(groups, prefs, traces) {
  const list = document.getElementById("traces-list");
  if (!list) return;

  const items = [...(groups.items ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  const tracesItems = traces?.items ?? [];

  const loireGroups = items.filter((g) => groupSubsection(g.id) === 'loire');
  const otherGroups = items.filter((g) => groupSubsection(g.id) === 'other');

  const legendItems = Object.entries(TRACE_MARKER_TYPES)
    .map(([key, cfg]) =>
      `<span class="lrz-legend-row__item"><span class="lrz-legend-row__emoji lrz-legend-row__emoji--${key}">${cfg.emoji}</span><span>${escapeHtml(cfg.label)}</span></span>`)
    .join("");

  list.innerHTML =
    buildSubsection('Loire à Vélo', loireGroups, prefs, tracesItems) +
    buildSubsection('Autres voyages', otherGroups, prefs, tracesItems) +
    `<div class="lrz-legend__title">Légende</div>` +
    `<div class="lrz-legend-row lrz-legend-row--inline">${legendItems}</div>`;
}

export function addEuroVeloToggle(eurovelo, prefs) {
  const list = document.getElementById("traces-list");
  if (!list) return;

  const legend = list.querySelector(".lrz-legend__title");
  const strokeStyle =
    "display:inline-block;width:1.5rem;height:3px;background:#6b7280;opacity:0.6;border-radius:2px;flex-shrink:0";

  const ev6Row = document.createElement("span");
  ev6Row.id = "eurovelo-row";
  ev6Row.className = "lrz-legend__eurovelo";
  ev6Row.innerHTML =
    `<span class="lrz-legend-row__visual" style="${strokeStyle}"></span>` +
    `<span>EuroVelo 6</span>`;

  const ev1Row = document.createElement("span");
  ev1Row.id = "eurovelo-1-row";
  ev1Row.className = "lrz-legend__eurovelo";
  ev1Row.innerHTML =
    `<span class="lrz-legend-row__visual" style="${strokeStyle}"></span>` +
    `<span>EuroVelo 1</span>`;

  const evWrapper = document.createElement("div");
  evWrapper.className = "lrz-legend__eurovelos";
  evWrapper.append(ev6Row, ev1Row);

  if (legend) {
    legend.after(evWrapper);
  } else {
    list.appendChild(evWrapper);
  }
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
      track('Layer Item Toggled', { section: 'traces', item: cb.dataset.groupId, state: cb.checked ? 'on' : 'off' });
      updatePreference(`traces.${cb.dataset.groupId}`, cb.checked);
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
      <label class="lrz-row__label">Photos géolocalisées</label>
      <input type="checkbox" class="lrz-checkbox type-filter" value="photo" ${isChecked ? "checked" : ""} />
    </div>`;
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
    track('Filters Toggled', { state: open ? 'open' : 'close' });
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
      track('Layer Toggled', { section: sectionKey, state: wasCollapsed ? 'on' : 'off' });
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
      const sectionKey = section?.dataset.section || '';
      const checkboxes = [...section.querySelectorAll(".lrz-checkbox")];
      const allChecked = checkboxes.every((cb) => cb.checked);
      track('Layer Tout Clicked', { section: sectionKey });
      checkboxes.forEach((cb) => {
        cb.checked = !allChecked;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

// ─────────────────────────────────────── Toggle "Où je suis"

export function initCurrentPositionToggle(layer, loadFn, prefs) {
  // Délégation sur document : survit aux re-renders de info-panel._render()
  document.addEventListener("change", (e) => {
    if (e.target.id !== "position-toggle") return;
    if (e.target.checked) layer.addTo(map);
    else map.removeLayer(layer);
    updatePreference("currentPosition", e.target.checked);
  });

  // À chaque re-render du bloc position, restaurer l'état visuel de la checkbox
  document.addEventListener("lrz:position-loaded", ({ detail }) => {
    if (!detail?.active) return;
    const cb = document.getElementById("position-toggle");
    if (!cb) return;
    const visible = loadPreferences().currentPosition ?? true;
    cb.checked = visible;
    if (!visible) map.removeLayer(layer);
  });

  loadFn();
}

// ─────────────────────────────────────── Reset preferences

export function initResetButton() {
  document.getElementById("reset-prefs")?.addEventListener("click", () => {
    track('Preferences Reset');
    resetPreferences();
    location.reload();
  });
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
