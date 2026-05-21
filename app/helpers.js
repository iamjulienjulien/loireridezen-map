/**
 * app/helpers.js — Fonctions utilitaires pures
 *
 * Pas de dépendance Leaflet ni DOM, juste des helpers réutilisables.
 */

/**
 * Échappe les caractères HTML dangereux pour insertion dans innerHTML.
 * À utiliser pour toute valeur venant de la DB ou d'une source externe.
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Valide qu'une URL est bien http:// ou https://.
 * Empêche les injections `javascript:`, `data:`, etc.
 * Retourne l'URL trimée si valide, null sinon.
 */
export function safeHttpUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Éclaircit une couleur hex en la mélangeant avec du blanc.
 * factor=0 → couleur originale, factor=1 → blanc pur.
 */
export function lightenHex(hex, factor = 0.8) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * factor);
  const lg = Math.round(g + (255 - g) * factor);
  const lb = Math.round(b + (255 - b) * factor);
  return `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
}

/**
 * Debounce : retarde l'exécution de fn tant que des appels arrivent.
 * Utile pour `moveend` de Leaflet (évite un fetch à chaque pixel).
 */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
