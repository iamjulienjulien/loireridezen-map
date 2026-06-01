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
  if (!h || h <= 0) return null;
  const totalMin = Math.round(h * 60);
  if (totalMin < 60) return `${totalMin} min`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return mins
    ? `${hours} h ${String(mins).padStart(2, "0")} de vélo`
    : `${hours} h de vélo`;
}
