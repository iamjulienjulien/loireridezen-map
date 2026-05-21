/**
 * app/current-position.js — Marker "Où je suis" rechargé depuis current_position.json
 *
 * Le JSON est mis à jour manuellement via scripts/update_position.py.
 * - Tooltip permanent Leaflet mis à jour toutes les 60s (heure relative)
 * - Dispatche lrz:position-loaded pour activer le bouton goto-julien
 */

import { DivIcon, Marker, Tooltip } from "leaflet";
import { map } from "./map.js";

export const currentPositionLayer = new Marker([0, 0], { opacity: 0 });

let _updatedAt = null;
let _tooltipInterval = null;

function formatRelativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "il y a moins d'une minute";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `il y a ${diffD} j`;
}

function tooltipContent(updatedAt) {
  return `<strong>Je suis là</strong><span class="lrz-position-tooltip__time">${formatRelativeTime(updatedAt)}</span>`;
}

function _refreshTooltip() {
  if (!_updatedAt) return;
  const tooltip = currentPositionLayer.getTooltip();
  if (tooltip) tooltip.setContent(tooltipContent(_updatedAt));
}

export async function loadCurrentPosition() {
  try {
    const r = await fetch("data/catalog/current_position.json", { cache: "no-cache" });
    if (!r.ok) return;
    const data = await r.json();

    if (!data.active || !data.coordinates) {
      map.removeLayer(currentPositionLayer);
      document.dispatchEvent(new CustomEvent("lrz:position-loaded", { detail: { active: false } }));
      return;
    }

    const [lon, lat] = data.coordinates;
    _updatedAt = data.updated_at;

    const icon = new DivIcon({
      html: `<div class="lrz-current-marker-wrap"><span class="lrz-current-marker">🚲</span><span class="lrz-current-ripple"></span></div>`,
      className: "",
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    currentPositionLayer.setLatLng([lat, lon]);
    currentPositionLayer.setIcon(icon);
    currentPositionLayer.setOpacity(1);

    // Tooltip permanent (remplace le popup)
    if (!currentPositionLayer.getTooltip()) {
      const tooltip = new Tooltip({
        permanent: true,
        direction: "top",
        offset: [0, -24],
        className: "lrz-position-tooltip",
      });
      currentPositionLayer.bindTooltip(tooltip);
    }
    currentPositionLayer.getTooltip().setContent(tooltipContent(_updatedAt));
    currentPositionLayer.addTo(map);
    currentPositionLayer.openTooltip();

    // Refresh du contenu toutes les 60s
    if (!_tooltipInterval) {
      _tooltipInterval = setInterval(_refreshTooltip, 60_000);
    }

    document.dispatchEvent(new CustomEvent("lrz:position-loaded", {
      detail: { active: true, lat, lon },
    }));
  } catch (err) {
    console.warn("[loireridezen] current_position load failed", err);
  }
}
