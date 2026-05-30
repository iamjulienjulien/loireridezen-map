/**
 * app/step-popup.js — Rendu HTML des popups d'étape (EVO-55)
 *
 * Layout : en-tête (badge acte + label + fermer) · contexte (date + soleil + lune)
 *          · météo · stats · liens.
 */

import { escapeHtml, safeHttpUrl } from "./helpers.js";

function formatDateFr(iso) {
  const d = new Date(iso + "T12:00:00");
  let s = d.toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  s = s.replace(/\s1\s/, " 1er ");
  return s.charAt(0).toUpperCase() + s.slice(1);
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

function moonPhaseEmoji(phase) {
  if (phase == null) return null;
  if (phase < 0.0625) return "🌑";
  if (phase < 0.1875) return "🌒";
  if (phase < 0.3125) return "🌓";
  if (phase < 0.4375) return "🌔";
  if (phase < 0.5625) return "🌕";
  if (phase < 0.6875) return "🌖";
  if (phase < 0.8125) return "🌗";
  if (phase < 0.9375) return "🌘";
  return "🌑";
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
  const elev = item.elevation_gain_m ? `${item.elevation_gain_m} m D+` : null;

  const weatherEmoji = item.weather_emoji || null;
  const weatherDesc = item.weather_desc || null;
  const tempC = item.temp_c != null ? `${item.temp_c}°C` : null;
  const hasWeather = weatherEmoji || weatherDesc || tempC;

  const sunrise = item.sunrise || null;
  const sunset = item.sunset || null;
  const moonEmoji = moonPhaseEmoji(item.moon_phase);
  const hasAstro = sunrise || sunset || moonEmoji;
  const hasContext = date || hasAstro;

  const instaHTML = renderExternalBtn(item.instagram_url, "📷 Instagram", "lrz-step-popup__btn--insta", item.id);
  const komootHTML = renderExternalBtn(item.komoot_url, "🗺️ Komoot", "lrz-step-popup__btn--komoot", item.id);
  const hasActions = instaHTML || komootHTML;

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
          ${hasAstro ? `
            <div class="lrz-step-popup__astro">
              ${sunrise && sunset ? `<span>🌅 ${escapeHtml(sunrise)} – ${escapeHtml(sunset)}</span>` : ""}
              ${moonEmoji ? `<span>${moonEmoji}</span>` : ""}
            </div>` : ""}
        </div>` : ""}
      ${hasWeather ? `
        <div class="lrz-step-popup__weather">
          ${weatherEmoji ? `<span class="lrz-step-popup__weather-icon">${escapeHtml(weatherEmoji)}</span>` : ""}
          ${weatherDesc ? `<span class="lrz-step-popup__weather-desc">${escapeHtml(weatherDesc)}</span>` : ""}
          ${tempC ? `<span class="lrz-step-popup__weather-temp">· ${escapeHtml(tempC)}</span>` : ""}
        </div>` : ""}
      <ul class="lrz-step-popup__stats">
        ${distance ? `<li>📏 <strong>${escapeHtml(distance)}</strong></li>` : ""}
        ${duration ? `<li>⏱ <strong>${escapeHtml(duration)}</strong></li>` : ""}
        ${elev ? `<li>⛰ <strong>${escapeHtml(elev)}</strong></li>` : ""}
      </ul>
      ${hasActions ? `<div class="lrz-step-popup__actions">${instaHTML}${komootHTML}</div>` : ""}
    </div>
  `;
}
