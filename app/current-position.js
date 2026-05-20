/**
 * app/current-position.js — Marker "Où je suis" rechargé depuis current_position.json
 *
 * Le JSON est mis à jour manuellement via scripts/update_position.py.
 * La carte le recharge toutes les 5 minutes (setInterval dans app.js).
 */

import { DivIcon, Marker } from "leaflet";
import { map } from "./map.js";
import { escapeHtml } from "./helpers.js";

export const currentPositionLayer = new Marker([0, 0], { opacity: 0 });

function renderPopup(data) {
  const date = new Date(data.updated_at).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
  return `
    <div class="lrz-current-popup">
      <strong>Je suis à ${escapeHtml(data.label)}</strong>
      <p class="lrz-current-popup__date">${escapeHtml(date)}</p>
      ${data.description ? `<p>${escapeHtml(data.description)}</p>` : ""}
    </div>
  `;
}

export async function loadCurrentPosition() {
  try {
    const r = await fetch("data/catalog/current_position.json", { cache: "no-cache" });
    if (!r.ok) return;
    const data = await r.json();

    if (!data.active || !data.coordinates) {
      map.removeLayer(currentPositionLayer);
      return;
    }

    const [lon, lat] = data.coordinates;
    const icon = new DivIcon({
      html: `<div class="lrz-current-marker-wrap"><span class="lrz-current-marker">🚲</span><span class="lrz-current-ripple"></span></div>`,
      className: "",
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    currentPositionLayer.setLatLng([lat, lon]);
    currentPositionLayer.setIcon(icon);
    currentPositionLayer.setOpacity(1);
    currentPositionLayer.bindPopup(renderPopup(data));
    currentPositionLayer.addTo(map);
  } catch (err) {
    console.warn("[loireridezen] current_position load failed", err);
  }
}
