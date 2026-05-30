/**
 * app/format.js — Helpers de formatage pour popup et export (EVO-57).
 */

export function formatTemp(c) {
  if (c == null) return null;
  return `${Math.round(c)}°C`;
}

export function formatDistance(km) {
  if (km == null) return null;
  return `${Math.round(km)} km`;
}

export function formatElevation(m) {
  if (m == null) return null;
  return `${Math.round(m)} m D+`;
}

export function formatDurationFr(h) {
  if (!h) return null;
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  return mins ? `${hours} h ${mins.toString().padStart(2, "0")}` : `${hours} h`;
}
