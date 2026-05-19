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
