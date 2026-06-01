/**
 * app/step-popup.js — Rendu HTML des popups d'étape (EVO-57)
 *
 * Structure données attendue :
 *   item.weather  = { icon, description, temp }
 *   item.day      = { sunrise, sunset }
 *   item.moon     = { phase, icon, description }
 *
 * Layout encadré contexte :
 *   🗓 date
 *   🌅 sunrise · 🌇 sunset   (si day)
 *   {moon.icon} {moon.description}   (si moon)
 *   {weather.icon} {weather.description} · 🌡️{temp}°C   (si weather, en dernier)
 */

import { escapeHtml, safeHttpUrl } from "./helpers.js";
import { formatDistance, formatElevation, formatDurationFr } from "./format.js";

function formatDateFr(iso) {
  const d = new Date(iso + "T12:00:00");
  let s = d.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  s = s.replace(/\s1\s/, " 1er ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderLink(url, icon, label) {
  const safe = safeHttpUrl(url);
  if (!safe) return "";
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="lrz-step-popup__link"><span>${icon}</span> ${escapeHtml(label)}</a>`;
}

export function renderStepPopup(item, group) {
  const groupColor = group?.color || "#6b7280";
  const groupShort = (group?.label || "").split(" — ")[0].trim() || (group?.id || "");
  const step = item.step != null ? item.step : null;

  const date = item.date ? formatDateFr(item.date) : null;
  const distance = formatDistance(item.distance_km);
  const duration = formatDurationFr(item.duration_h);
  const elev = formatElevation(item.elevation_gain_m);

  const weather = item.weather || null;
  const day = item.day || null;
  const moon = item.moon || null;

  const hasContext = date || day || moon || weather;

  const komootHTML = renderLink(item.komoot_url, "🔗", "Trace GPX sur Komoot");
  const instaHTML = renderLink(item.instagram_url, "📸", "Post sur Instagram");
  const hasActions = komootHTML || instaHTML;

  const weatherLine = weather
    ? `${escapeHtml(weather.icon || "")} ${escapeHtml(weather.description || "")}${weather.temp != null ? ` · 🌡️ ${Math.round(weather.temp)}°C` : ""}`.trim()
    : null;

  return `
    <div class="lrz-step-popup" style="--step-group-color:${escapeHtml(groupColor)}">
      <header class="lrz-step-popup__header">
        <div class="lrz-step-popup__header-left">
          <div class="lrz-step-popup__badges">
            <span class="lrz-step-popup__badge lrz-step-popup__badge--group">${escapeHtml(groupShort)}</span>
            ${step != null ? `<span class="lrz-step-popup__badge lrz-step-popup__badge--step">Étape ${step}</span>` : ""}
          </div>
          <strong class="lrz-step-popup__label">${escapeHtml(item.label)}</strong>
        </div>
        <button class="lrz-step-popup__close" aria-label="Fermer">✕</button>
      </header>
      ${hasContext ? `
        <div class="lrz-step-popup__context">
          ${date ? `<div class="lrz-step-popup__date">🗓 ${escapeHtml(date)}</div>` : ""}
          ${day?.sunrise && day?.sunset ? `<div class="lrz-step-popup__astro">🌅 ${escapeHtml(day.sunrise)} · 🌇 ${escapeHtml(day.sunset)}</div>` : ""}
          ${moon?.icon ? `<div class="lrz-step-popup__moon">${escapeHtml(moon.icon)} ${escapeHtml(moon.description || "")}</div>` : ""}
          ${weatherLine ? `<div class="lrz-step-popup__weather">${weatherLine}</div>` : ""}
        </div>` : ""}
      <ul class="lrz-step-popup__stats">
        ${distance ? `<li>📊 <strong>${escapeHtml(distance)}</strong></li>` : ""}
        ${duration ? `<li>⌚️ <strong>${escapeHtml(duration)}</strong></li>` : ""}
        ${elev ? `<li>⛰️ <strong>${escapeHtml(elev)}</strong></li>` : ""}
      </ul>
      ${hasActions ? `<div class="lrz-step-popup__actions">${komootHTML}${instaHTML}</div>` : ""}
    </div>
  `;
}
