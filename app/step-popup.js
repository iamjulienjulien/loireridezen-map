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

function renderExternalBtn(url, label, cls, stepId) {
  const safe = safeHttpUrl(url);
  if (!safe) return "";
  return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer" class="lrz-step-popup__btn ${cls}" data-step-id="${escapeHtml(stepId || '')}">${label}</a>`;
}

export function renderStepPopup(item, group) {
  const groupColor = group?.color || "#6b7280";
  const groupShort = (group?.label || "").split(" — ")[0].trim() || (group?.id || "");

  const date = item.date ? formatDateFr(item.date) : null;
  const distance = formatDistance(item.distance_km);
  const duration = formatDurationFr(item.duration_h);
  const elev = formatElevation(item.elevation_gain_m);

  const weather = item.weather || null;
  const day = item.day || null;
  const moon = item.moon || null;

  const hasContext = date || day || moon || weather;

  const instaHTML = renderExternalBtn(item.instagram_url, "📷 Instagram", "lrz-step-popup__btn--insta", item.id);
  const komootHTML = renderExternalBtn(item.komoot_url, "🗺️ Komoot", "lrz-step-popup__btn--komoot", item.id);
  const hasActions = instaHTML || komootHTML;

  const weatherLine = weather
    ? `${escapeHtml(weather.icon || "")} ${escapeHtml(weather.description || "")}${weather.temp != null ? ` · 🌡️${Math.round(weather.temp)}°C` : ""}`.trim()
    : null;

  return `
    <div class="lrz-step-popup" style="--step-group-color:${escapeHtml(groupColor)}">
      <header class="lrz-step-popup__header">
        <div class="lrz-step-popup__header-left">
          <span class="lrz-step-popup__group-badge">${escapeHtml(groupShort)}</span>
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
        ${duration ? `<li>⌚️ <strong>${escapeHtml(duration)} de vélo</strong></li>` : ""}
        ${elev ? `<li>⛰️ <strong>${escapeHtml(elev)}</strong></li>` : ""}
      </ul>
      ${hasActions ? `<div class="lrz-step-popup__actions">${instaHTML}${komootHTML}</div>` : ""}
    </div>
  `;
}
