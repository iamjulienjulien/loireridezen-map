/**
 * app/carnets/state.js — Persistance et bascule du carnet actif
 */

import { CARNETS_REGISTRY, DEFAULT_CARNET_KEY, CARNET_MAP } from "./registry.js";
import { applyCarnet } from "./apply.js";
import { showAccroche } from "./accroche.js";

const STORAGE_KEY = "lrz_carnet";

/** Migration one-shot depuis l'ancien système lrz_theme → lrz_carnet. */
export function migrateLocalStorage() {
  const oldTheme = localStorage.getItem("lrz_theme");
  if (oldTheme && !localStorage.getItem(STORAGE_KEY)) {
    const mapping = {
      "tuffeau":    "or-tuffeau",
      "or-tuffeau": "or-tuffeau",
      "ardoise":    "loire-velo",
      "etat-major": "patrimoine",
      "loire-velo": "loire-velo",
      "grand-air":  "grand-air",
    };
    const newKey = mapping[oldTheme] ?? DEFAULT_CARNET_KEY;
    localStorage.setItem(STORAGE_KEY, newKey);
    localStorage.removeItem("lrz_theme");
  }
}

export function getCurrentCarnetKey() {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_CARNET_KEY;
}

export function getCurrentCarnet() {
  return CARNET_MAP.get(getCurrentCarnetKey()) ?? CARNET_MAP.get(DEFAULT_CARNET_KEY);
}

export function setCarnet(key, { withAccroche = true } = {}) {
  const carnet = CARNET_MAP.get(key);
  if (!carnet) return;
  localStorage.setItem(STORAGE_KEY, key);
  applyCarnet(carnet);
  _syncSelectorUI(key);
  if (withAccroche) showAccroche(carnet);
}

function _syncSelectorUI(key) {
  document.querySelectorAll("[data-carnet]").forEach((btn) => {
    const isActive = btn.dataset.carnet === key;
    btn.classList.toggle("lrz-carnet-btn--active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });
}

export { CARNETS_REGISTRY };
