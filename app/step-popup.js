/**
 * app/step-popup.js — Rendu HTML des popups d'étape riches
 */

import { escapeHtml, safeHttpUrl } from "./helpers.js";

function formatDateFr(iso) {
  const d = new Date(iso + "T12:00:00");
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

function renderWeather(weather) {
  if (!weather) return "";
  const parts = [];
  if (weather.icon) {
    parts.push(`<span class="lrz-step-popup__weather-icon">${escapeHtml(weather.icon)}</span>`);
  }
  if (weather.description) {
    parts.push(`<span>${escapeHtml(weather.description)}</span>`);
  }
  const tmin = weather.temp_min ?? weather.temp_min_c;
  const tmax = weather.temp_max ?? weather.temp_max_c;
  if (tmin != null && tmax != null) {
    parts.push(`<span class="lrz-step-popup__weather-temp">• ${tmin}°–${tmax}°C</span>`);
  }
  if (!parts.length) return "";
  return `<div class="lrz-step-popup__weather">${parts.join(" ")}</div>`;
}

function renderExternalBtn(url, label, cls) {
  const safe = safeHttpUrl(url);
  if (!safe) return "";
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="lrz-step-popup__btn ${cls}">${label}</a>`;
}

export function renderStepPopup(item) {
  const date = item.date ? formatDateFr(item.date) : null;
  const distance = formatDistance(item.distance_km);
  const duration = formatDurationFr(item.duration_h);
  const elev = item.elevation_gain_m ? `${item.elevation_gain_m} m D+` : null;
  const weatherHTML = renderWeather(item.weather);
  const instaHTML = renderExternalBtn(item.instagram_url, "📷 Instagram", "lrz-step-popup__btn--insta");
  const komootHTML = renderExternalBtn(item.komoot_url, "🗺️ Komoot", "lrz-step-popup__btn--komoot");
  const hasActions = instaHTML || komootHTML;

  return `
    <div class="lrz-step-popup">
      <header class="lrz-step-popup__header">
        <strong>${escapeHtml(item.label)}</strong>
        ${date ? `<span class="lrz-step-popup__date">🗓 ${escapeHtml(date)}</span>` : ""}
      </header>
      ${weatherHTML}
      <ul class="lrz-step-popup__stats">
        ${distance ? `<li>📏 <strong>${escapeHtml(distance)}</strong></li>` : ""}
        ${duration ? `<li>⏱ <strong>${escapeHtml(duration)}</strong></li>` : ""}
        ${elev ? `<li>⛰ <strong>${escapeHtml(elev)}</strong></li>` : ""}
      </ul>
      ${hasActions ? `<div class="lrz-step-popup__actions">${instaHTML}${komootHTML}</div>` : ""}
    </div>
  `;
}
