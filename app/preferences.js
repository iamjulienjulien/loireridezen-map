/**
 * app/preferences.js — Persistance des préférences utilisateur
 *
 * Toutes les préférences (filtres, basemap, sections pliées) sont
 * stockées dans un seul objet JSON sous la clé "lrz-preferences".
 */

const KEY = "lrz-preferences";

const DEFAULTS = {
  baseLayer: "osm",
  traces: {},
  poi: {},
  photos: true,
  currentPosition: true,
  sections: {},
};

export function loadPreferences() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return { ...structuredClone(DEFAULTS), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function savePreferences(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {}
}

export function updatePreference(path, value) {
  const prefs = loadPreferences();
  const parts = path.split(".");
  let obj = prefs;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof obj[parts[i]] !== "object" || obj[parts[i]] === null) {
      obj[parts[i]] = {};
    }
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  savePreferences(prefs);
}

export function resetPreferences() {
  localStorage.removeItem(KEY);
  // Nettoyer les anciennes clés de LRZ-EVO-15 (backward compat)
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("lrz-section-")) localStorage.removeItem(key);
  }
  localStorage.removeItem("baseLayer");
}
