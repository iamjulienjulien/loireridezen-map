/**
 * app/step-popup.js — Rendu HTML des popups d'étape riches
 */

import { escapeHtml } from "./helpers.js";

function formatDateFr(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

function formatDurationFr(h) {
  if (!h) return null;
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return mins ? `${hours} h ${mins.toString().padStart(2, "0")}` : `${hours} h`;
}

function formatDistance(km) {
  if (!km) return null;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

export function renderStepPopup(item) {
  const date = item.date ? formatDateFr(item.date) : null;
  const status = item.date_status;
  const distance = formatDistance(item.distance_km);
  const duration = formatDurationFr(item.duration_h);
  const elev = item.elevation_gain_m ? `${item.elevation_gain_m} m D+` : null;
  const weather = item.weather;

  return `
    <div class="lrz-step-popup">
      <header class="lrz-step-popup__header">
        <strong>${escapeHtml(item.label)}</strong>
        ${date ? `<span class="lrz-step-popup__date">🗓 ${escapeHtml(date)}${status ? ` <em class="lrz-step-popup__status">(${escapeHtml(status)})</em>` : ""}</span>` : ""}
      </header>
      <ul class="lrz-step-popup__stats">
        ${distance ? `<li>📏 <strong>${escapeHtml(distance)}</strong></li>` : ""}
        ${duration ? `<li>⏱ <strong>${escapeHtml(duration)}</strong></li>` : ""}
        ${elev ? `<li>⛰ <strong>${escapeHtml(elev)}</strong></li>` : ""}
      </ul>
      ${weather && status === "effective" ? `
        <div class="lrz-step-popup__weather">
          ${escapeHtml(weather.icon || "🌤️")}
          <strong>${escapeHtml(weather.description || "")}</strong>
          ${weather.temp_min_c != null && weather.temp_max_c != null ? `<span>${weather.temp_min_c}°–${weather.temp_max_c}°C</span>` : ""}
        </div>
      ` : status === "prévue" ? `
        <div class="lrz-step-popup__weather">
          <em style="color: var(--lrz-ink-soft, #888); font-size: 0.8125rem;">Météo à venir…</em>
        </div>
      ` : ""}
    </div>
  `;
}
