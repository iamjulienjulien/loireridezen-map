/**
 * app/geo-utils.js — Utilitaires géographiques partagés
 */

const EARTH_RADIUS_M = 6371000;

function _toRad(deg) { return (deg * Math.PI) / 180; }

function haversine(lat1, lng1, lat2, lng2) {
  const dLat = _toRad(lat2 - lat1);
  const dLng = _toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Retourne le vertex de la trace le plus éloigné du premier point (vol d'oiseau).
 * @param {Array<[number, number]>} coords - Coordonnées [lng, lat] (format GeoJSON)
 * @returns {{ lng: number, lat: number, index: number, distance: number } | null}
 */
export function farthestPointFromStart(coords) {
  if (!coords || coords.length < 2) return null;
  const [lng0, lat0] = coords[0];
  let maxDist = -1, maxIdx = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = haversine(lat0, lng0, coords[i][1], coords[i][0]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  const [lng, lat] = coords[maxIdx];
  return { lng, lat, index: maxIdx, distance: maxDist };
}
